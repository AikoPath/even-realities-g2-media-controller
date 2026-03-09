import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
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

// Display layout — 2 containers: main (top) + volume bar (bottom)
const DISPLAY_W = 576
const DISPLAY_H = 288
const VOL_H = 72
const MAIN_H = DISPLAY_H - VOL_H

const MAIN = { id: 1, name: 'main' }
const VOL = { id: 2, name: 'vol' }

type MediaCommand = 'play' | 'pause' | 'next' | 'prev' | 'vol-up' | 'vol-down' | 'status'

declare const __APP_VERSION__: string

// --- Phone UI ---

const versionEl = document.getElementById('version')
if (versionEl) versionEl.textContent = `v${__APP_VERSION__}`

function setStatus(id: string, dotClass: string, text: string) {
  const dot = document.getElementById(`dot-${id}`)
  const label = document.getElementById(`label-${id}`)
  if (dot) dot.className = `status-dot ${dotClass}`
  if (label) label.textContent = text
}

function addLog(action: string, detail: string = '') {
  const list = document.getElementById('log-list')
  if (!list) return
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false })
  const entry = document.createElement('div')
  entry.className = 'log-entry'
  entry.innerHTML = `<span class="log-time">${time}</span> <span class="log-action">${action}</span>${detail ? ` <span class="log-detail">${detail}</span>` : ''}`
  list.insertBefore(entry, list.firstChild)
  while (list.children.length > 200) list.removeChild(list.lastChild!)
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

// --- Bridge communication ---

let isPlaying = false
let currentTrack = 'No media'
let volume = -1

async function sendCommand(cmd: MediaCommand): Promise<void> {
  try {
    const res = await fetch(`${BRIDGE_URL}/${cmd}`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      // For play/pause commands the Android bridge reads playbackState
      // immediately after dispatching — before the state has actually
      // changed. So the response returns stale data. We skip updating
      // isPlaying here; the caller sets it optimistically instead.
      if (cmd !== 'play' && cmd !== 'pause' && data.playing !== undefined) {
        isPlaying = data.playing
      }
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

// --- Input parsing ---

type Action = 'tap' | 'double-tap' | 'scroll-up' | 'scroll-down'

let lastScrollTime = 0

function parseEvent(event: EvenHubEvent): Action | null {
  if (event.audioEvent) return null

  const eventType = event.textEvent?.eventType ?? event.sysEvent?.eventType

  // CLICK_EVENT = 0, SDK fromJson normalizes 0 to undefined
  if (eventType === undefined || eventType === OsEventTypeList.CLICK_EVENT) return 'tap'
  if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) return 'double-tap'

  const now = Date.now()
  if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
    if (now - lastScrollTime < SCROLL_COOLDOWN_MS) return null
    lastScrollTime = now
    return 'scroll-up'
  }
  if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    if (now - lastScrollTime < SCROLL_COOLDOWN_MS) return null
    lastScrollTime = now
    return 'scroll-down'
  }

  return null
}

// --- State machine ---

const MENU_ITEMS: { label: string; command: () => MediaCommand }[] = [
  { label: 'Play / Pause', command: () => isPlaying ? 'pause' : 'play' },
  { label: 'Next Track',   command: () => 'next' },
  { label: 'Prev Track',   command: () => 'prev' },
]
const VOLUME_ITEM_INDEX = MENU_ITEMS.length
const TOTAL_ITEMS = MENU_ITEMS.length + 1 // +1 for volume bar

type Mode =
  | { type: 'menu'; selected: number }
  | { type: 'volume' }

let mode: Mode = { type: 'menu', selected: 0 }

async function handleAction(action: Action): Promise<void> {
  if (mode.type === 'menu') {
    if (action === 'scroll-up') {
      mode.selected = (mode.selected + 1) % TOTAL_ITEMS
      const name = mode.selected === VOLUME_ITEM_INDEX ? 'Volume' : MENU_ITEMS[mode.selected].label
      addLog('NAV', `Selected: ${name}`)
    } else if (action === 'scroll-down') {
      mode.selected = (mode.selected - 1 + TOTAL_ITEMS) % TOTAL_ITEMS
      const name = mode.selected === VOLUME_ITEM_INDEX ? 'Volume' : MENU_ITEMS[mode.selected].label
      addLog('NAV', `Selected: ${name}`)
    } else if (action === 'tap') {
      if (mode.selected === VOLUME_ITEM_INDEX) {
        mode = { type: 'volume' }
        addLog('VOL', 'Entered volume mode')
        await sendCommand('status')
      } else {
        const item = MENU_ITEMS[mode.selected]
        const cmd = item.command()
        // Optimistically set isPlaying so the indicator updates on the
        // first tap. The bridge returns stale state for play/pause because
        // it reads playbackState before Android has processed the dispatch.
        if (cmd === 'play') isPlaying = true
        else if (cmd === 'pause') isPlaying = false
        addLog('ACTION', `${item.label} (${cmd})`)
        await sendCommand(cmd)
      }
    }
  } else if (mode.type === 'volume') {
    if (action === 'scroll-up') {
      addLog('VOL', 'Volume down')
      await sendCommand('vol-down')
    } else if (action === 'scroll-down') {
      addLog('VOL', 'Volume up')
      await sendCommand('vol-up')
    } else if (action === 'tap') {
      mode = { type: 'menu', selected: VOLUME_ITEM_INDEX }
      addLog('VOL', 'Exited volume mode')
    }
  }
}

// --- Glasses display ---

function buildVolumeBar(): string {
  if (volume < 0) return 'Volume'
  const pct = Math.round((volume / 160) * 100)
  const maxBlocks = 15
  const filled = Math.round((pct / 100) * maxBlocks)
  const bar = '\u2501'.repeat(filled) + '\u2500'.repeat(maxBlocks - filled)
  return `[${bar}] ${pct}%`
}

function buildMainText(): string {
  const state = isPlaying ? '\u25B6' : '\u25A0'
  const header = `${state} ${currentTrack}`
  const selected = mode.type === 'menu' ? mode.selected : -1

  const menu = MENU_ITEMS.map((item, i) =>
    i === selected ? `> ${item.label}` : `  ${item.label}`
  ).join('\n')

  return `${header}\n\n${menu}`
}

function volumeHasBorder(): boolean {
  return mode.type === 'volume' || (mode.type === 'menu' && mode.selected === VOLUME_ITEM_INDEX)
}

function makeContainers(): TextContainerProperty[] {
  const hasBorder = volumeHasBorder()
  return [
    new TextContainerProperty({
      containerID: MAIN.id,
      containerName: MAIN.name,
      xPosition: 0,
      yPosition: 0,
      width: DISPLAY_W,
      height: MAIN_H,
      content: buildMainText(),
      isEventCapture: 1,
      borderWidth: 0,
    }),
    new TextContainerProperty({
      containerID: VOL.id,
      containerName: VOL.name,
      xPosition: 0,
      yPosition: MAIN_H,
      width: DISPLAY_W,
      height: VOL_H,
      content: buildVolumeBar(),
      isEventCapture: 0,
      borderWidth: hasBorder ? 2 : 0,
      borderColor: hasBorder ? 13 : 0,
      borderRdaius: hasBorder ? 6 : 0,
      paddingLength: 4,
    }),
  ]
}

let lastVolBorder = false

async function rebuildDisplay(bridge: EvenAppBridge) {
  const containers = makeContainers()
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: containers.length,
      textObject: containers,
    })
  )
}

async function updateDisplay(bridge: EvenAppBridge) {
  const hasBorder = volumeHasBorder()

  if (hasBorder !== lastVolBorder) {
    lastVolBorder = hasBorder
    await rebuildDisplay(bridge)
  } else {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: MAIN.id,
        containerName: MAIN.name,
        contentOffset: 0,
        contentLength: 2000,
        content: buildMainText(),
      })
    )
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: VOL.id,
        containerName: VOL.name,
        contentOffset: 0,
        contentLength: 2000,
        content: buildVolumeBar(),
      })
    )
  }
}

// --- Main ---

async function main() {
  addLog('INIT', 'Waiting for bridge...')
  setStatus('glasses', 'dot-yellow', 'Glasses: connecting...')

  const bridge = await waitForEvenAppBridge()

  addLog('INIT', 'Bridge ready')
  setStatus('glasses', 'dot-green', 'Glasses: connected')

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

  const containers = makeContainers()
  lastVolBorder = volumeHasBorder()

  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: containers.length,
      textObject: containers,
    })
  )

  await sendCommand('status')
  await updateDisplay(bridge)
  addLog('INIT', 'Ready')

  bridge.onEvenHubEvent(async (event: EvenHubEvent) => {
    const action = parseEvent(event)
    if (!action) return
    await handleAction(action)
    await updateDisplay(bridge)
  })
}

main()
