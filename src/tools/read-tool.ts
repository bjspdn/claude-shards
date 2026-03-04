import { join, resolve, relative } from "path"
import { z } from "zod"
import type { ToolDefinition } from "./types"

type ReadResult =
  | { ok: true; content: string }
  | { ok: false; error: string }

/**
 * Read a single vault note by its relative path.
 * @param notePath - Path relative to the vault root (e.g. `bevy/my-note.md`).
 * @param vaultPath - Absolute path to the vault directory.
 */
export async function executeRead(
  notePath: string,
  vaultPath: string,
): Promise<ReadResult> {
  if (notePath.startsWith("/")) {
    return { ok: false, error: "Absolute paths not allowed. Use paths relative to vault root." }
  }

  const resolved = resolve(vaultPath, notePath)
  const rel = relative(vaultPath, resolved)

  if (rel.startsWith("..")) {
    return { ok: false, error: "Path resolves outside vault. Use paths relative to vault root." }
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
    const result = await executeRead(path, ctx.vaultPath)
    if (result.ok) {
      return { text: result.content }
    }
    return { text: result.error, isError: true as const }
  },
}
