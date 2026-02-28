import { test, expect } from "bun:test"
import { discoverFiles, loadVault, filterEntries } from "../../src/vault/loader"
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
