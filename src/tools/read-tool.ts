import { join, resolve, relative } from "path"
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

type ReadResult =
  | { ok: true; content: string }
  | { ok: false; error: string }

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

export function registerReadTool(server: McpServer, vaultPath: string) {
  server.registerTool(
    "read",
    {
      description: "Fetch full content of a vault note by its relative path",
      inputSchema: z.object({
        path: z.string().describe("Relative path within vault (e.g. gotchas/bevy-system-ordering.md)")
      })
    },
    async ({ path }) => {
      const result = await executeRead(path, vaultPath)
      if (result.ok) {
        return { content: [{ type: "text" as const, text: result.content }] }
      }
      return { content: [{ type: "text" as const, text: result.error }], isError: true }
    }
  )
}
