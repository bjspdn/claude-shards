import matter from "gray-matter"

export type Priority = "critical" | "high" | "medium" | "low"
export const PRIORITIES = new Set<string>(["critical", "high", "medium", "low"])
export const DEFAULT_PRIORITY: Priority = "medium"

export interface Subtask {
  title: string
  done: boolean
}

export interface KanbanCard {
  title: string
  done: boolean
  priority: Priority
  tags: string[]
  subtasks: Subtask[]
  description?: string
}

export interface KanbanBoard {
  columns: string[]
  cards: Map<string, KanbanCard[]>
}

export function parseBoard(raw: string): KanbanBoard | { error: string } {
  const { data, content } = matter(raw)

  if (!data["shards-kanban"]) {
    return { error: "Missing 'shards-kanban: true' in frontmatter" }
  }

  if (!Array.isArray(data.columns) || data.columns.length === 0) {
    return { error: "Missing or empty 'columns' array in frontmatter" }
  }

  const columns: string[] = data.columns
  const cards = new Map<string, KanbanCard[]>()
  for (const col of columns) cards.set(col, [])

  let currentColumn: string | null = null
  let currentCard: KanbanCard | null = null

  const lines = content.split("\n")

  for (const line of lines) {
    const columnMatch = line.match(/^## (.+)$/)
    if (columnMatch) {
      const name = columnMatch[1]!.trim()
      if (!cards.has(name)) {
        return { error: `Column "${name}" not in frontmatter columns list` }
      }
      currentColumn = name
      currentCard = null
      continue
    }

    if (!currentColumn) continue

    const subtaskMatch = line.match(/^  - \[([ x])\] (.+)$/)
    if (subtaskMatch && currentCard) {
      currentCard.subtasks.push({
        done: subtaskMatch[1] === "x",
        title: subtaskMatch[2]!.trim(),
      })
      continue
    }

    const descMatch = line.match(/^  > (.+)$/)
    if (descMatch && currentCard) {
      const text = descMatch[1]!
      currentCard.description = currentCard.description
        ? currentCard.description + "\n" + text
        : text
      continue
    }

    const cardMatch = line.match(/^- \[([ x])\] (.+)$/)
    if (cardMatch) {
      const done = cardMatch[1] === "x"
      const rawTitle = cardMatch[2]!

      const tags: string[] = []
      let priority: Priority = DEFAULT_PRIORITY
      const titleParts: string[] = []

      for (const token of rawTitle.split(/\s+/)) {
        if (token.startsWith("#")) {
          const tag = token.slice(1)
          if (PRIORITIES.has(tag)) {
            priority = tag as Priority
          } else if (tag) {
            tags.push(tag)
          }
        } else {
          titleParts.push(token)
        }
      }

      currentCard = {
        title: titleParts.join(" ").trim(),
        done,
        priority,
        tags,
        subtasks: [],
      }
      cards.get(currentColumn)!.push(currentCard)
      continue
    }
  }

  return { columns, cards }
}

export function serializeBoard(board: KanbanBoard): string {
  const lines: string[] = [
    "---",
    "shards-kanban: true",
    "columns:",
  ]

  for (const col of board.columns) {
    lines.push(`  - ${col}`)
  }
  lines.push("---")

  const doneColumn = board.columns[board.columns.length - 1]

  for (const col of board.columns) {
    lines.push("", `## ${col}`)
    const colCards = board.cards.get(col) ?? []
    for (const card of colCards) {
      const checkbox = col === doneColumn ? "[x]" : "[ ]"
      const tagParts: string[] = []
      if (card.priority !== DEFAULT_PRIORITY) tagParts.push(`#${card.priority}`)
      for (const t of card.tags) tagParts.push(`#${t}`)
      const suffix = tagParts.length > 0 ? " " + tagParts.join(" ") : ""
      lines.push(`- ${checkbox} ${card.title}${suffix}`)

      for (const st of card.subtasks) {
        lines.push(`  - [${st.done ? "x" : " "}] ${st.title}`)
      }

      if (card.description) {
        for (const dLine of card.description.split("\n")) {
          lines.push(`  > ${dLine}`)
        }
      }
    }
  }

  return lines.join("\n") + "\n"
}

export function findCard(
  board: KanbanBoard,
  title: string,
): { column: string; card: KanbanCard } | undefined {
  for (const [column, colCards] of board.cards) {
    for (const card of colCards) {
      if (card.title === title) return { column, card }
    }
  }
  return undefined
}
