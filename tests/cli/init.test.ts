import { test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdtemp, rm, readdir } from "fs/promises"
import { tmpdir } from "os"
import { buildSeedNotes } from "../../src/cli/seed"
import { formatInitSummary, type InitResult } from "../../src/cli/init"

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ccm-init-test-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

test("buildSeedNotes returns expected files with date injected", () => {
  const notes = buildSeedNotes("2026-02-28")
  expect(notes.length).toBe(2)

  const ofm = notes.find((n) => n.relativePath.includes("obsidian-flavored-markdown"))
  expect(ofm).toBeDefined()
  expect(ofm!.content).toContain("created: 2026-02-28")
  expect(ofm!.content).toContain("type: pattern")

  const template = notes.find((n) => n.relativePath.includes("_templates/note.md"))
  expect(template).toBeDefined()
  expect(template!.content).toContain("type:")
})

test("formatInitSummary produces readable output", () => {
  const result: InitResult = {
    vaultPath: "/home/user/.ccm/knowledge-base",
    steps: [
      { name: "vault directory", status: "created", detail: "/home/user/.ccm/knowledge-base" },
      { name: "subdirectories", status: "created", detail: "gotchas, decisions" },
      { name: "patterns/ofm.md", status: "skipped", detail: "already exists" },
      { name: "Claude Code MCP", status: "failed", detail: "CLI not found" },
    ],
  }

  const summary = formatInitSummary(result)
  expect(summary).toContain("ccm init")
  expect(summary).toContain("vault directory")
  expect(summary).toContain("patterns/ofm.md")
  expect(summary).toContain("Claude Code MCP")
  expect(summary).toContain("2 created")
  expect(summary).toContain("1 failed")
})

test("seed notes write to disk correctly", async () => {
  const notes = buildSeedNotes("2026-02-28")
  for (const note of notes) {
    const fullPath = join(tempDir, note.relativePath)
    const dir = join(fullPath, "..")
    await Bun.write(fullPath, note.content)
  }

  const ofmContent = await Bun.file(
    join(tempDir, "patterns/obsidian-flavored-markdown.md"),
  ).text()
  expect(ofmContent).toContain("# Obsidian Flavored Markdown Conventions")

  const templateContent = await Bun.file(join(tempDir, "_templates/note.md")).text()
  expect(templateContent).toContain("# Title")
})
