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
  // Re-apply glasses dot on every bridge update to prevent it disappearing
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

// Which UI mode is active on the glasses
type UIMode = 'text' | 'list' | 'volume' | 'seek'
let uiMode: UIMode = 'text'

// Action indices for the list
const ACTION_SEEK = 0
const ACTION_PLAY = 1
const ACTION_NEXT = 2
const ACTION_PREV = 3
const ACTION_VOL = 4

// ── Bridge communication ──
function updateStateFromResponse(data: any): void {
  if (data.playing !== undefined) isPlaying = data.playing
  if (data.title) title = data.title
  if (data.artist !== undefined) artist = data.artist
  if (data.volume !== undefined) volume = data.volume
  if (data.maxVolume !== undefined) maxVolume = data.maxVolume
  if (data.position !== undefined) position = data.position
  if (data.duration !== undefined) duration = data.duration
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

function volumeStep(): number {
  return Math.max(1, Math.round(maxVolume / 20))
}

// ── Text for the simple text-only fallback ──
function buildDisplayText(): string {
  const state = isPlaying ? '\u25B6' : '\u23F8'
  const vol = volumePercent()
  return `${state} ${title}\n${artist}\n\nTap: Play/Pause\nDouble tap: Next\nScroll: Volume ${vol}%`
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

function getNowPlayingText(): string {
  const state = isPlaying ? '\u25B6' : '\u23F8'
  const line1 = `${state} ${title}`
  return artist ? `${line1}\n${artist}` : line1
}

function getSliderText(): string {
  if (uiMode === 'volume') {
    const bar = buildBar(volumeFraction(), 20)
    return `Volume\n${bar} ${volumePercent()}%\n\nScroll: adjust  2xTap: back`
  } else {
    const bar = buildBar(seekFraction(), 20)
    return `Position\n${formatTime(position)} ${bar} ${formatTime(duration)}\n\nScroll: seek  2xTap: back`
  }
}

// ── Page builders for rebuild ──
function buildListPage(): RebuildPageContainer {
  const items = getListItems()

  const textContainer = new TextContainerProperty({
    containerID: 1,
    containerName: 'now-playing',
    xPosition: 8,
    yPosition: 8,
    width: 560,
    height: 80,
    content: getNowPlayingText(),
    isEventCapture: 0,
    borderWidth: 0,
  })

  const listContainer = new ListContainerProperty({
    containerID: 2,
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
    containerTotalNum: 2,
    textObject: [textContainer],
    listObject: [listContainer],
  })
}

function buildSliderPage(): RebuildPageContainer {
  const infoText = new TextContainerProperty({
    containerID: 1,
    containerName: 'slider-info',
    xPosition: 8,
    yPosition: 8,
    width: 560,
    height: 60,
    content: getNowPlayingText(),
    isEventCapture: 0,
    borderWidth: 0,
  })

  const sliderText = new TextContainerProperty({
    containerID: 2,
    containerName: 'slider-ctrl',
    xPosition: 8,
    yPosition: 76,
    width: 560,
    height: 204,
    content: getSliderText(),
    isEventCapture: 1,
    borderWidth: 2,
    borderColor: 12,
    borderRdaius: 6,
    paddingLength: 16,
  })

  return new RebuildPageContainer({
    containerTotalNum: 2,
    textObject: [infoText, sliderText],
  })
}

// ── Album art ──
async function fetchAndSendAlbumArt(bridge: EvenAppBridge): Promise<void> {
  if (uiMode === 'text') return // no image container in text mode
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

// ── Display updates ──
async function rebuildDisplay(bridge: EvenAppBridge): Promise<void> {
  try {
    const page = uiMode === 'list' ? buildListPage() : buildSliderPage()
    const ok = await bridge.rebuildPageContainer(page)
    log(`[DBG] rebuildDisplay(${uiMode}): ${ok}`)
    if (!ok) {
      log(`[DBG] rebuildDisplay(${uiMode}) returned false`, 'error')
    }
  } catch (e) {
    log(`rebuildDisplay error: ${e}`, 'error')
  }
}

async function updateTextDisplay(bridge: EvenAppBridge): Promise<void> {
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
    log(`updateTextDisplay error: ${e}`, 'error')
  }
}

async function updateNowPlayingText(bridge: EvenAppBridge): Promise<void> {
  try {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 1,
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
  try {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 2,
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

// ── Event handling ──
async function handleTextEvent(
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

  await updateTextDisplay(bridge)
}

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
      case ACTION_PLAY:
        await sendCommand(isPlaying ? 'pause' : 'play')
        await rebuildDisplay(bridge)
        break
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
      const newVol = Math.max(0, Math.min(maxVolume, volume + increment * volumeStep()))
      await sendVolSet(newVol)
    } else if (uiMode === 'seek') {
      const step = Math.max(5000, duration / 20)
      const newPos = Math.max(0, Math.min(duration, position + increment * step))
      await sendSeek(newPos)
    }

    await updateSliderText(bridge)
  }
}

// ── Diagnostic: test which rebuild configurations the firmware accepts ──
async function runDiagnostics(bridge: EvenAppBridge): Promise<string | null> {
  const tests: { name: string; build: () => RebuildPageContainer }[] = [
    {
      name: 'A: 1 list only',
      build: () => new RebuildPageContainer({
        containerTotalNum: 1,
        listObject: [new ListContainerProperty({
          containerID: 1,
          containerName: 'list-1',
          xPosition: 0, yPosition: 0, width: 576, height: 288,
          borderWidth: 1, borderColor: 5, borderRdaius: 5, paddingLength: 10,
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: 3, itemWidth: 0, isItemSelectBorderEn: 1,
            itemName: ['Item 1', 'Item 2', 'Item 3'],
          }),
        })],
      }),
    },
    {
      name: 'B: SDK example (list+text, 2 containers)',
      build: () => new RebuildPageContainer({
        containerTotalNum: 2,
        listObject: [new ListContainerProperty({
          containerID: 1,
          containerName: 'list-1',
          xPosition: 100, yPosition: 50, width: 200, height: 150,
          borderWidth: 2, borderColor: 5, borderRdaius: 5, paddingLength: 10,
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: 3, itemWidth: 0, isItemSelectBorderEn: 1,
            itemName: ['Item 1', 'Item 2', 'Item 3'],
          }),
        })],
        textObject: [new TextContainerProperty({
          containerID: 2,
          containerName: 'text-1',
          xPosition: 100, yPosition: 220, width: 200, height: 50,
          borderWidth: 1, borderColor: 0, borderRdaius: 3, paddingLength: 5,
          content: 'Hello World',
          isEventCapture: 0,
        })],
      }),
    },
    {
      name: 'C: 2 text containers',
      build: () => new RebuildPageContainer({
        containerTotalNum: 2,
        textObject: [
          new TextContainerProperty({
            containerID: 1, containerName: 'text-1',
            xPosition: 0, yPosition: 0, width: 576, height: 140,
            content: 'Top half', isEventCapture: 0, borderWidth: 0,
          }),
          new TextContainerProperty({
            containerID: 2, containerName: 'text-2',
            xPosition: 0, yPosition: 148, width: 576, height: 140,
            content: 'Bottom half', isEventCapture: 1, borderWidth: 0,
          }),
        ],
      }),
    },
    {
      name: 'D: our list page (text+list, 2 containers)',
      build: () => buildListPage(),
    },
  ]

  const results: string[] = []
  let firstPass: string | null = null

  for (const test of tests) {
    try {
      const ok = await bridge.rebuildPageContainer(test.build())
      const status = ok ? 'PASS' : 'FAIL'
      results.push(`${test.name}: ${status}`)
      log(`[DIAG] ${test.name}: ${status}`)
      if (ok && !firstPass) firstPass = test.name
    } catch (e) {
      results.push(`${test.name}: THREW ${e}`)
      log(`[DIAG] ${test.name}: THREW ${e}`, 'error')
    }
  }

  log(`[DIAG] Summary: ${results.join(' | ')}`)
  return firstPass
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

  // Step 1: Create startup page with PROVEN WORKING single text container
  const resultNames = ['success', 'invalid', 'oversize', 'outOfMemory']
  let createResult: number
  try {
    createResult = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
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
    )
  } catch (e) {
    log(`createStartUpPageContainer threw: ${e}`, 'error')
    createResult = -1
  }
  log(`createStartUpPageContainer: ${resultNames[createResult] ?? createResult} (raw=${createResult})`)

  if (createResult === StartUpPageCreateResult.success) {
    log('Startup page created (first time)')
  } else {
    // "invalid" means it was already created in a previous session — that's fine
    log(`Startup returned ${resultNames[createResult] ?? createResult} — page already exists, proceeding with rebuild`)
  }

  setGlassesStatus('Glasses connected', 'green')
  log('Running rebuild diagnostics...')

  // Step 2: Run diagnostics to find which rebuild configs work
  const firstPass = await runDiagnostics(bridge)

  if (!firstPass) {
    log('ALL rebuild tests FAILED — staying on text UI', 'error')
    setGlassesStatus('Glasses connected (text only)', 'yellow')
  }

  // Step 3: Rebuild with our list page if test D passed, otherwise stay on text
  if (firstPass === 'D: our list page (text+list, 2 containers)') {
    uiMode = 'list'
    await bridge.rebuildPageContainer(buildListPage())
    log('List UI active')
  } else if (firstPass) {
    // Some other test passed but not our list page — rebuild back to text
    log(`Only "${firstPass}" passed, our list page failed. Rebuilding to text...`, 'warn')
    await bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 1,
      textObject: [new TextContainerProperty({
        containerID: 1, containerName: 'media-info',
        xPosition: 0, yPosition: 0, width: 576, height: 288,
        content: buildDisplayText(),
        isEventCapture: 1, borderWidth: 0,
      })],
    }))
  }

  // Event handler — route based on active UI mode
  bridge.onEvenHubEvent(async (event: EvenHubEvent) => {
    try {
      const le = event.listEvent
      const te = event.textEvent
      const se = event.sysEvent

      log(`Event: list=${!!le} text=${!!te} sys=${!!se} raw=${JSON.stringify(event.jsonData ?? {}).slice(0, 200)}`)

      if (uiMode === 'text') {
        const eventType = te?.eventType ?? se?.eventType
        if (eventType === undefined) return
        await handleTextEvent(bridge, eventType)
      } else if (uiMode === 'list') {
        const eventType = le?.eventType ?? se?.eventType
        if (eventType === undefined) return
        await handleListEvent(bridge, eventType, le?.currentSelectItemIndex)
      } else {
        const eventType = te?.eventType ?? se?.eventType
        if (eventType === undefined) return
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
    const oldVol = volume
    await sendCommand('status')
    if (title !== oldTitle || artist !== oldArtist || volume !== oldVol) {
      if (uiMode === 'text') {
        await updateTextDisplay(bridge)
      } else if (uiMode === 'list') {
        await updateNowPlayingText(bridge)
      }
    }
  }, 5000)
}

main().catch(e => log(`main() crashed: ${e}`, 'error'))
