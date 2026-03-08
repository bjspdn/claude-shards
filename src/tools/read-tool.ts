import { join, resolve, relative } from "path"
import { z } from "zod"
import type { NoteEntry } from "../vault/types"
import type { ToolDefinition } from "./types"
import { logError } from "../logger"

type ReadResult =
  | { ok: true; content: string }
  | { ok: false; error: string }

export async function executeRead(
  notePath: string,
  vaultPath: string,
  entries?: NoteEntry[],
): Promise<ReadResult> {
  if (notePath.startsWith("/")) {
    logError("security", "absolute path attempt in read", { path: notePath })
    return { ok: false, error: "Absolute paths not allowed. Use paths relative to vault root." }
  }

  const resolved = resolve(vaultPath, notePath)
  const rel = relative(vaultPath, resolved)

  if (rel.startsWith("..")) {
    logError("security", "path traversal attempt in read", { path: notePath })
    return { ok: false, error: "Path resolves outside vault. Use paths relative to vault root." }
  }

  const file = Bun.file(resolved)
  if (!(await file.exists())) {
    return { ok: false, error: `Note not found: ${notePath}. Run the 'index' tool to see available notes.` }
  }

  let content = await file.text()

  if (entries) {
    const entry = entries.find((e) => e.relativePath === rel || e.filePath === resolved)
    if (entry?.frontmatter.status === "stale") {
      content += `\n\n⚠ This note is stale. Update it to reactivate, or run hygiene to review.`
    }
  }

  return { ok: true, content }
}
export const readTool: ToolDefinition = {
  name: "read",
  description: "Fetch full content of a vault note by its relative path",
  inputSchema: z.object({
    path: z.string().max(500).describe("Relative path within vault (e.g. bevy/system-ordering.md)"),
  }),
  handler: async ({ path }, ctx) => {
    const result = await executeRead(path, ctx.vaultPath, ctx.entries)
    if (result.ok) {
      return { text: result.content }
    }
    return { text: result.error, isError: true as const }
  },
}
