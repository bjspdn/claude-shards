import { watch, existsSync, statSync } from "fs"
import { readFile } from "fs/promises"
import { dirname } from "path"
import { LOG_PATH } from "../logger"
import { C } from "../utils"

const INITIAL_LINES = 20

const LEVEL_COLOR: Record<string, string> = {
  info: C.green,
  warn: C.yellow,
  error: C.red,
}

const CATEGORY_COLOR: Record<string, string> = {
  tool: C.cyan,
  watcher: C.yellow,
  server: C.green,
  update: C.magenta,
}

function formatTime(iso: string): string {
  return iso.slice(11, 19)
}

function formatLogLine(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let entry: Record<string, unknown>
  try {
    entry = JSON.parse(trimmed)
  } catch {
    return null
  }

  const ts = formatTime(entry.ts as string)
  const level = (entry.level as string).toUpperCase().padEnd(5)
  const category = (entry.category as string).padEnd(8)
  const message = entry.message as string

  const levelColor = LEVEL_COLOR[entry.level as string] ?? ""
  const catColor = CATEGORY_COLOR[entry.category as string] ?? ""

  let line = `${C.dim}${ts}${C.reset} ${levelColor}${level}${C.reset} ${catColor}${category}${C.reset} ${message}`

  const meta: string[] = []
  for (const key of Object.keys(entry)) {
    if (["ts", "level", "category", "message"].includes(key)) continue
    const val = typeof entry[key] === "string" ? entry[key] : JSON.stringify(entry[key])
    meta.push(`${key}=${val}`)
  }
  if (meta.length > 0) {
    line += ` ${C.dim}${meta.join(" ")}${C.reset}`
  }

  return line
}

async function printInitialLines(): Promise<number> {
  if (!existsSync(LOG_PATH)) return 0

  const content = await readFile(LOG_PATH, "utf-8")
  const lines = content.split("\n").filter((l) => l.trim())
  const tail = lines.slice(-INITIAL_LINES)

  if (tail.length > 0) {
    console.log(`${C.dim}${C.bold}--- last ${tail.length} log entries ---${C.reset}`)
    for (const line of tail) {
      const formatted = formatLogLine(line)
      if (formatted) console.log(formatted)
    }
    console.log(`${C.dim}${C.bold}--- live tail ---${C.reset}\n`)
  }

  return Buffer.byteLength(content, "utf-8")
}

async function readDelta(offset: number): Promise<{ text: string; newOffset: number }> {
  const content = await readFile(LOG_PATH, "utf-8")
  const totalBytes = Buffer.byteLength(content, "utf-8")

  if (totalBytes < offset) {
    return { text: content, newOffset: totalBytes }
  }

  const buf = Buffer.from(content, "utf-8")
  const delta = buf.subarray(offset).toString("utf-8")
  return { text: delta, newOffset: totalBytes }
}

function waitForLogFile(): Promise<void> {
  if (existsSync(LOG_PATH)) return Promise.resolve()

  return new Promise((resolve) => {
    console.log(`${C.dim}Waiting for log file...${C.reset}`)
    const dir = dirname(LOG_PATH)
    const w = watch(dir, (_, filename) => {
      if (filename === "ccm.log" && existsSync(LOG_PATH)) {
        w.close()
        resolve()
      }
    })
  })
}

export async function runLogViewer(): Promise<void> {
  console.log(`${C.bold}ccm${C.reset} ${C.dim}log viewer${C.reset}\n`)

  await waitForLogFile()

  let offset = await printInitialLines()

  const dir = dirname(LOG_PATH)
  watch(dir, async (_, filename) => {
    if (filename !== "ccm.log") return

    try {
      const s = statSync(LOG_PATH)
      if (s.size < offset) {
        offset = 0
      }
      if (s.size === offset) return

      const { text, newOffset } = await readDelta(offset)
      offset = newOffset

      const lines = text.split("\n")
      for (const line of lines) {
        const formatted = formatLogLine(line)
        if (formatted) console.log(formatted)
      }
    } catch {}
  })
}
