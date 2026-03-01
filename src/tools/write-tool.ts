import { resolve, relative, dirname } from "path"
import { mkdir } from "fs/promises"
import { z } from "zod"
import matter from "gray-matter"
import { NoteType, NOTE_TYPE_PRIORITY, type NoteEntry } from "../vault/types"
import { parseNote } from "../vault/parser"
import { formatDate } from "../utils"
import { getUpdateNotice } from "../update-checker"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

type WriteMode = "create" | "replace" | "append" | "patch"

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

function buildSectionRegex(sectionTitle: string): RegExp {
  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^(#{1,6})\\s+${escaped}$`, "m")
}

/**
 * Create or update a vault note.
 * @param args.path - Relative path within the vault.
 * @param args.mode - `"create"` (default), `"replace"`, `"append"`, or `"patch"`.
 * @param args.type - Note type (required for create/replace).
 * @param args.title - H1 heading (required for create/replace).
 * @param args.body - Markdown body (required for all modes).
 * @param args.section - Section heading to replace (required for patch).
 * @param args.tags - Searchable tags.
 * @param args.projects - Associated project names.
 * @param args.overwrite - @deprecated Use `mode: "replace"` instead.
 * @param entries - Shared vault entries array, mutated in-place on success.
 * @param vaultPath - Absolute path to the vault directory.
 */
export async function executeWrite(
  args: {
    path: string
    type?: string
    title?: string
    body?: string
    tags?: string[]
    projects?: string[]
    overwrite?: boolean
    mode?: WriteMode
    section?: string
  },
  entries: NoteEntry[],
  vaultPath: string,
): Promise<WriteResult> {
  const mode: WriteMode = args.mode ?? (args.overwrite ? "replace" : "create")

  if (args.path.startsWith("/")) {
    return { ok: false, error: "Absolute paths not allowed. Use paths relative to vault root." }
  }

  const resolved = resolve(vaultPath, args.path)
  const rel = relative(vaultPath, resolved)

  if (rel.startsWith("..")) {
    return { ok: false, error: "Path resolves outside vault. Use paths relative to vault root." }
  }

  if (args.section && mode !== "patch") {
    return { ok: false, error: "The 'section' parameter is only valid with mode 'patch'." }
  }

  if ((mode === "create" || mode === "replace") && (!args.type || !args.title || !args.body)) {
    return { ok: false, error: `Mode '${mode}' requires type, title, and body.` }
  }

  if ((mode === "append") && !args.body) {
    return { ok: false, error: "Mode 'append' requires body." }
  }

  if ((mode === "patch") && (!args.body || !args.section)) {
    return { ok: false, error: "Mode 'patch' requires body and section." }
  }

  const fileExists = await Bun.file(resolved).exists()

  if (mode === "create" && fileExists) {
    return { ok: false, error: `File already exists: ${args.path}. Use mode 'replace', 'append', or 'patch' to modify it.` }
  }

  if ((mode === "append" || mode === "patch") && !fileExists) {
    return { ok: false, error: `File not found: ${args.path}. Use mode 'create' to create a new note.` }
  }

  const today = formatDate(new Date())
  let content: string

  if (mode === "append") {
    const raw = await Bun.file(resolved).text()
    const { data, content: existingContent } = matter(raw)
    const fm = buildFrontmatter({
      type: data.type,
      tags: data.tags,
      projects: data.projects,
      created: formatDate(new Date(data.created)),
      updated: today,
    })
    content = `${fm}\n${existingContent.trimEnd()}\n\n${args.body}\n`
  } else if (mode === "patch") {
    const raw = await Bun.file(resolved).text()
    const { data, content: existingContent } = matter(raw)
    const regex = buildSectionRegex(args.section!)
    const match = regex.exec(existingContent)
    if (!match) {
      return { ok: false, error: `Section not found: "${args.section}"` }
    }

    const headingLevel = match[1]!.length
    const sectionStart = match.index!
    const afterHeading = sectionStart + match[0].length

    const endRegex = new RegExp(`^#{1,${headingLevel}}\\s`, "m")
    const rest = existingContent.slice(afterHeading)
    const endMatch = endRegex.exec(rest)

    let before = existingContent.slice(0, afterHeading)
    let after = endMatch ? rest.slice(endMatch.index) : ""

    const newSection = `\n\n${args.body}\n`
    const rebuilt = before + newSection + (after ? "\n" + after : "")

    const fm = buildFrontmatter({
      type: data.type,
      tags: data.tags,
      projects: data.projects,
      created: formatDate(new Date(data.created)),
      updated: today,
    })
    content = `${fm}\n${rebuilt.trimEnd()}\n`
  } else {
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

    const fm = buildFrontmatter({
      type: args.type!,
      tags: args.tags,
      projects: args.projects,
      created: createdDate,
      updated: today,
    })
    content = `${fm}\n\n# ${args.title}\n\n${args.body}\n`
  }

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

  return { ok: true, path: rel, updated: mode !== "create" && fileExists }
}

/**
 * Register the `write` MCP tool (create / replace / append / patch).
 * @param server - MCP server instance to register on.
 * @param entries - Shared vault entries array (mutated on writes).
 * @param vaultPath - Absolute path to the vault directory.
 */
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
        "Modes: 'create' (default, fails if exists), 'replace' (full overwrite), " +
        "'append' (add body to end), 'patch' (replace a section by heading). " +
        "To write a web page to the vault, first use the fetch-page tool.",
      inputSchema: z.object({
        path: z.string().describe("Relative path within vault (e.g. gotchas/my-new-note.md)"),
        mode: z.enum(["create", "replace", "append", "patch"]).optional().describe("Write mode: create (default), replace, append, or patch"),
        type: NoteType.optional().describe("Note type (required for create/replace)"),
        title: z.string().optional().describe("Note title — becomes the H1 heading (required for create/replace)"),
        body: z.string().optional().describe("Markdown body content (required for all modes)"),
        section: z.string().optional().describe("Section heading to replace (required for patch mode)"),
        tags: z.array(z.string()).optional().describe("Searchable tags"),
        projects: z.array(z.string()).optional().describe("Project names this note relates to"),
        overwrite: z.boolean().optional().describe("Deprecated — use mode 'replace' instead"),
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
