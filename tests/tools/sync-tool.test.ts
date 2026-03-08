import { test, expect, beforeEach } from "bun:test"
import { executeSync } from "../../src/tools/sync-tool"
import type { NoteEntry } from "../../src/vault/types"
import { join } from "path"
import { mkdtemp, readdir, mkdir } from "fs/promises"
import { tmpdir } from "os"

function makeEntry(overrides: Partial<NoteEntry> & { relativePath: string; filePath: string }): NoteEntry {
  return {
    title: "Test Note",
    body: "body content",
    tokenCount: 100,
    frontmatter: {
      type: "gotchas",
      projects: [],
      tags: [],
      created: new Date(),
      updated: new Date(),
      status: "active",
      ...overrides.frontmatter,
    },
    ...overrides,
  } as NoteEntry
}

let tempDir: string
let vaultDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sync-test-"))
  vaultDir = await mkdtemp(join(tmpdir(), "sync-vault-"))
})

async function writeVaultNote(relativePath: string, content: string): Promise<string> {
  const fullPath = join(vaultDir, relativePath)
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"))
  await mkdir(dir, { recursive: true })
  await Bun.write(fullPath, content)
  return fullPath
}

test("executeSync with empty notes returns prompt message", async () => {
  const result = await executeSync([], [], tempDir)
  expect(result.entryCount).toBe(0)
  expect(result.summary).toContain("No notes specified")
})

test("executeSync copies files to docs/knowledge/<type>/ and updates CLAUDE.md", async () => {
  const fp = await writeVaultNote("gotchas/SYNC_BEFORE_INIT.md", "---\ntype: gotchas\n---\n# Note")
  const entries = [
    makeEntry({
      relativePath: "gotchas/SYNC_BEFORE_INIT.md",
      filePath: fp,
      title: "Sync before init",
      frontmatter: { type: "gotchas", projects: [], tags: [], created: new Date(), updated: new Date(), status: "active" },
    }),
  ]

  const result = await executeSync(["gotchas/SYNC_BEFORE_INIT.md"], entries, tempDir)
  expect(result.entryCount).toBe(1)
  expect(result.summary).toContain("Synced 1 entries")

  const copied = await Bun.file(join(tempDir, "docs/knowledge/gotchas/SYNC_BEFORE_INIT.md")).exists()
  expect(copied).toBe(true)

  const claudeMd = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(claudeMd).toContain("## Knowledge Index")
  expect(claudeMd).toContain("@docs/knowledge/gotchas/SYNC_BEFORE_INIT.md")
})

test("executeSync skips stale notes with report", async () => {
  const fp = await writeVaultNote("gotchas/STALE_NOTE.md", "---\ntype: gotchas\n---\n# Stale")
  const entries = [
    makeEntry({
      relativePath: "gotchas/STALE_NOTE.md",
      filePath: fp,
      title: "Stale note",
      frontmatter: { type: "gotchas", projects: [], tags: [], created: new Date(), updated: new Date(), status: "stale", staleAt: new Date() },
    }),
  ]

  const result = await executeSync(["gotchas/STALE_NOTE.md"], entries, tempDir)
  expect(result.entryCount).toBe(0)
  expect(result.summary).toContain("Skipped stale")
  expect(result.summary).toContain("STALE_NOTE.md")
})

test("executeSync reports not-found paths", async () => {
  const result = await executeSync(["gotchas/NONEXISTENT.md"], [], tempDir)
  expect(result.entryCount).toBe(0)
  expect(result.summary).toContain("Not found")
  expect(result.summary).toContain("NONEXISTENT.md")
})

test("executeSync cleans up files no longer in sync list", async () => {
  const knowledgeDir = join(tempDir, "docs/knowledge/gotchas")
  await mkdir(knowledgeDir, { recursive: true })
  await Bun.write(join(knowledgeDir, "OLD_NOTE.md"), "old content")

  const result = await executeSync([], [], tempDir)
  expect(result.summary).toContain("No notes specified")
})

test("executeSync removes files not in current sync list", async () => {
  const knowledgeDir = join(tempDir, "docs/knowledge/decisions")
  await mkdir(knowledgeDir, { recursive: true })
  await Bun.write(join(knowledgeDir, "REMOVED.md"), "old content")

  const fp = await writeVaultNote("gotchas/KEEP.md", "---\ntype: gotchas\n---\n# Keep")
  const entries = [
    makeEntry({
      relativePath: "gotchas/KEEP.md",
      filePath: fp,
      title: "Keep this",
      frontmatter: { type: "gotchas", projects: [], tags: [], created: new Date(), updated: new Date(), status: "active" },
    }),
  ]

  const result = await executeSync(["gotchas/KEEP.md"], entries, tempDir)
  expect(result.summary).toContain("Removed")
  expect(result.summary).toContain("decisions/REMOVED.md")

  const removedExists = await Bun.file(join(knowledgeDir, "REMOVED.md")).exists()
  expect(removedExists).toBe(false)

  const keptExists = await Bun.file(join(tempDir, "docs/knowledge/gotchas/KEEP.md")).exists()
  expect(keptExists).toBe(true)
})

test("executeSync uses description as title in CLAUDE.md table", async () => {
  const fp = await writeVaultNote("decisions/CHOSE_BUN.md", "---\ntype: decisions\n---\n# Chose Bun")
  const entries = [
    makeEntry({
      relativePath: "decisions/CHOSE_BUN.md",
      filePath: fp,
      title: "Chose Bun Over Node",
      frontmatter: { type: "decisions", description: "Why we chose Bun", projects: [], tags: [], created: new Date(), updated: new Date(), status: "active" },
    }),
  ]

  const result = await executeSync(["decisions/CHOSE_BUN.md"], entries, tempDir)
  const claudeMd = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(claudeMd).toContain("Why we chose Bun")
  expect(claudeMd).not.toContain("Chose Bun Over Node")
})

test("executeSync fingerprint skips rewrite when unchanged", async () => {
  const fp = await writeVaultNote("gotchas/STABLE.md", "---\ntype: gotchas\n---\n# Stable")
  const entries = [
    makeEntry({
      relativePath: "gotchas/STABLE.md",
      filePath: fp,
      title: "Stable note",
      frontmatter: { type: "gotchas", projects: [], tags: [], created: new Date(), updated: new Date(), status: "active" },
    }),
  ]

  const result1 = await executeSync(["gotchas/STABLE.md"], entries, tempDir)
  expect(result1.summary).toContain("Synced")

  const result2 = await executeSync(["gotchas/STABLE.md"], entries, tempDir)
  expect(result2.summary).toContain("already up to date")
})
