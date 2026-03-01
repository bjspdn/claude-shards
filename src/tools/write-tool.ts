import { resolve, relative, dirname } from "path"
import { mkdir } from "fs/promises"
import { z } from "zod"
import { NoteType, NOTE_TYPE_PRIORITY, type NoteEntry } from "../vault/types"
import { parseNote } from "../vault/parser"
import { formatDate } from "../utils"
import { getUpdateNotice } from "../update-checker"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

type WriteResult =
  | { ok: true; path: string; updated: boolean }
  | { ok: false; error: string }

function buildFrontmatter(args: {
  type: string
  tags?: string[]
  projects?: string[]
  created: string
  updated: string
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

  lines.push(`created: ${args.created}`, `updated: ${args.updated}`, "---")
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
    overwrite?: boolean
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

  const fileExists = await Bun.file(resolved).exists()

  if (fileExists && !args.overwrite) {
    return { ok: false, error: `File already exists: ${args.path}. Pass overwrite: true to replace it.` }
  }

  const today = formatDate(new Date())

  let createdDate = today
  if (fileExists) {
    const existing = entries.find((e) => e.filePath === resolved)
    if (existing) {
      createdDate = formatDate(existing.frontmatter.created)
    } else {
      const parsed = await parseNote(resolved, vaultPath)
      if (parsed) createdDate = formatDate(parsed.frontmatter.created)
    }
  }

  const frontmatter = buildFrontmatter({
    type: args.type,
    tags: args.tags,
    projects: args.projects,
    created: createdDate,
    updated: today,
  })
  const content = `${frontmatter}\n\n# ${args.title}\n\n${args.body}\n`

  await mkdir(dirname(resolved), { recursive: true })
  await Bun.write(resolved, content)

  const entry = await parseNote(resolved, vaultPath)
  if (entry) {
    const idx = entries.findIndex((e) => e.filePath === resolved)
    if (idx !== -1) entries.splice(idx, 1)
    entries.push(entry)
    entries.sort(
      (a, b) =>
        NOTE_TYPE_PRIORITY[a.frontmatter.type] -
        NOTE_TYPE_PRIORITY[b.frontmatter.type],
    )
  }

  return { ok: true, path: rel, updated: fileExists && !!args.overwrite }
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
        "Create or update a note in the vault with structured frontmatter. " +
        "Rejects writes to existing paths unless overwrite is true. " +
        "To write a web page to the vault, first use the fetch-page tool.",
      inputSchema: z.object({
        path: z.string().describe("Relative path within vault (e.g. gotchas/my-new-note.md)"),
        type: NoteType.describe("Note type"),
        title: z.string().describe("Note title (becomes the H1 heading)"),
        body: z.string().describe("Markdown body content (after the H1)"),
        tags: z.array(z.string()).optional().describe("Searchable tags"),
        projects: z.array(z.string()).optional().describe("Project names this note relates to"),
        overwrite: z.boolean().optional().describe("Set to true to overwrite an existing note"),
      }),
    },
    async (args) => {
      const result = await executeWrite(args, entries, vaultPath)
      if (result.ok) {
        const verb = result.updated ? "Updated" : "Created"
        return { content: [{ type: "text" as const, text: `${verb} note: ${result.path}` + await getUpdateNotice() }] }
      }
      return { content: [{ type: "text" as const, text: result.error }], isError: true }
    },
  )
}
