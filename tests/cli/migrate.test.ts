import { test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdtemp, rm, mkdir } from "fs/promises"
import { tmpdir } from "os"
import { detectLegacyLayout, executeMigration } from "../../src/cli/migrate"

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "claude-shards-migrate-test-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function writeNote(relativePath: string, frontmatter: Record<string, unknown>) {
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        if (v.length === 0) return `${k}: []`
        return `${k}:\n${v.map((i) => `  - ${i}`).join("\n")}`
      }
      return `${k}: ${v}`
    })
    .join("\n")
  const content = `---\n${yaml}\n---\n\n# Test Note\n`
  const fullPath = join(tempDir, relativePath)
  return mkdir(join(fullPath, ".."), { recursive: true }).then(() =>
    Bun.write(fullPath, content),
  )
}

test("detectLegacyLayout returns true when type folders contain .md files", async () => {
  await writeNote("gotchas/test.md", { type: "gotchas", tags: ["rust"], created: "2026-01-01", updated: "2026-01-01" })
  expect(await detectLegacyLayout(tempDir)).toBe(true)
})

test("detectLegacyLayout returns false on fresh vault", async () => {
  await mkdir(join(tempDir, "_templates"), { recursive: true })
  await mkdir(join(tempDir, "_unsorted"), { recursive: true })
  expect(await detectLegacyLayout(tempDir)).toBe(false)
})

test("detectLegacyLayout returns false on empty type folders", async () => {
  await mkdir(join(tempDir, "gotchas"), { recursive: true })
  await mkdir(join(tempDir, "decisions"), { recursive: true })
  expect(await detectLegacyLayout(tempDir)).toBe(false)
})

test("executeMigration moves notes to tag-based folders", async () => {
  await writeNote("gotchas/bevy-ordering.md", { type: "gotchas", tags: ["bevy", "rust"], created: "2026-01-01", updated: "2026-01-01" })
  await writeNote("decisions/chose-ecs.md", { type: "decisions", tags: ["bevy", "ecs"], created: "2026-01-01", updated: "2026-01-01" })

  const result = await executeMigration(tempDir)

  expect(result.moved).toContainEqual({ from: "gotchas/bevy-ordering.md", to: "bevy/bevy-ordering.md" })
  expect(result.moved).toContainEqual({ from: "decisions/chose-ecs.md", to: "bevy/chose-ecs.md" })
  expect(await Bun.file(join(tempDir, "bevy/bevy-ordering.md")).exists()).toBe(true)
  expect(await Bun.file(join(tempDir, "bevy/chose-ecs.md")).exists()).toBe(true)
})

test("executeMigration moves tagless notes to _unsorted", async () => {
  await writeNote("patterns/no-tags.md", { type: "patterns", tags: [], created: "2026-01-01", updated: "2026-01-01" })

  const result = await executeMigration(tempDir)

  expect(result.moved).toContainEqual({ from: "patterns/no-tags.md", to: "_unsorted/no-tags.md" })
  expect(await Bun.file(join(tempDir, "_unsorted/no-tags.md")).exists()).toBe(true)
})

test("executeMigration handles slug collisions with numeric suffix", async () => {
  await writeNote("gotchas/same-name.md", { type: "gotchas", tags: ["rust"], created: "2026-01-01", updated: "2026-01-01" })
  await writeNote("patterns/same-name.md", { type: "patterns", tags: ["rust"], created: "2026-01-01", updated: "2026-01-01" })

  const result = await executeMigration(tempDir)

  const movedPaths = result.moved.map((m) => m.to)
  expect(movedPaths).toContain("rust/same-name.md")
  expect(movedPaths).toContain("rust/same-name-2.md")
})

test("executeMigration removes empty legacy folders", async () => {
  await writeNote("gotchas/test.md", { type: "gotchas", tags: ["rust"], created: "2026-01-01", updated: "2026-01-01" })

  const result = await executeMigration(tempDir)

  expect(result.removedDirs).toContain("gotchas")
  expect(await Bun.file(join(tempDir, "gotchas")).exists()).toBe(false)
})

test("executeMigration is idempotent", async () => {
  await writeNote("gotchas/test.md", { type: "gotchas", tags: ["rust"], created: "2026-01-01", updated: "2026-01-01" })

  await executeMigration(tempDir)
  const result2 = await executeMigration(tempDir)

  expect(result2.moved).toHaveLength(0)
})
