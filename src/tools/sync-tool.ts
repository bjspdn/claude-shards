import { z } from "zod"
import { join, resolve } from "path"
import { homedir } from "os"
import type { NoteEntry } from "../vault/types"
import { loadProjectConfig, createDefaultConfig } from "../vault/config"
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
  let config = await loadProjectConfig(targetDir)
  let autoCreated = false

  const globalClaudeDir = resolve(homedir(), ".claude")
  if (!config && resolve(targetDir) !== globalClaudeDir) {
    config = await createDefaultConfig(targetDir, allEntries)
    autoCreated = true
  }

  const filterConfig = config?.filter
    ? { ...config, filter: { ...config.filter, tags: undefined } }
    : config
  let filtered = filterEntries(allEntries, filterConfig)

  const projectName = config?.project?.name
  const filterTags = config?.filter?.tags
  if (projectName) {
    filtered = filtered.filter(
      (e) =>
        e.frontmatter.projects.includes(projectName) ||
        (e.frontmatter.projects.length === 0 &&
          filterTags?.length !== undefined &&
          filterTags.length > 0 &&
          e.frontmatter.tags.some((t) => filterTags.includes(t))),
    )
  } else {
    filtered = filtered.filter((e) => e.frontmatter.projects.length === 0)
  }

  const totalTokens = filtered.reduce((sum, e) => sum + e.tokenCount, 0)

  const claudeMdPath = join(targetDir, "CLAUDE.md")
  const file = Bun.file(claudeMdPath)
  const existing = (await file.exists()) ? await file.text() : ""

  const updated = existing
    ? injectKnowledgeSection(existing, filtered)
    : formatKnowledgeSection(filtered) + "\n"

  await Bun.write(claudeMdPath, updated)

  let summary = `Synced ${filtered.length} entries to CLAUDE.md (${formatTokenCount(totalTokens)} total index tokens)`

  if (autoCreated) {
    const allTags = [...new Set(allEntries.flatMap((e) => e.frontmatter.tags))].sort()
    const inferredTags = config?.filter?.tags
    if (inferredTags?.length) {
      summary += `\nAuto-created .context.toml with inferred tags: [${inferredTags.join(", ")}]`
    } else {
      summary += `\nAuto-created .context.toml (no tags inferred from file extensions)`
    }
    if (allTags.length > 0) {
      summary += `\nAvailable vault tags: [${allTags.join(", ")}] — edit .context.toml filter.tags to refine`
    }
  }

  return {
    entryCount: filtered.length,
    totalTokens,
    summary,
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
