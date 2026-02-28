import { test, expect } from "bun:test"
import { loadProjectConfig } from "../../src/vault/config"
import { join } from "path"

const FIXTURES = join(import.meta.dir, "../fixtures")

test("loadProjectConfig parses valid .context.toml", async () => {
  const config = await loadProjectConfig(join(FIXTURES, "with-config"))
  expect(config).not.toBeNull()
  expect(config!.project!.name).toBe("test-project")
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
