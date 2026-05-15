# Sky Browser

> A premium, privacy-first browser with built-in ad blocking.
> One codebase. Two platforms: **macOS** (Electron) and **Android** (Capacitor + native WebView).

---

## Highlights

- **Hagezi Pro DNS blocklist** — ~200k domain hostname-suffix matching
- **Native rendering on both platforms** — Chromium on desktop, system WebView on Android
- **Multi-tab** with per-tab URL/title/navigation state
- **Pop-up blocker** (window + session level)
- **Predictive back gesture** (Android 14+)
- **Lifecycle-aware** — WebViews pause/resume with the app, freeing CPU/battery
- **24-hour blocklist cache** with stale-fallback and atomic refresh
- **Sandboxed renderer** on Electron, no `nodeIntegration`

---

## Architecture

A single web UI (`src/`) drives both platforms. A thin runtime abstraction
(`src/tab.js`) chooses the correct tab implementation per-host:

```
                  ┌────────────────────────┐
                  │   src/index.html       │
                  │   src/app.js (UI)      │
                  │   src/tab.js (switch)  │
                  └─────────┬──────────────┘
                            │
              ┌─────────────┴──────────────┐
              ▼                            ▼
    ┌──────────────────┐        ┌─────────────────────┐
    │  ElectronTab     │        │  AndroidTab         │
    │  <webview> tag   │        │  Capacitor plugin   │
    │                  │        │  → native WebView   │
    └──────────────────┘        └─────────────────────┘
              │                            │
              ▼                            ▼
    ┌──────────────────┐        ┌─────────────────────┐
    │  blocklist.js    │        │  AdBlocker.kt       │
    │  (Node https/fs) │        │  (HttpURLConnection)│
    └──────────────────┘        └─────────────────────┘
```

| Concern        | Desktop (Electron)                        | Android (Capacitor)                              |
|----------------|-------------------------------------------|--------------------------------------------------|
| Shell          | `main.js` → `BrowserWindow`               | `MainActivity.kt` → `BridgeActivity`             |
| UI             | `src/index.html` + `src/app.js`           | same (loaded into bridge `WebView`)              |
| Tabs           | `<webview>` per tab                       | native `WebView` per tab via `SkyTabsPlugin`     |
| Ad-block hook  | `session.webRequest.onBeforeRequest`      | `WebViewClient.shouldInterceptRequest`           |
| Blocklist I/O  | `blocklist.js` (Node `https` + `fs`)      | `AdBlocker.kt` (`HttpURLConnection` + `filesDir`)|
| Back nav       | (none — desktop)                          | `OnBackPressedDispatcher` + plugin handler       |

The Android plugin parents native WebViews as **siblings of the Capacitor bridge WebView**.
JavaScript reports the visible content rect (`#webviews-container.getBoundingClientRect()`,
DPR-scaled) via `SkyTabs.setRect`, so the native WebView fills exactly the right region
while the toolbar/tab bar in the bridge WebView remains interactive.

---

## Quick Start

### Prerequisites

| Tool      | Version                          | Notes                                       |
|-----------|----------------------------------|---------------------------------------------|
| Node      | **≥ 22**                          | Capacitor CLI requirement                   |
| JDK       | **≥ 21** (tested on 25)           | Android build                               |
| Android SDK | API 36 (compile/target), API 24+ (min) | Standard Android Studio install         |
| Xcode CLT | latest                           | Electron native build (macOS)               |

### Install

```bash
git clone <repo> sky-browser
cd sky-browser
npm install
```

---

## Desktop (macOS)

```bash
npm start              # run in development
npm run dist:mac       # build .dmg + .zip (universal: arm64 + x64)
```

Output: `dist/Sky Browser-1.0.0-*.dmg`

The desktop build uses Electron's `<webview>` tag with `contextIsolation: true`,
`nodeIntegration: false`, and `sandbox: true` for the main renderer.

---

## Android

```bash
# Make sure you're on the right Node + JDK
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"

# Sync web assets to the Android project
npx cap sync android

# Either build via Android Studio…
npx cap open android

# …or via CLI
cd android && ./gradlew assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk` (~4 MB)

Install on a device:

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
adb logcat | grep -E 'SkyTabs|AdBlocker|chromium'
```

---

## How Ad Blocking Works

1. On startup, `AdBlocker` loads the cached blocklist from disk (instant).
2. If cache is fresh (`< 24h`), nothing else happens; otherwise a background
   fetch refreshes from [Hagezi Pro](https://github.com/hagezi/dns-blocklists).
3. Each network request goes through:
   - **Electron**: `session.webRequest.onBeforeRequest` → `cancel: true`
   - **Android**: `WebViewClient.shouldInterceptRequest` → 403 (sub-resources)
     or styled "Blocked by Sky" page (main frame)
4. Domain matching is **suffix-based**: `ads.tracker.example.com` is blocked if
   any of `ads.tracker.example.com`, `tracker.example.com`, or `example.com`
   appear in the list.
5. List parsing tolerates both bare-domain and hosts-file formats
   (`0.0.0.0 example.com`).
6. Blocklist updates use **atomic swap** — `isBlocked()` never sees an empty set
   during a refresh.

---

## How Android Tabs Work

```
┌─────────── Activity DecorView ───────────┐
│                                          │
│  ┌──── Capacitor bridge WebView ────┐    │
│  │  (HTML UI: tabs, address bar)    │    │
│  │                                  │    │
│  │  ┌── #webviews-container ──┐     │    │
│  │  │   (empty placeholder)   │     │    │
│  │  └─────────────────────────┘     │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌── Native WebView (per tab) ──┐        │
│  │  positioned by setRect       │ ←── sibling of bridge WebView,
│  │  GONE when not active        │     covers the placeholder area
│  └──────────────────────────────┘        │
└──────────────────────────────────────────┘
```

- **Plugin events** (`tab:<id>:navigate`, `tab:<id>:title`, `tab:<id>:cangostate`)
  flow back to JS, which updates the address bar / tab title / nav buttons.
- **Plugin methods**: `create`, `load`, `reload`, `back`, `forward`, `setRect`,
  `setVisible`, `destroy`.
- All WebView ops run on the Android UI thread (`activity.runOnUiThread`).
- First navigation is gated on `AdBlocker.onReady` so the very first request is
  filtered.
- Predictive back gesture is wired through `OnBackPressedDispatcher`; the plugin
  consumes the back press if the visible WebView has history, otherwise falls
  through to the system.

---

## Security & Privacy Posture

| Vector                   | Mitigation                                                    |
|--------------------------|---------------------------------------------------------------|
| Renderer code execution  | `sandbox: true`, `contextIsolation: true`, no `nodeIntegration` |
| Pop-up windows           | `setWindowOpenHandler → deny` (window + session level)         |
| Android multi-window     | `setSupportMultipleWindows(false)`, `javaScriptCanOpenWindowsAutomatically = false` |
| Untrusted blocklist data | Sanity check (≥100 entries, no `<html`)                       |
| Stale blocklist          | 24h TTL with cache fallback                                    |
| Concurrent list refresh  | Atomic `Set` swap                                              |
| HTTPS indicator          | Lock icon hidden on non-`https://` URLs                       |
| Mixed content (Android)  | `allowMixedContent: true` — reconsider for production         |

---

## Project Layout

```
sky-browser/
├─ main.js                  # Electron entry — BrowserWindow + adblock + popup deny
├─ preload.js               # minimal stub, sandboxed
├─ blocklist.js             # Node-side AdBlocker (https + fs)
├─ capacitor.config.ts      # appId, webDir
├─ package.json             # Electron 33 + Capacitor 8 + electron-builder 25
├─ icon.icns                # macOS app icon
├─ src/                     # shared web UI
│  ├─ index.html
│  ├─ app.js                # tab controller, address bar, nav buttons
│  ├─ tab.js                # ElectronTab / AndroidTab abstraction
│  └─ style.css             # vibrancy + dark mode + Android overrides
└─ android/
   ├─ app/src/main/AndroidManifest.xml
   ├─ app/build.gradle      # kotlin, jvmTarget 21
   ├─ build.gradle          # Gradle 9, AGP 8.13
   ├─ gradle.properties     # parallel + cache + config-cache
   └─ app/src/main/java/com/sky/browser/
      ├─ MainActivity.kt    # registers plugin + back dispatcher
      ├─ SkyTabsPlugin.kt   # per-tab native WebView management
      └─ AdBlocker.kt       # fetch + cache + intercept
```

---

## Development Tips

- **Debug Android WebViews**: open `chrome://inspect` in desktop Chrome with the
  device connected. The plugin enables `setWebContentsDebuggingEnabled(true)` in
  debug builds automatically.
- **Force blocklist refresh**: delete `~/Library/Application Support/sky-browser/blocklist.txt`
  (macOS) or `/data/data/com.sky.browser/files/blocklist.txt` (Android, requires
  `adb root`).
- **Modify the blocklist source**: change `URL_HAGEZI` in `blocklist.js` /
  `AdBlocker.kt`. Both files validate the response (`looksLikeBlocklist`) before
  writing to cache.
- **Test pop-up blocking**: navigate to a page that calls `window.open(...)` —
  no new window should appear.

---

## Troubleshooting

| Symptom                                       | Likely cause / fix                                                     |
|-----------------------------------------------|------------------------------------------------------------------------|
| `Unsupported class file major version 69`     | JDK 25 needs Gradle ≥ 9. Wrapper is pinned; if you overrode it, revert.|
| `npx cap sync` fails with Node version error  | Use Node ≥ 22 (`brew install node@22`)                                 |
| Address bar shows `https://` but no lock icon | URL did not parse as `https:` — check input                            |
| Android back gesture exits app immediately    | Make sure `android:enableOnBackInvokedCallback="true"` is in manifest  |
| First page loads ads                          | `AdBlocker.onReady` gate is bypassed — should not happen; file an issue|

---

## License

MIT. Original Sky Browser by Antigravity; this fork adds Capacitor / Android
support.
