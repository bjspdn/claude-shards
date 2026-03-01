import { test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdtemp, rm, mkdir } from "fs/promises"
import { tmpdir } from "os"
import {
  generateVaultId,
  loadObsidianConfig,
  findVaultByPath,
  registerVaultWithObsidian,
} from "../../src/cli/obsidian"

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "claude-shards-obsidian-test-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

test("generateVaultId returns 16-char hex string", () => {
  const id = generateVaultId()
  expect(id).toMatch(/^[a-f0-9]{16}$/)
})

test("generateVaultId returns unique values", () => {
  const ids = new Set(Array.from({ length: 10 }, () => generateVaultId()))
  expect(ids.size).toBe(10)
})

test("loadObsidianConfig returns null for missing file", async () => {
  const result = await loadObsidianConfig(join(tempDir, "nonexistent.json"))
  expect(result).toBeNull()
})

test("loadObsidianConfig parses valid config", async () => {
  const configPath = join(tempDir, "obsidian.json")
  await Bun.write(configPath, JSON.stringify({ vaults: {} }))

  const result = await loadObsidianConfig(configPath)
  expect(result).not.toBeNull()
  expect(result!.vaults).toEqual({})
})

test("findVaultByPath returns id when vault exists", () => {
  const config = {
    vaults: {
      abc123def456: { path: "/home/user/vault", ts: 1000 },
    },
  }
  expect(findVaultByPath(config, "/home/user/vault")).toBe("abc123def456")
})

test("findVaultByPath returns null when vault not found", () => {
  const config = {
    vaults: {
      abc123def456: { path: "/home/user/vault", ts: 1000 },
    },
  }
  expect(findVaultByPath(config, "/some/other/path")).toBeNull()
})

test("registerVaultWithObsidian skips when config missing", async () => {
  const result = await registerVaultWithObsidian(
    "/some/vault",
    join(tempDir, "nonexistent.json"),
  )
  expect("skipped" in result && result.skipped).toBe(true)
  if ("skipped" in result) {
    expect(result.reason).toContain("not installed")
  }
})

test("registerVaultWithObsidian skips when already registered", async () => {
  const configPath = join(tempDir, "obsidian.json")
  const existing = {
    vaults: {
      existingid1234567: { path: "/my/vault", ts: 1000 },
    },
  }
  await Bun.write(configPath, JSON.stringify(existing))

  const result = await registerVaultWithObsidian("/my/vault", configPath)
  expect("skipped" in result && result.skipped).toBe(true)
  if ("skipped" in result) {
    expect(result.reason).toContain("already registered")
    expect(result.vaultId).toBe("existingid1234567")
  }
})

test("registerVaultWithObsidian registers new vault", async () => {
  const configPath = join(tempDir, "obsidian.json")
  await Bun.write(configPath, JSON.stringify({ vaults: {} }))

  const result = await registerVaultWithObsidian("/new/vault", configPath)
  expect("registered" in result && result.registered).toBe(true)
  if ("registered" in result) {
    expect(result.vaultId).toMatch(/^[a-f0-9]{16}$/)
  }

  const updated = JSON.parse(await Bun.file(configPath).text())
  const vaultIds = Object.keys(updated.vaults)
  expect(vaultIds.length).toBe(1)
  expect(updated.vaults[vaultIds[0]!].path).toBe("/new/vault")
})

test("registerVaultWithObsidian creates backup before writing", async () => {
  const configPath = join(tempDir, "obsidian.json")
  const original = { vaults: {}, someOtherField: true }
  await Bun.write(configPath, JSON.stringify(original))

  await registerVaultWithObsidian("/new/vault", configPath)

  const backup = JSON.parse(await Bun.file(`${configPath}.backup`).text())
  expect(backup.someOtherField).toBe(true)
  expect(Object.keys(backup.vaults).length).toBe(0)
})
