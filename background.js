// Service worker — initializes default storage on install.

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;

  await chrome.storage.sync.set({
    additionalDomains: [],
    detectedDomain: null,
  });
});
