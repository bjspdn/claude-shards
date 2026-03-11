import { test, expect } from "bun:test"
import { createConfig, type ShardsConfig } from "../src/config"
import { homedir } from "os"
import { join } from "path"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"

function isolatedConfig(overrides?: Partial<ShardsConfig>) {
  const dir = mkdtempSync(join(tmpdir(), "shards-test-"))
  return createConfig({ paths: { shardsDir: dir, vaultPath: join(dir, "knowledge-base"), globalClaudeDir: join(dir, ".claude"), globalClaudeMd: join(dir, ".claude", "CLAUDE.md"), contextToml: ".context.toml" }, ...overrides })
}

test("createConfig returns frozen defaults", () => {
  const cfg = isolatedConfig()
  expect(Object.isFrozen(cfg)).toBe(true)
  expect(cfg.paths.vaultPath).toContain("knowledge-base")
  expect(cfg.paths.contextToml).toBe(".context.toml")
})

test("createConfig has correct note type icons and priorities", () => {
  const cfg = isolatedConfig()
  expect(cfg.noteTypeIcons.gotchas).toBe("🔴")
  expect(cfg.noteTypeIcons.decisions).toBe("🟤")
  expect(cfg.noteTypeIcons.patterns).toBe("🔵")
  expect(cfg.noteTypeIcons.references).toBe("🟢")
  expect(cfg.noteTypePriority.gotchas).toBe(0)
  expect(cfg.noteTypePriority.references).toBe(3)
})

test("createConfig has correct lifecycle defaults", () => {
  const cfg = isolatedConfig()
  expect(cfg.lifecycle.staleDays).toBe(30)
  expect(cfg.lifecycle.deleteDays).toBe(14)
  expect(cfg.lifecycle.debounceMs).toBe(300)
})

test("createConfig has correct search defaults", () => {
  const cfg = isolatedConfig()
  expect(cfg.search.semanticWeight).toBe(0.35)
  expect(cfg.search.candidateK).toBe(50)
  expect(cfg.search.alpha).toBe(0.3)
  expect(cfg.search.defaultLimit).toBe(10)
})

test("createConfig has correct similarity defaults", () => {
  const cfg = isolatedConfig()
  expect(cfg.similarity.threshold).toBe(0.7)
  expect(cfg.similarity.slugMaxLen).toBe(60)
  expect(cfg.similarity.contextMaxLen).toBe(120)
})

test("createConfig has correct discovery defaults", () => {
  const cfg = isolatedConfig()
  expect(cfg.discovery.ignoreDirs).toContain("node_modules")
  expect(cfg.discovery.extToTags.rs).toEqual(["rust"])
  expect(cfg.discovery.extToTags.tsx).toEqual(["typescript", "react"])
  expect(cfg.discovery.techTags.has("typescript")).toBe(true)
  expect(cfg.discovery.techTags.has("react")).toBe(true)
})

test("createConfig has correct display defaults", () => {
  const cfg = isolatedConfig()
  expect(cfg.display.sectionTitle).toBe("## Knowledge Index")
  expect(cfg.display.iconLegend).toContain("🔴 = gotchas")
  expect(cfg.display.instructionLine).toContain("auto-loaded into context")
})

test("createConfig merges overrides per group", () => {
  const cfg = createConfig({
    lifecycle: { staleDays: 60, deleteDays: 14, debounceMs: 300 },
    search: { semanticWeight: 0.5, candidateK: 50, alpha: 0.3, defaultLimit: 10 },
  })
  expect(cfg.lifecycle.staleDays).toBe(60)
  expect(cfg.lifecycle.deleteDays).toBe(14)
  expect(cfg.search.semanticWeight).toBe(0.5)
  expect(cfg.paths.vaultPath).toContain("knowledge-base")
})

test("createConfig allows overriding vault path via paths", () => {
  const cfg = createConfig({
    paths: {
      vaultPath: "/tmp/test-vault",
      shardsDir: "/tmp/.claude-shards",
      globalClaudeDir: "/tmp/.claude",
      globalClaudeMd: "/tmp/.claude/CLAUDE.md",
      contextToml: ".context.toml",
    },
  })
  expect(cfg.paths.vaultPath).toBe("/tmp/test-vault")
  expect(cfg.paths.shardsDir).toBe("/tmp/.claude-shards")
})
