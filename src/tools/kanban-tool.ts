import { join } from "path"
import { z } from "zod"
import {
  parseBoard,
  serializeBoard,
  findCard,
  DEFAULT_PRIORITY,
  PRIORITIES,
  type KanbanBoard,
  type KanbanCard,
  type Priority,
  type Subtask,
} from "./kanban-parser"
import type { ToolDefinition } from "./types"
import config from "../config"

const DEFAULT_COLUMNS = ["Backlog", "Todo", "In Progress", "Review", "Done"]

interface ReadCmd { mode: "read" }
interface InitCmd { mode: "init"; columns?: string[] }
interface AddCmd {
  mode: "add"
  title: string
  column?: string
  priority?: Priority
  tags?: string[]
  subtasks?: string[]
  description?: string
}
interface AddBatchCmd {
  mode: "add_batch"
  cards: Array<{
    title: string
    column?: string
    priority?: Priority
    tags?: string[]
    subtasks?: string[]
    description?: string
  }>
}
interface MoveCmd { mode: "move"; title: string; column: string }
interface UpdateCmd {
  mode: "update"
  title: string
  priority?: Priority
  tags?: string[]
  description?: string
  add_subtasks?: string[]
  remove_subtasks?: string[]
}
interface RemoveCmd { mode: "remove"; title: string }

export type KanbanCommand = ReadCmd | InitCmd | AddCmd | AddBatchCmd | MoveCmd | UpdateCmd | RemoveCmd

export function parseKanbanArgs(args: Record<string, any>): KanbanCommand | { error: string } {
  const mode = args.mode as string | undefined
  if (!mode) return { error: "Missing required field: mode" }

  switch (mode) {
    case "read":
      return { mode: "read" }

    case "init":
      return { mode: "init", columns: args.columns }

    case "add": {
      if (!args.title) return { error: "Mode 'add' requires 'title'" }
      const cmd: AddCmd = { mode: "add", title: args.title }
      if (args.column) cmd.column = args.column
      if (args.priority) {
        if (!PRIORITIES.has(args.priority)) return { error: `Invalid priority: '${args.priority}'` }
        cmd.priority = args.priority
      }
      if (args.tags) cmd.tags = args.tags
      if (args.subtasks) cmd.subtasks = args.subtasks
      if (args.description) cmd.description = args.description
      return cmd
    }

    case "add_batch": {
      if (!Array.isArray(args.cards) || args.cards.length === 0) {
        return { error: "Mode 'add_batch' requires a non-empty 'cards' array" }
      }
      for (const c of args.cards) {
        if (!c.title) return { error: "Each card in 'cards' requires a 'title'" }
        if (c.priority && !PRIORITIES.has(c.priority)) {
          return { error: `Invalid priority: '${c.priority}'` }
        }
      }
      return { mode: "add_batch", cards: args.cards }
    }

    case "move": {
      if (!args.title) return { error: "Mode 'move' requires 'title'" }
      if (!args.column) return { error: "Mode 'move' requires 'column'" }
      return { mode: "move", title: args.title, column: args.column }
    }

    case "update": {
      if (!args.title) return { error: "Mode 'update' requires 'title'" }
      const cmd: UpdateCmd = { mode: "update", title: args.title }
      if (args.priority) {
        if (!PRIORITIES.has(args.priority)) return { error: `Invalid priority: '${args.priority}'` }
        cmd.priority = args.priority
      }
      if (args.tags) cmd.tags = args.tags
      if (args.description) cmd.description = args.description
      if (args.add_subtasks) cmd.add_subtasks = args.add_subtasks
      if (args.remove_subtasks) cmd.remove_subtasks = args.remove_subtasks
      return cmd
    }

    case "remove": {
      if (!args.title) return { error: "Mode 'remove' requires 'title'" }
      return { mode: "remove", title: args.title }
    }

    default:
      return { error: `Unknown mode: '${mode}'` }
  }
}

function formatBoard(board: KanbanBoard): string {
  const lines: string[] = []
  for (const col of board.columns) {
    const colCards = board.cards.get(col) ?? []
    lines.push(`${col} (${colCards.length})`)
    for (const card of colCards) {
      const parts: string[] = []
      if (card.priority !== DEFAULT_PRIORITY) parts.push(`#${card.priority}`)
      for (const t of card.tags) parts.push(`#${t}`)
      const subtaskInfo = card.subtasks.length > 0
        ? ` [${card.subtasks.filter((s) => s.done).length}/${card.subtasks.length} subtasks]`
        : ""
      const tagStr = parts.length > 0 ? " " + parts.join(" ") : ""
      lines.push(`  - ${card.title}${tagStr}${subtaskInfo}`)
    }
  }
  return lines.join("\n")
}

function buildCard(spec: {
  title: string
  column?: string
  priority?: Priority
  tags?: string[]
  subtasks?: string[]
  description?: string
}): KanbanCard {
  return {
    title: spec.title,
    done: false,
    priority: spec.priority ?? DEFAULT_PRIORITY,
    tags: spec.tags ?? [],
    subtasks: (spec.subtasks ?? []).map((s) => ({ title: s, done: false })),
    description: spec.description,
  }
}

export async function executeKanban(
  cmd: KanbanCommand,
  kanbanPath: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  switch (cmd.mode) {
    case "init": {
      const exists = await Bun.file(kanbanPath).exists()
      if (exists) return { ok: false, error: "Kanban board already exists" }

      const columns = cmd.columns ?? DEFAULT_COLUMNS
      const board: KanbanBoard = {
        columns,
        cards: new Map(columns.map((c) => [c, []])),
      }
      await Bun.write(kanbanPath, serializeBoard(board))
      return { ok: true, message: `Created kanban board with columns: ${columns.join(", ")}` }
    }

    case "read": {
      const exists = await Bun.file(kanbanPath).exists()
      if (!exists) return { ok: false, error: "No kanban board found. Use mode 'init' to create one." }

      const raw = await Bun.file(kanbanPath).text()
      const board = parseBoard(raw)
      if ("error" in board) return { ok: false, error: board.error }
      return { ok: true, message: formatBoard(board) }
    }

    case "add": {
      const raw = await Bun.file(kanbanPath).text()
      const board = parseBoard(raw)
      if ("error" in board) return { ok: false, error: board.error }

      if (findCard(board, cmd.title)) {
        return { ok: false, error: `Card already exists: "${cmd.title}"` }
      }

      const column = cmd.column ?? board.columns[0]!
      if (!board.cards.has(column)) {
        return { ok: false, error: `Column not found: "${column}"` }
      }

      board.cards.get(column)!.push(buildCard(cmd))
      await Bun.write(kanbanPath, serializeBoard(board))
      return { ok: true, message: `Added "${cmd.title}" to ${column}` }
    }

    case "add_batch": {
      const raw = await Bun.file(kanbanPath).text()
      const board = parseBoard(raw)
      if ("error" in board) return { ok: false, error: board.error }

      const batchTitles = new Set<string>()
      for (const spec of cmd.cards) {
        if (findCard(board, spec.title)) {
          return { ok: false, error: `Card already exists: "${spec.title}"` }
        }
        if (batchTitles.has(spec.title)) {
          return { ok: false, error: `Duplicate title in batch: "${spec.title}"` }
        }
        batchTitles.add(spec.title)

        const column = spec.column ?? board.columns[0]!
        if (!board.cards.has(column)) {
          return { ok: false, error: `Column not found: "${column}"` }
        }
      }

      for (const spec of cmd.cards) {
        const column = spec.column ?? board.columns[0]!
        board.cards.get(column)!.push(buildCard(spec))
      }

      await Bun.write(kanbanPath, serializeBoard(board))
      return { ok: true, message: `Added ${cmd.cards.length} cards` }
    }

    case "move": {
      const raw = await Bun.file(kanbanPath).text()
      const board = parseBoard(raw)
      if ("error" in board) return { ok: false, error: board.error }

      const found = findCard(board, cmd.title)
      if (!found) return { ok: false, error: `Card not found: "${cmd.title}"` }

      if (!board.cards.has(cmd.column)) {
        return { ok: false, error: `Column not found: "${cmd.column}"` }
      }

      const srcCards = board.cards.get(found.column)!
      srcCards.splice(srcCards.indexOf(found.card), 1)
      board.cards.get(cmd.column)!.push(found.card)

      await Bun.write(kanbanPath, serializeBoard(board))
      return { ok: true, message: `Moved "${cmd.title}" from ${found.column} to ${cmd.column}` }
    }

    case "update": {
      const raw = await Bun.file(kanbanPath).text()
      const board = parseBoard(raw)
      if ("error" in board) return { ok: false, error: board.error }

      const found = findCard(board, cmd.title)
      if (!found) return { ok: false, error: `Card not found: "${cmd.title}"` }

      const card = found.card
      if (cmd.priority) card.priority = cmd.priority
      if (cmd.tags) card.tags = cmd.tags
      if (cmd.description !== undefined) card.description = cmd.description

      if (cmd.add_subtasks) {
        for (const s of cmd.add_subtasks) {
          card.subtasks.push({ title: s, done: false })
        }
      }

      if (cmd.remove_subtasks) {
        const toRemove = new Set(cmd.remove_subtasks)
        card.subtasks = card.subtasks.filter((s) => !toRemove.has(s.title))
      }

      await Bun.write(kanbanPath, serializeBoard(board))
      return { ok: true, message: `Updated "${cmd.title}"` }
    }

    case "remove": {
      const raw = await Bun.file(kanbanPath).text()
      const board = parseBoard(raw)
      if ("error" in board) return { ok: false, error: board.error }

      const found = findCard(board, cmd.title)
      if (!found) return { ok: false, error: `Card not found: "${cmd.title}"` }

      const colCards = board.cards.get(found.column)!
      colCards.splice(colCards.indexOf(found.card), 1)

      await Bun.write(kanbanPath, serializeBoard(board))
      return { ok: true, message: `Removed "${cmd.title}" from ${found.column}` }
    }
  }
}

export const kanbanTool: ToolDefinition = {
  name: "kanban",
  description:
    "Manage a markdown-backed kanban board in the vault. " +
    "Modes: 'init' (create board), 'read' (view board), 'add' (add card), " +
    "'add_batch' (add multiple cards), 'move' (move card), 'update' (update card), " +
    "'remove' (delete card).",
  inputSchema: z.object({
    mode: z.enum(["read", "init", "add", "add_batch", "move", "update", "remove"])
      .describe("Operation mode"),
    title: z.string().optional().describe("Card title (required for add, move, update, remove)"),
    column: z.string().optional().describe("Target column name"),
    columns: z.array(z.string()).optional().describe("Column names for init mode"),
    priority: z.enum(["critical", "high", "medium", "low"]).optional().describe("Card priority"),
    tags: z.array(z.string()).optional().describe("Card tags"),
    subtasks: z.array(z.string()).optional().describe("Subtask titles for add mode"),
    description: z.string().optional().describe("Card description"),
    add_subtasks: z.array(z.string()).optional().describe("Subtasks to add (update mode)"),
    remove_subtasks: z.array(z.string()).optional().describe("Subtasks to remove by title (update mode)"),
    cards: z.array(z.object({
      title: z.string(),
      column: z.string().optional(),
      priority: z.enum(["critical", "high", "medium", "low"]).optional(),
      tags: z.array(z.string()).optional(),
      subtasks: z.array(z.string()).optional(),
      description: z.string().optional(),
    })).optional().describe("Cards array for add_batch mode"),
  }),
  handler: async (args, ctx) => {
    const kanbanPath = join(ctx.vaultPath, config.kanban.filename)
    const parsed = parseKanbanArgs(args)
    if ("error" in parsed) return { text: parsed.error, isError: true as const }
    const result = await executeKanban(parsed, kanbanPath)
    if (!result.ok) return { text: result.error, isError: true as const }
    return { text: result.message }
  },
}
