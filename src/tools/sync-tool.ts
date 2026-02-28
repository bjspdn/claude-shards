import { z } from "zod"
import { join } from "path"
import type { NoteEntry } from "../vault/types"
import { loadProjectConfig } from "../vault/config"
import { filterEntries } from "../vault/loader"
import {
  formatKnowledgeSection,
  injectKnowledgeSection,
  formatTokenCount,
} from "../index-engine/index"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

interface SyncResult {
  entryCount: number
  totalTokens: number
  summary: string
}

export async function executeSync(
  targetDir: string,
  allEntries: NoteEntry[],
  vaultPath: string,
): Promise<SyncResult> {
  const config = await loadProjectConfig(targetDir)
  const filtered = filterEntries(allEntries, config)
  const totalTokens = filtered.reduce((sum, e) => sum + e.tokenCount, 0)

  const claudeMdPath = join(targetDir, "CLAUDE.md")
  const file = Bun.file(claudeMdPath)
  const existing = (await file.exists()) ? await file.text() : ""

  const updated = existing
    ? injectKnowledgeSection(existing, filtered)
    : formatKnowledgeSection(filtered) + "\n"

  await Bun.write(claudeMdPath, updated)

  return {
    entryCount: filtered.length,
    totalTokens,
    summary: `Synced ${filtered.length} entries to CLAUDE.md (${formatTokenCount(totalTokens)} total index tokens)`,
  }
}

export function registerSyncTool(
  server: McpServer,
  entries: NoteEntry[],
  vaultPath: string,
) {
    server.registerTool(
        "sync",
        {
            description: "Generate or update the Knowledge Index section in a project's CLAUDE.md",
            inputSchema: z.object({
                targetDir: z.string().optional().describe("Project directory (defaults to server CWD)")
            })
        },
        async ({ targetDir }) => {
            const dir = targetDir ?? process.cwd()
            const result = await executeSync(dir, entries, vaultPath)
            return { content: [{ type: "text" as const, text: result.summary }] }
        },
    )
}
