# Even Realities G2 Media Controller

Control Android media playback (Spotify, YouTube Music, etc.) from your Even Realities G2 smart glasses.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  ANDROID PHONE                       │
│                                                      │
│  ┌──────────────────┐   HTTP      ┌───────────────┐ │
│  │  Even Hub App     │──────────► │  Media Bridge  │ │
│  │  (WebView)        │ localhost  │  (Android App) │ │
│  │                   │  :8765     │                │ │
│  │  Shows UI on      │            │  Controls any  │ │
│  │  glasses, gets    │/play-pause │  active media  │ │
│  │  tap events       │  /next     │  session       │ │
│  └──────────────────┘  /prev     └───────────────┘ │
│         ▲              /vol-up                       │
│         │ BLE          /vol-down                     │
│         ▼              /status                       │
│  ┌──────────────┐                                   │
│  │  G2 Glasses   │                                   │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
```

## Components

### 1. Even Hub App (`even-hub-app/`)

A web app that runs inside the Even Realities app WebView. Displays media info on the glasses and maps gestures to media commands.

#### UI Behavior

1. List: Play/Pause, Next Track, Prev Track, `[━━━━━━───] 53%`
2. Scroll wraps around
3. Scroll down = selection moves down
4. Screen does not scroll as a whole
5. Tap items 0-2 → send command (`play-pause`/`next`/`prev`)
6. Tap item 3 (volume bar) → toggle volume adjust mode:
   - Border appears around volume bar
   - Scroll up/down → `vol-up`/`vol-down`
   - Tap again → border removed, scroll works normally again
7. Volume bar = full screen width (576px)
8. Commands passed directly to Android bridge — no extra logic
9. No extra features, no extra code beyond what is described above

#### Phone UI (WebView page)

- Glasses connection status dot (yellow → green)
- Action log: timestamped list of every gesture, command, and mode change
- App version display

**Tech:** TypeScript + Vite + Even Hub SDK

### 2. Android Media Bridge (`android-media-bridge/`)

A tiny Android app that runs an HTTP server on `localhost:8765` and translates requests into Android MediaSession commands. Controls whichever app is currently playing media.

**Tech:** Kotlin + NanoHTTPD + Android MediaSessionManager

## Setup

### Even Hub App

```bash
cd even-hub-app
npm install
npm run dev
```

For development, generate a QR code to sideload into the Even App:

```bash
npx @evenrealities/evenhub-cli qr --url "http://YOUR_LOCAL_IP:5173"
```

The production version auto-deploys to GitHub Pages on push to `main`.

### Android Media Bridge

1. Open `android-media-bridge/` in Android Studio
2. Build and install the APK on your phone
3. Open the app and grant **Notification Listener** permission
4. Tap **Start Media Bridge**

### Permissions Required

- **Notification Listener Access** — needed to discover active media sessions (Spotify, YouTube Music, etc.)
- **Internet** — only for localhost HTTP communication between the WebView and the bridge

## How It Works

1. You interact with the G2 glasses (tap, scroll)
2. The Even Hub app receives the gesture via the Even Hub SDK
3. It sends an HTTP POST to `localhost:8765` on the phone
4. The Media Bridge app receives the request and sends the corresponding command to the active Android media session
5. The glasses display updates with the current track info
