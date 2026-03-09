# CLAUDE.md

## PR Creation

- This environment does NOT have GitHub API auth or `gh` CLI. Do not waste time trying API calls.
- To create a PR, build a GitHub compare URL with query parameters directly:
  `https://github.com/{owner}/{repo}/compare/{base}...{head}?expand=1&title=...&body=...`
- URL-encode the title and body, and include the description in the URL from the start.

## Git Workflow

- Always commit and push new or changed files immediately after creating/editing them. Do not wait for reminders or hooks.
- **ALWAYS** include a PR link immediately after every push. No exceptions. Do not wait to be asked.

## Even Realities G2 — EvenHub SDK Patterns

### Architecture

- Apps are regular web apps. iPhone WebView loads the URL and relays BLE to glasses.
- Flow: `[Web Server] <-HTTPS-> [iPhone WebView] <-BLE-> [G2 Glasses]`
- SDK: `@evenrealities/even_hub_sdk` — injects `EvenAppBridge` into the WebView `window` object.

### Display

- **576×288 px green micro-LED**, 4-bit greyscale (16 levels).
- **Max 4 containers per page** (text, list, image). Mixed types OK.
- **Exactly one container must have `isEventCapture: 1`** — that container receives input events.
- Container IDs determine z-order: higher IDs render on top.
- No CSS/flexbox/DOM — pixel-positioned containers only.

### Container Types

| Type | Limits | Scrollable | Notes |
|------|--------|-----------|-------|
| Text | 1000 chars (create/rebuild), 2000 (upgrade) | Yes if event capture | `borderWidth`, `borderColor`, `borderRdaius` (SDK typo), `paddingLength` |
| List | 20 items, 64 chars each | Yes (firmware-native) | Firmware handles highlight. Takes over scroll events as `listEvent` |
| Image | 20-200px W, 20-100px H | No | Must `updateImageRawData` after page create |

### Page Lifecycle

- `createStartUpPageContainer()` — once at startup.
- `rebuildPageContainer()` — full page replacement (causes flicker on real hardware, resets scroll/selection).
- `textContainerUpgrade()` — in-place text update, flicker-free. Preferred for content changes.
- Only use `rebuildPageContainer` when container properties (border, layout) need to change.

### Input Events

Events arrive via `bridge.onEvenHubEvent(callback)` as `EvenHubEvent`:
- `textEvent` — from text containers with event capture
- `listEvent` — from list containers with event capture
- `sysEvent` — system events (simulator uses this for clicks)

| Event | Value | Trigger |
|-------|-------|---------|
| `CLICK_EVENT` | 0 | Ring/temple tap |
| `SCROLL_TOP_EVENT` | 1 | Scroll boundary (top) |
| `SCROLL_BOTTOM_EVENT` | 2 | Scroll boundary (bottom) |
| `DOUBLE_CLICK_EVENT` | 3 | Ring/temple double-tap |
| `FOREGROUND_ENTER_EVENT` | 4 | App enters foreground |
| `FOREGROUND_EXIT_EVENT` | 5 | App enters background |

### SDK Quirks (Critical)

- **CLICK_EVENT (0) → undefined**: SDK `fromJson` normalizes 0 to undefined. Always check `eventType === OsEventTypeList.CLICK_EVENT || eventType === undefined`.
- **Missing `currentSelectItemIndex`**: Simulator/hardware omits index for item 0. Track selection in app state.
- **Simulator vs hardware**: Simulator sends `sysEvent` for clicks; hardware sends `textEvent`/`listEvent`.
- **Scroll throttling**: Scroll events fire rapidly. Use 300ms cooldown.
- **`borderRdaius`**: SDK has a typo — use `borderRdaius` not `borderRadius`.
- **Stale bridge response for play/pause**: The Android bridge dispatches `transportControls.play()`/`.pause()` then immediately reads `playbackState`. Since the dispatch is async, the response returns the OLD state.

### UI Patterns

- **`>` prefix cursor**: Simulate menu selection with `> Item` / `  Item`. Update via `textContainerUpgrade`.
- **Border highlight**: Toggle `borderWidth` on containers to indicate selection. Requires `rebuildPageContainer`.
- **Unicode**: `━─` for progress bars, `●○■□` for indicators, `▲▶▼◀` for arrows, box-drawing `┌┐└┘│─` available. Font is NOT monospaced.

### State Machine Design

- Use a discriminated union for mode: `{ type: 'menu', selected: number } | { type: 'volume' }`.
- Tap selects/activates, tap again deselects (toggle pattern).
- Scroll = navigate menu items or adjust volume depending on mode.
- Track border state separately; only `rebuildPageContainer` when it changes, use `textContainerUpgrade` otherwise.
- Keep navigation shallow (1-2 levels max) — deep trees fail with limited inputs.
