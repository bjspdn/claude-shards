import { test, expect, beforeEach } from "bun:test"
import { executeSync } from "../../src/tools/sync-tool"
import { loadVault } from "../../src/vault/loader"
import { join } from "path"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"

const VAULT = join(import.meta.dir, "../fixtures/vault")
let entries: Awaited<ReturnType<typeof loadVault>>
const setup = loadVault(VAULT).then((e) => (entries = e))

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sync-test-"))
})

test("executeSync creates CLAUDE.md when none exists", async () => {
  await setup
  const result = await executeSync(tempDir, entries, VAULT)
  expect(result.summary).toContain("Synced")
  expect(result.entryCount).toBe(1)

  const content = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(content).toContain("## Knowledge Index")
  expect(content).toContain("General testing tip")
  expect(content).not.toContain("bevy")
})

test("executeSync preserves existing CLAUDE.md content outside Knowledge Index", async () => {
  await setup
  await Bun.write(
    join(tempDir, "CLAUDE.md"),
    "# My Project\n\nImportant rules here.\n\n## Other Section\n\nKeep this.\n",
  )

  await executeSync(tempDir, entries, VAULT)

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

  await executeSync(tempDir, entries, VAULT)

  const content = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(content).not.toContain("Old stuff")
  expect(content).toContain("## Knowledge Index")
  expect(content).toContain("## Other")
  expect(content).toContain("Keep.")
})

test("executeSync applies .context.toml filters when present", async () => {
  await setup
  const configDir = join(import.meta.dir, "../fixtures/with-config")

  const result = await executeSync(configDir, entries, VAULT)
  expect(result.entryCount).toBeGreaterThan(0)
  expect(result.entryCount).toBeLessThan(entries.length)
})

test("executeSync returns entry count and token summary", async () => {
  await setup
  const result = await executeSync(tempDir, entries, VAULT)
  expect(result.entryCount).toBe(1)
  expect(result.totalTokens).toBeGreaterThan(0)
  expect(result.summary).toMatch(/Synced \d+ entries/)
})
