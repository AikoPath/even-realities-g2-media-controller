import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  TextContainerProperty,
  OsEventTypeList,
  type EvenHubEvent,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'

const BRIDGE_PORT = 8765
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`
const SCROLL_COOLDOWN_MS = 300

type MediaCommand = 'play' | 'pause' | 'next' | 'prev' | 'vol-up' | 'vol-down' | 'status'

// State
let isPlaying = false
let lastScrollTime = 0
let currentTrack = 'No media'
let volume = -1

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

function buildDisplayText(): string {
  const state = isPlaying ? '▶' : '⏸'
  const vol = volume >= 0 ? `Vol: ${volume}` : ''
  return [
    `${state} ${currentTrack}`,
    '',
    'Tap: Play/Pause',
    'Double tap: Next',
    `Scroll: Volume ${vol}`,
  ].join('\n')
}

async function updateDisplay(bridge: EvenAppBridge) {
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

async function main() {
  const bridge = await waitForEvenAppBridge()

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

  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [textContainer],
    })
  )

  await sendCommand('status')
  await updateDisplay(bridge)

  bridge.onEvenHubEvent(async (event: EvenHubEvent) => {
    const te = event.textEvent
    const se = event.sysEvent

    const eventType = te?.eventType ?? se?.eventType
    if (eventType === undefined) return

    const now = Date.now()

    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      await sendCommand('next')
    } else if (eventType === OsEventTypeList.CLICK_EVENT) {
      await sendCommand(isPlaying ? 'pause' : 'play')
    } else if (eventType === OsEventTypeList.SCROLL_TOP_EVENT && now - lastScrollTime > SCROLL_COOLDOWN_MS) {
      lastScrollTime = now
      await sendCommand('vol-up')
    } else if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT && now - lastScrollTime > SCROLL_COOLDOWN_MS) {
      lastScrollTime = now
      await sendCommand('vol-down')
    } else {
      return
    }

    await updateDisplay(bridge)
  })
}

main()
