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
} from '@evenrealities/even_hub_sdk'

const BRIDGE_PORT = 8765
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`

const DISPLAY_W = 576
const DISPLAY_H = 288
const VOL_H = 72
const LIST_H = DISPLAY_H - VOL_H

const MENU = { id: 1, name: 'menu' }
const VOL = { id: 2, name: 'vol' }

const MENU_LABELS = ['Play/Pause', 'Next Track', 'Prev Track']
const MENU_COMMANDS: MediaCommand[] = ['play-pause', 'next', 'prev']
const ITEM_COUNT = 4 // 3 commands + volume bar

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

// --- Bridge communication ---

let volume = -1

async function sendCommand(cmd: MediaCommand): Promise<void> {
  try {
    const res = await fetch(`${BRIDGE_URL}/${cmd}`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      if (data.volume !== undefined) volume = data.volume
    }
  } catch {
    // bridge unreachable
  }
}

// --- State machine ---

type Mode =
  | { type: 'menu'; selected: number }
  | { type: 'volume' }

let mode: Mode = { type: 'menu', selected: 0 }

// --- Input parsing ---

type Action = 'tap' | 'scroll-up' | 'scroll-down'

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
    if (et === OsEventTypeList.SCROLL_TOP_EVENT) return { action: 'scroll-up' }
    if (et === OsEventTypeList.SCROLL_BOTTOM_EVENT) return { action: 'scroll-down' }
    return null
  }

  // Text/sys events (volume mode or simulator)
  const eventType = event.textEvent?.eventType ?? event.sysEvent?.eventType
  if (eventType === undefined || eventType === OsEventTypeList.CLICK_EVENT) return { action: 'tap' }
  if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) return { action: 'scroll-up' }
  if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) return { action: 'scroll-down' }
  return null
}

async function handleAction(action: Action, listIndex?: number): Promise<boolean> {
  if (mode.type === 'menu') {
    if (action === 'scroll-up' || action === 'scroll-down') {
      // Firmware handles list selection visually — just track index in state
      if (action === 'scroll-down') {
        mode.selected = (mode.selected + 1) % ITEM_COUNT
      } else {
        mode.selected = (mode.selected - 1 + ITEM_COUNT) % ITEM_COUNT
      }
      const label = mode.selected < 3 ? MENU_LABELS[mode.selected] : 'Volume'
      addLog('NAV', `Selected: ${label}`)
      return false // firmware handles the visual update
    } else if (action === 'tap') {
      const idx = listIndex ?? mode.selected
      if (idx < 0 || idx >= ITEM_COUNT) return false
      mode.selected = idx
      if (idx === 3) {
        mode = { type: 'volume' }
        addLog('VOL', 'Entered volume mode')
        await sendCommand('status')
      } else {
        addLog('ACTION', `${MENU_LABELS[idx]} (${MENU_COMMANDS[idx]})`)
        await sendCommand(MENU_COMMANDS[idx])
      }
      return true
    }
  } else if (mode.type === 'volume') {
    if (action === 'scroll-up') {
      addLog('VOL', 'Volume down')
      await sendCommand('vol-down')
    } else if (action === 'scroll-down') {
      addLog('VOL', 'Volume up')
      await sendCommand('vol-up')
    } else if (action === 'tap') {
      mode = { type: 'menu', selected: 3 }
      addLog('VOL', 'Exited volume mode')
    }
    return true
  }
  return false
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
  const listItems = new ListItemContainerProperty({
    itemCount: ITEM_COUNT,
    itemWidth: DISPLAY_W - 16,
    isItemSelectBorderEn: 1,
    itemName: [...MENU_LABELS, buildVolumeBar()],
  })

  const menuList = new ListContainerProperty({
    containerID: MENU.id,
    containerName: MENU.name,
    xPosition: 0,
    yPosition: 0,
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
    yPosition: LIST_H,
    width: DISPLAY_W,
    height: VOL_H,
    content: buildVolumeBar(),
    isEventCapture: inVolumeMode ? 1 : 0,
    borderWidth: inVolumeMode ? 2 : 0,
    borderColor: inVolumeMode ? 13 : 0,
    borderRdaius: inVolumeMode ? 6 : 0,
    paddingLength: 4,
  })

  return { textObject: [volBar], listObject: [menuList], count: 2 }
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
  } else if (mode.type === 'volume') {
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
    const needsDisplayUpdate = await handleAction(parsed.action, parsed.listIndex)
    if (needsDisplayUpdate) await updateDisplay(bridge)
  })
}

main()
