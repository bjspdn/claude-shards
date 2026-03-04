import { z } from "zod"
import { NoteType, type NoteEntry, type LinkGraph } from "../vault/types"
import type { ToolDefinition } from "./types"
import { executeSearch } from "./search-tool"
import type { IdfTable } from "./bm25"
import type { EmbeddingIndex } from "../embeddings/types"
import config from "../config"

interface SuggestCaptureArgs {
  topic: string
  type: NoteType
  context: string
  tags?: string[]
  projects?: string[]
}

export interface CaptureSuggestion {
  draftPath: string
  draftFrontmatter: Record<string, unknown>
  draftBody: string
  motivation: string
  similarNotes: { title: string; relativePath: string; score: number }[]
  suggestUpdate?: { title: string; relativePath: string; score: number }
}

export function generateSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, config.similarity.slugMaxLen)
}

export function generateMotivation(context: string): string {
  const maxLen = config.similarity.contextMaxLen
  const trimmed = context.slice(0, maxLen)
  const lastSpace = trimmed.lastIndexOf(" ")
  return lastSpace > maxLen * 0.67 ? trimmed.slice(0, lastSpace) : trimmed
}

export function executeSuggestCapture(
  args: SuggestCaptureArgs,
  entries: NoteEntry[],
  linkGraph?: LinkGraph,
  idf?: IdfTable,
  embeddingIndex?: EmbeddingIndex,
  queryEmbedding?: Float32Array,
): CaptureSuggestion {
  const similarResults = executeSearch(
    { query: args.topic, limit: 3 },
    entries,
    linkGraph,
    idf,
    embeddingIndex,
    queryEmbedding,
  )

  const slug = generateSlug(args.topic)
  const draftPath = `${args.type}/${slug}.md`
  const motivation = generateMotivation(args.context)

  const similarNotes = similarResults.map((r) => ({
    title: r.title,
    relativePath: r.relativePath,
    score: r.score,
  }))

  const suggestUpdate =
    similarNotes.length > 0 && similarNotes[0]!.score >= config.similarity.threshold
      ? similarNotes[0]
      : undefined

  return {
    draftPath,
    draftFrontmatter: {
      type: args.type,
      tags: args.tags ?? [],
      projects: args.projects ?? [],
      motivation,
    },
    draftBody: args.context,
    motivation,
    similarNotes,
    suggestUpdate,
  }
}

export function formatSuggestion(suggestion: CaptureSuggestion): string {
  const lines: string[] = []

  if (suggestion.suggestUpdate) {
    const u = suggestion.suggestUpdate
    lines.push(
      `**Consider updating existing note:** ${u.title} (${u.relativePath}) — similarity ${u.score.toFixed(2)}`,
      "",
    )
  }

  lines.push(`**Draft path:** \`${suggestion.draftPath}\``, "")

  lines.push("```yaml")
  for (const [key, value] of Object.entries(suggestion.draftFrontmatter)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`)
      } else {
        lines.push(`${key}:`)
        for (const item of value) {
          lines.push(`  - ${item}`)
        }
      }
    } else {
      lines.push(`${key}: ${value}`)
    }
  }
  lines.push("```", "")

  lines.push("**Body preview:**", "")
  lines.push(suggestion.draftBody, "")

  if (suggestion.similarNotes.length > 0) {
    lines.push("**Similar existing notes:**", "")
    for (const note of suggestion.similarNotes) {
      lines.push(`- ${note.title} (\`${note.relativePath}\`) — score ${note.score.toFixed(2)}`)
    }
  }

  return lines.join("\n")
}

export const suggestCaptureTool: ToolDefinition = {
  name: "suggest-capture",
  description:
    "Call this proactively when you encounter reusable knowledge — patterns, gotchas, or decisions worth remembering. Prefer updating existing notes over creating duplicates.",
  inputSchema: z.object({
    topic: z.string().describe("Short title/topic for the note"),
    type: NoteType.describe("Note type"),
    context: z.string().describe("The knowledge to capture"),
    tags: z.array(z.string()).optional().describe("Searchable tags"),
    projects: z.array(z.string()).optional().describe("Project names this note relates to. Always include the current project name."),
  }),
  handler: async (args, ctx) => {
    let queryEmbedding: Float32Array | undefined
    try {
      if (ctx.embedQuery) queryEmbedding = await ctx.embedQuery(args.topic)
    } catch {}
    const suggestion = executeSuggestCapture(
      args,
      ctx.entries,
      ctx.linkGraph,
      ctx.idfTable,
      ctx.embeddingIndex,
      queryEmbedding,
    )
    return { text: formatSuggestion(suggestion) }
  },
}
