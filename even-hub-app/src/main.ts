import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  type EvenHubEvent,
  type EvenAppBridge,
  type DeviceStatus,
} from '@evenrealities/even_hub_sdk'

const BRIDGE_PORT = 8765
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`
const SCROLL_COOLDOWN_MS = 300

const DISPLAY_W = 576
const DISPLAY_H = 288
const HEADER_H = 48
const VOL_H = 72
const LIST_H = DISPLAY_H - HEADER_H - VOL_H

const HEADER = { id: 1, name: 'header' }
const MENU = { id: 2, name: 'menu' }
const VOL = { id: 3, name: 'vol' }

type MediaCommand = 'play-pause' | 'next' | 'prev' | 'vol-up' | 'vol-down' | 'status'

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
  } else {
    setStatus('media', 'dot-green', `Media: ${currentTrack}`)
  }
}

// --- Bridge communication ---

let currentTrack = 'No media'
let volume = -1

async function sendCommand(cmd: MediaCommand): Promise<void> {
  try {
    const res = await fetch(`${BRIDGE_URL}/${cmd}`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      if (data.title) {
        currentTrack = data.artist ? `${data.artist} - ${data.title}` : data.title
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

// --- State machine ---

const MENU_ITEMS: { label: string; command: MediaCommand | 'volume' }[] = [
  { label: 'Play / Pause', command: 'play-pause' },
  { label: 'Next Track', command: 'next' },
  { label: 'Prev Track', command: 'prev' },
  { label: 'Volume', command: 'volume' },
]

type Mode =
  | { type: 'menu'; selected: number }
  | { type: 'volume' }

let mode: Mode = { type: 'menu', selected: 0 }

// --- Input parsing ---

type Action = 'tap' | 'scroll-up' | 'scroll-down'

let lastScrollTime = 0

function throttledScroll(eventType: OsEventTypeList): Action | null {
  const now = Date.now()
  if (now - lastScrollTime < SCROLL_COOLDOWN_MS) return null
  lastScrollTime = now
  if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) return 'scroll-up'
  if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) return 'scroll-down'
  return null
}

function parseEvent(event: EvenHubEvent): { action: Action; listIndex?: number } | null {
  if (event.audioEvent) return null

  // List events (menu mode) — firmware handles selection
  if (event.listEvent) {
    const et = event.listEvent.eventType
    if (et === undefined || et === OsEventTypeList.CLICK_EVENT) {
      // Firmware may omit index for item 0
      const idx = event.listEvent.currentSelectItemIndex
        ?? (mode.type === 'menu' ? mode.selected : 0)
      return { action: 'tap', listIndex: idx }
    }
    if (et === undefined) return null
    const scroll = throttledScroll(et)
    return scroll ? { action: scroll } : null
  }

  // Text/sys events (volume mode or simulator)
  const eventType = event.textEvent?.eventType ?? event.sysEvent?.eventType
  if (eventType === undefined || eventType === OsEventTypeList.CLICK_EVENT) return { action: 'tap' }
  const scroll = throttledScroll(eventType)
  return scroll ? { action: scroll } : null
}

async function handleAction(action: Action, listIndex?: number): Promise<void> {
  if (mode.type === 'menu') {
    if (action === 'scroll-up' || action === 'scroll-down') {
      // Firmware handles list selection visually — just track index in state
      if (action === 'scroll-down') {
        mode.selected = (mode.selected + 1) % MENU_ITEMS.length
      } else {
        mode.selected = (mode.selected - 1 + MENU_ITEMS.length) % MENU_ITEMS.length
      }
      addLog('NAV', `Selected: ${MENU_ITEMS[mode.selected].label}`)
    } else if (action === 'tap') {
      const idx = listIndex ?? mode.selected
      const item = MENU_ITEMS[idx]
      if (!item) return
      mode.selected = idx
      if (item.command === 'volume') {
        mode = { type: 'volume' }
        addLog('VOL', 'Entered volume mode')
        await sendCommand('status')
      } else {
        addLog('ACTION', `${item.label} (${item.command})`)
        await sendCommand(item.command)
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
      mode = { type: 'menu', selected: MENU_ITEMS.length - 1 }
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

let lastMode: Mode['type'] = 'menu'

function buildPage(inVolumeMode: boolean) {
  const header = new TextContainerProperty({
    containerID: HEADER.id,
    containerName: HEADER.name,
    xPosition: 0,
    yPosition: 0,
    width: DISPLAY_W,
    height: HEADER_H,
    content: currentTrack,
    isEventCapture: 0,
    borderWidth: 0,
  })

  const listItems = new ListItemContainerProperty({
    itemCount: MENU_ITEMS.length,
    itemWidth: DISPLAY_W - 16,
    isItemSelectBorderEn: 1,
    itemName: MENU_ITEMS.map(i => i.label),
  })

  const menuList = new ListContainerProperty({
    containerID: MENU.id,
    containerName: MENU.name,
    xPosition: 0,
    yPosition: HEADER_H,
    width: DISPLAY_W,
    height: LIST_H,
    isEventCapture: inVolumeMode ? 0 : 1,
    borderWidth: 0,
    paddingLength: 4,
    itemContainer: listItems,
  })

  const volBar = new TextContainerProperty({
    containerID: VOL.id,
    containerName: VOL.name,
    xPosition: 0,
    yPosition: HEADER_H + LIST_H,
    width: DISPLAY_W,
    height: VOL_H,
    content: buildVolumeBar(),
    isEventCapture: inVolumeMode ? 1 : 0,
    borderWidth: inVolumeMode ? 2 : 0,
    borderColor: inVolumeMode ? 13 : 0,
    borderRdaius: inVolumeMode ? 6 : 0,
    paddingLength: 4,
  })

  return { textObject: [header, volBar], listObject: [menuList], count: 3 }
}

async function updateDisplay(bridge: EvenAppBridge) {
  const modeChanged = mode.type !== lastMode
  lastMode = mode.type

  if (modeChanged) {
    const page = buildPage(mode.type === 'volume')
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: page.count,
        textObject: page.textObject,
        listObject: page.listObject,
      })
    )
  } else {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: HEADER.id,
        containerName: HEADER.name,
        contentOffset: 0,
        contentLength: 2000,
        content: currentTrack,
      })
    )
    if (mode.type === 'volume') {
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

  const page = buildPage(false)
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: page.count,
      textObject: page.textObject,
      listObject: page.listObject,
    })
  )

  await sendCommand('status')
  addLog('INIT', 'Ready')

  bridge.onEvenHubEvent(async (event: EvenHubEvent) => {
    const parsed = parseEvent(event)
    if (!parsed) return
    await handleAction(parsed.action, parsed.listIndex)
    await updateDisplay(bridge)
  })
}

main()
