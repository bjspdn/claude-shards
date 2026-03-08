import {
  NOTE_TYPE_ICONS,
  type NoteEntry,
  type IndexEntry,
} from "../vault/types"
import config from "../config"

export function formatTokenCount(count: number): string {
  return `~${Math.round(count / 10) * 10}`
}

export function toIndexEntry(entry: NoteEntry): IndexEntry {
  return {
    icon: NOTE_TYPE_ICONS[entry.frontmatter.type],
    title: entry.frontmatter.description ?? entry.title,
    relativePath: entry.relativePath,
    tokenDisplay: formatTokenCount(entry.tokenCount),
  }
}

export function buildIndexTable(entries: NoteEntry[]): string {
  if (entries.length === 0) {
    return "No knowledge entries match the current filters."
  }

  const headers = ["T", "Title", "Path", "~Tok"]
  const rows = entries.map((e) => {
    const idx = toIndexEntry(e)
    return [idx.icon, idx.title, idx.relativePath, idx.tokenDisplay]
  })

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  )

  const padRow = (cells: string[]) =>
    "| " + cells.map((c, i) => c.padEnd(colWidths[i])).join(" | ") + " |"

  const separator =
    "|" + colWidths.map((w) => "-".repeat(w + 2)).join("|") + "|"

  return [padRow(headers), separator, ...rows.map(padRow)].join("\n")
}

export function formatKnowledgeSection(entries: NoteEntry[]): string {
  const table = buildIndexTable(entries)

  return [
    config.display.sectionTitle,
    "See docs/knowledge/ for full note contents.",
    config.display.iconLegend,
    "",
    table,
  ].join("\n")
}

export function injectKnowledgeSection(
  existingContent: string,
  entries: NoteEntry[],
): string {
  const newSection = formatKnowledgeSection(entries)
  const sectionTitle = config.display.sectionTitle
  const sectionStart = existingContent.indexOf(sectionTitle)

  if (sectionStart === -1) {
    return newSection + "\n\n" + existingContent.trimStart()
  }

  const beforeSection = existingContent.substring(0, sectionStart)
  const afterSectionStart = existingContent.indexOf(
    "\n## ",
    sectionStart + sectionTitle.length,
  )

  const rest =
    afterSectionStart === -1
      ? beforeSection.trimEnd()
      : (beforeSection + existingContent.substring(afterSectionStart + 1)).trimStart()

  return rest ? newSection + "\n\n" + rest : newSection + "\n"
}
