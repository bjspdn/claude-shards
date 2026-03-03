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

const LINK_CATEGORIES = ["decisions", "patterns", "gotchas", "references"] as const

function resolveWikilink(raw: string): string | null {
  const match = raw.match(/^\[\[(.+)\]\]$/)
  return match ? match[1]! : null
}

export function buildLinkGraph(entries: NoteEntry[]): LinkGraph {
  const slugToPath = new Map<string, string>()
  for (const entry of entries) {
    const slug = entry.relativePath.replace(/\.md$/, "").split("/").pop()!
    slugToPath.set(slug, entry.relativePath)
  }

  const forward = new Map<string, Set<string>>()
  const reverse = new Map<string, Set<string>>()

  for (const entry of entries) {
    const resolved: string[] = []
    for (const cat of LINK_CATEGORIES) {
      for (const raw of entry.frontmatter[cat]) {
        const slug = resolveWikilink(raw)
        if (!slug) continue
        const target = slugToPath.get(slug)
        if (target) resolved.push(target)
      }
    }
    if (!resolved.length) continue

    forward.set(entry.relativePath, new Set(resolved))
    for (const target of resolved) {
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
