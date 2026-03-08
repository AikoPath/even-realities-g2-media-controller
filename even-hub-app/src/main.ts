import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  TextContainerProperty,
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
let lastScrollTime = 0
let bridgeOnline = false

// ── Bridge communication ──
function updateStateFromResponse(data: any): void {
  if (data.playing !== undefined) isPlaying = data.playing
  if (data.title) title = data.title
  if (data.artist !== undefined) artist = data.artist
  if (data.volume !== undefined) volume = data.volume
  if (data.maxVolume !== undefined) maxVolume = data.maxVolume
}

async function sendCommand(cmd: MediaCommand): Promise<any> {
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

// ── Formatting ──
function volumePercent(): number {
  if (maxVolume <= 0) return 0
  return Math.min(100, Math.round((volume / maxVolume) * 100))
}

function volumeStep(): number {
  return Math.max(1, Math.round(maxVolume / 20))
}

function buildDisplayText(): string {
  const state = isPlaying ? '\u25B6' : '\u23F8'
  const vol = volumePercent()
  return `${state} ${title}\n${artist}\n\nTap: Play/Pause\nDouble tap: Next\nScroll: Volume ${vol}%`
}

// ── Display update via textContainerUpgrade ──
async function updateGlassesText(bridge: EvenAppBridge): Promise<void> {
  try {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 1,
        containerName: 'media-info',
        contentOffset: 0,
        contentLength: 500,
        content: buildDisplayText(),
      })
    )
  } catch (e) {
    log(`updateGlassesText error: ${e}`, 'error')
  }
}

// ── Event handling (text mode only) ──
async function handleEvent(
  bridge: EvenAppBridge,
  eventType: OsEventTypeList,
): Promise<void> {
  const now = Date.now()

  if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    await sendCommand('next')
  } else if (eventType === OsEventTypeList.CLICK_EVENT) {
    await sendCommand(isPlaying ? 'pause' : 'play')
  } else if (eventType === OsEventTypeList.SCROLL_TOP_EVENT && now - lastScrollTime > SCROLL_COOLDOWN_MS) {
    lastScrollTime = now
    await sendVolSet(Math.min(maxVolume, volume + volumeStep()))
  } else if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT && now - lastScrollTime > SCROLL_COOLDOWN_MS) {
    lastScrollTime = now
    await sendVolSet(Math.max(0, volume - volumeStep()))
  } else {
    return
  }

  await updateGlassesText(bridge)
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

  // Create startup page — shut down stale page first if needed
  const startupPage = new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [new TextContainerProperty({
      containerID: 1,
      containerName: 'media-info',
      xPosition: 0, yPosition: 0, width: 576, height: 288,
      content: buildDisplayText(),
      isEventCapture: 1,
      borderWidth: 0,
    })],
  })

  const resultNames = ['success', 'invalid', 'oversize', 'outOfMemory']
  let createResult: number
  try {
    createResult = await bridge.createStartUpPageContainer(startupPage)
  } catch (e) {
    log(`createStartUpPageContainer threw: ${e}`, 'error')
    createResult = -1
  }
  log(`createStartUpPageContainer: ${resultNames[createResult] ?? createResult} (raw=${createResult})`)

  // "invalid" means page exists from previous session — that's fine, reuse it
  if (createResult === StartUpPageCreateResult.invalid) {
    log('Page exists from previous session — reusing')
    await updateGlassesText(bridge)
  }

  if (createResult === StartUpPageCreateResult.success || createResult === StartUpPageCreateResult.invalid) {
    log('Glasses display ready')
    setGlassesStatus('Glasses connected', 'green')
  } else {
    log(`Page creation failed: ${resultNames[createResult] ?? createResult}`, 'error')
    setGlassesStatus('Glasses error', 'red')
  }

  // Event handler — text mode only
  bridge.onEvenHubEvent(async (event: EvenHubEvent) => {
    try {
      const le = event.listEvent
      const te = event.textEvent
      const se = event.sysEvent
      log(`[RAW] list=${JSON.stringify(le)} text=${JSON.stringify(te)} sys=${JSON.stringify(se)} json=${JSON.stringify(event.jsonData ?? {}).slice(0, 300)}`)
      const eventType = te?.eventType ?? se?.eventType ?? le?.eventType
      if (eventType === undefined) return
      log(`Event: type=${eventType}`)
      await handleEvent(bridge, eventType)
    } catch (e) {
      log(`Event error: ${e}`, 'error')
    }
  })

  // Periodic status poll — update glasses when track/volume changes
  setInterval(async () => {
    const oldTitle = title
    const oldArtist = artist
    const oldVol = volume
    await sendCommand('status')
    if (title !== oldTitle || artist !== oldArtist || volume !== oldVol) {
      await updateGlassesText(bridge)
    }
  }, 5000)
}

main().catch(e => log(`main() crashed: ${e}`, 'error'))
