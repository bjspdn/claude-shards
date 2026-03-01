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

test("rejects write to existing file in create mode", async () => {
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

test("overwrite: true still works as mode replace (backwards compat)", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "V1", body: "old" },
    entries,
    tempVault,
  )
  const result = await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "V2", body: "new", overwrite: true },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.updated).toBe(true)
  const content = await Bun.file(join(tempVault, "gotchas/note.md")).text()
  expect(content).toContain("# V2")
  expect(content).toContain("new")
})

test("create mode requires type, title, and body", async () => {
  const result = await executeWrite(
    { path: "gotchas/note.md", body: "only body" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("requires type, title, and body")
})

test("replace mode requires type, title, and body", async () => {
  const result = await executeWrite(
    { path: "gotchas/note.md", mode: "replace", body: "only body" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("requires type, title, and body")
})

test("section rejected for non-patch modes", async () => {
  const result = await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "T", body: "b", section: "Foo" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("only valid with mode 'patch'")
})

test("append adds body to end and bumps updated date", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Original", body: "first paragraph", tags: ["tag1"], projects: ["proj1"] },
    entries,
    tempVault,
  )

  const result = await executeWrite(
    { path: "gotchas/note.md", mode: "append", body: "appended paragraph" },
    entries,
    tempVault,
  )

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.updated).toBe(true)

  const content = await Bun.file(join(tempVault, "gotchas/note.md")).text()
  expect(content).toContain("first paragraph")
  expect(content).toContain("appended paragraph")
  expect(content).toContain("# Original")
  expect(content).toContain("type: gotchas")
  expect(content).toContain("  - tag1")
  expect(content).toContain("  - proj1")
})

test("append preserves created date", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "T", body: "body" },
    entries,
    tempVault,
  )
  const createdBefore = entries[0]!.frontmatter.created

  await executeWrite(
    { path: "gotchas/note.md", mode: "append", body: "more" },
    entries,
    tempVault,
  )

  const content = await Bun.file(join(tempVault, "gotchas/note.md")).text()
  const createdMatch = content.match(/created: (\S+)/)
  expect(createdMatch).toBeTruthy()
  expect(createdMatch![1]).toBe(formatDate(createdBefore))
})

test("append does not require type or title", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "T", body: "body" },
    entries,
    tempVault,
  )

  const result = await executeWrite(
    { path: "gotchas/note.md", mode: "append", body: "extra" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(true)
})

test("append fails if file does not exist", async () => {
  const result = await executeWrite(
    { path: "gotchas/missing.md", mode: "append", body: "nope" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("File not found")
})

test("append requires body", async () => {
  const result = await executeWrite(
    { path: "gotchas/note.md", mode: "append" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("requires body")
})

test("patch replaces section by heading", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Note", body: "intro\n\n## Section A\n\nold content A\n\n## Section B\n\nold content B" },
    entries,
    tempVault,
  )

  const result = await executeWrite(
    { path: "gotchas/note.md", mode: "patch", section: "Section A", body: "new content A" },
    entries,
    tempVault,
  )

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.updated).toBe(true)

  const content = await Bun.file(join(tempVault, "gotchas/note.md")).text()
  expect(content).toContain("new content A")
  expect(content).not.toContain("old content A")
  expect(content).toContain("## Section A")
  expect(content).toContain("## Section B")
  expect(content).toContain("old content B")
})

test("patch handles last section with no following heading", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Note", body: "intro\n\n## Only Section\n\nold content" },
    entries,
    tempVault,
  )

  const result = await executeWrite(
    { path: "gotchas/note.md", mode: "patch", section: "Only Section", body: "replaced content" },
    entries,
    tempVault,
  )

  expect(result.ok).toBe(true)
  const content = await Bun.file(join(tempVault, "gotchas/note.md")).text()
  expect(content).toContain("replaced content")
  expect(content).not.toContain("old content")
  expect(content).toContain("## Only Section")
})

test("patch respects heading level hierarchy", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Note", body: "## Parent\n\nparent text\n\n### Child\n\nchild text\n\n## Sibling\n\nsibling text" },
    entries,
    tempVault,
  )

  const result = await executeWrite(
    { path: "gotchas/note.md", mode: "patch", section: "Parent", body: "new parent\n\n### Child\n\nnew child" },
    entries,
    tempVault,
  )

  expect(result.ok).toBe(true)
  const content = await Bun.file(join(tempVault, "gotchas/note.md")).text()
  expect(content).toContain("new parent")
  expect(content).toContain("new child")
  expect(content).not.toContain("parent text")
  expect(content).not.toContain("child text")
  expect(content).toContain("## Sibling")
  expect(content).toContain("sibling text")
})

test("patch fails if section not found", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Note", body: "## Real Section\n\ncontent" },
    entries,
    tempVault,
  )

  const result = await executeWrite(
    { path: "gotchas/note.md", mode: "patch", section: "Nonexistent", body: "nope" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("Section not found")
})

test("patch fails if file does not exist", async () => {
  const result = await executeWrite(
    { path: "gotchas/missing.md", mode: "patch", section: "Foo", body: "nope" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("File not found")
})

test("patch requires section param", async () => {
  const result = await executeWrite(
    { path: "gotchas/note.md", mode: "patch", body: "nope" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("requires section")
})

test("patch preserves created date and metadata", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Note", body: "## Sec\n\nold", tags: ["t1"], projects: ["p1"] },
    entries,
    tempVault,
  )
  const createdBefore = entries[0]!.frontmatter.created

  await executeWrite(
    { path: "gotchas/note.md", mode: "patch", section: "Sec", body: "new" },
    entries,
    tempVault,
  )

  const content = await Bun.file(join(tempVault, "gotchas/note.md")).text()
  const createdMatch = content.match(/created: (\S+)/)
  expect(createdMatch![1]).toBe(formatDate(createdBefore))
  expect(content).toContain("type: gotchas")
  expect(content).toContain("  - t1")
  expect(content).toContain("  - p1")
})

test("patch with no body deletes a middle section", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Note", body: "## Section A\n\ncontent A\n\n## Section B\n\ncontent B\n\n## Section C\n\ncontent C" },
    entries,
    tempVault,
  )

  const result = await executeWrite(
    { path: "gotchas/note.md", mode: "patch", section: "Section B" },
    entries,
    tempVault,
  )

  expect(result.ok).toBe(true)
  const content = await Bun.file(join(tempVault, "gotchas/note.md")).text()
  expect(content).toContain("## Section A")
  expect(content).toContain("content A")
  expect(content).not.toContain("## Section B")
  expect(content).not.toContain("content B")
  expect(content).toContain("## Section C")
  expect(content).toContain("content C")
})

test("patch with no body deletes the last section", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Note", body: "## First\n\nkeep this\n\n## Last\n\nremove this" },
    entries,
    tempVault,
  )

  const result = await executeWrite(
    { path: "gotchas/note.md", mode: "patch", section: "Last" },
    entries,
    tempVault,
  )

  expect(result.ok).toBe(true)
  const content = await Bun.file(join(tempVault, "gotchas/note.md")).text()
  expect(content).toContain("## First")
  expect(content).toContain("keep this")
  expect(content).not.toContain("## Last")
  expect(content).not.toContain("remove this")
})

test("patch with empty string body deletes the section", async () => {
  await executeWrite(
    { path: "gotchas/note.md", type: "gotchas", title: "Note", body: "## Keep\n\nkept\n\n## Remove\n\ngone" },
    entries,
    tempVault,
  )

  const result = await executeWrite(
    { path: "gotchas/note.md", mode: "patch", section: "Remove", body: "" },
    entries,
    tempVault,
  )

  expect(result.ok).toBe(true)
  const content = await Bun.file(join(tempVault, "gotchas/note.md")).text()
  expect(content).toContain("## Keep")
  expect(content).toContain("kept")
  expect(content).not.toContain("## Remove")
  expect(content).not.toContain("gone")
})

