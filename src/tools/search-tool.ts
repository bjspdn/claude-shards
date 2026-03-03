import { z } from "zod"
import {
  NoteType,
  NOTE_TYPE_ICONS,
  type NoteEntry,
  type LinkGraph,
} from "../vault/types"
import { formatTokenCount } from "../index-engine/index"
import type { ToolDefinition } from "./types"
import { scoreBM25, type IdfTable } from "./bm25"

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

/** @deprecated Use {@link scoreBM25} from ./bm25 — scheduled for removal. */
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
  idf?: IdfTable,
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
      score: idf
        ? scoreBM25(entry, keywords, idf)
        : scoreEntry(entry, keywords),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)

  const limit = args.limit ?? 10

  if (!linkGraph) return scored.slice(0, limit)

  const ALPHA = 0.3
  const pathToScore = new Map(scored.map(r => [r.relativePath, r.score]))

  for (const result of scored) {
    let boost = 0
    const rev = linkGraph.reverse.get(result.relativePath)
    if (rev) {
      for (const source of rev) {
        const sourceScore = pathToScore.get(source) ?? 0
        const outDegree = linkGraph.forward.get(source)?.size ?? 1
        boost += sourceScore / outDegree
      }
    }
    const fwd = linkGraph.forward.get(result.relativePath)
    if (fwd) {
      for (const target of fwd) {
        const targetScore = pathToScore.get(target) ?? 0
        const outDegree = linkGraph.forward.get(target)?.size ?? 1
        boost += targetScore / outDegree
      }
    }
    result.score += ALPHA * boost
  }

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, limit)
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
    const results = executeSearch(args, ctx.entries, ctx.linkGraph, ctx.idfTable)
    if (results.length === 0) {
      return { text: "No notes match that query." }
    }
    return { text: formatSearchResults(results) }
  },
}
