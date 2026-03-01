import type { z } from "zod"
import type { NoteEntry } from "../vault/types"
import type { WatcherStats } from "../vault/watcher"

export interface ToolContext {
  entries: NoteEntry[]
  vaultPath: string
  watcherStats: WatcherStats
}

export type ToolResponse =
  | { text: string }
  | { text: string; isError: true }

export interface ToolDefinition {
  name: string
  description: string
  inputSchema?: z.ZodType
  handler: (args: any, ctx: ToolContext) => ToolResponse | Promise<ToolResponse>
}
