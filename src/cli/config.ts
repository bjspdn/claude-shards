import {
  CONFIGURABLE_KEYS,
  loadPersistedConfig,
  savePersistedConfig,
  getConfigValue,
  setConfigValue,
  type ConfigEntry,
  type PersistedConfig,
} from "../config"
import { C } from "../utils"

const HIDE_CURSOR = "\x1b[?25l"
const SHOW_CURSOR = "\x1b[?25h"
const ALT_SCREEN_ON = "\x1b[?1049h"
const ALT_SCREEN_OFF = "\x1b[?1049l"
const CURSOR_HOME = "\x1b[H"
const CLEAR_TO_END = "\x1b[J"

type Mode = "navigate" | "edit"

interface MenuItem {
  type: "section" | "entry" | "blank"
  label?: string
  entryIdx?: number
}

interface State {
  cursor: number
  mode: Mode
  editBuffer: string
  persisted: PersistedConfig
  shardsDir: string
  scroll: number
}

function getSections(): { section: string; entries: ConfigEntry[] }[] {
  const seen = new Map<string, ConfigEntry[]>()
  for (const entry of CONFIGURABLE_KEYS) {
    let group = seen.get(entry.section)
    if (!group) {
      group = []
      seen.set(entry.section, group)
    }
    group.push(entry)
  }
  return [...seen.entries()].map(([section, entries]) => ({ section, entries }))
}

function buildHeader(): string[] {
  return [`  ${C.bold}Claude Shards Config${C.reset}`, ""]
}

function buildContent(state: State): { lines: string[]; cursorLine: number } {
  const lines: string[] = []
  let cursorLine = 0

  let idx = 0
  for (const { section, entries } of getSections()) {
    lines.push(`  ${C.dim}${section}${C.reset}`)
    for (const entry of entries) {
      const value = getConfigValue(entry, state.persisted)
      const isSelected = idx === state.cursor
      if (isSelected) cursorLine = lines.length

      const prefix = isSelected ? `  ${C.cyan}▸${C.reset} ` : "    "
      const label = entry.key.split(".").pop()!
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase())
        .trim()

      let valueStr: string
      if (state.mode === "edit" && isSelected) {
        valueStr = `${C.cyan}${state.editBuffer}▏${C.reset}`
      } else if (entry.type === "boolean") {
        valueStr = value ? `${C.green}✓${C.reset}` : `${C.dim}✗${C.reset}`
      } else {
        const isDefault = value === entry.defaultValue
        valueStr = isDefault ? `${C.dim}${value}${C.reset}` : `${C.cyan}${value}${C.reset}`
      }

      const padding = " ".repeat(Math.max(1, 24 - label.length))
      lines.push(`${prefix}${isSelected ? C.bold : ""}${label}${isSelected ? C.reset : ""}${padding}${valueStr}`)

      if (isSelected) {
        lines.push(`      ${C.dim}${entry.description}${C.reset}`)
      }

      idx++
    }
    lines.push("")
  }

  return { lines, cursorLine }
}

function buildFooter(state: State): string[] {
  if (state.mode === "edit") {
    return [`  ${C.dim}enter${C.reset} confirm  ${C.dim}esc${C.reset} cancel`]
  }
  return [`  ${C.dim}↑↓${C.reset} navigate  ${C.dim}enter${C.reset} edit  ${C.dim}esc${C.reset} quit`]
}

function render(state: State): string {
  const rows = process.stdout.rows || 24
  const header = buildHeader()
  const footer = buildFooter(state)
  const { lines, cursorLine } = buildContent(state)

  const contentRows = Math.max(1, rows - header.length - footer.length - 2)

  if (cursorLine < state.scroll) {
    state.scroll = Math.max(0, cursorLine - 1)
  }
  if (cursorLine + 1 >= state.scroll + contentRows) {
    state.scroll = cursorLine + 1 - contentRows + 1
  }
  state.scroll = Math.max(0, Math.min(state.scroll, Math.max(0, lines.length - contentRows)))

  const visibleContent = lines.slice(state.scroll, state.scroll + contentRows)

  return CURSOR_HOME + CLEAR_TO_END + [...header, ...visibleContent, "", ...footer, ""].join("\n")
}

function parseKeypress(data: Buffer): string {
  if (data[0] === 0x1b) {
    if (data.length === 1) return "escape"
    if (data[1] === 0x5b) {
      if (data[2] === 0x41) return "up"
      if (data[2] === 0x42) return "down"
    }
    return "unknown"
  }
  if (data[0] === 0x0d || data[0] === 0x0a) return "enter"
  if (data[0] === 0x7f || data[0] === 0x08) return "backspace"
  if (data[0] === 0x03) return "ctrl-c"

  const ch = data.toString("utf-8")
  if (/^[\d.]$/.test(ch)) return ch
  if (ch === "-") return ch
  return "unknown"
}

export async function runConfig(shardsDir: string): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error("--config requires an interactive terminal")
    process.exit(1)
  }

  const state: State = {
    cursor: 0,
    mode: "navigate",
    editBuffer: "",
    persisted: loadPersistedConfig(shardsDir),
    shardsDir,
    scroll: 0,
  }

  const totalItems = CONFIGURABLE_KEYS.length

  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdout.write(ALT_SCREEN_ON + HIDE_CURSOR)
  process.stdout.write(render(state))

  return new Promise((resolve) => {
    const cleanup = () => {
      process.stdout.write(SHOW_CURSOR + ALT_SCREEN_OFF)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener("data", onKey)
      resolve()
    }

    const onKey = (data: Buffer) => {
      const key = parseKeypress(data)
      const entry = CONFIGURABLE_KEYS[state.cursor]!

      if (key === "ctrl-c") {
        cleanup()
        return
      }

      if (state.mode === "navigate") {
        switch (key) {
          case "up":
            state.cursor = (state.cursor - 1 + totalItems) % totalItems
            break
          case "down":
            state.cursor = (state.cursor + 1) % totalItems
            break
          case "enter":
            if (entry.type === "boolean") {
              const current = getConfigValue(entry, state.persisted) as boolean
              state.persisted = setConfigValue(state.persisted, entry, !current)
              savePersistedConfig(state.shardsDir, state.persisted)
            } else {
              state.mode = "edit"
              state.editBuffer = ""
            }
            break
          case "escape":
            cleanup()
            return
        }
      } else {
        switch (key) {
          case "enter": {
            const num = parseFloat(state.editBuffer)
            if (!isNaN(num)) {
              state.persisted = setConfigValue(state.persisted, entry, num)
              savePersistedConfig(state.shardsDir, state.persisted)
            }
            state.mode = "navigate"
            state.editBuffer = ""
            break
          }
          case "escape":
            state.mode = "navigate"
            state.editBuffer = ""
            break
          case "backspace":
            state.editBuffer = state.editBuffer.slice(0, -1)
            break
          default:
            if (/^[\d.\-]$/.test(key)) {
              state.editBuffer += key
            }
            break
        }
      }

      process.stdout.write(render(state))
    }

    process.stdin.on("data", onKey)
  })
}
