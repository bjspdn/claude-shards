import { test, expect, beforeEach } from "bun:test"
import { markStaleNotes } from "../../src/tools/index-tool"
import type { NoteEntry } from "../../src/vault/types"
import { join } from "path"
import { mkdtemp, mkdir } from "fs/promises"
import { tmpdir } from "os"

let vaultDir: string

beforeEach(async () => {
  vaultDir = await mkdtemp(join(tmpdir(), "hygiene-test-"))
})

function makeNote(relativePath: string, overrides: Partial<NoteEntry["frontmatter"]> = {}): NoteEntry {
  const filePath = join(vaultDir, relativePath)
  return {
    frontmatter: {
      type: "gotchas",
      projects: [],
      tags: [],
      created: new Date("2024-01-01"),
      updated: new Date("2024-01-01"),
      status: "active",
      ...overrides,
    },
    filePath,
    relativePath,
    title: "Test Note",
    body: "body",
    tokenCount: 50,
  }
}

async function writeNote(entry: NoteEntry) {
  const dir = entry.filePath.substring(0, entry.filePath.lastIndexOf("/"))
  await mkdir(dir, { recursive: true })
  await Bun.write(entry.filePath, `---\ntype: ${entry.frontmatter.type}\nstatus: ${entry.frontmatter.status}\ncreated: 2024-01-01\nupdated: 2024-01-01\n---\n# Test\n`)
}

test("markStaleNotes marks old notes as stale", async () => {
  const entry = makeNote("gotchas/OLD_NOTE.md", { updated: new Date("2024-01-01") })
  await writeNote(entry)
  const entries = [entry]

  const now = new Date("2024-06-01")
  const result = await markStaleNotes(entries, vaultDir, 30, 14, now)

  expect(result.staleCount).toBe(1)
  expect(entries[0]!.frontmatter.status).toBe("stale")
})

test("markStaleNotes reactivates recently updated stale notes", async () => {
  const entry = makeNote("gotchas/RECENT.md", {
    updated: new Date("2024-05-30"),
    status: "stale",
    staleAt: new Date("2024-05-01"),
  })
  await writeNote(entry)
  const entries = [entry]

  const now = new Date("2024-06-01")
  const result = await markStaleNotes(entries, vaultDir, 30, 14, now)

  expect(result.activatedCount).toBe(1)
  expect(entries[0]!.frontmatter.status).toBe("active")
})

test("markStaleNotes deletes expired stale notes", async () => {
  const entry = makeNote("gotchas/EXPIRED.md", {
    updated: new Date("2024-01-01"),
    status: "stale",
    staleAt: new Date("2024-04-01"),
  })
  await writeNote(entry)
  const entries = [entry]

  const now = new Date("2024-06-01")
  const result = await markStaleNotes(entries, vaultDir, 30, 14, now)

  expect(result.deletedCount).toBe(1)
  expect(result.deletedPaths).toContain("gotchas/EXPIRED.md")
  expect(entries.length).toBe(0)
})

test("markStaleNotes returns zero counts when no lifecycle changes needed", async () => {
  const entry = makeNote("gotchas/FRESH.md", { updated: new Date() })
  await writeNote(entry)
  const entries = [entry]

  const result = await markStaleNotes(entries, vaultDir)

  expect(result.staleCount).toBe(0)
  expect(result.activatedCount).toBe(0)
  expect(result.deletedCount).toBe(0)
})
