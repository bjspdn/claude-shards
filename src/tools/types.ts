import type { z } from "zod"
import type { NoteEntry } from "../vault/types"
import type { WatcherStats } from "../vault/watcher"

/** Shared runtime state injected into every tool handler. */
export interface ToolContext {
  entries: NoteEntry[]
  vaultPath: string
  watcherStats: WatcherStats
}

/** Normalized response returned by tool handlers before MCP wrapping. */
export type ToolResponse =
  | { text: string }
  | { text: string; isError: true }

/**
 * Declarative tool definition registered via {@link import("./registry").registerTools}.
 * Each tool declares its name, description, optional Zod input schema, and handler.
 */
export interface ToolDefinition {
  name: string
  description: string
  inputSchema?: z.ZodType
  handler: (args: any, ctx: ToolContext) => ToolResponse | Promise<ToolResponse>
}
