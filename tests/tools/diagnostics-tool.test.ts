import { test, expect } from "bun:test"
import { executeDiagnostics } from "../../src/tools/diagnostics-tool"
import { loadVault } from "../../src/vault/loader"
import type { WatcherStats } from "../../src/vault/watcher"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")
let entries: Awaited<ReturnType<typeof loadVault>>
const setup = loadVault(VAULT).then((e) => (entries = e))

function makeStats(overrides?: Partial<WatcherStats>): WatcherStats {
  return { activeWatchers: 0, totalFlushes: 0, totalUpserts: 0, totalRemoves: 0, ...overrides }
}

test("returns vault stats for loaded entries", async () => {
  await setup
  const result = executeDiagnostics(entries, makeStats())

  expect(result).toContain("Vault")
  expect(result).toContain(`Entries:  ${entries.length}`)
  expect(result).toContain("Gotchas:")
  expect(result).toContain("Tokens:")
})

test("reflects watcher stats accurately", async () => {
  await setup
  const stats = makeStats({ activeWatchers: 3, totalFlushes: 10, totalUpserts: 25, totalRemoves: 5 })
  const result = executeDiagnostics(entries, stats)

  expect(result).toContain("Active:   3")
  expect(result).toContain("Flushes:  10")
  expect(result).toContain("Upserts:  25")
  expect(result).toContain("Removes:  5")
})

test("includes process metrics", async () => {
  await setup
  const result = executeDiagnostics(entries, makeStats())

  expect(result).toContain("Uptime:")
  expect(result).toContain("RSS:")
  expect(result).toContain("Heap:")
  expect(result).toMatch(/\d+\.\d+ MB/)
})

test("includes server version", async () => {
  await setup
  const result = executeDiagnostics(entries, makeStats())

  expect(result).toContain("Version:")
})
