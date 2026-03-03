import { test, expect } from "bun:test"
import { executeSearch } from "../../src/tools/search-tool"
import { loadVault, buildLinkGraph } from "../../src/vault/loader"
import { buildIdfTable } from "../../src/tools/bm25"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")

let entries: Awaited<ReturnType<typeof loadVault>>
let idf: ReturnType<typeof buildIdfTable>

const setup = loadVault(VAULT).then((e) => {
  entries = e
  idf = buildIdfTable(e)
})

test("executeSearch finds notes matching title keywords", async () => {
  await setup
  const results = executeSearch({ query: "Bevy system ordering" }, entries, undefined, idf)
  expect(results.length).toBeGreaterThan(0)
  expect(results[0]!.title).toContain("Bevy system ordering")
})

test("executeSearch scores title matches higher than body matches", async () => {
  await setup
  const results = executeSearch({ query: "bevy" }, entries, undefined, idf)
  expect(results.length).toBeGreaterThan(1)
  const firstTitle = results[0]!.title.toLowerCase()
  expect(firstTitle).toContain("bevy")
})

test("executeSearch filters by types param", async () => {
  await setup
  const results = executeSearch(
    { query: "rust", types: ["gotchas"] },
    entries,
    undefined,
    idf,
  )
  expect(results.every((r) => r.type === "gotchas")).toBe(true)
})

test("executeSearch filters by tags param", async () => {
  await setup
  const results = executeSearch(
    { query: "bun", tags: ["typescript"] },
    entries,
    undefined,
    idf,
  )
  expect(results.length).toBeGreaterThan(0)
})

test("executeSearch respects limit", async () => {
  await setup
  const results = executeSearch({ query: "bevy", limit: 2 }, entries, undefined, idf)
  expect(results.length).toBeLessThanOrEqual(2)
})

test("executeSearch returns empty array for no matches", async () => {
  await setup
  const results = executeSearch(
    { query: "xyznonexistent" },
    entries,
    undefined,
    idf,
  )
  expect(results).toEqual([])
})

test("executeSearch with graph propagation boosts linked results", async () => {
  await setup
  const graph = buildLinkGraph(entries)

  const withoutGraph = executeSearch({ query: "render order ECS schedule" }, entries, undefined, idf)
  const withGraph = executeSearch({ query: "render order ECS schedule" }, entries, graph, idf)

  const withoutScores = new Map(withoutGraph.map((r) => [r.relativePath, r.score]))
  const withScores = new Map(withGraph.map((r) => [r.relativePath, r.score]))

  let anyBoosted = false
  for (const [path, score] of withScores) {
    const base = withoutScores.get(path) ?? 0
    if (score > base) anyBoosted = true
  }
  expect(anyBoosted).toBe(true)
})

test("executeSearch without linkGraph preserves backward compat", async () => {
  await setup
  const results = executeSearch({ query: "bevy" }, entries, undefined, idf)
  expect(results.length).toBeGreaterThan(0)
})

test("executeSearch without idf falls back to legacy scoring", async () => {
  await setup
  const results = executeSearch({ query: "bevy" }, entries)
  expect(results.length).toBeGreaterThan(0)
  expect(results[0]!.title.toLowerCase()).toContain("bevy")
})
