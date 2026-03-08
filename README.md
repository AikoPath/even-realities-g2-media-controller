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
│  │  glasses, gets    │  /play     │  active media  │ │
│  │  tap events       │  /pause    │  session       │ │
│  └──────────────────┘  /next     └───────────────┘ │
│         ▲              /prev                         │
│         │ BLE          /vol-up                       │
│         ▼              /vol-down                     │
│  ┌──────────────┐                                   │
│  │  G2 Glasses   │                                   │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
```

## Components

### 1. Even Hub App (`even-hub-app/`)

A web app that runs inside the Even Realities app WebView. Displays media info on the glasses and maps gestures to media commands.

| Gesture | Action |
|---------|--------|
| Single tap | Play / Pause |
| Double tap | Next track |
| Scroll up | Volume up |
| Scroll down | Volume down |

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
