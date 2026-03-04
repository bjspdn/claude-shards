import { homedir } from "os"
import { join } from "path"
import { appendFile, stat, writeFile, mkdir } from "fs/promises"

export const LOG_PATH = join(homedir(), ".claude-shards", "claude-shards.log")

const MAX_LOG_SIZE = 5 * 1024 * 1024

type LogLevel = "info" | "warn" | "error"
type LogCategory = "server" | "tool" | "watcher" | "update" | "embedder" | "embeddings"

interface LogEntry {
  ts: string
  level: LogLevel
  category: LogCategory
  message: string
  [key: string]: unknown
}

function buildEntry(level: LogLevel, category: LogCategory, message: string, meta?: Record<string, unknown>): string {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    category,
    message,
    ...meta,
  }
  return JSON.stringify(entry) + "\n"
}

function writeLog(line: string): void {
  appendFile(LOG_PATH, line).catch(() => {})
}

export function logInfo(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
  writeLog(buildEntry("info", category, message, meta))
}

export function logWarn(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
  writeLog(buildEntry("warn", category, message, meta))
}

export function logError(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
  writeLog(buildEntry("error", category, message, meta))
}

export function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.length > 100) {
      result[key] = value.slice(0, 100) + "…"
    } else {
      result[key] = value
    }
  }
  return result
}

export function logToolCall(
  tool: string,
  args: Record<string, unknown>,
  durationMs: number,
  error?: string,
): void {
  const meta: Record<string, unknown> = {
    tool,
    args: summarizeArgs(args),
    durationMs,
  }
  if (error) {
    meta.error = error
    writeLog(buildEntry("error", "tool", `${tool} failed (${durationMs}ms)`, meta))
  } else {
    writeLog(buildEntry("info", "tool", `${tool} completed (${durationMs}ms)`, meta))
  }
}

export async function initLogFile(): Promise<void> {
  await mkdir(join(homedir(), ".claude-shards"), { recursive: true })
  try {
    const s = await stat(LOG_PATH)
    if (s.size > MAX_LOG_SIZE) {
      await writeFile(LOG_PATH, "")
    }
  } catch {
    await writeFile(LOG_PATH, "")
  }
}
