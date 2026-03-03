import { test, expect } from "bun:test"
import { discoverFiles, loadVault, filterEntries, buildLinkGraph } from "../../src/vault/loader"
import type { ProjectConfig } from "../../src/vault/types"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")

test("discoverFiles finds .md files and ignores hidden dirs", async () => {
  const files = await discoverFiles(VAULT)
  expect(files.length).toBeGreaterThan(0)
  expect(files.every((f) => f.endsWith(".md"))).toBe(true)
  expect(files.some((f) => f.includes(".obsidian"))).toBe(false)
})

test("loadVault parses all valid notes and skips invalid ones", async () => {
  const entries = await loadVault(VAULT)
  const titles = entries.map((e) => e.title)
  expect(titles).toContain("Bevy system ordering matters")
  expect(titles).toContain("Chose ECS over OOP for game architecture")
  expect(titles).not.toContain("no-frontmatter")
  expect(titles).not.toContain("invalid-type")
})

test("loadVault sorts by type priority: gotchas > decisions > patterns > references", async () => {
  const entries = await loadVault(VAULT)
  const types = entries.map((e) => e.frontmatter.type)
  const gotchaIdx = types.indexOf("gotchas")
  const decisionIdx = types.indexOf("decisions")
  const patternIdx = types.indexOf("patterns")
  const referenceIdx = types.indexOf("references")
  expect(gotchaIdx).toBeLessThan(decisionIdx)
  expect(decisionIdx).toBeLessThan(patternIdx)
  expect(patternIdx).toBeLessThan(referenceIdx)
})

test("filterEntries with null config returns all entries", async () => {
  const entries = await loadVault(VAULT)
  const filtered = filterEntries(entries, null)
  expect(filtered.length).toBe(entries.length)
})

test("filterEntries by tags keeps notes matching ANY tag", async () => {
  const entries = await loadVault(VAULT)
  const config: ProjectConfig = {
    filter: { tags: ["bevy"] },
  }
  const filtered = filterEntries(entries, config)
  expect(filtered.every((e) => e.frontmatter.tags.includes("bevy"))).toBe(true)
  expect(filtered.length).toBeGreaterThan(0)
  expect(filtered.length).toBeLessThan(entries.length)
})

test("filterEntries by types keeps only matching types", async () => {
  const entries = await loadVault(VAULT)
  const config: ProjectConfig = {
    filter: { types: ["gotchas"] },
  }
  const filtered = filterEntries(entries, config)
  expect(filtered.every((e) => e.frontmatter.type === "gotchas")).toBe(true)
})

test("filterEntries with exclude patterns removes matching paths", async () => {
  const entries = await loadVault(VAULT)
  const config: ProjectConfig = {
    filter: { exclude: ["drafts/*"] },
  }
  const filtered = filterEntries(entries, config)
  expect(filtered.some((e) => e.relativePath.startsWith("drafts/"))).toBe(false)
})

test("buildLinkGraph builds forward and reverse maps from frontmatter links", async () => {
  const entries = await loadVault(VAULT)
  const graph = buildLinkGraph(entries)

  const linkedNote = entries.find((e) => e.relativePath === "linked-note.md")
  expect(linkedNote).toBeDefined()

  const fwd = graph.forward.get("linked-note.md")
  expect(fwd).toBeDefined()
  expect(fwd!.has("decisions/chose-ecs-over-oop.md")).toBe(true)
  expect(fwd!.has("patterns/rust-error-handling.md")).toBe(true)

  const revEcs = graph.reverse.get("decisions/chose-ecs-over-oop.md")
  expect(revEcs).toBeDefined()
  expect(revEcs!.has("linked-note.md")).toBe(true)

  const revRust = graph.reverse.get("patterns/rust-error-handling.md")
  expect(revRust).toBeDefined()
  expect(revRust!.has("linked-note.md")).toBe(true)
})

test("buildLinkGraph excludes dangling wikilinks to non-existent notes", async () => {
  const entries = await loadVault(VAULT)

  const fakeEntry = {
    ...entries[0]!,
    relativePath: "gotchas/fake.md",
    filePath: "/tmp/fake.md",
    frontmatter: {
      ...entries[0]!.frontmatter,
      decisions: ["[[nonexistent]]", "[[chose-ecs-over-oop]]"],
      patterns: [],
      gotchas: [],
      references: [],
    },
  }

  const graph = buildLinkGraph([...entries, fakeEntry])

  const fwd = graph.forward.get("gotchas/fake.md")
  expect(fwd).toBeDefined()
  expect(fwd!.has("decisions/chose-ecs-over-oop.md")).toBe(true)
  expect(fwd!.size).toBe(1)
})
