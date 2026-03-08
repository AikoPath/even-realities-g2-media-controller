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
  type EvenHubEvent,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'

const BRIDGE_PORT = 8765
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`
const SCROLL_COOLDOWN_MS = 200

type MediaCommand = 'play' | 'pause' | 'next' | 'prev' | 'vol-up' | 'vol-down' | 'status'

// ── State ──
let isPlaying = false
let title = 'No media'
let artist = ''
let volume = 0
let maxVolume = 15
let position = 0
let duration = 0
let lastScrollTime = 0
let lastArtUrl = ''

// UI mode: 'list' = normal action list, 'volume' = volume slider, 'seek' = seek slider
type UIMode = 'list' | 'volume' | 'seek'
let uiMode: UIMode = 'list'

// ── Action items for the list ──
const ACTION_PREV = 0
const ACTION_PLAY = 1
const ACTION_NEXT = 2
const ACTION_VOL = 3
const ACTION_SEEK = 4

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

async function sendCommand(cmd: MediaCommand): Promise<StatusResponse | null> {
  try {
    const res = await fetch(`${BRIDGE_URL}/${cmd}`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      if (data.playing !== undefined) isPlaying = data.playing
      if (data.title) title = data.title
      if (data.artist !== undefined) artist = data.artist
      if (data.volume !== undefined) volume = data.volume
      if (data.maxVolume !== undefined) maxVolume = data.maxVolume
      if (data.position !== undefined) position = data.position
      if (data.duration !== undefined) duration = data.duration
      return data
    }
  } catch {
    title = 'Bridge offline'
    artist = ''
  }
  return null
}

async function sendSeek(pos: number): Promise<void> {
  try {
    await fetch(`${BRIDGE_URL}/seek?pos=${Math.round(pos)}`, { method: 'POST' })
    position = pos
  } catch { /* ignore */ }
}

async function sendVolSet(vol: number): Promise<void> {
  try {
    await fetch(`${BRIDGE_URL}/vol-set?v=${vol}`, { method: 'POST' })
    volume = vol
  } catch { /* ignore */ }
}

// ── Formatting helpers ──
const LIST_CHAR_WIDTH = 40 // approximate chars that fit in 560px item width

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
  const filled = Math.round(fraction * width)
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled)
}

function volumePercent(): number {
  return maxVolume > 0 ? Math.round((volume / maxVolume) * 100) : 0
}

function volumeFraction(): number {
  return maxVolume > 0 ? volume / maxVolume : 0
}

function seekFraction(): number {
  return duration > 0 ? Math.min(position / duration, 1) : 0
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
    centerText('\u23EE Previous'),
    centerText(playLabel),
    centerText('\u23ED Next'),
    centerText(`\u266B Vol ${volBar} ${volPct}%`),
    centerText(`${posStr} ${seekBar} ${durStr}`),
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
function buildListPage(bridge: EvenAppBridge): RebuildPageContainer | CreateStartUpPageContainer {
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
  try {
    const res = await fetch(`${BRIDGE_URL}/art`, { method: 'POST' })
    if (!res.ok) return
    const data = await res.json()
    if (!data.art || data.art === lastArtUrl) return
    lastArtUrl = data.art

    // Decode base64 PNG → canvas → raw pixel bytes
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

    // Convert RGBA to grayscale bytes (one byte per pixel)
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
  } catch {
    // Album art is optional, ignore errors
  }
}

// ── Display update ──
async function rebuildDisplay(bridge: EvenAppBridge): Promise<void> {
  if (uiMode === 'list') {
    await bridge.rebuildPageContainer(buildListPage(bridge))
    // Update album art after rebuild (can't send during startup)
    fetchAndSendAlbumArt(bridge)
  } else {
    await bridge.rebuildPageContainer(buildSliderPage())
  }
}

async function updateNowPlayingText(bridge: EvenAppBridge): Promise<void> {
  if (uiMode === 'list') {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 2,
        containerName: 'now-playing',
        contentOffset: 0,
        contentLength: 500,
        content: getNowPlayingText(),
      })
    )
  }
}

async function updateSliderText(bridge: EvenAppBridge): Promise<void> {
  if (uiMode !== 'list') {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 2,
        containerName: 'slider-ctrl',
        contentOffset: 0,
        contentLength: 500,
        content: getSliderText(),
      })
    )
  }
}

// ── Event handling ──
async function handleListEvent(
  bridge: EvenAppBridge,
  eventType: OsEventTypeList,
  itemIndex?: number,
): Promise<void> {
  if (eventType === OsEventTypeList.CLICK_EVENT) {
    switch (itemIndex) {
      case ACTION_PREV:
        await sendCommand('prev')
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
      case ACTION_VOL:
        uiMode = 'volume'
        await rebuildDisplay(bridge)
        break
      case ACTION_SEEK:
        uiMode = 'seek'
        await rebuildDisplay(bridge)
        break
    }
  }
  // Scroll events in list mode are handled by the list container natively
}

async function handleSliderEvent(
  bridge: EvenAppBridge,
  eventType: OsEventTypeList,
): Promise<void> {
  const now = Date.now()

  if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    // Exit slider mode
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
      const newVol = Math.max(0, Math.min(maxVolume, volume + increment))
      await sendVolSet(newVol)
    } else if (uiMode === 'seek') {
      const step = Math.max(5000, duration / 20) // 5% or 5s, whichever is larger
      const newPos = Math.max(0, Math.min(duration, position + increment * step))
      await sendSeek(newPos)
    }

    await updateSliderText(bridge)
  }
}

// ── Main ──
async function main() {
  const bridge = await waitForEvenAppBridge()

  // Initial status fetch
  await sendCommand('status')

  // Create startup page with list layout
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

  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 3,
      imageObject: [imgContainer],
      textObject: [textContainer],
      listObject: [listContainer],
    })
  )

  // Send album art after startup
  fetchAndSendAlbumArt(bridge)

  // Event handler
  bridge.onEvenHubEvent(async (event: EvenHubEvent) => {
    const le = event.listEvent
    const te = event.textEvent
    const se = event.sysEvent

    if (uiMode === 'list') {
      const eventType = le?.eventType ?? se?.eventType
      if (eventType === undefined) return
      await handleListEvent(bridge, eventType, le?.currentSelectItemIndex)
    } else {
      const eventType = te?.eventType ?? se?.eventType
      if (eventType === undefined) return
      await handleSliderEvent(bridge, eventType)
    }
  })

  // Periodic status poll to keep position/track info up to date
  setInterval(async () => {
    const oldTitle = title
    const oldArtist = artist
    await sendCommand('status')
    if (uiMode === 'list' && (title !== oldTitle || artist !== oldArtist)) {
      await updateNowPlayingText(bridge)
      fetchAndSendAlbumArt(bridge)
    }
  }, 5000)
}

main()
