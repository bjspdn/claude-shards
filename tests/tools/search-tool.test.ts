import { test, expect } from "bun:test"
import { executeSearch } from "../../src/tools/search-tool"
import { loadVault } from "../../src/vault/loader"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")

let entries: Awaited<ReturnType<typeof loadVault>>

const setup = loadVault(VAULT).then((e) => (entries = e))

test("executeSearch finds notes matching title keywords", async () => {
  await setup
  const results = executeSearch({ query: "Bevy system ordering" }, entries)
  expect(results.length).toBeGreaterThan(0)
  expect(results[0]!.title).toContain("Bevy system ordering")
})

test("executeSearch scores title matches higher than body matches", async () => {
  await setup
  const results = executeSearch({ query: "bevy" }, entries)
  expect(results.length).toBeGreaterThan(1)
  const firstTitle = results[0]!.title.toLowerCase()
  expect(firstTitle).toContain("bevy")
})

test("executeSearch filters by types param", async () => {
  await setup
  const results = executeSearch(
    { query: "rust", types: ["gotchas"] },
    entries,
  )
  expect(results.every((r) => r.type === "gotchas")).toBe(true)
})

test("executeSearch filters by tags param", async () => {
  await setup
  const results = executeSearch(
    { query: "bun", tags: ["typescript"] },
    entries,
  )
  expect(results.length).toBeGreaterThan(0)
})

test("executeSearch respects limit", async () => {
  await setup
  const results = executeSearch({ query: "bevy", limit: 2 }, entries)
  expect(results.length).toBeLessThanOrEqual(2)
})

test("executeSearch returns empty array for no matches", async () => {
  await setup
  const results = executeSearch(
    { query: "xyznonexistent" },
    entries,
  )
  expect(results).toEqual([])
})

