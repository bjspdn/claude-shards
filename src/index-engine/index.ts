import {
  NOTE_TYPE_ICONS,
  type NoteEntry,
  type IndexEntry,
} from "../vault/types"

export function formatTokenCount(count: number): string {
  return `~${Math.round(count / 10) * 10}`
}

export function toIndexEntry(entry: NoteEntry): IndexEntry {
  return {
    icon: NOTE_TYPE_ICONS[entry.frontmatter.type],
    title: entry.title,
    relativePath: entry.relativePath,
    tokenDisplay: formatTokenCount(entry.tokenCount),
  }
}

export function buildIndexTable(entries: NoteEntry[]): string {
  if (entries.length === 0) {
    return "No knowledge entries match the current filters."
  }

  const rows = entries.map((e) => {
    const idx = toIndexEntry(e)
    return `| ${idx.icon} | ${idx.title} | ${idx.relativePath} | ${idx.tokenDisplay} |`
  })

  return [
    "| T | Title | Path | ~Tok |",
    "|---|-------|------|------|",
    ...rows,
  ].join("\n")
}

export function formatKnowledgeSection(entries: NoteEntry[]): string {
  const table = buildIndexTable(entries)

  return [
    "## Knowledge Index",
    "Use MCP tool `read` with the note path to fetch full details on demand.",
    "🔴 = gotcha  🟤 = decision  🔵 = pattern  🟢 = reference",
    "",
    table,
  ].join("\n")
}

export function injectKnowledgeSection(
  existingContent: string,
  entries: NoteEntry[],
): string {
  const newSection = formatKnowledgeSection(entries)
  const sectionStart = existingContent.indexOf("## Knowledge Index")

  if (sectionStart === -1) {
    return existingContent.trimEnd() + "\n\n" + newSection + "\n"
  }

  const beforeSection = existingContent.substring(0, sectionStart)
  const afterSectionStart = existingContent.indexOf(
    "\n## ",
    sectionStart + "## Knowledge Index".length,
  )

  if (afterSectionStart === -1) {
    return beforeSection + newSection + "\n"
  }

  return (
    beforeSection + newSection + "\n" + existingContent.substring(afterSectionStart + 1)
  )
}
