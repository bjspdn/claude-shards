import { test, expect } from "bun:test"
import {
  parseBoard,
  serializeBoard,
  findCard,
  DEFAULT_PRIORITY,
  type KanbanBoard,
} from "../../src/tools/kanban-parser"

const MINIMAL_BOARD = `---
shards-kanban: true
columns:
  - Backlog
  - Todo
  - In Progress
  - Review
  - Done
---

## Backlog

## Todo

## In Progress

## Review

## Done
`

const FULL_BOARD = `---
shards-kanban: true
columns:
  - Backlog
  - In Progress
  - Done
---

## Backlog
- [ ] Set up CI #high #epic:scaffold
  - [ ] Configure linting
  - [x] Add build step
  > Must support both Linux and macOS
- [ ] Write README

## In Progress
- [ ] Implement auth #critical #backend
  - [ ] Add JWT middleware
  > Token expiry is 1h
  > Refresh tokens last 7d

## Done
- [x] Project init #low
`

test("roundtrip: parse → serialize → re-parse matches", () => {
  const board1 = parseBoard(FULL_BOARD)
  if ("error" in board1) throw new Error(board1.error)

  const serialized = serializeBoard(board1)
  const board2 = parseBoard(serialized)
  if ("error" in board2) throw new Error(board2.error)

  expect(board2.columns).toEqual(board1.columns)
  for (const col of board1.columns) {
    const cards1 = board1.cards.get(col)!
    const cards2 = board2.cards.get(col)!
    expect(cards2.length).toBe(cards1.length)
    for (let i = 0; i < cards1.length; i++) {
      expect(cards2[i]!.title).toBe(cards1[i]!.title)
      expect(cards2[i]!.priority).toBe(cards1[i]!.priority)
      expect(cards2[i]!.tags).toEqual(cards1[i]!.tags)
      expect(cards2[i]!.subtasks).toEqual(cards1[i]!.subtasks)
      expect(cards2[i]!.description).toBe(cards1[i]!.description)
    }
  }
})

test("priority extraction from hashtag", () => {
  const board = parseBoard(FULL_BOARD)
  if ("error" in board) throw new Error(board.error)

  const ciCard = board.cards.get("Backlog")![0]!
  expect(ciCard.priority).toBe("high")

  const authCard = board.cards.get("In Progress")![0]!
  expect(authCard.priority).toBe("critical")

  const initCard = board.cards.get("Done")![0]!
  expect(initCard.priority).toBe("low")
})

test("non-priority hashtags become tags", () => {
  const board = parseBoard(FULL_BOARD)
  if ("error" in board) throw new Error(board.error)

  const ciCard = board.cards.get("Backlog")![0]!
  expect(ciCard.tags).toEqual(["epic:scaffold"])

  const authCard = board.cards.get("In Progress")![0]!
  expect(authCard.tags).toEqual(["backend"])
})

test("default priority is medium", () => {
  const board = parseBoard(FULL_BOARD)
  if ("error" in board) throw new Error(board.error)

  const readmeCard = board.cards.get("Backlog")![1]!
  expect(readmeCard.priority).toBe(DEFAULT_PRIORITY)
})

test("subtask parsing", () => {
  const board = parseBoard(FULL_BOARD)
  if ("error" in board) throw new Error(board.error)

  const ciCard = board.cards.get("Backlog")![0]!
  expect(ciCard.subtasks).toEqual([
    { title: "Configure linting", done: false },
    { title: "Add build step", done: true },
  ])
})

test("blockquote description single and multi-line", () => {
  const board = parseBoard(FULL_BOARD)
  if ("error" in board) throw new Error(board.error)

  const ciCard = board.cards.get("Backlog")![0]!
  expect(ciCard.description).toBe("Must support both Linux and macOS")

  const authCard = board.cards.get("In Progress")![0]!
  expect(authCard.description).toBe("Token expiry is 1h\nRefresh tokens last 7d")
})

test("missing frontmatter flag returns error", () => {
  const result = parseBoard(`---
columns:
  - Backlog
---

## Backlog
`)
  expect("error" in result).toBe(true)
  if ("error" in result) expect(result.error).toContain("shards-kanban")
})

test("empty board with only columns", () => {
  const board = parseBoard(MINIMAL_BOARD)
  if ("error" in board) throw new Error(board.error)

  expect(board.columns).toEqual(["Backlog", "Todo", "In Progress", "Review", "Done"])
  for (const col of board.columns) {
    expect(board.cards.get(col)!.length).toBe(0)
  }
})

test("checkbox state preserved on parse", () => {
  const board = parseBoard(FULL_BOARD)
  if ("error" in board) throw new Error(board.error)

  const backlogCard = board.cards.get("Backlog")![0]!
  expect(backlogCard.done).toBe(false)

  const doneCard = board.cards.get("Done")![0]!
  expect(doneCard.done).toBe(true)
})

test("serializer omits medium priority tag", () => {
  const board: KanbanBoard = {
    columns: ["Backlog", "Done"],
    cards: new Map([
      ["Backlog", [{ title: "Task A", done: false, priority: "medium", tags: [], subtasks: [] }]],
      ["Done", []],
    ]),
  }
  const out = serializeBoard(board)
  expect(out).toContain("- [ ] Task A\n")
  expect(out).not.toContain("#medium")
})

test("serializer sets [x] for Done column, [ ] for others", () => {
  const board: KanbanBoard = {
    columns: ["Backlog", "Done"],
    cards: new Map([
      ["Backlog", [{ title: "Task A", done: true, priority: "medium", tags: [], subtasks: [] }]],
      ["Done", [{ title: "Task B", done: false, priority: "medium", tags: [], subtasks: [] }]],
    ]),
  }
  const out = serializeBoard(board)
  expect(out).toContain("- [ ] Task A")
  expect(out).toContain("- [x] Task B")
})

test("findCard returns match", () => {
  const board = parseBoard(FULL_BOARD)
  if ("error" in board) throw new Error(board.error)

  const result = findCard(board, "Set up CI")
  expect(result).toBeDefined()
  expect(result!.column).toBe("Backlog")
  expect(result!.card.priority).toBe("high")
})

test("findCard returns undefined for missing card", () => {
  const board = parseBoard(FULL_BOARD)
  if ("error" in board) throw new Error(board.error)

  expect(findCard(board, "Nonexistent")).toBeUndefined()
})
