import { resolve, relative, dirname } from "path"
import { mkdir } from "fs/promises"
import { z } from "zod"
import matter from "gray-matter"
import { NoteType, NOTE_TYPE_PRIORITY, flattenWikilinks, type NoteEntry } from "../vault/types"
import { parseNote } from "../vault/parser"
import { formatDate } from "../utils"
import type { ToolDefinition } from "./types"
import { logError } from "../logger"

type WriteResult =
  | { ok: true; path: string; updated: boolean }
  | { ok: false; error: string }

interface WriteCreateCmd {
  mode: "create"
  path: string
  type: string
  title: string
  body: string
  description?: string
  motivation?: string
  tags?: string[]

  decisions?: string[]
  patterns?: string[]
  gotchas?: string[]
  references?: string[]
}

interface WriteReplaceCmd {
  mode: "replace"
  path: string
  type: string
  title: string
  body: string
  description?: string
  motivation?: string
  tags?: string[]

  decisions?: string[]
  patterns?: string[]
  gotchas?: string[]
  references?: string[]
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
  description?: string
  motivation?: string
  tags?: string[]

  decisions?: string[]
  patterns?: string[]
  gotchas?: string[]
  references?: string[]
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
        description: args.description,
        motivation: args.motivation,
        tags: args.tags,
        decisions: args.decisions,
        patterns: args.patterns,
        gotchas: args.gotchas,
        references: args.references,
      })
    case "replace":
      return writeReplace({
        path: args.path,
        type: args.type!,
        title: args.title!,
        body: args.body!,
        description: args.description,
        motivation: args.motivation,
        tags: args.tags,
        decisions: args.decisions,
        patterns: args.patterns,
        gotchas: args.gotchas,
        references: args.references,
      })
    case "append":
      return writeAppend({ path: args.path, body: args.body! })
    case "patch":
      return writePatch({ path: args.path, section: args.section!, body: args.body })
    default:
      return { error: `Unknown mode: '${mode}'` }
  }
}

const LINK_CATEGORIES = ["decisions", "patterns", "gotchas", "references"] as const

function buildFrontmatter(args: {
  type: string
  description?: string
  motivation?: string
  status?: string
  tags?: string[]

  decisions?: string[]
  patterns?: string[]
  gotchas?: string[]
  references?: string[]
  created: string
  updated: string
}): string {
  const lines = ["---", `type: ${args.type}`]

  if (args.description) {
    lines.push(`description: "${args.description}"`)
  }

  if (args.motivation) {
    lines.push(`motivation: "${args.motivation}"`)
  }

  if (args.tags?.length) {
    lines.push("tags:")
    for (const t of args.tags) lines.push(`  - ${t}`)
  }

  for (const cat of LINK_CATEGORIES) {
    const vals = args[cat]
    if (vals?.length) {
      lines.push(`${cat}:`)
      for (const v of vals) lines.push(`  - "${v}"`)
    }
  }

  lines.push(`created: ${args.created}`, `updated: ${args.updated}`, `status: ${args.status ?? "active"}`, "---")
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
    logError("security", "absolute path attempt in write", { path: cmd.path })
    return { ok: false, error: "Absolute paths not allowed. Use paths relative to vault root." }
  }

  const resolved = resolve(vaultPath, cmd.path)
  const rel = relative(vaultPath, resolved)

  if (rel.startsWith("..")) {
    logError("security", "path traversal attempt in write", { path: cmd.path })
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
        description: data.description,
        motivation: data.motivation,
        status: data.status,
        tags: data.tags,
        decisions: flattenWikilinks(data.decisions),
        patterns: flattenWikilinks(data.patterns),
        gotchas: flattenWikilinks(data.gotchas),
        references: flattenWikilinks(data.references),
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
        description: data.description,
        motivation: data.motivation,
        status: data.status,
        tags: data.tags,
        decisions: flattenWikilinks(data.decisions),
        patterns: flattenWikilinks(data.patterns),
        gotchas: flattenWikilinks(data.gotchas),
        references: flattenWikilinks(data.references),
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
        description: cmd.description,
        motivation: cmd.motivation,
        tags: cmd.tags,
        decisions: cmd.decisions,
        patterns: cmd.patterns,
        gotchas: cmd.gotchas,
        references: cmd.references,
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
    "When creating notes, populate 'links' with paths to related notes " +
    "(gotchas \u2192 the decisions/patterns involved, patterns \u2192 the decisions " +
    "they implement, references \u2192 patterns that use them).",
  inputSchema: z.object({
    path: z.string().max(500).describe("Relative path within vault (e.g. gotchas/SYNC_BEFORE_INIT.md). Use UPPER_SNAKE_CASE filenames."),
    mode: z.enum(["create", "replace", "append", "patch"]).optional().describe("Write mode: create (default), replace, append, or patch"),
    type: NoteType.optional().describe("Note type (required for create/replace)"),
    title: z.string().max(200).optional().describe("Note title — becomes the H1 heading (required for create/replace)"),
    description: z.string().max(500).optional().describe("One-line semantic summary for search"),
    motivation: z.string().max(500).optional().describe("Why this note was created — shown in search results"),
    body: z.string().max(50_000).optional().describe("Markdown body content (required for all modes except patch — omit to delete section)"),
    section: z.string().max(200).optional().describe("Section heading to replace (required for patch mode)"),
    tags: z.array(z.string().max(100)).max(50).optional().describe("Searchable tags"),
    decisions: z.array(z.string().max(500)).max(50).optional().describe("Wikilinks to related decision notes (e.g. [[chose-x]])"),
    patterns: z.array(z.string().max(500)).max(50).optional().describe("Wikilinks to related pattern notes (e.g. [[my-pattern]])"),
    gotchas: z.array(z.string().max(500)).max(50).optional().describe("Wikilinks to related gotcha notes (e.g. [[my-gotcha]])"),
    references: z.array(z.string().max(500)).max(50).optional().describe("Wikilinks to related reference notes (e.g. [[my-reference]])"),
    overwrite: z.boolean().optional().describe("Deprecated — use mode 'replace' instead"),
  }),
  handler: async (args, ctx) => {
    const parsed = parseWriteArgs(args)
    if ("error" in parsed) {
      return { text: parsed.error, isError: true as const }
    }
    const result = await executeWrite(parsed, ctx.entries, ctx.vaultPath)
    if (result.ok) {
      ctx.rebuildLinkGraph()
      const verb = result.updated ? "Updated" : "Created"
      return { text: `${verb} note: ${result.path}` }
    }
    return { text: result.error, isError: true as const }
  },
}
