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

export const TECH_TAGS = new Set([
  "bash", "c", "clojure", "cpp", "csharp", "css", "dart", "elixir", "erlang",
  "fsharp", "go", "haskell", "html", "java", "javascript", "kotlin", "lua",
  "ocaml", "perl", "php", "python", "ruby", "rust", "scala", "sql", "swift",
  "typescript", "zig",
  "angular", "astro", "bevy", "django", "docker", "electron", "express",
  "fastapi", "fastify", "flask", "flutter", "gatsby", "gin", "godot",
  "htmx", "kubernetes", "laravel", "nestjs", "nextjs", "nuxt", "rails",
  "react", "react-native", "remix", "solid", "spring", "svelte", "tailwind",
  "tauri", "unity", "unreal", "vue",
  "bun", "deno", "node", "nodejs",
])

function hasTechTag(entry: NoteEntry): boolean {
  return entry.frontmatter.tags.some((t) => TECH_TAGS.has(t))
}

interface SyncResult {
  entryCount: number
  totalTokens: number
  summary: string
}

async function syncToFile(
  claudeMdPath: string,
  filtered: NoteEntry[],
): Promise<{ entryCount: number; totalTokens: number }> {
  const totalTokens = filtered.reduce((sum, e) => sum + e.tokenCount, 0)

  const file = Bun.file(claudeMdPath)
  const existing = (await file.exists()) ? await file.text() : ""

  const updated = existing
    ? injectKnowledgeSection(existing, filtered)
    : formatKnowledgeSection(filtered) + "\n"

  await Bun.write(claudeMdPath, updated)

  return { entryCount: filtered.length, totalTokens }
}

interface SyncOptions {
  globalClaudeDir?: string
}

export async function executeSync(
  targetDir: string,
  allEntries: NoteEntry[],
  vaultPath: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  let config = await loadProjectConfig(targetDir)
  let autoCreated = false

  const globalClaudeDir = options.globalClaudeDir ?? resolve(homedir(), ".claude")
  const isGlobalDir = resolve(targetDir) === resolve(globalClaudeDir)

  if (!config && !isGlobalDir) {
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
    filtered = filtered.filter(
      (e) => e.frontmatter.projects.length === 0 && !hasTechTag(e),
    )
  }

  const { entryCount, totalTokens } = await syncToFile(
    join(targetDir, "CLAUDE.md"),
    filtered,
  )

  let summary = `Synced ${entryCount} entries to CLAUDE.md (${formatTokenCount(totalTokens)} total index tokens)`

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

  if (!isGlobalDir) {
    const globalEntries = allEntries.filter(
      (e) => e.frontmatter.projects.length === 0 && !hasTechTag(e),
    )
    const globalResult = await syncToFile(
      join(globalClaudeDir, "CLAUDE.md"),
      globalEntries,
    )
    summary += `\nSynced ${globalResult.entryCount} global entries to ~/.claude/CLAUDE.md (${formatTokenCount(globalResult.totalTokens)} total index tokens)`
  }

  return {
    entryCount,
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
