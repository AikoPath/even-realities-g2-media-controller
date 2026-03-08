import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  OsEventTypeList,
  StartUpPageCreateResult,
  type EvenHubEvent,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'

const BRIDGE_PORT = 8765
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`
const SCROLL_COOLDOWN_MS = 200

type MediaCommand = 'play' | 'pause' | 'next' | 'prev' | 'vol-up' | 'vol-down' | 'status'

// ── Phone-side UI helpers ──
function log(msg: string, level: 'info' | 'warn' | 'error' = 'info') {
  const el = document.getElementById('log')
  if (!el) return
  const time = new Date().toLocaleTimeString()
  const cls = level === 'error' ? ' class="log-error"' : level === 'warn' ? ' class="log-warn"' : ''
  el.innerHTML = `<div${cls}>[${time}] ${msg}</div>` + el.innerHTML
  if (el.children.length > 100) el.removeChild(el.lastChild!)
}

function updatePhoneUI() {
  const titleEl = document.getElementById('track-title')
  const artistEl = document.getElementById('track-artist')
  if (titleEl) titleEl.textContent = title
  if (artistEl) artistEl.textContent = artist
}

const DOT_COLORS = { green: '#4caf50', red: '#f44336', yellow: '#ff9800' }

let glassesConnected = false

function setBridgeStatus(online: boolean) {
  bridgeOnline = online
  const dot = document.getElementById('bridge-dot')
  const status = document.getElementById('bridge-status')
  if (dot) dot.style.backgroundColor = online ? DOT_COLORS.green : DOT_COLORS.red
  if (status) status.textContent = online ? 'Bridge connected' : 'Bridge offline'
  if (glassesConnected) {
    const gDot = document.getElementById('glasses-dot')
    if (gDot) gDot.style.backgroundColor = DOT_COLORS.green
  }
}

function setGlassesStatus(msg: string, color: 'green' | 'yellow' | 'red') {
  glassesConnected = color === 'green'
  const dot = document.getElementById('glasses-dot')
  const el = document.getElementById('glasses-status')
  if (dot) dot.style.backgroundColor = DOT_COLORS[color]
  if (el) el.textContent = msg
}

// ── State ──
let isPlaying = false
let title = 'No media'
let artist = ''
let volume = 0
let maxVolume = 160
let position = 0
let duration = 0
let lastScrollTime = 0
let lastArtUrl = ''
let bridgeOnline = false

// ── Bridge communication ──
interface StatusResponse {
  playing: boolean
  title: string
  artist: string
  volume: number
  maxVolume: number
  position: number
  duration: number
}

function updateStateFromResponse(data: any): void {
  if (data.playing !== undefined) isPlaying = data.playing
  if (data.title) title = data.title
  if (data.artist !== undefined) artist = data.artist
  if (data.volume !== undefined) volume = data.volume
  if (data.maxVolume !== undefined) maxVolume = data.maxVolume
  if (data.position !== undefined) position = data.position
  if (data.duration !== undefined) duration = data.duration
}

async function sendCommand(cmd: MediaCommand): Promise<StatusResponse | null> {
  try {
    const res = await fetch(`${BRIDGE_URL}/${cmd}`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      updateStateFromResponse(data)
      setBridgeStatus(true)
      updatePhoneUI()
      return data
    }
    log(`${cmd}: HTTP ${res.status}`, 'warn')
  } catch (e) {
    setBridgeStatus(false)
    title = 'Bridge offline'
    artist = ''
    updatePhoneUI()
    log(`${cmd}: ${e}`, 'error')
  }
  return null
}

async function sendSeek(pos: number): Promise<void> {
  try {
    const res = await fetch(`${BRIDGE_URL}/seek?pos=${Math.round(pos)}`, { method: 'POST' })
    position = pos
    if (res.ok) {
      const data = await res.json()
      updateStateFromResponse(data)
      setBridgeStatus(true)
    }
  } catch (e) {
    log(`seek: ${e}`, 'error')
  }
}

async function sendVolSet(vol: number): Promise<void> {
  try {
    const res = await fetch(`${BRIDGE_URL}/vol-set?v=${vol}`, { method: 'POST' })
    volume = vol
    if (res.ok) {
      const data = await res.json()
      updateStateFromResponse(data)
      setBridgeStatus(true)
    }
  } catch (e) {
    log(`vol-set: ${e}`, 'error')
  }
}

// ── Formatting helpers ──
function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

function buildBar(fraction: number, width: number = 12): string {
  const clamped = Math.max(0, Math.min(1, fraction))
  const filled = Math.round(clamped * width)
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled)
}

function volumePercent(): number {
  if (maxVolume <= 0) return 0
  return Math.min(100, Math.round((volume / maxVolume) * 100))
}

function volumeFraction(): number {
  return maxVolume > 0 ? Math.min(1, volume / maxVolume) : 0
}

function seekFraction(): number {
  return duration > 0 ? Math.min(position / duration, 1) : 0
}

function volumeStep(): number {
  return Math.max(1, Math.round(maxVolume / 20))
}

// ── Glasses display text ──
// This is the proven working format: single full-screen text container
function buildDisplayText(): string {
  const state = isPlaying ? '\u25B6' : '\u23F8'
  const vol = volumePercent()
  return [
    `${state} ${title}`,
    artist ? artist : '',
    '',
    'Tap: Play/Pause',
    'Double tap: Next',
    `Scroll: Volume ${vol}%`,
  ].filter(l => l !== '' || true).join('\n')
}

// ── Display update (text upgrade only — no rebuild needed) ──
async function updateDisplay(bridge: EvenAppBridge): Promise<void> {
  try {
    const ok = await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 1,
        containerName: 'media-info',
        contentOffset: 0,
        contentLength: 500,
        content: buildDisplayText(),
      })
    )
    log(`[DBG] textContainerUpgrade: ${ok}`)
  } catch (e) {
    log(`updateDisplay error: ${e}`, 'error')
  }
}

// ── Event handling ──
// Hardware event types observed from actual glasses (different from SDK enum!):
// SDK enum:  CLICK=0, SCROLL_TOP=1, SCROLL_BOTTOM=2, DOUBLE_CLICK=3
// Hardware:  tap=1,   scroll=2,      (no separate dir), double-tap=3
const HW_TAP = 1
const HW_SCROLL = 2
const HW_DOUBLE_TAP = 3

async function handleEvent(
  bridge: EvenAppBridge,
  eventType: number,
): Promise<void> {
  const now = Date.now()
  log(`handleEvent: type=${eventType}`)

  if (eventType === HW_DOUBLE_TAP) {
    await sendCommand('next')
  } else if (eventType === HW_TAP) {
    await sendCommand(isPlaying ? 'pause' : 'play')
  } else if (eventType === HW_SCROLL && now - lastScrollTime > SCROLL_COOLDOWN_MS) {
    lastScrollTime = now
    const step = volumeStep()
    const newVol = Math.min(maxVolume, volume + step)
    await sendVolSet(newVol)
  } else {
    return
  }

  await updateDisplay(bridge)
}

// ── Main ──
async function main() {
  log('Waiting for EvenAppBridge...')
  setGlassesStatus('Initializing...', 'yellow')

  const bridge = await waitForEvenAppBridge()
  log('Bridge ready')

  // Initial status fetch
  const statusResult = await sendCommand('status')
  if (statusResult) {
    log(`Status: playing=${isPlaying} vol=${volume}/${maxVolume} title="${title}"`)
  } else {
    log('Initial status fetch failed - bridge may be offline', 'warn')
  }

  // Create startup page — single full-screen text container
  // This is the PROVEN WORKING structure from before the UI rework
  const textContainer = new TextContainerProperty({
    containerID: 1,
    containerName: 'media-info',
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    content: buildDisplayText(),
    isEventCapture: 1,
    borderWidth: 0,
  })

  const startupPayload = new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [textContainer],
  })

  const resultNames = ['success', 'invalid', 'oversize', 'outOfMemory']
  let createResult: number
  try {
    createResult = await bridge.createStartUpPageContainer(startupPayload)
  } catch (e) {
    log(`[DBG] createStartUpPageContainer threw: ${e}`, 'error')
    createResult = -1
  }
  log(`createStartUpPageContainer: ${resultNames[createResult] ?? createResult} (raw=${createResult})`)

  if (createResult === StartUpPageCreateResult.success) {
    log('Startup page created OK')
  } else if (createResult === StartUpPageCreateResult.invalid) {
    // Page exists from previous session — reuse it, update text
    log('Page exists from previous session — reusing')
    await updateDisplay(bridge)
  } else {
    log(`STARTUP FAILED: ${resultNames[createResult] ?? createResult}`, 'error')
    setGlassesStatus(`Startup failed: ${resultNames[createResult] ?? createResult}`, 'red')
    return
  }

  setGlassesStatus('Glasses connected', 'green')

  // Event handler
  bridge.onEvenHubEvent(async (event: EvenHubEvent) => {
    try {
      const te = event.textEvent
      const se = event.sysEvent

      log(`Event: text=${!!te} sys=${!!se} raw=${JSON.stringify(event.jsonData ?? {}).slice(0, 200)}`)

      const eventType = te?.eventType ?? se?.eventType
      if (eventType === undefined) {
        log('No eventType found, ignoring', 'warn')
        return
      }
      await handleEvent(bridge, eventType)
    } catch (e) {
      log(`Event handler error: ${e}`, 'error')
    }
  })

  // Periodic status poll
  setInterval(async () => {
    const oldTitle = title
    const oldArtist = artist
    const oldVol = volume
    await sendCommand('status')
    if (title !== oldTitle || artist !== oldArtist || volume !== oldVol) {
      await updateDisplay(bridge)
    }
  }, 5000)
}

main().catch(e => log(`main() crashed: ${e}`, 'error'))
