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

// ─── Action handlers ───────────────────────────────────────────────────────────

/**
 * Trigger a reply scoped to internal-domain recipients only.
 * Currently surfaces a console log + alert stub; compose integration
 * requires access to Gmail's JS API and will be wired in a follow-up.
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

  // TODO: open Gmail compose pre-populated with `internal` addresses.
  console.log('[Sidebar] Internal-only recipients:', internal);
  alert('[Sidebar] Internal only → ' + internal.join(', ') + '\n(compose integration coming soon)');
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
