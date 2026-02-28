import { z } from "zod"
import {
  NoteType,
  NOTE_TYPE_ICONS,
  type NoteEntry,
  type ProjectConfig,
} from "../vault/types"
import { filterEntries } from "../vault/loader"
import { formatTokenCount } from "../index-engine/index"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

interface SearchArgs {
  query: string
  types?: NoteType[]
  tags?: string[]
  limit?: number
}

interface SearchResult {
  icon: string
  title: string
  type: NoteType
  relativePath: string
  tokenDisplay: string
  score: number
}

function scoreEntry(entry: NoteEntry, keywords: string[]): number {
  let score = 0
  const titleLower = entry.title.toLowerCase()
  const tagsLower = entry.frontmatter.tags.map((t) => t.toLowerCase())
  const bodyLower = entry.body.toLowerCase()

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase()
    if (titleLower.includes(kwLower)) score += 10
    if (tagsLower.some((t) => t.includes(kwLower))) score += 5
    if (bodyLower.includes(kwLower)) score += 1
  }
  return score
}

export function executeSearch(
  args: SearchArgs,
  entries: NoteEntry[],
  projectConfig: ProjectConfig | null,
): SearchResult[] {
  let filtered = filterEntries(entries, projectConfig)

  if (args.types?.length) {
    filtered = filtered.filter((e) => args.types!.includes(e.frontmatter.type))
  }
  if (args.tags?.length) {
    filtered = filtered.filter((e) =>
      e.frontmatter.tags.some((t) => args.tags!.includes(t)),
    )
  }

  const keywords = args.query.split(/\s+/).filter(Boolean)
  if (keywords.length === 0) return []

  const scored = filtered
    .map((entry) => ({
      icon: NOTE_TYPE_ICONS[entry.frontmatter.type],
      title: entry.title,
      type: entry.frontmatter.type,
      relativePath: entry.relativePath,
      tokenDisplay: formatTokenCount(entry.tokenCount),
      score: scoreEntry(entry, keywords),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)

  const limit = args.limit ?? 10
  return scored.slice(0, limit)
}

export function registerSearchTool(
  server: McpServer,
  entries: NoteEntry[],
  projectConfig: ProjectConfig | null,
) {
  server.registerTool(
    "search",
    {
      description: "Keyword search across vault notes. Returns index entries — use 'read' tool to fetch full content.",
      inputSchema: z.object({
        query: z.string().describe("Space-separated keywords to search for"),
        types: z.array(NoteType).optional().describe("Filter to these note types"),
        tags: z.array(z.string()).optional().describe("Filter to notes with these tags"),
        limit: z.number().optional().describe("Max results (default 10)"),
      })
    },
    async (args) => {
      const results = executeSearch(args, entries, projectConfig)
      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: "No notes match that query." }] }
      }
      const table = [
        "| T | Title | Path | ~Tok | Score |",
        "|---|-------|------|------|-------|",
        ...results.map(
          (r) => `| ${r.icon} | ${r.title} | ${r.relativePath} | ${r.tokenDisplay} | ${r.score} |`,
        ),
      ].join("\n")
      return { content: [{ type: "text" as const, text: table }] }
    },
  )
}
