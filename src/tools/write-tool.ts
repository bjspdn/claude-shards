import { resolve, relative, dirname } from "path"
import { mkdir } from "fs/promises"
import { z } from "zod"
import { NoteType, NOTE_TYPE_PRIORITY, type NoteEntry } from "../vault/types"
import { parseNote } from "../vault/parser"
import { fetchPageAsMarkdown } from "../web/fetcher"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

type WriteResult =
  | { ok: true; path: string }
  | { ok: false; error: string }

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildFrontmatter(args: {
  type: string
  tags?: string[]
  projects?: string[]
  date: string
}): string {
  const lines = ["---", `type: ${args.type}`]

  if (args.projects?.length) {
    lines.push("projects:")
    for (const p of args.projects) lines.push(`  - ${p}`)
  }

  if (args.tags?.length) {
    lines.push("tags:")
    for (const t of args.tags) lines.push(`  - ${t}`)
  }

  lines.push(`created: ${args.date}`, `updated: ${args.date}`, "---")
  return lines.join("\n")
}

export async function executeWrite(
  args: {
    path: string
    type?: string
    title?: string
    body?: string
    url?: string
    tags?: string[]
    projects?: string[]
  },
  entries: NoteEntry[],
  vaultPath: string,
): Promise<WriteResult> {
  if (args.path.startsWith("/")) {
    return { ok: false, error: "Absolute paths not allowed. Use paths relative to vault root." }
  }

  const resolved = resolve(vaultPath, args.path)
  const rel = relative(vaultPath, resolved)

  if (rel.startsWith("..")) {
    return { ok: false, error: "Path resolves outside vault. Use paths relative to vault root." }
  }

  if (await Bun.file(resolved).exists()) {
    return { ok: false, error: `File already exists: ${args.path}. Use a different path.` }
  }

  let title = args.title
  let body = args.body
  let type = args.type

  if (args.url) {
    let page
    try {
      page = await fetchPageAsMarkdown(args.url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Failed to fetch URL: ${msg}` }
    }
    title ??= page.title
    body ??= page.markdown
    type ??= "reference"
    body = `> Source: ${args.url}\n\n${body}`
  }

  if (!title) {
    return { ok: false, error: "A title is required. Provide title or url." }
  }
  if (!body) {
    return { ok: false, error: "A body is required. Provide body or url." }
  }
  type ??= "reference"

  const today = formatDate(new Date())
  const frontmatter = buildFrontmatter({
    type,
    tags: args.tags,
    projects: args.projects,
    date: today,
  })
  const content = `${frontmatter}\n\n# ${title}\n\n${body}\n`

  await mkdir(dirname(resolved), { recursive: true })
  await Bun.write(resolved, content)

  const entry = await parseNote(resolved, vaultPath)
  if (entry) {
    entries.push(entry)
    entries.sort(
      (a, b) =>
        NOTE_TYPE_PRIORITY[a.frontmatter.type] -
        NOTE_TYPE_PRIORITY[b.frontmatter.type],
    )
  }

  return { ok: true, path: rel }
}

export function registerWriteTool(
  server: McpServer,
  entries: NoteEntry[],
  vaultPath: string,
) {
  server.registerTool(
    "write",
    {
      description:
        "Create a new note in the vault with structured frontmatter. " +
        "Rejects writes to existing paths. " +
        "Provide a url to auto-fetch and parse a web page as note content.",
      inputSchema: z.object({
        path: z.string().describe("Relative path within vault (e.g. gotchas/my-new-note.md)"),
        type: NoteType.optional().describe("Note type (defaults to 'reference' when url provided)"),
        title: z.string().optional().describe("Note title (becomes the H1 heading). Auto-detected from page when url provided."),
        body: z.string().optional().describe("Markdown body content (after the H1). Auto-extracted from page when url provided."),
        url: z.url().optional().describe("URL to fetch and parse as note content"),
        tags: z.array(z.string()).optional().describe("Searchable tags"),
        projects: z.array(z.string()).optional().describe("Project names this note relates to"),
      }),
    },
    async (args) => {
      const result = await executeWrite(args, entries, vaultPath)
      if (result.ok) {
        return { content: [{ type: "text" as const, text: `Created note: ${result.path}` }] }
      }
      return { content: [{ type: "text" as const, text: result.error }], isError: true }
    },
  )
}
