import { resolve, relative, dirname } from "path"
import { mkdir } from "fs/promises"
import { z } from "zod"
import matter from "gray-matter"
import { NoteType, NOTE_TYPE_PRIORITY, type NoteEntry } from "../vault/types"
import { parseNote } from "../vault/parser"
import { formatDate } from "../utils"
import type { ToolDefinition } from "./types"

type WriteResult =
  | { ok: true; path: string; updated: boolean }
  | { ok: false; error: string }

interface WriteCreateCmd {
  mode: "create"
  path: string
  type: string
  title: string
  body: string
  tags?: string[]
  projects?: string[]
}

interface WriteReplaceCmd {
  mode: "replace"
  path: string
  type: string
  title: string
  body: string
  tags?: string[]
  projects?: string[]
}

interface WriteAppendCmd {
  mode: "append"
  path: string
  body: string
}

interface WritePatchCmd {
  mode: "patch"
  path: string
  section: string
  body?: string
}

export type WriteCommand = WriteCreateCmd | WriteReplaceCmd | WriteAppendCmd | WritePatchCmd

/** @returns {WriteCreateCmd} A create command with mode discriminant set. */
export function writeCreate(opts: Omit<WriteCreateCmd, "mode">): WriteCreateCmd {
  return { mode: "create", ...opts }
}

/** @returns {WriteReplaceCmd} A replace command with mode discriminant set. */
export function writeReplace(opts: Omit<WriteReplaceCmd, "mode">): WriteReplaceCmd {
  return { mode: "replace", ...opts }
}

/** @returns {WriteAppendCmd} An append command with mode discriminant set. */
export function writeAppend(opts: Omit<WriteAppendCmd, "mode">): WriteAppendCmd {
  return { mode: "append", ...opts }
}

/** @returns {WritePatchCmd} A patch command with mode discriminant set. */
export function writePatch(opts: Omit<WritePatchCmd, "mode">): WritePatchCmd {
  return { mode: "patch", ...opts }
}

/**
 * Bridge MCP's flat optional args to a typed {@link WriteCommand}.
 * Validates mode-dependent required fields and maps deprecated `overwrite` to `"replace"`.
 * @param args - Raw tool arguments from the MCP handler.
 * @returns {WriteCommand | {error: string}} A validated command, or an error object.
 */
export function parseWriteArgs(args: {
  path: string
  type?: string
  title?: string
  body?: string
  tags?: string[]
  projects?: string[]
  overwrite?: boolean
  mode?: string
  section?: string
}): WriteCommand | { error: string } {
  const mode = args.mode ?? (args.overwrite ? "replace" : "create")

  if (args.section && mode !== "patch") {
    return { error: "The 'section' parameter is only valid with mode 'patch'." }
  }

  if ((mode === "create" || mode === "replace") && (!args.type || !args.title || !args.body)) {
    return { error: `Mode '${mode}' requires type, title, and body.` }
  }

  if (mode === "append" && !args.body) {
    return { error: "Mode 'append' requires body." }
  }

  if (mode === "patch" && !args.section) {
    return { error: "Mode 'patch' requires section." }
  }

  switch (mode) {
    case "create":
      return writeCreate({
        path: args.path,
        type: args.type!,
        title: args.title!,
        body: args.body!,
        tags: args.tags,
        projects: args.projects,
      })
    case "replace":
      return writeReplace({
        path: args.path,
        type: args.type!,
        title: args.title!,
        body: args.body!,
        tags: args.tags,
        projects: args.projects,
      })
    case "append":
      return writeAppend({ path: args.path, body: args.body! })
    case "patch":
      return writePatch({ path: args.path, section: args.section!, body: args.body })
    default:
      return { error: `Unknown mode: '${mode}'` }
  }
}

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
 * Dispatches on {@link WriteCommand.mode} with full type narrowing — no runtime
 * assertions needed.
 * @param cmd - Discriminated write command (use factory functions or {@link parseWriteArgs}).
 * @param entries - Shared vault entries array, mutated in-place on success.
 * @param vaultPath - Absolute path to the vault directory.
 * @returns {{ ok: true, path: string, updated: boolean } | { ok: false, error: string }}
 */
export async function executeWrite(
  cmd: WriteCommand,
  entries: NoteEntry[],
  vaultPath: string,
): Promise<WriteResult> {
  if (cmd.path.startsWith("/")) {
    return { ok: false, error: "Absolute paths not allowed. Use paths relative to vault root." }
  }

  const resolved = resolve(vaultPath, cmd.path)
  const rel = relative(vaultPath, resolved)

  if (rel.startsWith("..")) {
    return { ok: false, error: "Path resolves outside vault. Use paths relative to vault root." }
  }

  const fileExists = await Bun.file(resolved).exists()

  if (cmd.mode === "create" && fileExists) {
    return { ok: false, error: `File already exists: ${cmd.path}. Use mode 'replace', 'append', or 'patch' to modify it.` }
  }

  if ((cmd.mode === "append" || cmd.mode === "patch") && !fileExists) {
    return { ok: false, error: `File not found: ${cmd.path}. Use mode 'create' to create a new note.` }
  }

  const today = formatDate(new Date())
  let content: string

  switch (cmd.mode) {
    case "append": {
      const raw = await Bun.file(resolved).text()
      const { data, content: existingContent } = matter(raw)
      const fm = buildFrontmatter({
        type: data.type,
        tags: data.tags,
        projects: data.projects,
        created: formatDate(new Date(data.created)),
        updated: today,
      })
      content = `${fm}\n${existingContent.trimEnd()}\n\n${cmd.body}\n`
      break
    }

    case "patch": {
      const raw = await Bun.file(resolved).text()
      const { data, content: existingContent } = matter(raw)
      const regex = buildSectionRegex(cmd.section)
      const match = regex.exec(existingContent)
      if (!match) {
        return { ok: false, error: `Section not found: "${cmd.section}"` }
      }

      const headingLevel = match[1]!.length
      const sectionStart = match.index!
      const afterHeading = sectionStart + match[0].length

      const endRegex = new RegExp(`^#{1,${headingLevel}}\\s`, "m")
      const rest = existingContent.slice(afterHeading)
      const endMatch = endRegex.exec(rest)

      const before = existingContent.slice(0, sectionStart)
      const after = endMatch ? rest.slice(endMatch.index) : ""

      let rebuilt: string
      if (!cmd.body) {
        rebuilt = before.trimEnd() + (after ? "\n\n" + after : "")
      } else {
        const heading = existingContent.slice(sectionStart, afterHeading)
        rebuilt = before + heading + `\n\n${cmd.body}\n` + (after ? "\n" + after : "")
      }

      const fm = buildFrontmatter({
        type: data.type,
        tags: data.tags,
        projects: data.projects,
        created: formatDate(new Date(data.created)),
        updated: today,
      })
      content = `${fm}\n${rebuilt.trimEnd()}\n`
      break
    }

    case "create":
    case "replace": {
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
        type: cmd.type,
        tags: cmd.tags,
        projects: cmd.projects,
        created: createdDate,
        updated: today,
      })
      content = `${fm}\n\n# ${cmd.title}\n\n${cmd.body}\n`
      break
    }
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

  return { ok: true, path: rel, updated: cmd.mode !== "create" && fileExists }
}

/** MCP tool: creates or updates vault notes (create, replace, append, patch modes). */
export const writeTool: ToolDefinition = {
  name: "write",
  description:
    "Create or update a note in the vault with structured frontmatter. " +
    "Modes: 'create' (default, fails if exists), 'replace' (full overwrite), " +
    "'append' (add body to end), 'patch' (replace or delete a section by heading). " +
    "To write a web page to the vault, first use the fetch-page tool.",
  inputSchema: z.object({
    path: z.string().describe("Relative path within vault (e.g. gotchas/my-new-note.md)"),
    mode: z.enum(["create", "replace", "append", "patch"]).optional().describe("Write mode: create (default), replace, append, or patch"),
    type: NoteType.optional().describe("Note type (required for create/replace)"),
    title: z.string().optional().describe("Note title — becomes the H1 heading (required for create/replace)"),
    body: z.string().optional().describe("Markdown body content (required for all modes except patch — omit to delete section)"),
    section: z.string().optional().describe("Section heading to replace (required for patch mode)"),
    tags: z.array(z.string()).optional().describe("Searchable tags"),
    projects: z.array(z.string()).optional().describe("Project names this note relates to"),
    overwrite: z.boolean().optional().describe("Deprecated — use mode 'replace' instead"),
  }),
  handler: async (args, ctx) => {
    const parsed = parseWriteArgs(args)
    if ("error" in parsed) {
      return { text: parsed.error, isError: true as const }
    }
    const result = await executeWrite(parsed, ctx.entries, ctx.vaultPath)
    if (result.ok) {
      const verb = result.updated ? "Updated" : "Created"
      return { text: `${verb} note: ${result.path}` }
    }
    return { text: result.error, isError: true as const }
  },
}
