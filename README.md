# 🎬 BugReel — Record bugs that developers can actually fix

BugReel is a Chrome extension that captures a short screen recording and the developer context around it — console logs, network requests, user actions, and environment details — and saves a single self‑contained HTML report you can share.

No servers. No accounts. Everything runs locally in your browser.

---

## ✨ Highlights

- Screen and microphone recording (tab audio supported)
- Floating, minimal toolbar (pause/resume, mic toggle, tab‑audio toggle). Bottom‑center and draggable
- Console logs, network requests, user actions, and environment data captured alongside video
- Powerful search and filters in the report (log level, status code buckets, time range, text search)
- Privacy‑minded defaults with client‑side PII scrubbing
- Reports are self‑contained HTML files (video embedded) — easy to attach to tickets or share

---

## 🚀 Quick start (Chrome)

1. Open `chrome://extensions/`
2. Enable “Developer mode” (top‑right)
3. Click “Load unpacked” and select the project folder
4. Pin the extension for easy access (optional)

Recording a bug:
- Click the BugReel icon → “Start Tab Recording”
- In the screen picker, choose “Chrome Tab” and check “Share tab audio” if you want tab sound
- Reproduce the issue
- Use the floating toolbar to pause/resume, toggle mic/tab‑audio, or stop
- A dark preview page opens → Save Report (downloads the self‑contained HTML)

---

## 🧭 What gets captured

- Video: your active tab (with optional tab audio and microphone)
- Console: `error`, `warn`, `log`, `info`, `debug` (timestamped)
- Network: URL, method, status, timing, request/response headers
- Actions: clicks, keydown, inputs (sanitized), simple selectors
- Environment: user agent, platform, screen + viewport size, page title/URL

All data stays local; nothing is sent anywhere.

---

## 🧰 The floating toolbar

- Stop: ends the recording and opens the preview
- Pause/Resume: toggles MediaRecorder pause state and freezes the on‑screen timer
- Mic: toggles microphone capture
- Sound: toggles tab/system audio

The toolbar spawns bottom‑center and can be dragged to the edge you prefer.

Notes on permissions:
- To capture tab audio, pick “Chrome Tab” and check “Share tab audio” in the picker
- Your first run may prompt for microphone access if you enable mic capture

---

## 📝 The preview and the saved report

After stopping, a preview page opens with three actions: Save Report, Start New Recording, Close.

The final report is a single HTML file (dark theme) that includes:
- Embedded video
- Tabs for Console, Network, Actions, and Environment
- Search box and filters: log level, status bucket (2xx/3xx/4xx/5xx), time range
- A Notes field captured from the preview page

There’s no external dependency; you can open the report offline.

---

## 🔒 Privacy & security

- No cloud uploads by default; everything is processed and stored locally
- Session‑only Chrome storage during capture
- Best‑effort PII masking: common secret patterns and password‑like inputs are scrubbed

You control what gets shared by sending (or not sending) the HTML file.

---

## 🧪 Troubleshooting

Tab audio isn’t in the recording:
- In the screen picker, select the “Chrome Tab” and check “Share tab audio”

Mic didn’t record:
- Ensure the mic button was enabled on the toolbar and grant mic permission when prompted

Video shows “Unknown/Infinity” duration:
- We removed the duration field in the report UI to avoid misleading values from some encoders. The embedded player still knows the real duration

Preview opens but nothing appears in Network/Console tabs:
- Navigate within the same tab while recording (not a new window)
- Some extensions or strict corporate policies can block `webRequest` logging

---

## 🏗️ Project structure

- `manifest.json` — Extension configuration and permissions
- `popup.html` / `popup.js` — Minimal popup to start a recording
- `background.js` — Service worker orchestrating capture and report generation
- `offscreen.html` / `offscreen.js` — Offscreen document that runs the recorder
- `content.js` — Injected into the page to collect logs/actions and render the toolbar
- `preview.html` / `preview.js` — In‑extension preview (Save/Start New/Close)

---

## 🛠️ Building from source

No build step is required. Load the folder as an unpacked extension (see Quick start). To develop:

1. Make your changes
2. In `chrome://extensions`, click the “Reload” icon for BugReel
3. Test on any site (the `navigation-test.html` and `debug-toolbar.html` in this repo can help)

---

## 🗺️ Roadmap ideas

- Click‑to‑seek from console/network entries in the report
- One‑click export: MP4 or ZIP (video + JSON)
- Optional share/upload target (S3/GCS) with expiring links
- Repro steps generator from captured actions
- Simple in‑report trimming and annotations

---

## 🤝 Contributing

Issues and PRs are welcome. Please keep PRs focused and include a brief description, test steps, and screenshots/GIFs where relevant.


Made with care to help you file better bugs, faster.