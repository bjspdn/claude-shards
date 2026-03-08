import { test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { loadManifest, saveManifest, hashContent } from "../../src/cli/vault-manifest"

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "claude-shards-manifest-test-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

test("loadManifest returns null when no manifest exists", async () => {
  const result = await loadManifest(tempDir)
  expect(result).toBeNull()
})

test("saveManifest + loadManifest round-trip", async () => {
  const manifest = {
    version: "0.20.0",
    files: {
      "welcome.md": hashContent("# Welcome"),
      "CLAUDE.md": hashContent("# Claude"),
    },
  }

  await saveManifest(tempDir, manifest)
  const loaded = await loadManifest(tempDir)

  expect(loaded).toEqual(manifest)
})

test("hashContent is deterministic", () => {
  const content = "hello world"
  expect(hashContent(content)).toBe(hashContent(content))
})

test("hashContent differs for different content", () => {
  expect(hashContent("hello")).not.toBe(hashContent("world"))
})
