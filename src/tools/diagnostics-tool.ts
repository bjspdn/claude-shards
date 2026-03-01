import pkg from "../../package.json" with { type: "json" }
import type { NoteEntry, NoteType } from "../vault/types"
import type { WatcherStats } from "../vault/watcher"
import { C } from "../utils"
import type { ToolDefinition } from "./types"

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h}h ${m}m ${s}s`
}

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Collect vault stats, watcher activity, process metrics, and server version into a formatted string.
 * @param entries - All loaded vault note entries.
 * @param watcherStats - Live file-watcher statistics.
 */
export function executeDiagnostics(
  entries: NoteEntry[],
  watcherStats: WatcherStats,
): string {
  const typeCounts: Record<NoteType, number> = { gotchas: 0, decisions: 0, patterns: 0, references: 0 }
  let totalTokens = 0
  for (const entry of entries) {
    typeCounts[entry.frontmatter.type]++
    totalTokens += entry.tokenCount
  }

  const mem = process.memoryUsage()

  const lines = [
    `${C.bold}Vault${C.reset}`,
    `  Entries:  ${entries.length}`,
    `  Gotchas: ${typeCounts.gotchas}  Decisions: ${typeCounts.decisions}  Patterns: ${typeCounts.patterns}  References: ${typeCounts.references}`,
    `  Tokens:   ${totalTokens}`,
    "",
    `${C.bold}Watcher${C.reset}`,
    `  Active:   ${watcherStats.activeWatchers}`,
    `  Flushes:  ${watcherStats.totalFlushes}`,
    `  Upserts:  ${watcherStats.totalUpserts}`,
    `  Removes:  ${watcherStats.totalRemoves}`,
    "",
    `${C.bold}Process${C.reset}`,
    `  Uptime:   ${formatUptime(process.uptime())}`,
    `  RSS:      ${formatMB(mem.rss)}`,
    `  Heap:     ${formatMB(mem.heapUsed)} / ${formatMB(mem.heapTotal)}`,
    "",
    `${C.bold}Server${C.reset}`,
    `  Version:  ${pkg.version}`,
  ]

  return lines.join("\n")
}

export const diagnosticsTool: ToolDefinition = {
  name: "diagnostics",
  description: "Show live runtime diagnostics: vault stats, watcher activity, process metrics, and server version",
  handler: (_args, ctx) => {
    return { text: executeDiagnostics(ctx.entries, ctx.watcherStats) }
  },
}
