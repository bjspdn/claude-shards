import { test, expect } from "bun:test"
import { loadProjectConfig, createDefaultConfig } from "../../src/vault/config"
import { join, basename } from "path"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"

const FIXTURES = join(import.meta.dir, "../fixtures")

test("loadProjectConfig parses valid .context.toml", async () => {
  const config = await loadProjectConfig(join(FIXTURES, "with-config"))
  expect(config).not.toBeNull()
  expect(config!.project!.name).toBe("bevy-game")
  expect(config!.filter!.tags).toEqual(["rust", "bevy"])
  expect(config!.filter!.types).toEqual(["gotcha", "pattern"])
  expect(config!.filter!.exclude).toEqual(["drafts/*"])
})

test("loadProjectConfig returns null when no .context.toml", async () => {
  const config = await loadProjectConfig(join(FIXTURES, "no-config"))
  expect(config).toBeNull()
})

test("loadProjectConfig returns null for invalid TOML", async () => {
  const config = await loadProjectConfig(join(FIXTURES, "invalid-config"))
  expect(config).toBeNull()
})

test("createDefaultConfig writes .context.toml and returns config", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "config-test-"))
  const config = await createDefaultConfig(tempDir)

  expect(config.project!.name).toBe(basename(tempDir))

  const written = await Bun.file(join(tempDir, ".context.toml")).text()
  expect(written).toContain(basename(tempDir))

  const loaded = await loadProjectConfig(tempDir)
  expect(loaded).not.toBeNull()
  expect(loaded!.project!.name).toBe(basename(tempDir))
})
