import { globby } from "globby"
import { parseNote } from "./parser"
import { NOTE_TYPE_PRIORITY, type NoteEntry, type ProjectConfig, type LinkGraph } from "./types"

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

export function buildLinkGraph(entries: NoteEntry[]): LinkGraph {
  const existingPaths = new Set(entries.map((e) => e.relativePath))
  const forward = new Map<string, Set<string>>()
  const reverse = new Map<string, Set<string>>()

  for (const entry of entries) {
    const links = entry.frontmatter.links
    if (!links.length) continue

    const validLinks = links.filter((l) => existingPaths.has(l))
    if (!validLinks.length) continue

    forward.set(entry.relativePath, new Set(validLinks))
    for (const target of validLinks) {
      let rev = reverse.get(target)
      if (!rev) {
        rev = new Set()
        reverse.set(target, rev)
      }
      rev.add(entry.relativePath)
    }
  }

  return { forward, reverse }
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
