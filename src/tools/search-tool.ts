import { z } from "zod"
import {
  NoteType,
  NOTE_TYPE_ICONS,
  type NoteEntry,
  type LinkGraph,
} from "../vault/types"
import { formatTokenCount } from "../index-engine/index"
import type { ToolDefinition } from "./types"
import { scoreBM25, MIN_BM25_SCORE, type IdfTable } from "./bm25"
import type { EmbeddingIndex } from "../embeddings/types"

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

export function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!
  return sum
}

function minMaxNormalize(values: number[]): number[] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) return values.map(() => 1)
  return values.map((v) => (v - min) / (max - min))
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
  embeddingIndex?: EmbeddingIndex,
  queryEmbedding?: Float32Array,
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

  const SEMANTIC_WEIGHT = 0.35
  const CANDIDATE_K = 50

  const bm25Scored = filtered.map((entry) => ({
    entry,
    bm25: idf ? scoreBM25(entry, keywords, idf) : scoreEntry(entry, keywords),
  }))

  const bm25Threshold = idf ? MIN_BM25_SCORE : 0
  const bm25Candidates = bm25Scored
    .filter((s) => s.bm25 > bm25Threshold)
    .sort((a, b) => b.bm25 - a.bm25)
    .slice(0, CANDIDATE_K)

  const hasSemantic = !!(embeddingIndex && queryEmbedding && embeddingIndex.size > 0)

  let semanticCandidates: { entry: NoteEntry; cosine: number }[] = []
  if (hasSemantic) {
    semanticCandidates = filtered
      .map((entry) => {
        const emb = embeddingIndex!.get(entry.relativePath)
        if (!emb) return { entry, cosine: -1 }
        return { entry, cosine: dotProduct(queryEmbedding!, emb.embedding) }
      })
      .filter((s) => s.cosine > 0)
      .sort((a, b) => b.cosine - a.cosine)
      .slice(0, CANDIDATE_K)
  }

  const candidateMap = new Map<string, { entry: NoteEntry; bm25: number; cosine: number }>()
  for (const s of bm25Candidates) {
    candidateMap.set(s.entry.relativePath, { entry: s.entry, bm25: s.bm25, cosine: 0 })
  }
  for (const s of semanticCandidates) {
    const existing = candidateMap.get(s.entry.relativePath)
    if (existing) {
      existing.cosine = s.cosine
    } else {
      candidateMap.set(s.entry.relativePath, { entry: s.entry, bm25: 0, cosine: s.cosine })
    }
  }

  const candidates = [...candidateMap.values()]
  let scored: SearchResult[]

  if (hasSemantic && candidates.length > 0) {
    const bm25Values = candidates.map((c) => c.bm25)
    const cosineValues = candidates.map((c) => c.cosine)
    const normBM25 = minMaxNormalize(bm25Values)
    const normCosine = minMaxNormalize(cosineValues)

    scored = candidates
      .map((c, i) => ({
        icon: NOTE_TYPE_ICONS[c.entry.frontmatter.type],
        title: c.entry.title,
        type: c.entry.frontmatter.type,
        relativePath: c.entry.relativePath,
        tokenDisplay: formatTokenCount(c.entry.tokenCount),
        score: (1 - SEMANTIC_WEIGHT) * normBM25[i]! + SEMANTIC_WEIGHT * normCosine[i]!,
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
  } else {
    scored = bm25Candidates.map((s) => ({
      icon: NOTE_TYPE_ICONS[s.entry.frontmatter.type],
      title: s.entry.title,
      type: s.entry.frontmatter.type,
      relativePath: s.entry.relativePath,
      tokenDisplay: formatTokenCount(s.entry.tokenCount),
      score: s.bm25,
    }))
  }

  const limit = args.limit ?? 10

  if (linkGraph) {
    const ALPHA = 0.3
    const pathToScore = new Map(scored.map((r) => [r.relativePath, r.score]))

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
  }

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
  handler: async (args, ctx) => {
    let queryEmbedding: Float32Array | undefined
    try {
      if (ctx.embedQuery) queryEmbedding = await ctx.embedQuery(args.query)
    } catch {}
    const results = executeSearch(args, ctx.entries, ctx.linkGraph, ctx.idfTable, ctx.embeddingIndex, queryEmbedding)
    if (results.length === 0) {
      return { text: "No notes match that query." }
    }
    return { text: formatSearchResults(results) }
  },
}
