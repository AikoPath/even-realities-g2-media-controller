import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
  TextContainer,
  ListContainer,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'

const BRIDGE_PORT = 8765
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`
const SCROLL_COOLDOWN_MS = 300

// Media commands sent to the Android companion app
type MediaCommand = 'play' | 'pause' | 'next' | 'prev' | 'vol-up' | 'vol-down' | 'status'

// State
let isPlaying = false
let lastScrollTime = 0
let currentTrack = 'No media'
let volume = -1

// ── Send command to Android Media Bridge ──
async function sendCommand(cmd: MediaCommand): Promise<void> {
  try {
    const res = await fetch(`${BRIDGE_URL}/${cmd}`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      if (data.playing !== undefined) isPlaying = data.playing
      if (data.track) currentTrack = data.track
      if (data.volume !== undefined) volume = data.volume
    }
  } catch {
    currentTrack = 'Bridge offline'
  }
}

// ── Build display text for glasses ──
function buildDisplayText(): string {
  const state = isPlaying ? '▶' : '⏸'
  const vol = volume >= 0 ? `Vol: ${volume}` : ''
  const lines = [
    `${state} ${currentTrack}`,
    '',
    'Tap: Play/Pause',
    'Double tap: Next',
    `Scroll: Volume ${vol}`,
  ]
  return lines.join('\n')
}

// ── Main ──
async function main() {
  const bridge = await waitForEvenAppBridge()

  // Create initial UI: single text container filling the screen
  const textContainer = new TextContainer({
    containerID: 1,
    containerName: 'media-info',
    containerX: 0,
    containerY: 0,
    containerW: 576,
    containerH: 288,
    contentOffset: 0,
    contentLength: 500,
    content: buildDisplayText(),
    fontSize: 24,
    isEventCapture: 1,
    borderWidth: 0,
  })

  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [textContainer],
    })
  )

  // Fetch initial status from bridge
  await sendCommand('status')
  await updateDisplay(bridge)

  // Listen for glasses input events
  bridge.onEvenHubEvent(async (event: EvenHubEvent) => {
    // Handle text container events (from real hardware)
    const te = event.textEvent
    const se = event.sysEvent

    // Detect click: single tap = play/pause
    const isClick =
      (te && (te.eventType === 0 || te.eventType === undefined)) ||
      (se && (se.eventType === 0 || se.eventType === undefined))

    // Detect double click: double tap = next track
    const isDoubleClick =
      (te && te.eventType === 3) || (se && se.eventType === 3)

    // Detect scroll
    const isScrollUp =
      (te && te.eventType === 1) || (se && se.eventType === 1)
    const isScrollDown =
      (te && te.eventType === 2) || (se && se.eventType === 2)

    const now = Date.now()

    if (isDoubleClick) {
      await sendCommand('next')
    } else if (isClick) {
      await sendCommand(isPlaying ? 'pause' : 'play')
    } else if (isScrollUp && now - lastScrollTime > SCROLL_COOLDOWN_MS) {
      lastScrollTime = now
      await sendCommand('vol-up')
    } else if (isScrollDown && now - lastScrollTime > SCROLL_COOLDOWN_MS) {
      lastScrollTime = now
      await sendCommand('vol-down')
    } else {
      return // No recognized action
    }

    await updateDisplay(bridge)
  })
}

async function updateDisplay(bridge: any) {
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 1,
      containerName: 'media-info',
      contentOffset: 0,
      contentLength: 500,
      content: buildDisplayText(),
    })
  )
}

main()
