import { resolve, relative, dirname } from "path"
import { mkdir } from "fs/promises"
import { z } from "zod"
import { NoteType, NOTE_TYPE_PRIORITY, type NoteEntry } from "../vault/types"
import { parseNote } from "../vault/parser"
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
    type: string
    title: string
    body: string
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

  const today = formatDate(new Date())
  const frontmatter = buildFrontmatter({
    type: args.type,
    tags: args.tags,
    projects: args.projects,
    date: today,
  })
  const content = `${frontmatter}\n\n# ${args.title}\n\n${args.body}\n`

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
        "To write a web page to the vault, first use the fetch-page tool.",
      inputSchema: z.object({
        path: z.string().describe("Relative path within vault (e.g. gotchas/my-new-note.md)"),
        type: NoteType.describe("Note type"),
        title: z.string().describe("Note title (becomes the H1 heading)"),
        body: z.string().describe("Markdown body content (after the H1)"),
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
