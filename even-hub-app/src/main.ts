import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  TextContainerProperty,
  OsEventTypeList,
  type EvenHubEvent,
  type EvenAppBridge,
  type DeviceStatus,
} from '@evenrealities/even_hub_sdk'

const BRIDGE_PORT = 8765
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`
const SCROLL_COOLDOWN_MS = 300

type MediaCommand = 'play' | 'pause' | 'next' | 'prev' | 'vol-up' | 'vol-down' | 'status'

// Action menu
const ACTIONS: { label: string; command: () => MediaCommand }[] = [
  { label: 'Play / Pause', command: () => isPlaying ? 'pause' : 'play' },
  { label: 'Next Track',   command: () => 'next' },
  { label: 'Prev Track',   command: () => 'prev' },
  { label: 'Volume Up',    command: () => 'vol-up' },
  { label: 'Volume Down',  command: () => 'vol-down' },
]

// State
let isPlaying = false
let selectedIndex = 0
let lastScrollTime = 0
let currentTrack = 'No media'
let volume = -1

// --- Phone UI helpers ---

function setStatus(id: string, dotClass: string, text: string) {
  const dot = document.getElementById(`dot-${id}`)
  const label = document.getElementById(`label-${id}`)
  if (dot) {
    dot.className = `status-dot ${dotClass}`
  }
  if (label) {
    label.textContent = text
  }
}

function addLog(action: string, detail: string = '') {
  const list = document.getElementById('log-list')
  if (!list) return
  const now = new Date()
  const time = now.toLocaleTimeString('en-GB', { hour12: false })
  const entry = document.createElement('div')
  entry.className = 'log-entry'
  entry.innerHTML = `<span class="log-time">${time}</span> <span class="log-action">${action}</span>${detail ? ` <span class="log-detail">${detail}</span>` : ''}`
  list.insertBefore(entry, list.firstChild)
  // Keep max 200 entries
  while (list.children.length > 200) {
    list.removeChild(list.lastChild!)
  }
}

// --- Bridge communication ---

async function sendCommand(cmd: MediaCommand): Promise<void> {
  try {
    const res = await fetch(`${BRIDGE_URL}/${cmd}`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      if (data.playing !== undefined) isPlaying = data.playing
      if (data.title) {
        currentTrack = data.artist ? `${data.artist} - ${data.title}` : data.title
      } else if (data.track) {
        currentTrack = data.track
      }
      if (data.volume !== undefined) volume = data.volume
      setStatus('bridge', 'dot-green', 'Bridge: connected')
      updateMediaStatus()
    }
  } catch {
    currentTrack = 'Bridge offline'
    setStatus('bridge', 'dot-red', 'Bridge: offline')
    setStatus('media', 'dot-gray', 'Media: unknown')
  }
}

function updateMediaStatus() {
  if (currentTrack === 'Bridge offline') {
    setStatus('media', 'dot-gray', 'Media: unknown')
  } else if (isPlaying) {
    setStatus('media', 'dot-green', `Media: playing - ${currentTrack}`)
  } else {
    setStatus('media', 'dot-yellow', `Media: paused - ${currentTrack}`)
  }
}

function buildDisplayText(): string {
  const state = isPlaying ? '>' : '||'
  const vol = volume >= 0 ? ` | Vol: ${volume}` : ''
  const header = `${state} ${currentTrack}${vol}`

  const menu = ACTIONS.map((a, i) =>
    i === selectedIndex ? `> ${a.label}` : `  ${a.label}`
  ).join('\n')

  return `${header}\n\n${menu}`
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

// --- Main ---

async function main() {
  addLog('INIT', 'Waiting for bridge...')
  setStatus('glasses', 'dot-yellow', 'Glasses: connecting...')

  const bridge = await waitForEvenAppBridge()

  addLog('INIT', 'Bridge ready')
  setStatus('glasses', 'dot-green', 'Glasses: connected')

  // Watch glasses connection status
  bridge.onDeviceStatusChanged((status: DeviceStatus) => {
    const ct = status.connectType
    if (ct === 'none') return
    addLog('DEVICE', `status=${ct}, battery=${status.batteryLevel ?? '?'}%, wearing=${status.isWearing ?? '?'}`)
    if (ct === 'connected') {
      setStatus('glasses', 'dot-green', `Glasses: connected${status.batteryLevel !== undefined ? ` (${status.batteryLevel}%)` : ''}`)
    } else if (ct === 'connecting') {
      setStatus('glasses', 'dot-yellow', 'Glasses: connecting...')
    } else if (ct === 'disconnected') {
      setStatus('glasses', 'dot-red', 'Glasses: disconnected')
    } else if (ct === 'connectionFailed') {
      setStatus('glasses', 'dot-red', 'Glasses: connection failed')
    }
  })

  // Create page
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

  // Fetch initial status
  await sendCommand('status')
  await updateDisplay(bridge)
  addLog('INIT', 'Initial status fetched, display updated')

  // Handle glasses events
  // Scroll = navigate menu, Tap = execute selected action
  bridge.onEvenHubEvent(async (event: EvenHubEvent) => {
    const te = event.textEvent
    const se = event.sysEvent

    const eventType = te?.eventType ?? se?.eventType

    // Firmware sends single tap as empty evenHubEvent (no eventType).
    // Skip audio events which also have no textEvent/sysEvent.
    if (eventType === undefined) {
      if (event.audioEvent) return
      // Tap = execute selected action
      const selected = ACTIONS[selectedIndex]
      const cmd = selected.command()
      addLog('ACTION', `${selected.label} (${cmd})`)
      await sendCommand(cmd)
      await updateDisplay(bridge)
      return
    }

    const now = Date.now()

    if (eventType === OsEventTypeList.CLICK_EVENT) {
      // Tap = execute selected action
      const selected = ACTIONS[selectedIndex]
      const cmd = selected.command()
      addLog('ACTION', `${selected.label} (${cmd})`)
      await sendCommand(cmd)
    } else if (eventType === OsEventTypeList.SCROLL_TOP_EVENT && now - lastScrollTime > SCROLL_COOLDOWN_MS) {
      lastScrollTime = now
      selectedIndex = (selectedIndex - 1 + ACTIONS.length) % ACTIONS.length
      addLog('NAV', `Selected: ${ACTIONS[selectedIndex].label}`)
    } else if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT && now - lastScrollTime > SCROLL_COOLDOWN_MS) {
      lastScrollTime = now
      selectedIndex = (selectedIndex + 1) % ACTIONS.length
      addLog('NAV', `Selected: ${ACTIONS[selectedIndex].label}`)
    } else if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      // Double tap also executes selected action (alternative trigger)
      const selected = ACTIONS[selectedIndex]
      const cmd = selected.command()
      addLog('ACTION', `${selected.label} (${cmd})`)
      await sendCommand(cmd)
    } else {
      addLog('EVENT', `unhandled eventType=${eventType}`)
      return
    }

    await updateDisplay(bridge)
  })
}

main()
