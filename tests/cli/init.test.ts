import { test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdtemp, rm, readFile, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { VAULT_BUNDLE } from "../../src/cli/vault-bundle.gen"
import { saveManifest, hashContent } from "../../src/cli/vault-manifest"
import { formatInitSummary, type InitResult } from "../../src/cli/init"

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "claude-shards-init-test-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

test("VAULT_BUNDLE contains expected files", () => {
  expect(VAULT_BUNDLE["Welcome.md"]).toContain("Welcome to Claude Shards")
  expect(VAULT_BUNDLE["CLAUDE.md"]).toContain("Claude Shards Vault")
  expect(VAULT_BUNDLE[".obsidian/app.json"]).toBeDefined()
})

test("formatInitSummary produces readable output", () => {
  const result: InitResult = {
    vaultPath: "/home/user/.claude-shards/knowledge-base",
    steps: [
      { name: "vault directory", status: "created", detail: "/home/user/.claude-shards/knowledge-base" },
      { name: "Welcome.md", status: "created", detail: "" },
      { name: "CLAUDE.md", status: "skipped", detail: "user modified" },
      { name: "Claude Code MCP", status: "failed", detail: "CLI not found" },
    ],
  }

  const summary = formatInitSummary(result)
  expect(summary).toContain("claude-shards init")
  expect(summary).toContain("Welcome.md")
  expect(summary).toContain("CLAUDE.md")
  expect(summary).toContain("Claude Code MCP")
  expect(summary).toContain("2 created")
  expect(summary).toContain("1 failed")
})

test("bundle files write to disk correctly", async () => {
  const fileEntries = Object.entries(VAULT_BUNDLE).filter(([k]) => !k.endsWith("/"))
  for (const [relativePath, content] of fileEntries) {
    const fullPath = join(tempDir, relativePath)
    const dir = join(fullPath, "..")
    await Bun.write(fullPath, content!)
  }

  const welcomeContent = await readFile(join(tempDir, "Welcome.md"), "utf-8")
  expect(welcomeContent).toContain("Welcome to Claude Shards")

  const claudeContent = await readFile(join(tempDir, "CLAUDE.md"), "utf-8")
  expect(claudeContent).toContain("Claude Shards Vault")
})

test("selective merge preserves user-modified files", async () => {
  const originalContent = VAULT_BUNDLE["Welcome.md"]!
  const fullPath = join(tempDir, "Welcome.md")

  await Bun.write(fullPath, originalContent)

  await saveManifest(tempDir, {
    version: "0.1.0",
    files: { "Welcome.md": hashContent(originalContent) },
  })

  const userModified = "# My Custom Welcome\n\nI changed this."
  await writeFile(fullPath, userModified)

  const diskContent = await readFile(fullPath, "utf-8")
  const diskHash = hashContent(diskContent)
  const manifestHash = hashContent(originalContent)

  expect(diskHash).not.toBe(manifestHash)
})

test("selective merge overwrites unmodified files", async () => {
  const originalContent = "old version"
  const fullPath = join(tempDir, "welcome.md")

  await Bun.write(fullPath, originalContent)

  await saveManifest(tempDir, {
    version: "0.1.0",
    files: { "Welcome.md": hashContent(originalContent) },
  })

  const diskContent = await readFile(fullPath, "utf-8")
  const diskHash = hashContent(diskContent)
  const manifestHash = hashContent(originalContent)

  expect(diskHash).toBe(manifestHash)
})
