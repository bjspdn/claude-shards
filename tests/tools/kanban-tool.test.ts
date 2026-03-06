import { test, expect, beforeEach, afterEach } from "bun:test"
import { executeKanban, parseKanbanArgs, type KanbanCommand } from "../../src/tools/kanban-tool"
import { parseBoard } from "../../src/tools/kanban-parser"
import { join } from "path"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"

let tempDir: string
let kanbanPath: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "claude-shards-kanban-test-"))
  kanbanPath = join(tempDir, "_kanban.md")
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function exec(cmd: KanbanCommand) {
  return executeKanban(cmd, kanbanPath)
}

async function readBoard() {
  const raw = await Bun.file(kanbanPath).text()
  const board = parseBoard(raw)
  if ("error" in board) throw new Error(board.error)
  return board
}

test("init: creates file with default columns", async () => {
  const result = await exec({ mode: "init" })
  expect(result.ok).toBe(true)

  const board = await readBoard()
  expect(board.columns).toEqual(["Backlog", "Todo", "In Progress", "Review", "Done"])
})

test("init: creates with custom columns", async () => {
  const result = await exec({ mode: "init", columns: ["A", "B", "C"] })
  expect(result.ok).toBe(true)

  const board = await readBoard()
  expect(board.columns).toEqual(["A", "B", "C"])
})

test("init: fails if file exists", async () => {
  await exec({ mode: "init" })
  const result = await exec({ mode: "init" })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("already exists")
})

test("read: returns summary with counts", async () => {
  await exec({ mode: "init", columns: ["Todo", "Done"] })
  await exec({ mode: "add", title: "Task A" })
  await exec({ mode: "add", title: "Task B" })

  const result = await exec({ mode: "read" })
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.message).toContain("Todo (2)")
    expect(result.message).toContain("Done (0)")
    expect(result.message).toContain("Task A")
    expect(result.message).toContain("Task B")
  }
})

test("read: fails if no board file", async () => {
  const result = await exec({ mode: "read" })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("No kanban board found")
})

test("add: card in default column", async () => {
  await exec({ mode: "init", columns: ["Backlog", "Done"] })
  const result = await exec({ mode: "add", title: "New task" })
  expect(result.ok).toBe(true)

  const board = await readBoard()
  expect(board.cards.get("Backlog")!.length).toBe(1)
  expect(board.cards.get("Backlog")![0]!.title).toBe("New task")
})

test("add: card in specified column", async () => {
  await exec({ mode: "init", columns: ["Backlog", "In Progress", "Done"] })
  const result = await exec({ mode: "add", title: "Active task", column: "In Progress" })
  expect(result.ok).toBe(true)

  const board = await readBoard()
  expect(board.cards.get("In Progress")!.length).toBe(1)
})

test("add: fails on duplicate title", async () => {
  await exec({ mode: "init" })
  await exec({ mode: "add", title: "Dup" })
  const result = await exec({ mode: "add", title: "Dup" })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("already exists")
})

test("add: card with priority, tags, subtasks", async () => {
  await exec({ mode: "init", columns: ["Todo", "Done"] })
  const result = await exec({
    mode: "add",
    title: "Complex task",
    priority: "high",
    tags: ["backend", "epic:auth"],
    subtasks: ["Step 1", "Step 2"],
    description: "Important work",
  })
  expect(result.ok).toBe(true)

  const board = await readBoard()
  const card = board.cards.get("Todo")![0]!
  expect(card.priority).toBe("high")
  expect(card.tags).toEqual(["backend", "epic:auth"])
  expect(card.subtasks).toEqual([
    { title: "Step 1", done: false },
    { title: "Step 2", done: false },
  ])
  expect(card.description).toBe("Important work")
})

test("add_batch: adds multiple cards", async () => {
  await exec({ mode: "init", columns: ["Todo", "Done"] })
  const result = await exec({
    mode: "add_batch",
    cards: [
      { title: "Card 1", priority: "high" },
      { title: "Card 2", tags: ["ui"] },
      { title: "Card 3" },
    ],
  })
  expect(result.ok).toBe(true)

  const board = await readBoard()
  expect(board.cards.get("Todo")!.length).toBe(3)
})

test("add_batch: fails on duplicate", async () => {
  await exec({ mode: "init" })
  await exec({ mode: "add", title: "Existing" })

  const result = await exec({
    mode: "add_batch",
    cards: [
      { title: "New one" },
      { title: "Existing" },
    ],
  })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("already exists")
})

test("move: card between columns", async () => {
  await exec({ mode: "init", columns: ["Todo", "In Progress", "Done"] })
  await exec({ mode: "add", title: "Moving task" })

  const result = await exec({ mode: "move", title: "Moving task", column: "In Progress" })
  expect(result.ok).toBe(true)

  const board = await readBoard()
  expect(board.cards.get("Todo")!.length).toBe(0)
  expect(board.cards.get("In Progress")!.length).toBe(1)
})

test("move: to Done sets checkbox", async () => {
  await exec({ mode: "init", columns: ["Todo", "Done"] })
  await exec({ mode: "add", title: "Finish me" })
  await exec({ mode: "move", title: "Finish me", column: "Done" })

  const raw = await Bun.file(kanbanPath).text()
  expect(raw).toContain("- [x] Finish me")
})

test("move: fails for unknown card", async () => {
  await exec({ mode: "init" })
  const result = await exec({ mode: "move", title: "Ghost", column: "Done" })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("Card not found")
})

test("move: fails for unknown column", async () => {
  await exec({ mode: "init", columns: ["Todo", "Done"] })
  await exec({ mode: "add", title: "Task" })

  const result = await exec({ mode: "move", title: "Task", column: "Nowhere" })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("Column not found")
})

test("update: changes priority", async () => {
  await exec({ mode: "init", columns: ["Todo", "Done"] })
  await exec({ mode: "add", title: "Update me" })

  const result = await exec({ mode: "update", title: "Update me", priority: "critical" })
  expect(result.ok).toBe(true)

  const board = await readBoard()
  expect(board.cards.get("Todo")![0]!.priority).toBe("critical")
})

test("update: adds and removes subtasks", async () => {
  await exec({ mode: "init", columns: ["Todo", "Done"] })
  await exec({ mode: "add", title: "Task", subtasks: ["A", "B", "C"] })

  await exec({ mode: "update", title: "Task", add_subtasks: ["D"], remove_subtasks: ["B"] })

  const board = await readBoard()
  const subtitles = board.cards.get("Todo")![0]!.subtasks.map((s) => s.title)
  expect(subtitles).toEqual(["A", "C", "D"])
})

test("remove: removes card", async () => {
  await exec({ mode: "init", columns: ["Todo", "Done"] })
  await exec({ mode: "add", title: "Delete me" })

  const result = await exec({ mode: "remove", title: "Delete me" })
  expect(result.ok).toBe(true)

  const board = await readBoard()
  expect(board.cards.get("Todo")!.length).toBe(0)
})

test("remove: fails for unknown card", async () => {
  await exec({ mode: "init" })
  const result = await exec({ mode: "remove", title: "Ghost" })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("Card not found")
})
