# Sidebar — Project Summary & Build Template

## What We Built

A Chrome extension called **Sidebar** that injects a smart reply button (⬡) into every message in a Gmail thread. Clicking it opens a popover with three reply options: Reply All, ITV Internal Only, and Select Recipients. The extension auto-detects the user's internal email domain and allows additional domains to be added via a settings page.

**Repo:** github.com/jzuaiter-glitch/sidebar  
**Status as of session end:** Button injecting successfully, popover rendering, options visible. Compose window integration (the actual sending logic) is the next phase.

---

## Decisions Made

### Platform
- **Chrome extension** (not a Gmail Add-on) because we needed DOM injection — the ability to place a button directly inside Gmail's thread UI. Gmail Add-ons are confined to a sidebar panel and can't do this.

### Architecture
- **Manifest V3** — the current Chrome extension standard
- **MutationObserver** watching `document.body` for DOM changes, since Gmail is a single-page app that doesn't trigger page reloads
- **Stable selectors only** — targeting `[data-message-id]`, `[role="toolbar"]`, `[aria-label]`, etc. Zero Gmail class names, which change frequently and break extensions
- **Sentinel pattern** — a `data-sidebar-injected` attribute is set on injection and checked before every inject, preventing duplicate buttons on re-renders

### Domain Detection (Option 3)
- Auto-detects the user's domain from their signed-in Gmail address on first run
- Settings page allows adding additional internal domains
- All domain data persisted in `chrome.storage.sync` (follows the user across devices)
- Filtering logic: `email.endsWith('@domain.com')` against the stored domain list

### UI
- Single ⬡ button injected per message (not a cluster of buttons)
- Popover opens on click with three options
- **Reply All** — mirrors native Gmail behavior
- **ITV Internal Only** — filters to domain-matched recipients only
- **Select Recipients** — checkbox UI for surgical control (stubbed, next phase)
- Subtle **⬡ Sidebar** footer with Chrome Web Store link placeholder

### Options Cut
- **Reply to Sender** was considered and cut — the native Gmail Reply button already does this
- Reply All was kept in the popover for consistency and recipient preview, but is lowest priority

### Open Source
- **MIT license** — maximum adoption, no friction for forks or internal deployments
- Hosted on GitHub under personal account (not ITV) to ensure Jon owns it regardless of employment
- OAuth credentials (Google Cloud project) also set up under personal account for the same reason

---

## How the GitHub Repo Was Created

1. Signed into github.com with personal account (`jzuaiter-glitch`)
2. Created new repository named `sidebar`, set to **Public**
3. Checked **Add a README file** and set license to **MIT**
4. Cloned locally via terminal: `git clone https://github.com/jzuaiter-glitch/sidebar.git`
5. Configured git identity (required on first commit):
   ```bash
   git config --global user.email "jzuaiter@me.com"
   git config --global user.name "Jon Zuaiter"
   ```
6. Updated remote URL to include username for authentication:
   ```bash
   git remote set-url origin https://jzuaiter-glitch@github.com/jzuaiter-glitch/sidebar.git
   ```
7. Configured macOS Keychain to store credentials so token is only entered once:
   ```bash
   git config --global credential.helper osxkeychain
   ```
8. First push used a GitHub Personal Access Token (Settings → Developer settings → Tokens (classic) → repo scope)

---

## Tools & Environment

| Tool | Purpose |
|---|---|
| Claude Code (CLI) | Built and scaffolded all project files directly in the repo folder |
| Visual Studio Code | Editor and integrated terminal |
| GitHub | Version control and open source hosting |
| Chrome (Developer Mode) | Loading and testing the unpacked extension |
| Google Cloud Console | OAuth credentials and Gmail API access (personal account) |

**Claude Code install:**
```bash
sudo npm install -g @anthropic-ai/claude-code
claude  # run from inside project folder
```

---

## Project File Structure

```
sidebar/
├── manifest.json         ← Extension config, permissions, Manifest V3
├── content.js            ← MutationObserver, DOM injection, popover logic
├── content.css           ← Popover and button styles
├── background.js         ← OAuth token handling, Gmail API calls
├── options/
│   ├── options.html      ← Settings UI
│   └── options.js        ← Domain management logic
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── CLAUDE.md             ← Session memory file for Claude Code
├── LICENSE               ← MIT
└── README.md
```

---

## Standard Git Workflow (use after every meaningful session)

```bash
git add .
git commit -m "Description of what changed"
git push
```

---

## Next Steps

1. **Wire up ITV Internal Only** — open Gmail compose window pre-populated with only domain-matched recipients
2. **Build Select Recipients UI** — checkbox popover showing all thread recipients, user selects subset, compose opens with that list
3. **Connect Reply All** — delegate to Gmail's native Reply All button
4. **Replace placeholder icons** — design or commission final ⬡ icon in three sizes
5. **OAuth verification** — if distributing publicly, submit for Google's OAuth review (not needed for internal use)
6. **Chrome Web Store listing** — create developer account, submit extension, update footer link
7. **README** — add screenshots/GIF of popover in action, install instructions, Google Cloud setup guide for forks

---

## Template: Starting a New Project Like This

Use this sequence for any future Chrome extension, CLI tool, or open source project:

### Phase 1: Design (in chat)
- Define the exact problem and who has it
- Decide what the tool does and what it explicitly does not do
- Choose the right platform (extension vs. add-on vs. web app vs. CLI)
- Sketch the UI and user flow before writing any code
- Make architecture decisions (data storage, auth, selectors, etc.)
- Do competitive research: Chrome Web Store, GitHub, Product Hunt, Reddit

### Phase 2: Setup
- Create GitHub repo (personal account, Public, MIT license, with README)
- Install Claude Code: `sudo npm install -g @anthropic-ai/claude-code`
- Clone repo locally and open in VS Code
- Configure git identity and credential helper
- Create terminal alias for fast re-entry: `alias projectname="cd ~/projectname && claude"`

### Phase 3: Build (in Claude Code)
- Write a single handoff prompt summarizing all design decisions
- Let Claude Code scaffold the full file structure in one pass
- Approve all edits for the session at once (option 2)
- Test immediately — load unpacked in Chrome, open the target page
- Commit working state before adding new features: `git add . && git commit -m "message" && git push`
- Create a `CLAUDE.md` file so future sessions start with full context

### Phase 4: Distribute
- Internal: share unpacked folder or push via MDM/Google Admin
- Public: Chrome Web Store developer account ($5 one-time), OAuth scope review, privacy policy required
- Open source: README with screenshots, setup instructions for forks, link from in-app footer

---

*Last updated: April 2026 — Session 1*
