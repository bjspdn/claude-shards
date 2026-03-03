import { z } from "zod"
import {
  NoteType,
  NOTE_TYPE_ICONS,
  type NoteEntry,
  type LinkGraph,
} from "../vault/types"
import { formatTokenCount } from "../index-engine/index"
import type { ToolDefinition } from "./types"

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

/**
 * Keyword search across vault notes, scored by title/tag/body matches.
 * @param args.query - Space-separated keywords.
 * @param args.types - Optional note type filter.
 * @param args.tags - Optional tag filter.
 * @param args.limit - Max results (default 10).
 * @param entries - All loaded vault note entries.
 */
export function executeSearch(
  args: SearchArgs,
  entries: NoteEntry[],
  linkGraph?: LinkGraph,
): SearchResult[] {
  let filtered = entries.slice()

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

  if (!linkGraph) return scored.slice(0, limit)

  const topResults = scored.slice(0, limit)
  const inResults = new Set(topResults.map((r) => r.relativePath))
  const expanded: SearchResult[] = []

  const entryByPath = new Map(entries.map((e) => [e.relativePath, e]))

  for (const result of topResults) {
    const neighbors = new Set<string>()
    const fwd = linkGraph.forward.get(result.relativePath)
    if (fwd) for (const n of fwd) neighbors.add(n)
    const rev = linkGraph.reverse.get(result.relativePath)
    if (rev) for (const n of rev) neighbors.add(n)

    for (const neighborPath of neighbors) {
      if (inResults.has(neighborPath)) continue

      const entry = entryByPath.get(neighborPath)
      if (!entry) continue

      if (args.types?.length && !args.types.includes(entry.frontmatter.type)) continue
      if (args.tags?.length && !entry.frontmatter.tags.some((t) => args.tags!.includes(t))) continue

      const expandedScore = Math.max(Math.floor(result.score / 2), 1)
      expanded.push({
        icon: NOTE_TYPE_ICONS[entry.frontmatter.type],
        title: entry.title,
        type: entry.frontmatter.type,
        relativePath: entry.relativePath,
        tokenDisplay: formatTokenCount(entry.tokenCount),
        score: expandedScore,
      })
      inResults.add(neighborPath)
    }
  }

  const merged = [...topResults, ...expanded]
    .sort((a, b) => b.score - a.score)

  return merged.slice(0, limit)
}

/**
 * Render search results as a markdown table.
 * @param results - Scored search results to format.
 */
export function formatSearchResults(results: SearchResult[]): string {
  return [
    "| T | Title | Path | ~Tok | Score |",
    "|---|-------|------|------|-------|",
    ...results.map(
      (r) => `| ${r.icon} | ${r.title} | ${r.relativePath} | ${r.tokenDisplay} | ${r.score} |`,
    ),
  ].join("\n")
}

export const searchTool: ToolDefinition = {
  name: "search",
  description: "Keyword search across vault notes, scored by title/tag/body matches. Returns a ranked results table — use the read tool to fetch full content of specific results.",
  inputSchema: z.object({
    query: z.string().describe("Space-separated keywords to search for"),
    types: z.array(NoteType).optional().describe("Filter to these note types"),
    tags: z.array(z.string()).optional().describe("Filter to notes with these tags"),
    limit: z.number().optional().describe("Max results (default 10)"),
  }),
  handler: (args, ctx) => {
    const results = executeSearch(args, ctx.entries, ctx.linkGraph)
    if (results.length === 0) {
      return { text: "No notes match that query." }
    }
    return { text: formatSearchResults(results) }
  },
}
