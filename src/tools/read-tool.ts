import { basename, resolve, relative } from "path"
import { z } from "zod"
import type { NoteEntry } from "../vault/types"
import type { ToolDefinition } from "./types"
import { logError } from "../logger"

type ReadResult =
  | { ok: true; content: string }
  | { ok: false; error: string }

export function resolveNotePath(notePath: string, entries: NoteEntry[]): NoteEntry | NoteEntry[] | null {
  const exact = entries.find((e) => e.relativePath === notePath)
  if (exact) return exact

  const suffix = notePath.startsWith("/") ? notePath.slice(1) : notePath
  const suffixMatches = entries.filter((e) => e.relativePath.endsWith(`/${suffix}`))
  if (suffixMatches.length === 1) return suffixMatches[0]!
  if (suffixMatches.length > 1) return suffixMatches

  const filename = basename(notePath)
  const nameMatches = entries.filter((e) => basename(e.relativePath) === filename)
  if (nameMatches.length === 1) return nameMatches[0]!
  if (nameMatches.length > 1) return nameMatches

  return null
}

export async function executeRead(
  notePath: string,
  vaultPath: string,
  entries?: NoteEntry[],
): Promise<ReadResult> {
  if (notePath.startsWith("/")) {
    logError("security", "absolute path attempt in read", { path: notePath })
    return { ok: false, error: "Absolute paths not allowed. Use paths relative to vault root." }
  }

  const resolved = resolve(vaultPath, notePath)
  const rel = relative(vaultPath, resolved)

  if (rel.startsWith("..")) {
    logError("security", "path traversal attempt in read", { path: notePath })
    return { ok: false, error: "Path resolves outside vault. Use paths relative to vault root." }
  }

  let entry: NoteEntry | undefined
  const file = Bun.file(resolved)
  if (await file.exists()) {
    entry = entries?.find((e) => e.relativePath === rel || e.filePath === resolved)
  } else if (entries) {
    const match = resolveNotePath(notePath, entries)
    if (Array.isArray(match)) {
      return {
        ok: false,
        error: `Ambiguous path "${notePath}" matches ${match.length} notes:\n${match.map((e) => `  - ${e.relativePath}`).join("\n")}\nUse the full vault-relative path.`,
      }
    }
    if (!match) {
      return { ok: false, error: `Note not found: ${notePath}. Use the 'search' tool to find available notes.` }
    }
    entry = match
  } else {
    return { ok: false, error: `Note not found: ${notePath}. Use the 'search' tool to find available notes.` }
  }

  let content = entry
    ? await Bun.file(entry.filePath).text()
    : await file.text()

  if (entry?.frontmatter.status === "stale") {
    content += `\n\n⚠ This note is stale. Update it to reactivate, or run hygiene to review.`
  }

  return { ok: true, content }
}
export const readTool: ToolDefinition = {
  name: "read",
  description: "Fetch full content of a vault note by its relative path",
  inputSchema: z.object({
    path: z.string().max(500).describe("Relative path within vault (e.g. {{project}}/{{type}}/{{slug}}.md). Partial paths like {{type}}/{{slug}}.md or {{slug}}.md are also resolved."),
  }),
  handler: async ({ path }, ctx) => {
    const result = await executeRead(path, ctx.vaultPath, ctx.entries)
    if (result.ok) {
      return { text: result.content }
    }
    return { text: result.error, isError: true as const }
  },
}
