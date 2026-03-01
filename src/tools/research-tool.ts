import { z } from "zod"
import { NoteType, NOTE_TYPE_ICONS, type NoteEntry } from "../vault/types"
import { formatTokenCount } from "../index-engine/index"
import { executeSearch } from "./search-tool"
import { executeRead } from "./read-tool"
import { getUpdateNotice } from "../update-checker"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

interface ResearchArgs {
  query: string
  types?: NoteType[]
  tags?: string[]
  limit?: number
  maxTokens?: number
}

interface ResearchResult {
  table: string
  notes: { relativePath: string; content: string }[]
  totalTokens: number
  truncated: boolean
  maxTokenBudget?: number
}

export function buildResearchOutput(result: ResearchResult): string {
  const lines: string[] = []

  const countLabel = result.truncated
    ? `${result.notes.length} notes (truncated to ~${result.maxTokenBudget} tokens)`
    : `${result.notes.length} notes`

  lines.push(`## Research Results (${countLabel})`, "", result.table)

  for (const note of result.notes) {
    lines.push("", "---", `### ${note.relativePath}`, "", note.content)
  }

  return lines.join("\n")
}

export async function executeResearch(
  args: ResearchArgs,
  entries: NoteEntry[],
  vaultPath: string,
): Promise<ResearchResult> {
  const searchResults = executeSearch(
    { query: args.query, types: args.types, tags: args.tags, limit: args.limit },
    entries,
  )

  if (searchResults.length === 0) {
    return { table: "", notes: [], totalTokens: 0, truncated: false }
  }

  const table = [
    "| T | Title | Path | ~Tok | Score |",
    "|---|-------|------|------|-------|",
    ...searchResults.map(
      (r) => `| ${r.icon} | ${r.title} | ${r.relativePath} | ${r.tokenDisplay} | ${r.score} |`,
    ),
  ].join("\n")

  const notes: { relativePath: string; content: string }[] = []
  let totalTokens = 0
  let truncated = false
  const maxTokens = args.maxTokens ?? Infinity

  for (const result of searchResults) {
    const entry = entries.find((e) => e.relativePath === result.relativePath)
    if (!entry) continue

    if (totalTokens + entry.tokenCount > maxTokens && notes.length > 0) {
      truncated = true
      break
    }

    const readResult = await executeRead(result.relativePath, vaultPath)
    if (!readResult.ok) continue

    notes.push({ relativePath: result.relativePath, content: readResult.content })
    totalTokens += entry.tokenCount
  }

  return { table, notes, totalTokens, truncated, maxTokenBudget: args.maxTokens }
}

export function registerResearchTool(
  server: McpServer,
  entries: NoteEntry[],
  vaultPath: string,
) {
  server.registerTool(
    "research",
    {
      description:
        "Batched search+read: finds matching notes and returns their full content in a single call. " +
        "Use this instead of search → read chains to reduce round-trips.",
      inputSchema: z.object({
        query: z.string().describe("Space-separated keywords to search for"),
        types: z.array(NoteType).optional().describe("Filter to these note types"),
        tags: z.array(z.string()).optional().describe("Filter to notes with these tags"),
        limit: z.number().optional().describe("Max results (default 10)"),
        maxTokens: z
          .number()
          .optional()
          .describe("Token budget — stops including note bodies once exceeded"),
      }),
    },
    async (args) => {
      const result = await executeResearch(args, entries, vaultPath)
      if (result.notes.length === 0) {
        return { content: [{ type: "text" as const, text: "No notes match that query." + await getUpdateNotice() }] }
      }
      return { content: [{ type: "text" as const, text: buildResearchOutput(result) + await getUpdateNotice() }] }
    },
  )
}
