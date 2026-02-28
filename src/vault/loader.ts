import { globby } from "globby"
import { parseNote } from "./parser"
import { NOTE_TYPE_PRIORITY, type NoteEntry, type ProjectConfig } from "./types"

export async function discoverFiles(vaultPath: string): Promise<string[]> {
  return globby("**/*.md", {
    cwd: vaultPath,
    absolute: true,
    ignore: ["**/node_modules/**", "**/.*/**"],
  })
}

export async function loadVault(vaultPath: string): Promise<NoteEntry[]> {
  const files = await discoverFiles(vaultPath)
  const results = await Promise.all(
    files.map((f) => parseNote(f, vaultPath)),
  )

  return results
    .filter((entry): entry is NoteEntry => entry !== null)
    .sort(
      (a, b) =>
        NOTE_TYPE_PRIORITY[a.frontmatter.type] -
        NOTE_TYPE_PRIORITY[b.frontmatter.type],
    )
}

function matchesGlob(path: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
  return new RegExp(`^${regex}$`).test(path)
}

export function filterEntries(
  entries: NoteEntry[],
  config: ProjectConfig | null,
): NoteEntry[] {
  if (!config?.filter) return entries

  const { tags, types, exclude } = config.filter

  return entries.filter((entry) => {
    if (types?.length && !types.includes(entry.frontmatter.type)) return false

    if (
      tags?.length &&
      !entry.frontmatter.tags.some((t) => tags.includes(t))
    )
      return false

    if (
      exclude?.length &&
      exclude.some((pattern) => matchesGlob(entry.relativePath, pattern))
    )
      return false

    return true
  })
}
