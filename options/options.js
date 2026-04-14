'use strict';

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const detectedDomainEl = document.getElementById('detected-domain');
const detectedSourceEl = document.getElementById('detected-source');
const domainListEl = document.getElementById('domain-list');
const newDomainInput = document.getElementById('new-domain');
const addBtn = document.getElementById('add-btn');
const errorMsg = document.getElementById('error-msg');

// ─── State ────────────────────────────────────────────────────────────────────

let additionalDomains = [];

// ─── Storage ──────────────────────────────────────────────────────────────────

function loadSettings() {
  chrome.storage.sync.get(['detectedDomain', 'additionalDomains'], (data) => {
    const detected = data.detectedDomain || null;
    additionalDomains = data.additionalDomains || [];

    if (detected) {
      detectedDomainEl.textContent = detected;
      detectedSourceEl.textContent = '(auto-detected)';
    } else {
      detectedDomainEl.textContent = 'Not yet detected';
      detectedSourceEl.textContent = '(open Gmail to detect)';
    }

    renderList();
  });
}

function saveAdditionalDomains() {
  chrome.storage.sync.set({ additionalDomains }, () => {
    renderList();
  });
}

// ─── Validation ───────────────────────────────────────────────────────────────

const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;

function validateDomain(value) {
  if (!value) return 'Please enter a domain.';
  if (!DOMAIN_RE.test(value)) return 'Enter a valid domain (e.g. example.com).';
  if (additionalDomains.includes(value)) return 'This domain is already in the list.';
  return null;
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function clearError() {
  errorMsg.textContent = '';
  errorMsg.classList.add('hidden');
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderList() {
  domainListEl.innerHTML = '';

  if (additionalDomains.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'domain-item domain-item--empty';
    empty.textContent = 'No additional domains added yet.';
    domainListEl.appendChild(empty);
    return;
  }

  additionalDomains.forEach((domain, index) => {
    const item = document.createElement('li');
    item.className = 'domain-item';

    const label = document.createElement('span');
    label.className = 'domain-item-label';
    label.textContent = domain;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-remove';
    removeBtn.setAttribute('aria-label', `Remove ${domain}`);
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeDomain(index));

    item.appendChild(label);
    item.appendChild(removeBtn);
    domainListEl.appendChild(item);
  });
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function addDomain() {
  const value = newDomainInput.value.trim().toLowerCase();
  const error = validateDomain(value);

  if (error) {
    showError(error);
    return;
  }

  clearError();
  additionalDomains = [...additionalDomains, value];
  newDomainInput.value = '';
  saveAdditionalDomains();
}

function removeDomain(index) {
  additionalDomains = additionalDomains.filter((_, i) => i !== index);
  saveAdditionalDomains();
}

// ─── Event listeners ──────────────────────────────────────────────────────────

addBtn.addEventListener('click', addDomain);

newDomainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addDomain();
});

newDomainInput.addEventListener('input', () => {
  if (errorMsg.textContent) clearError();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

loadSettings();
