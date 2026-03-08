import { join, resolve, relative } from "path"
import { z } from "zod"
import type { NoteEntry } from "../vault/types"
import type { ToolDefinition } from "./types"

type ReadResult =
  | { ok: true; content: string }
  | { ok: false; error: string }

export async function executeRead(
  notePath: string,
  vaultPath: string,
  entries?: NoteEntry[],
): Promise<ReadResult> {
  if (notePath.startsWith("/")) {
    return { ok: false, error: "Absolute paths not allowed. Use paths relative to vault root." }
  }

  const resolved = resolve(vaultPath, notePath)
  const rel = relative(vaultPath, resolved)

  if (rel.startsWith("..")) {
    return { ok: false, error: "Path resolves outside vault. Use paths relative to vault root." }
  }

  if (entries) {
    const entry = entries.find((e) => e.relativePath === rel || e.filePath === resolved)
    if (entry?.frontmatter.status === "stale") {
      return { ok: false, error: `Note '${notePath}' is stale. Run the 'hygiene' tool to review stale notes.` }
    }
  }

  const file = Bun.file(resolved)
  if (!(await file.exists())) {
    return { ok: false, error: `Note not found: ${notePath}. Run the 'index' tool to see available notes.` }
  }

  return { ok: true, content: await file.text() }
}
export const readTool: ToolDefinition = {
  name: "read",
  description: "Fetch full content of a vault note by its relative path",
  inputSchema: z.object({
    path: z.string().describe("Relative path within vault (e.g. bevy/system-ordering.md)"),
  }),
  handler: async ({ path }, ctx) => {
    const result = await executeRead(path, ctx.vaultPath, ctx.entries)
    if (result.ok) {
      return { text: result.content }
    }
    return { text: result.error, isError: true as const }
  },
}
