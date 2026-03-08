import { test, expect } from "bun:test"
import { analyzeHealth, formatHealthReport } from "../../src/tools/health-tool"
import { loadVault, buildLinkGraph } from "../../src/vault/loader"
import type { NoteEntry, LinkGraph } from "../../src/vault/types"
import type { StaleResult } from "../../src/tools/index-tool"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")

let entries: NoteEntry[]
let linkGraph: LinkGraph

const setup = loadVault(VAULT).then((e) => {
  entries = e
  linkGraph = buildLinkGraph(e)
})

test("linked + orphans = total", async () => {
  await setup
  const report = analyzeHealth(entries, linkGraph)
  expect(report.linkedNotes + report.orphanNotes.length).toBe(report.totalNotes)
})

test("orphans have no inbound or outbound links", async () => {
  await setup
  const report = analyzeHealth(entries, linkGraph)
  expect(report.orphanNotes.length).toBeGreaterThan(0)
  for (const orphan of report.orphanNotes) {
    expect(linkGraph.forward.has(orphan.relativePath)).toBe(false)
    expect(linkGraph.reverse.has(orphan.relativePath)).toBe(false)
  }
})

test("hub notes are sorted by degree descending", async () => {
  await setup
  const report = analyzeHealth(entries, linkGraph)
  expect(report.hubNotes.length).toBeGreaterThan(0)
  for (let i = 1; i < report.hubNotes.length; i++) {
    expect(report.hubNotes[i]!.degree).toBeLessThanOrEqual(report.hubNotes[i - 1]!.degree)
  }
})

test("hub notes are capped at 5", async () => {
  await setup
  const report = analyzeHealth(entries, linkGraph)
  expect(report.hubNotes.length).toBeLessThanOrEqual(5)
})

test("empty graph makes all notes orphans", async () => {
  await setup
  const emptyGraph: LinkGraph = { forward: new Map(), reverse: new Map() }
  const report = analyzeHealth(entries, emptyGraph)
  expect(report.orphanNotes.length).toBe(entries.length)
  expect(report.linkedNotes).toBe(0)
  expect(report.hubNotes.length).toBe(0)
})

test("empty graph creates single-node clusters for every note", async () => {
  await setup
  const emptyGraph: LinkGraph = { forward: new Map(), reverse: new Map() }
  const report = analyzeHealth(entries, emptyGraph)
  expect(report.clusters.length).toBe(entries.length)
  for (const cluster of report.clusters) {
    expect(cluster.size).toBe(1)
  }
})

test("clusters are sorted largest-first", async () => {
  await setup
  const report = analyzeHealth(entries, linkGraph)
  for (let i = 1; i < report.clusters.length; i++) {
    expect(report.clusters[i]!.size).toBeLessThanOrEqual(report.clusters[i - 1]!.size)
  }
})

test("all notes appear in exactly one cluster", async () => {
  await setup
  const report = analyzeHealth(entries, linkGraph)
  const allMembers = report.clusters.flatMap((c) => c.members)
  expect(allMembers.length).toBe(report.totalNotes)
  expect(new Set(allMembers).size).toBe(report.totalNotes)
})

test("formatHealthReport contains expected sections", async () => {
  await setup
  const report = analyzeHealth(entries, linkGraph)
  const output = formatHealthReport(report)
  expect(output).toContain("## Overview")
  expect(output).toContain("## Hubs")
  expect(output).toContain("## Orphans")
  expect(output).toContain("## Clusters")
})

test("formatHealthReport includes note counts", async () => {
  await setup
  const report = analyzeHealth(entries, linkGraph)
  const output = formatHealthReport(report)
  expect(output).toContain(`Total notes: ${report.totalNotes}`)
  expect(output).toContain(`Linked: ${report.linkedNotes}`)
  expect(output).toContain(`Orphans: ${report.orphanNotes.length}`)
})

test("formatHealthReport includes lifecycle section with stale result", async () => {
  await setup
  const report = analyzeHealth(entries, linkGraph)
  const staleResult: StaleResult = {
    staleCount: 2,
    activatedCount: 1,
    deletedCount: 1,
    deletedPaths: ["gotchas/old-note.md"],
    stalePaths: ["patterns/stale-one.md", "patterns/stale-two.md"],
    staleSynced: ["patterns/stale-one.md"],
  }
  const output = formatHealthReport(report, staleResult)
  expect(output).toContain("## Lifecycle")
  expect(output).toContain("2 marked stale")
  expect(output).toContain("1 reactivated")
  expect(output).toContain("1 deleted: gotchas/old-note.md")
  expect(output).toContain("⚠ Stale notes still synced")
  expect(output).toContain("## Overview")
})

test("formatHealthReport shows no lifecycle changes when nothing changed", async () => {
  await setup
  const report = analyzeHealth(entries, linkGraph)
  const staleResult: StaleResult = {
    staleCount: 0,
    activatedCount: 0,
    deletedCount: 0,
    deletedPaths: [],
    stalePaths: [],
    staleSynced: [],
  }
  const output = formatHealthReport(report, staleResult)
  expect(output).toContain("## Lifecycle")
  expect(output).toContain("No lifecycle changes")
})

test("formatHealthReport omits lifecycle section without stale result", async () => {
  await setup
  const report = analyzeHealth(entries, linkGraph)
  const output = formatHealthReport(report)
  expect(output).not.toContain("## Lifecycle")
})
