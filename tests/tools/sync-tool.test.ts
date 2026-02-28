import { test, expect, beforeEach } from "bun:test"
import { executeSync } from "../../src/tools/sync-tool"
import { loadVault } from "../../src/vault/loader"
import { join } from "path"
import { mkdtemp, mkdir } from "fs/promises"
import { tmpdir } from "os"

const VAULT = join(import.meta.dir, "../fixtures/vault")
let entries: Awaited<ReturnType<typeof loadVault>>
const setup = loadVault(VAULT).then((e) => (entries = e))

let tempDir: string
let globalDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sync-test-"))
  globalDir = await mkdtemp(join(tmpdir(), "sync-global-"))
})

test("executeSync creates CLAUDE.md and auto-creates .context.toml", async () => {
  await setup
  const result = await executeSync(tempDir, entries, VAULT, { globalClaudeDir: globalDir })
  expect(result.summary).toContain("Synced")
  expect(result.entryCount).toBe(0)

  const content = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(content).toContain("## Knowledge Index")

  const configExists = await Bun.file(join(tempDir, ".context.toml")).exists()
  expect(configExists).toBe(true)
})

test("executeSync preserves existing CLAUDE.md content outside Knowledge Index", async () => {
  await setup
  await Bun.write(
    join(tempDir, "CLAUDE.md"),
    "# My Project\n\nImportant rules here.\n\n## Other Section\n\nKeep this.\n",
  )

  await executeSync(tempDir, entries, VAULT, { globalClaudeDir: globalDir })

  const content = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(content).toContain("# My Project")
  expect(content).toContain("Important rules here.")
  expect(content).toContain("## Knowledge Index")
  expect(content).toContain("## Other Section")
  expect(content).toContain("Keep this.")
})

test("executeSync replaces existing Knowledge Index section", async () => {
  await setup
  await Bun.write(
    join(tempDir, "CLAUDE.md"),
    "# Project\n\n## Knowledge Index\nOld stuff.\n\n## Other\nKeep.\n",
  )

  await executeSync(tempDir, entries, VAULT, { globalClaudeDir: globalDir })

  const content = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(content).not.toContain("Old stuff")
  expect(content).toContain("## Knowledge Index")
  expect(content).toContain("## Other")
  expect(content).toContain("Keep.")
})

test("executeSync applies .context.toml filters when present", async () => {
  await setup
  const configDir = join(import.meta.dir, "../fixtures/with-config")

  const result = await executeSync(configDir, entries, VAULT, { globalClaudeDir: globalDir })
  expect(result.entryCount).toBeGreaterThan(0)
  expect(result.entryCount).toBeLessThan(entries.length)
})

test("executeSync returns entry count and token summary", async () => {
  await setup
  const result = await executeSync(tempDir, entries, VAULT, { globalClaudeDir: globalDir })
  expect(result.entryCount).toBe(0)
  expect(result.totalTokens).toBe(0)
  expect(result.summary).toMatch(/Synced \d+ entries/)
})

test("executeSync includes global notes when tags overlap", async () => {
  await setup
  await Bun.write(
    join(tempDir, ".context.toml"),
    '[project]\nname = "test-proj"\n\n[filter]\ntags = ["general"]\n',
  )
  const result = await executeSync(tempDir, entries, VAULT, { globalClaudeDir: globalDir })
  expect(result.entryCount).toBe(1)

  const content = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(content).toContain("General testing tip")
})

test("executeSync excludes global notes when no tag overlap", async () => {
  await setup
  await Bun.write(
    join(tempDir, ".context.toml"),
    '[project]\nname = "test-proj"\n\n[filter]\ntags = ["nonexistent"]\n',
  )
  const result = await executeSync(tempDir, entries, VAULT, { globalClaudeDir: globalDir })
  expect(result.entryCount).toBe(0)
})

test("executeSync excludes global notes when no filter.tags specified", async () => {
  await setup
  await Bun.write(
    join(tempDir, ".context.toml"),
    '[project]\nname = "test-proj"\n',
  )
  const result = await executeSync(tempDir, entries, VAULT, { globalClaudeDir: globalDir })
  expect(result.entryCount).toBe(0)
})

test("executeSync auto-created .context.toml contains inferred tags from extensions", async () => {
  await setup
  await Bun.write(join(tempDir, "index.ts"), "export default {}")
  await Bun.write(join(tempDir, "app.tsx"), "<App />")

  const result = await executeSync(tempDir, entries, VAULT, { globalClaudeDir: globalDir })

  const toml = await Bun.file(join(tempDir, ".context.toml")).text()
  expect(toml).toContain("typescript")
  expect(result.summary).toContain("inferred tags")
  expect(result.summary).toContain("Available vault tags")
})

test("executeSync also writes global CLAUDE.md with project-less notes", async () => {
  await setup
  await Bun.write(
    join(tempDir, ".context.toml"),
    '[project]\nname = "test-proj"\n\n[filter]\ntags = ["rust"]\n',
  )

  const result = await executeSync(tempDir, entries, VAULT, { globalClaudeDir: globalDir })

  expect(result.summary).toContain("global entries to ~/.claude/CLAUDE.md")

  const globalContent = await Bun.file(join(globalDir, "CLAUDE.md")).text()
  expect(globalContent).toContain("## Knowledge Index")
  const globalNotes = entries.filter((e) => e.frontmatter.projects.length === 0)
  for (const note of globalNotes) {
    expect(globalContent).toContain(note.title)
  }
})

test("executeSync skips global sync when targetDir is the global claude dir", async () => {
  await setup
  const result = await executeSync(globalDir, entries, VAULT, { globalClaudeDir: globalDir })

  expect(result.summary).not.toContain("global entries")

  const content = await Bun.file(join(globalDir, "CLAUDE.md")).text()
  expect(content).toContain("## Knowledge Index")
})
