// Service worker — initializes default storage on install and handles Gmail
// label operations on behalf of the content script.

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;

  await chrome.storage.sync.set({
    additionalDomains: [],
    detectedDomain: null,
  });
});

// ─── Gmail API helpers ────────────────────────────────────────────────────────

async function getAuthToken() {
  const { token } = await chrome.identity.getAuthToken({ interactive: true });
  if (!token) throw new Error('Failed to obtain auth token.');
  return token;
}

/**
 * Returns the ID of the "Sidebar" label, creating it (blue) if it doesn't
 * already exist in the user's account.
 */
async function getOrCreateSidebarLabel(token) {
  const listRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/labels',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!listRes.ok) throw new Error(`Labels list failed: ${listRes.status}`);

  const { labels = [] } = await listRes.json();
  const existing = labels.find((l) => l.name === 'Sidebar');
  if (existing) return existing.id;

  // Label not found — create it with a blue colour.
  const createRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/labels',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Sidebar',
        color: {
          backgroundColor: '#4986e7',
          textColor: '#ffffff',
        },
      }),
    }
  );
  if (!createRes.ok) throw new Error(`Label create failed: ${createRes.status}`);
  const { id } = await createRes.json();
  return id;
}

/**
 * Adds the given label to a thread via threads.modify.
 */
async function applyLabelToThread(token, threadId, labelId) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ addLabelIds: [labelId] }),
    }
  );
  if (!res.ok) throw new Error(`Thread modify failed: ${res.status}`);
}

// ─── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getAuthToken') {
    const { threadId } = msg;
    (async () => {
      try {
        const token = await getAuthToken();
        console.log('[Sidebar] OAuth token retrieved successfully.');

        console.log(`[Sidebar] Thread ID from URL: ${threadId}`);
        const labelId = await getOrCreateSidebarLabel(token);
        await applyLabelToThread(token, threadId, labelId);
        console.log(`[Sidebar] "Sidebar" label applied to thread ${threadId}`);

        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Sidebar] getAuthToken error:', err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // Keep channel open for async sendResponse
  }

  return false;
});
