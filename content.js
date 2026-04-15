/**
 * Sidebar for Gmail — content script
 *
 * Injection strategy:
 *   - Target [data-message-id] elements (stable Gmail attribute, not class names).
 *   - Use data-sidebar-injected sentinel to prevent duplicate injection.
 *   - MutationObserver watches for new messages as threads expand.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const SENTINEL = 'data-sidebar-injected';

// ─── Domain detection ─────────────────────────────────────────────────────────

/**
 * Attempt to read the signed-in user's email from stable Gmail DOM attributes.
 * Gmail renders the account button with an aria-label like:
 *   "Google Account: Display Name (user@domain.com)"
 * and some elements carry a data-email attribute directly.
 */
function detectUserEmail() {
  // Strategy 1: explicit data-email attribute
  const withDataEmail = document.querySelector('[data-email]');
  if (withDataEmail) {
    const email = withDataEmail.getAttribute('data-email');
    if (email && email.includes('@')) return email;
  }

  // Strategy 2: Google Account button aria-label
  const accountBtn = document.querySelector('[aria-label*="Google Account"]');
  if (accountBtn) {
    const label = accountBtn.getAttribute('aria-label') || '';
    const match = label.match(/\(([^\s)]+@[^\s)]+)\)/);
    if (match) return match[1];
  }

  // Strategy 3: a[href] containing accounts.google.com with authuser hint
  // (fallback — domain only from URL)
  const url = new URL(window.location.href);
  const authuser = url.searchParams.get('authuser');
  if (authuser && authuser.includes('@')) return authuser;

  return null;
}

function domainFromEmail(email) {
  if (!email || !email.includes('@')) return null;
  return email.split('@')[1].toLowerCase();
}

// ─── Storage helpers ───────────────────────────────────────────────────────────

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['detectedDomain', 'additionalDomains'], (data) => {
      resolve({
        detectedDomain: data.detectedDomain || null,
        additionalDomains: data.additionalDomains || [],
      });
    });
  });
}

async function saveDetectedDomain(domain) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ detectedDomain: domain }, resolve);
  });
}

function allInternalDomains(settings) {
  const domains = new Set();
  if (settings.detectedDomain) domains.add(settings.detectedDomain);
  for (const d of settings.additionalDomains) {
    if (d) domains.add(d.toLowerCase());
  }
  return [...domains];
}

// ─── Gmail recipient parsing ───────────────────────────────────────────────────

/**
 * Extract recipient email addresses visible within a message container.
 * Gmail renders To/Cc recipients in [email] or [data-hovercard-id] attributes
 * on <span> elements inside the message header.
 */
function parseMessageRecipients(messageEl) {
  const emails = new Set();

  // Elements with data-hovercard-id often contain email@domain strings
  messageEl.querySelectorAll('[data-hovercard-id]').forEach((el) => {
    const val = el.getAttribute('data-hovercard-id') || '';
    if (val.includes('@')) emails.add(val.toLowerCase());
  });

  // Elements with email attribute
  messageEl.querySelectorAll('[email]').forEach((el) => {
    const val = el.getAttribute('email') || '';
    if (val.includes('@')) emails.add(val.toLowerCase());
  });

  return [...emails];
}

// ─── Message data extraction ───────────────────────────────────────────────────

/**
 * Extract the thread subject from the page title.
 * Gmail sets document.title to "Subject - user@domain.com - Gmail".
 */
function getThreadSubject() {
  // Strip everything from the first " - " that precedes an email address onward.
  // Handles titles like "Subject - user@domain.com - ITV Mail" or "Subject - Gmail".
  return document.title
    .replace(/\s+-\s+[^\s@]+@.+$/, '')
    .replace(/\s+-\s+Gmail\s*$/, '')
    .trim() || '(no subject)';
}

/**
 * Extract the sender's email address from the message header.
 * Gmail renders the From address on an element with an [email] attribute.
 */
function getMessageSender(messageEl) {
  const el = messageEl.querySelector('[email]');
  return el ? el.getAttribute('email') : '';
}

/**
 * Extract a human-readable date string from the message header.
 * Gmail renders the timestamp on a <span> or <td> with a [title] attribute
 * containing the full date, falling back to [datetime] on a <time> element.
 */
function getMessageDate(messageEl) {
  const timeEl = messageEl.querySelector('[datetime]');
  if (timeEl) {
    const dt = timeEl.getAttribute('datetime');
    try {
      return new Date(dt).toLocaleString(undefined, {
        weekday: 'short', year: 'numeric', month: 'short',
        day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch (_) { return dt; }
  }
  return '';
}

/**
 * Extract the plain-text body of a message.
 * Targets [dir="ltr"] which Gmail sets on the message body container —
 * a stable structural attribute that avoids class-name coupling.
 */
function getMessageBodyText(messageEl) {
  const bodyEl = messageEl.querySelector('[dir="ltr"]');
  return (bodyEl || messageEl).innerText.trim();
}

/**
 * Build a quoted-reply body string in standard email format.
 */
function buildQuotedBody(messageEl) {
  const sender = getMessageSender(messageEl);
  const date   = getMessageDate(messageEl);
  const body   = getMessageBodyText(messageEl);

  const header = [date, sender].filter(Boolean).join(', ');
  const intro  = header ? `On ${header} wrote:` : '';
  const quoted = body.split('\n').map((l) => '> ' + l).join('\n');

  return '\n\n' + (intro ? intro + '\n' : '') + quoted;
}

// ─── Action handlers ───────────────────────────────────────────────────────────

/**
 * Inject a value into a plain input/textarea compose field (e.g. Subject)
 * by simulating real input events so Gmail's React-based UI registers the change.
 */
function setComposeField(fieldEl, value) {
  fieldEl.focus();
  fieldEl.value = value;
  fieldEl.dispatchEvent(new Event('input',  { bubbles: true }));
  fieldEl.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Add recipient addresses one-by-one into Gmail's To field.
 *
 * Gmail's To field is a <div aria-label="To"> containing a child <input>.
 * Setting .value on the div doesn't work — we must target the inner input,
 * then fire input/change so Gmail's autocomplete activates, followed by a
 * synthetic Enter keydown (keyCode 13) to tokenize the address.
 * A 150ms gap between each address prevents race conditions in the tokenizer.
 */
function addRecipientsToToField(toDiv, addresses) {
  const input = toDiv.querySelector('input');
  if (!input) {
    console.warn('[Sidebar] Could not find inner <input> inside To field.');
    return;
  }

  function addNext(i) {
    if (i >= addresses.length) return;
    input.focus();
    input.value = addresses[i];
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 13, which: 13, key: 'Enter' }));
    setTimeout(() => addNext(i + 1), 150);
  }

  addNext(0);
}

/**
 * Click Gmail's native Compose button to open the compose tray, then
 * populate the To and Subject fields once the tray has rendered.
 */
function triggerInternalOnlyReply(messageEl, internalDomains) {
  const recipients = parseMessageRecipients(messageEl);
  const internal = recipients.filter((email) =>
    internalDomains.some((d) => email.endsWith('@' + d))
  );

  if (internal.length === 0) {
    alert('[Sidebar] No internal recipients found in this message.');
    return;
  }

  // Find the Compose button by iterating all role="button" elements and
  // matching on text content — the most resilient approach since Gmail's
  // compose button has no stable attribute but always reads "Compose".
  const composeBtn = Array.from(document.querySelectorAll('[role="button"]'))
    .find((el) => el.innerText.trim() === 'Compose');

  if (!composeBtn) {
    console.warn('[Sidebar] Could not find Gmail compose button by text match.');
    return;
  }
  console.log('[Sidebar] Compose button found via text match:', composeBtn);
  composeBtn.click();

  // Wait for the compose tray to render, then populate To and Subject.
  // 500ms is enough for Gmail's compose animation to complete in practice.
  setTimeout(() => {
    const toField      = document.querySelector('[aria-label="To"]');
    const subjectField = document.querySelector('[aria-label="Subject"]');

    console.log('[Sidebar] Compose fields — To:', toField, '| Subject:', subjectField);

    if (toField) {
      addRecipientsToToField(toField, internal);
    } else {
      console.warn('[Sidebar] Could not find To field in compose tray.');
    }

    // Delay Subject population until all recipients have been tokenized.
    // internal.length * 150ms covers the per-address gaps + a small buffer.
    const subjectDelay = 200 + internal.length * 150;
    setTimeout(() => {
      if (subjectField) setComposeField(subjectField, 'Re: ' + getThreadSubject());
      else console.warn('[Sidebar] Could not find Subject field in compose tray.');
    }, subjectDelay);
  }, 500);
}

/**
 * Open the recipient picker modal.
 * TODO: implement full picker UI.
 */
function triggerSelectRecipients(messageEl, internalDomains) {
  const recipients = parseMessageRecipients(messageEl);
  console.log('[Sidebar] All recipients:', recipients, '| Internal domains:', internalDomains);
  alert('[Sidebar] Select Recipients coming soon.\nDetected: ' + recipients.join(', '));
}

// ─── Popover ───────────────────────────────────────────────────────────────────

let activePopover = null;

function closeActivePopover() {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
}

function createPopover(anchorEl, messageEl, settings) {
  closeActivePopover();

  const domains = allInternalDomains(settings);

  const popover = document.createElement('div');
  popover.className = 'sidebar-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Sidebar reply options');

  // ── Actions ──
  const actions = [
    {
      label: 'ITV Internal Only',
      description: domains.length
        ? 'Reply to ' + domains.join(', ') + ' recipients only'
        : 'No internal domain configured — check Settings',
      handler: () => { closeActivePopover(); triggerInternalOnlyReply(messageEl, domains); },
    },
    {
      label: 'Select Recipients',
      description: 'Choose exactly who receives your reply',
      handler: () => { closeActivePopover(); triggerSelectRecipients(messageEl, domains); },
    },
  ];

  const list = document.createElement('ul');
  list.className = 'sidebar-popover-list';

  for (const action of actions) {
    const item = document.createElement('li');
    item.className = 'sidebar-popover-item';

    const btn = document.createElement('button');
    btn.className = 'sidebar-popover-btn';
    btn.addEventListener('click', action.handler);

    const labelEl = document.createElement('span');
    labelEl.className = 'sidebar-popover-label';
    labelEl.textContent = action.label;

    const descEl = document.createElement('span');
    descEl.className = 'sidebar-popover-desc';
    descEl.textContent = action.description;

    btn.appendChild(labelEl);
    btn.appendChild(descEl);
    item.appendChild(btn);
    list.appendChild(item);
  }

  // ── Footer ──
  const footer = document.createElement('div');
  footer.className = 'sidebar-popover-footer';

  const footerLink = document.createElement('a');
  footerLink.href = 'https://chrome.google.com/webstore'; // placeholder
  footerLink.target = '_blank';
  footerLink.rel = 'noopener noreferrer';
  footerLink.textContent = '⬡ Sidebar';
  footerLink.className = 'sidebar-popover-footer-link';

  footer.appendChild(footerLink);

  popover.appendChild(list);
  popover.appendChild(footer);

  // ── Positioning ──
  document.body.appendChild(popover);
  activePopover = popover;

  const anchorRect = anchorEl.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();

  let top = anchorRect.bottom + window.scrollY + 6;
  let left = anchorRect.left + window.scrollX;

  // Keep popover within viewport horizontally
  const rightEdge = left + popoverRect.width;
  if (rightEdge > window.innerWidth - 12) {
    left = window.innerWidth - popoverRect.width - 12;
  }

  popover.style.top = top + 'px';
  popover.style.left = left + 'px';

  // ── Dismiss on outside click ──
  function onOutsideClick(e) {
    if (!popover.contains(e.target) && e.target !== anchorEl) {
      closeActivePopover();
      document.removeEventListener('mousedown', onOutsideClick, true);
    }
  }
  // Defer so this click doesn't immediately close the popover
  setTimeout(() => document.addEventListener('mousedown', onOutsideClick, true), 0);
}

// ─── Button injection ──────────────────────────────────────────────────────────

/**
 * Find the best anchor point for the Sidebar button within a message.
 * We look for the native action bar by stable attributes, not class names.
 */
function findActionBar(messageEl) {
  // Prefer the toolbar that contains the Reply button
  const replyBtn =
    messageEl.querySelector('[data-tooltip="Reply"]') ||
    messageEl.querySelector('[aria-label="Reply"]');

  if (replyBtn) return replyBtn.closest('[role="toolbar"]') || replyBtn.parentElement;

  // Fallback: any role=toolbar inside the message
  return messageEl.querySelector('[role="toolbar"]');
}

function injectButton(messageEl, settings) {
  if (messageEl.hasAttribute(SENTINEL)) return;
  messageEl.setAttribute(SENTINEL, 'true');

  const actionBar = findActionBar(messageEl);
  if (!actionBar) {
    // Message may be collapsed — observer will retry when it expands
    messageEl.removeAttribute(SENTINEL);
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'sidebar-btn-wrapper';

  const btn = document.createElement('button');
  btn.className = 'sidebar-btn';
  btn.setAttribute('aria-label', 'Open Sidebar reply options');
  btn.setAttribute('title', 'Sidebar');
  btn.textContent = '⬡';

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    createPopover(btn, messageEl, settings);
  });

  wrapper.appendChild(btn);
  actionBar.appendChild(wrapper);
}

// ─── Observer ─────────────────────────────────────────────────────────────────

function processMessages(settings) {
  document.querySelectorAll('[data-message-id]').forEach((el) => {
    if (!el.hasAttribute(SENTINEL)) {
      injectButton(el, settings);
    }
  });
}

function startObserver(settings) {
  // Re-process on any subtree mutation — Gmail is highly dynamic
  const observer = new MutationObserver(() => processMessages(settings));

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Initial pass
  processMessages(settings);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  const settings = await loadSettings();

  // Detect and persist the user's domain if not already stored
  if (!settings.detectedDomain) {
    const email = detectUserEmail();
    const domain = domainFromEmail(email);
    if (domain) {
      settings.detectedDomain = domain;
      await saveDetectedDomain(domain);
    }
  }

  startObserver(settings);

  // Re-attempt domain detection after Gmail finishes loading
  if (!settings.detectedDomain) {
    setTimeout(async () => {
      const email = detectUserEmail();
      const domain = domainFromEmail(email);
      if (domain) {
        settings.detectedDomain = domain;
        await saveDetectedDomain(domain);
      }
    }, 3000);
  }
}

init();
