import { test, expect, beforeEach, afterEach } from "bun:test"
import { executeWrite } from "../../src/tools/write-tool"
import { NOTE_TYPE_PRIORITY, type NoteEntry } from "../../src/vault/types"
import { formatDate } from "../../src/utils"
import { join } from "path"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"

let tempVault: string
let entries: NoteEntry[]

beforeEach(async () => {
  tempVault = await mkdtemp(join(tmpdir(), "ccm-write-test-"))
  entries = []
})

afterEach(async () => {
  await rm(tempVault, { recursive: true, force: true })
})

test("rejects absolute paths", async () => {
  const result = await executeWrite(
    { path: "/etc/passwd", type: "gotchas", title: "Bad", body: "nope" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("Absolute paths")
})

test("rejects path traversal", async () => {
  const result = await executeWrite(
    { path: "../etc/passwd", type: "gotchas", title: "Bad", body: "nope" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("outside vault")
})

test("rejects write to existing file without overwrite", async () => {
  const filePath = join(tempVault, "existing.md")
  await Bun.write(filePath, "already here")

  const result = await executeWrite(
    { path: "existing.md", type: "gotchas", title: "Dup", body: "nope" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("already exists")
})

test("creates file with correct frontmatter and body", async () => {
  const result = await executeWrite(
    {
      path: "gotchas/test-note.md",
      type: "gotchas",
      title: "Test Title",
      body: "Some body content.",
      tags: ["rust", "bevy"],
      projects: ["my-project"],
    },
    entries,
    tempVault,
  )

  expect(result.ok).toBe(true)
  if (!result.ok) return

  const content = await Bun.file(join(tempVault, "gotchas/test-note.md")).text()
  expect(content).toContain("type: gotchas")
  expect(content).toContain("tags:")
  expect(content).toContain("  - rust")
  expect(content).toContain("  - bevy")
  expect(content).toContain("projects:")
  expect(content).toContain("  - my-project")
  expect(content).toContain("created:")
  expect(content).toContain("updated:")
  expect(content).toContain("# Test Title")
  expect(content).toContain("Some body content.")
})

test("creates parent directories if missing", async () => {
  const result = await executeWrite(
    { path: "deep/nested/dir/note.md", type: "patterns", title: "Deep", body: "content" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(true)

  const exists = await Bun.file(join(tempVault, "deep/nested/dir/note.md")).exists()
  expect(exists).toBe(true)
})

test("pushes new entry to entries array", async () => {
  expect(entries.length).toBe(0)

  await executeWrite(
    { path: "gotchas/new.md", type: "gotchas", title: "New Note", body: "body" },
    entries,
    tempVault,
  )

  expect(entries.length).toBe(1)
  expect(entries[0]!.title).toBe("New Note")
  expect(entries[0]!.frontmatter.type).toBe("gotchas")
  expect(entries[0]!.relativePath).toBe("gotchas/new.md")
})

test("entries stay sorted by type priority after insert", async () => {
  await executeWrite(
    { path: "references/ref.md", type: "references", title: "Ref", body: "ref body" },
    entries,
    tempVault,
  )
  await executeWrite(
    { path: "gotchas/gotcha.md", type: "gotchas", title: "Gotcha", body: "gotcha body" },
    entries,
    tempVault,
  )
  await executeWrite(
    { path: "patterns/pat.md", type: "patterns", title: "Pattern", body: "pat body" },
    entries,
    tempVault,
  )

  expect(entries.length).toBe(3)
  for (let i = 1; i < entries.length; i++) {
    const prev = NOTE_TYPE_PRIORITY[entries[i - 1]!.frontmatter.type]
    const curr = NOTE_TYPE_PRIORITY[entries[i]!.frontmatter.type]
    expect(prev).toBeLessThanOrEqual(curr)
  }
})

test("overwrites existing file when overwrite is true", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Original", body: "old body" },
    entries,
    tempVault,
  )

  const result = await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Updated", body: "new body", overwrite: true },
    entries,
    tempVault,
  )

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.updated).toBe(true)

  const content = await Bun.file(join(tempVault, "gotchas/note.md")).text()
  expect(content).toContain("# Updated")
  expect(content).toContain("new body")
})

test("preserves original created date on overwrite", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Original", body: "old" },
    entries,
    tempVault,
  )

  const originalCreated = entries[0]!.frontmatter.created

  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Updated", body: "new", overwrite: true },
    entries,
    tempVault,
  )

  const content = await Bun.file(join(tempVault, "gotchas/note.md")).text()
  const createdMatch = content.match(/created: (\S+)/)
  expect(createdMatch).toBeTruthy()
  expect(createdMatch![1]).toBe(formatDate(originalCreated))
})

test("creates normally when overwrite is true but file does not exist", async () => {
  const result = await executeWrite(
    { path: "gotchas/fresh.md", type: "gotchas", title: "Fresh", body: "body", overwrite: true },
    entries,
    tempVault,
  )

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.updated).toBe(false)
  expect(entries.length).toBe(1)
})

test("no duplicate entries after overwrite", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "V1", body: "v1" },
    entries,
    tempVault,
  )
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "V2", body: "v2", overwrite: true },
    entries,
    tempVault,
  )
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "V3", body: "v3", overwrite: true },
    entries,
    tempVault,
  )

  const matching = entries.filter((e) => e.relativePath === "gotchas/note.md")
  expect(matching.length).toBe(1)
  expect(matching[0]!.title).toBe("V3")
})

test("sort order maintained when type changes on overwrite", async () => {
  await executeWrite(
    { path: "references/ref.md", type: "references", title: "Ref", body: "ref" },
    entries,
    tempVault,
  )
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Gotcha", body: "gotcha" },
    entries,
    tempVault,
  )

  await executeWrite(
    { path: "gotchas/note.md", type: "references", title: "Now Ref", body: "changed", overwrite: true },
    entries,
    tempVault,
  )

  expect(entries.length).toBe(2)
  for (let i = 1; i < entries.length; i++) {
    const prev = NOTE_TYPE_PRIORITY[entries[i - 1]!.frontmatter.type]
    const curr = NOTE_TYPE_PRIORITY[entries[i]!.frontmatter.type]
    expect(prev).toBeLessThanOrEqual(curr)
  }
})

