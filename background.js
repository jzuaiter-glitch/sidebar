// Service worker — initializes default storage on install and proxies OAuth
// token requests from the content script.

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;

  await chrome.storage.sync.set({
    additionalDomains: [],
    detectedDomain: null,
  });
});

// ─── OAuth token proxy ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'getAuthToken') return false;

  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message });
    } else if (!token) {
      sendResponse({ ok: false, error: 'getAuthToken returned no token' });
    } else {
      sendResponse({ ok: true, token });
    }
  });

  return true; // keep channel open for async sendResponse
});
