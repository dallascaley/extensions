# Plugins Repository

A collection of standalone Chrome browser extensions. Each plugin is self-contained with no shared code or dependencies between them.

## Plugins

| Plugin | Type | Description |
|--------|------|-------------|
| **EmailNanny** | Service worker + Options/Popup UI | Automatically deletes old Gmail messages on a schedule using configurable rules |
| **PagerNanny** | Content script | Monitors PagerDuty and auto-resolves incidents assigned to a specific user |

---

## EmailNanny

Connects to the Gmail API via OAuth 2.0 and deletes (or trashes) emails matching user-defined rules. Rules are a pairing of a Gmail search query (e.g. `from:glassdoor`) and an age threshold.

### Architecture

```
background.js (service worker)
  ├── chrome.alarms → scheduled cleanup runs
  ├── Gmail API v1 (via fetch + OAuth token)
  └── message listener ← popup.js, options.js

popup.html / popup.js
  └── shows last-run status, triggers manual run

options.html / options.js
  └── 4-tab UI: Settings | Rules | Preview | History
```

### Storage

| Store | Key | Contents |
|-------|-----|----------|
| `storage.sync` | `emailNannyConfig` | Settings and rules (cloud-synced) |
| `storage.local` | `emailNannyHistory` | Run history, capped at 100 entries |

### Permissions

- `identity` — Google OAuth
- `storage` — Chrome sync and local storage
- `alarms` — Scheduled runs
- OAuth scope: `https://mail.google.com/`

### Key behaviors

- Default interval: 6 hours (configurable)
- Default deletion mode: Trash (not permanent delete)
- Gmail API returns max 500 results per request; pagination is handled automatically
- Tokens are refreshed automatically on 401 responses
- Dry-run Preview tab shows what *would* be deleted without making changes

---

## PagerNanny

Content script that injects into `https://4asm.pagerduty.com/*` and automatically resolves high-urgency incidents assigned to a specific user.

### Architecture

```
main.js (content script only, no background or UI)
  ├── setInterval (1s) → scans DOM for high-urgency incidents
  ├── Checks .status-cell-resolved, .details-cell .ember-view
  ├── If unresolved incident found for target user → waits 30s → opens detail
  ├── On detail page → waits 30s → clicks "Resolve Incident"
  └── setInterval (60s) → reloads page to catch new incidents
```

### Notes

- Target user is hardcoded as `"Dallas Caley"` in `main.js`
- DOM selectors target Ember.js internal class names — fragile if PagerDuty updates their frontend
- No permissions declared (content script DOM access only)
- No UI — all activity is logged to the browser console

---

## Tech Stack

- **Manifest version**: V3 (both plugins)
- **JavaScript**: Vanilla ES6+, no build tools, no npm, no transpilation
- **No shared code** between plugins
- **No minification** — source is loaded directly as an unpacked extension

## Loading a Plugin in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the plugin folder (e.g. `EmailNanny/` or `PagerNanny/`)

## Project Files

- `PagerNanny.docx` — Original design document for PagerNanny
- `.gitignore` — Excludes `_docx_extract/`, `*.zip`, and OS files
