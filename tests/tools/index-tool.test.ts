import { test, expect } from "bun:test"
import { executeIndex } from "../../src/tools/index-tool"
import { loadVault } from "../../src/vault/loader"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")
let entries: Awaited<ReturnType<typeof loadVault>>
const setup = loadVault(VAULT).then((e) => (entries = e))

test("executeIndex returns full index table with no filters", async () => {
  await setup
  const result = executeIndex({}, entries)
  expect(result).toContain("| T | Title | Path | ~Tok |")
  expect(result).toContain("🔴")
  expect(result).toContain("🟤")
})

test("executeIndex filters by project tag", async () => {
  await setup
  const result = executeIndex({ project: "bevy-game" }, entries)
  expect(result).toContain("Bevy")
  expect(result).not.toContain("Bun over Node")
})


test("executeIndex returns message when no entries match", async () => {
  await setup
  const result = executeIndex({ project: "nonexistent-project" }, entries)
  expect(result).toContain("No knowledge entries")
})
