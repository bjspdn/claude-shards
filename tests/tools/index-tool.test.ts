import { test, expect } from "bun:test"
import { executeIndex } from "../../src/tools/index-tool"
import { loadVault } from "../../src/vault/loader"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")
let entries: Awaited<ReturnType<typeof loadVault>>
const setup = loadVault(VAULT).then((e) => (entries = e))

test("executeIndex returns full index table with no filters", async () => {
  await setup
  const result = executeIndex({}, entries, null)
  expect(result).toContain("| T | Title | Path | ~Tok |")
  expect(result).toContain("🔴")
  expect(result).toContain("🟤")
})

test("executeIndex filters by project tag", async () => {
  await setup
  const result = executeIndex({ project: "bevy-game" }, entries, null)
  expect(result).toContain("Bevy")
  expect(result).not.toContain("Bun over Node")
})

test("executeIndex applies project config filters", async () => {
  await setup
  const config = { filter: { types: ["gotcha" as const, "pattern" as const] } }
  const result = executeIndex({}, entries, config)
  expect(result).toContain("🔴")
  expect(result).toContain("🔵")
  expect(result).not.toContain("🟤")
})

test("executeIndex returns message when no entries match", async () => {
  await setup
  const result = executeIndex({ project: "nonexistent-project" }, entries, null)
  expect(result).toContain("No knowledge entries")
})
