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

function setBridgeStatus(online: boolean) {
  bridgeOnline = online
  const dot = document.getElementById('bridge-dot')
  const status = document.getElementById('bridge-status')
  if (dot) dot.style.backgroundColor = online ? DOT_COLORS.green : DOT_COLORS.red
  if (status) status.textContent = online ? 'Bridge connected' : 'Bridge offline'
}

function setGlassesStatus(msg: string, color: 'green' | 'yellow' | 'red') {
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

type UIMode = 'list' | 'volume' | 'seek'
let uiMode: UIMode = 'list'

// ── Action items for the list ──
const ACTION_SEEK = 0
const ACTION_PLAY = 1
const ACTION_NEXT = 2
const ACTION_PREV = 3
const ACTION_VOL = 4

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
const LIST_CHAR_WIDTH = 40

function centerText(text: string, width: number = LIST_CHAR_WIDTH): string {
  if (text.length >= width) return text
  const pad = Math.floor((width - text.length) / 2)
  return ' '.repeat(pad) + text
}

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

// Volume step: for high-range devices (maxVolume=160), step by ~5% instead of 1
function volumeStep(): number {
  return Math.max(1, Math.round(maxVolume / 20))
}

// ── List item labels ──
function getListItems(): string[] {
  const playLabel = isPlaying ? '\u23F8 Pause' : '\u25B6 Play'
  const volBar = buildBar(volumeFraction(), 10)
  const volPct = volumePercent()
  const posStr = formatTime(position)
  const durStr = formatTime(duration)
  const seekBar = buildBar(seekFraction(), 10)

  return [
    centerText(`${posStr} ${seekBar} ${durStr}`),
    centerText(playLabel),
    centerText('\u23ED Next'),
    centerText('\u23EE Previous'),
    centerText(`\u266B Vol ${volBar} ${volPct}%`),
  ]
}

// ── Now-playing text ──
function getNowPlayingText(): string {
  const state = isPlaying ? '\u25B6' : '\u23F8'
  const line1 = `${state} ${title}`
  return artist ? `${line1}\n${artist}` : line1
}

// ── Slider mode text ──
function getSliderText(): string {
  if (uiMode === 'volume') {
    const bar = buildBar(volumeFraction(), 20)
    return `Volume\n${bar} ${volumePercent()}%\n\nScroll: adjust  2xTap: back`
  } else {
    const bar = buildBar(seekFraction(), 20)
    return `Position\n${formatTime(position)} ${bar} ${formatTime(duration)}\n\nScroll: seek  2xTap: back`
  }
}

// ── Page builders ──
// Startup page: must match the original working structure exactly
// (3 containers: image + text + list, itemWidth=560)
function buildStartupPage(): CreateStartUpPageContainer {
  const items = getListItems()

  const imgContainer = new ImageContainerProperty({
    containerID: 1,
    containerName: 'album-art',
    xPosition: 8,
    yPosition: 8,
    width: 80,
    height: 80,
  })

  const textContainer = new TextContainerProperty({
    containerID: 2,
    containerName: 'now-playing',
    xPosition: 96,
    yPosition: 8,
    width: 472,
    height: 80,
    content: getNowPlayingText(),
    isEventCapture: 0,
    borderWidth: 0,
  })

  const listContainer = new ListContainerProperty({
    containerID: 3,
    containerName: 'actions',
    xPosition: 0,
    yPosition: 96,
    width: 576,
    height: 192,
    borderWidth: 1,
    borderColor: 8,
    borderRdaius: 4,
    paddingLength: 4,
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length,
      itemWidth: 560,
      isItemSelectBorderEn: 1,
      itemName: items,
    }),
  })

  return new CreateStartUpPageContainer({
    containerTotalNum: 3,
    imageObject: [imgContainer],
    textObject: [textContainer],
    listObject: [listContainer],
  })
}

// Rebuild pages include image container
function buildListPage(): RebuildPageContainer {
  const items = getListItems()

  const imgContainer = new ImageContainerProperty({
    containerID: 1,
    containerName: 'album-art',
    xPosition: 8,
    yPosition: 8,
    width: 80,
    height: 80,
  })

  const textContainer = new TextContainerProperty({
    containerID: 2,
    containerName: 'now-playing',
    xPosition: 96,
    yPosition: 8,
    width: 472,
    height: 80,
    content: getNowPlayingText(),
    isEventCapture: 0,
    borderWidth: 0,
  })

  const listContainer = new ListContainerProperty({
    containerID: 3,
    containerName: 'actions',
    xPosition: 0,
    yPosition: 96,
    width: 576,
    height: 192,
    borderWidth: 1,
    borderColor: 8,
    borderRdaius: 4,
    paddingLength: 4,
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length,
      itemWidth: 560,
      isItemSelectBorderEn: 1,
      itemName: items,
    }),
  })

  return new RebuildPageContainer({
    containerTotalNum: 3,
    imageObject: [imgContainer],
    textObject: [textContainer],
    listObject: [listContainer],
  })
}

function buildSliderPage(): RebuildPageContainer {
  const imgContainer = new ImageContainerProperty({
    containerID: 1,
    containerName: 'album-art',
    xPosition: 8,
    yPosition: 8,
    width: 80,
    height: 80,
  })

  const textContainer = new TextContainerProperty({
    containerID: 2,
    containerName: 'now-playing',
    xPosition: 96,
    yPosition: 8,
    width: 472,
    height: 80,
    content: getNowPlayingText(),
    isEventCapture: 0,
    borderWidth: 0,
  })

  const sliderText = new TextContainerProperty({
    containerID: 3,
    containerName: 'slider-ctrl',
    xPosition: 8,
    yPosition: 96,
    width: 560,
    height: 184,
    borderWidth: 2,
    borderColor: 12,
    borderRdaius: 6,
    paddingLength: 16,
    content: getSliderText(),
    isEventCapture: 1,
  })

  return new RebuildPageContainer({
    containerTotalNum: 3,
    imageObject: [imgContainer],
    textObject: [textContainer, sliderText],
  })
}

// ── Album art ──
async function fetchAndSendAlbumArt(bridge: EvenAppBridge): Promise<void> {
  try {
    const res = await fetch(`${BRIDGE_URL}/art`, { method: 'POST' })
    if (!res.ok) return
    const data = await res.json()
    if (!data.art || data.art === lastArtUrl) return
    lastArtUrl = data.art

    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject()
      img.src = `data:image/png;base64,${data.art}`
    })

    const canvas = document.createElement('canvas')
    canvas.width = 80
    canvas.height = 80
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, 80, 80)
    const imageData = ctx.getImageData(0, 0, 80, 80)

    const pixels = imageData.data
    const grayBytes: number[] = []
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2])
      grayBytes.push(gray)
    }

    await bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID: 1,
        containerName: 'album-art',
        imageData: grayBytes,
      })
    )
    log('Album art updated')
  } catch {
    // Album art is optional
  }
}

// ── Display update ──
async function rebuildDisplay(bridge: EvenAppBridge): Promise<void> {
  try {
    const page = uiMode === 'list' ? buildListPage() : buildSliderPage()
    try {
      const json = (page as any).toJson ? (page as any).toJson() : page
      log(`[DBG] rebuildDisplay(${uiMode}) payload: ${JSON.stringify(json).slice(0, 500)}`)
    } catch {}
    const ok = await bridge.rebuildPageContainer(page)
    log(`rebuildDisplay(${uiMode}): ${ok}`)
    if (!ok) {
      log(`[DBG] rebuildDisplay(${uiMode}) returned false!`, 'error')
    }
    fetchAndSendAlbumArt(bridge)
  } catch (e) {
    log(`rebuildDisplay error: ${e}`, 'error')
  }
}

async function updateNowPlayingText(bridge: EvenAppBridge): Promise<void> {
  try {
    // Container ID depends on whether we've rebuilt (with image) or still on startup
    const id = uiMode === 'list' ? 2 : 2
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: id,
        containerName: 'now-playing',
        contentOffset: 0,
        contentLength: 500,
        content: getNowPlayingText(),
      })
    )
  } catch (e) {
    log(`updateNowPlayingText error: ${e}`, 'error')
  }
}

async function updateSliderText(bridge: EvenAppBridge): Promise<void> {
  if (uiMode !== 'list') {
    try {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: 3,
          containerName: 'slider-ctrl',
          contentOffset: 0,
          contentLength: 500,
          content: getSliderText(),
        })
      )
    } catch (e) {
      log(`updateSliderText error: ${e}`, 'error')
    }
  }
}

// ── Event handling ──
async function handleListEvent(
  bridge: EvenAppBridge,
  eventType: OsEventTypeList,
  itemIndex?: number,
): Promise<void> {
  log(`handleListEvent: type=${eventType} index=${itemIndex}`)
  if (eventType === OsEventTypeList.CLICK_EVENT) {
    switch (itemIndex) {
      case ACTION_SEEK:
        uiMode = 'seek'
        await rebuildDisplay(bridge)
        break
      case ACTION_PLAY: {
        const wantPlaying = !isPlaying
        await sendCommand(wantPlaying ? 'play' : 'pause')
        isPlaying = wantPlaying
        await rebuildDisplay(bridge)
        break
      }
      case ACTION_NEXT:
        await sendCommand('next')
        await rebuildDisplay(bridge)
        break
      case ACTION_PREV:
        await sendCommand('prev')
        await rebuildDisplay(bridge)
        break
      case ACTION_VOL:
        uiMode = 'volume'
        await rebuildDisplay(bridge)
        break
      default:
        log(`Unknown item index: ${itemIndex}`, 'warn')
        break
    }
  }
}

async function handleSliderEvent(
  bridge: EvenAppBridge,
  eventType: OsEventTypeList,
): Promise<void> {
  const now = Date.now()
  log(`handleSliderEvent: type=${eventType} mode=${uiMode}`)

  if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    uiMode = 'list'
    await sendCommand('status')
    await rebuildDisplay(bridge)
    return
  }

  if (eventType === OsEventTypeList.SCROLL_TOP_EVENT || eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    if (now - lastScrollTime < SCROLL_COOLDOWN_MS) return
    lastScrollTime = now

    const increment = eventType === OsEventTypeList.SCROLL_TOP_EVENT ? 1 : -1

    if (uiMode === 'volume') {
      const step = volumeStep()
      const newVol = Math.max(0, Math.min(maxVolume, volume + increment * step))
      await sendVolSet(newVol)
    } else if (uiMode === 'seek') {
      const step = Math.max(5000, duration / 20)
      const newPos = Math.max(0, Math.min(duration, position + increment * step))
      await sendSeek(newPos)
    }

    await updateSliderText(bridge)
  }
}

// ── Main ──
async function main() {
  log('Waiting for EvenAppBridge...')
  setGlassesStatus('Initializing...', 'yellow')

  const bridge = await waitForEvenAppBridge()
  log('Bridge ready')
  setGlassesStatus('Glasses connected', 'green')

  // Initial status fetch
  const statusResult = await sendCommand('status')
  if (statusResult) {
    log(`Status: playing=${isPlaying} vol=${volume}/${maxVolume} title="${title}"`)
  } else {
    log('Initial status fetch failed - bridge may be offline', 'warn')
  }

  // Create startup page — can only be called once per glasses session.
  // If it returns "invalid", likely already created; fall back to rebuildPageContainer.
  const resultNames = ['success', 'invalid', 'oversize', 'outOfMemory']
  const startupPayload = buildStartupPage()
  try {
    const startupJson = (startupPayload as any).toJson ? (startupPayload as any).toJson() : startupPayload
    log(`[DBG] startup payload: ${JSON.stringify(startupJson).slice(0, 500)}`)
  } catch (e) {
    log(`[DBG] could not serialize startup payload: ${e}`, 'warn')
  }

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
  } else {
    log(`Startup returned ${resultNames[createResult] ?? createResult}, trying rebuildPageContainer...`, 'warn')
    // Use the same 3-container layout (image+text+list) as the startup page
    const rebuildPayload = buildListPage()
    try {
      const rebuildJson = (rebuildPayload as any).toJson ? (rebuildPayload as any).toJson() : rebuildPayload
      log(`[DBG] rebuild fallback payload: ${JSON.stringify(rebuildJson).slice(0, 500)}`)
    } catch (e) {
      log(`[DBG] could not serialize rebuild payload: ${e}`, 'warn')
    }

    let rebuildOk: boolean
    try {
      rebuildOk = await bridge.rebuildPageContainer(rebuildPayload)
    } catch (e) {
      log(`[DBG] rebuildPageContainer threw: ${e}`, 'error')
      rebuildOk = false
    }
    log(`rebuildPageContainer fallback: ${rebuildOk}`)
    if (!rebuildOk) {
      log('Both startup and rebuild failed — check [DBG] logs above', 'error')
      setGlassesStatus('Page create failed', 'red')
      return
    }
  }

  setGlassesStatus('Glasses connected', 'green')

  // Rebuild with image container for album art
  log('[DBG] calling rebuildDisplay for image+list page...')
  await rebuildDisplay(bridge)
  log('[DBG] rebuildDisplay done')

  // Event handler
  bridge.onEvenHubEvent(async (event: EvenHubEvent) => {
    try {
      const le = event.listEvent
      const te = event.textEvent
      const se = event.sysEvent

      log(`Event: list=${!!le} text=${!!te} sys=${!!se} raw=${JSON.stringify(event.jsonData ?? {}).slice(0, 200)}`)

      if (uiMode === 'list') {
        const eventType = le?.eventType ?? se?.eventType
        if (eventType === undefined) {
          log('List mode: no eventType found, ignoring', 'warn')
          return
        }
        await handleListEvent(bridge, eventType, le?.currentSelectItemIndex)
      } else {
        const eventType = te?.eventType ?? se?.eventType
        if (eventType === undefined) {
          log('Slider mode: no eventType found, ignoring', 'warn')
          return
        }
        await handleSliderEvent(bridge, eventType)
      }
    } catch (e) {
      log(`Event handler error: ${e}`, 'error')
    }
  })

  // Periodic status poll
  setInterval(async () => {
    const oldTitle = title
    const oldArtist = artist
    await sendCommand('status')
    if (title !== oldTitle || artist !== oldArtist) {
      await updateNowPlayingText(bridge)
      fetchAndSendAlbumArt(bridge)
    }
  }, 5000)
}

main().catch(e => log(`main() crashed: ${e}`, 'error'))
