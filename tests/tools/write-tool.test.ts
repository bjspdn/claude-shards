import { test, expect, beforeEach, afterEach, mock } from "bun:test"
import { executeWrite } from "../../src/tools/write-tool"
import { NOTE_TYPE_PRIORITY, type NoteEntry } from "../../src/vault/types"
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
    { path: "/etc/passwd", type: "gotcha", title: "Bad", body: "nope" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("Absolute paths")
})

test("rejects path traversal", async () => {
  const result = await executeWrite(
    { path: "../etc/passwd", type: "gotcha", title: "Bad", body: "nope" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("outside vault")
})

test("rejects write to existing file", async () => {
  const filePath = join(tempVault, "existing.md")
  await Bun.write(filePath, "already here")

  const result = await executeWrite(
    { path: "existing.md", type: "gotcha", title: "Dup", body: "nope" },
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
      type: "gotcha",
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
  expect(content).toContain("type: gotcha")
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
    { path: "deep/nested/dir/note.md", type: "pattern", title: "Deep", body: "content" },
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
    { path: "gotchas/new.md", type: "gotcha", title: "New Note", body: "body" },
    entries,
    tempVault,
  )

  expect(entries.length).toBe(1)
  expect(entries[0]!.title).toBe("New Note")
  expect(entries[0]!.frontmatter.type).toBe("gotcha")
  expect(entries[0]!.relativePath).toBe("gotchas/new.md")
})

test("entries stay sorted by type priority after insert", async () => {
  await executeWrite(
    { path: "references/ref.md", type: "reference", title: "Ref", body: "ref body" },
    entries,
    tempVault,
  )
  await executeWrite(
    { path: "gotchas/gotcha.md", type: "gotcha", title: "Gotcha", body: "gotcha body" },
    entries,
    tempVault,
  )
  await executeWrite(
    { path: "patterns/pat.md", type: "pattern", title: "Pattern", body: "pat body" },
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

test("rejects when neither url nor body provided", async () => {
  const result = await executeWrite(
    { path: "test.md", title: "Title" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("body is required")
})

test("rejects when neither url nor title provided", async () => {
  const result = await executeWrite(
    { path: "test.md", body: "Some body" },
    entries,
    tempVault,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain("title is required")
})

test("defaults type to reference when url-derived content is used", async () => {
  mock.module("../../src/web/fetcher", () => ({
    fetchPageAsMarkdown: async () => ({
      title: "Fetched Title",
      markdown: "Fetched body content.",
      siteName: null,
      excerpt: null,
    }),
  }))

  const { executeWrite: writeWithMock } = await import("../../src/tools/write-tool")

  const result = await writeWithMock(
    { path: "references/fetched.md", url: "https://example.com/page" },
    entries,
    tempVault,
  )

  expect(result.ok).toBe(true)
  if (!result.ok) return

  const content = await Bun.file(join(tempVault, "references/fetched.md")).text()
  expect(content).toContain("type: reference")
  expect(content).toContain("# Fetched Title")
})

test("source URL appears as blockquote in written file", async () => {
  mock.module("../../src/web/fetcher", () => ({
    fetchPageAsMarkdown: async () => ({
      title: "Page Title",
      markdown: "Page content here.",
      siteName: null,
      excerpt: null,
    }),
  }))

  const { executeWrite: writeWithMock } = await import("../../src/tools/write-tool")

  const result = await writeWithMock(
    { path: "references/sourced.md", url: "https://example.com/article" },
    entries,
    tempVault,
  )

  expect(result.ok).toBe(true)
  if (!result.ok) return

  const content = await Bun.file(join(tempVault, "references/sourced.md")).text()
  expect(content).toContain("> Source: https://example.com/article")
  expect(content).toContain("Page content here.")
})
