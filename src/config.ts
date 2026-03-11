import { homedir } from "os"
import { join } from "path"
import { readFileSync, mkdirSync, writeFileSync } from "fs"
import { parse, stringify } from "smol-toml"
import { z } from "zod"

export interface ShardsConfig {
  paths: {
    vaultPath: string
    shardsDir: string
    globalClaudeDir: string
    globalClaudeMd: string
    contextToml: string
  }
  noteTypeIcons: Record<string, string>
  noteTypePriority: Record<string, number>
  lifecycle: {
    staleDays: number
    deleteDays: number
    debounceMs: number
  }
  search: {
    semanticWeight: number
    candidateK: number
    alpha: number
    defaultLimit: number
  }
  similarity: {
    threshold: number
    slugMaxLen: number
    contextMaxLen: number
  }
  sync: {
    gatherMaxTokens: number
  }
  capture: {
    aggressiveness: number
  }
  discovery: {
    ignoreDirs: string[]
    extToTags: Record<string, string[]>
    techTags: Set<string>
  }
  display: {
    sectionTitle: string
    iconLegend: string
    architectureLegend: string
    instructionLine: string
  }
}

const PersistedConfigSchema = z.object({
  vault: z.object({ path: z.string().optional() }).optional(),
  search: z.object({
    semantic_weight: z.number().optional(),
    candidate_k: z.number().optional(),
    alpha: z.number().optional(),
    default_limit: z.number().optional(),
  }).optional(),
  similarity: z.object({
    threshold: z.number().optional(),
    slug_max_len: z.number().optional(),
    context_max_len: z.number().optional(),
  }).optional(),
  sync: z.object({
    gather_max_tokens: z.number().optional(),
  }).optional(),
  capture: z.object({
    capture_aggressiveness: z.number().optional(),
  }).optional(),
  auto_update: z.boolean().optional(),
})
export type PersistedConfig = z.infer<typeof PersistedConfigSchema>

export type ConfigEntry = {
  key: string
  section: string
  tomlPath: string[]
  type: "number" | "boolean"
  description: string
  defaultValue: number | boolean
}

export const CONFIGURABLE_KEYS: ConfigEntry[] = [
  { key: "search.semanticWeight", section: "Search", tomlPath: ["search", "semantic_weight"], type: "number", description: "How much to trust meaning-based search vs exact keyword matches (0 = pure keywords, 1 = pure meaning)", defaultValue: 0.35 },
  { key: "search.candidateK", section: "Search", tomlPath: ["search", "candidate_k"], type: "number", description: "How many notes to consider before picking the best ones. Higher means more thorough but slower", defaultValue: 50 },
  { key: "search.alpha", section: "Search", tomlPath: ["search", "alpha"], type: "number", description: "Multiplier for the link-graph bonus. Well-connected notes get a boost equal to alpha × link_bonus (0 = links ignored)", defaultValue: 0.3 },
  { key: "search.defaultLimit", section: "Search", tomlPath: ["search", "default_limit"], type: "number", description: "How many results to return. Claude can override this per-query", defaultValue: 10 },
  { key: "similarity.threshold", section: "Similarity", tomlPath: ["similarity", "threshold"], type: "number", description: "How similar two notes need to be before suggesting you update the existing one instead of creating a duplicate", defaultValue: 0.7 },
  { key: "similarity.slugMaxLen", section: "Similarity", tomlPath: ["similarity", "slug_max_len"], type: "number", description: "Max length for auto-generated filenames. Keeps paths readable and avoids filesystem issues", defaultValue: 60 },
  { key: "similarity.contextMaxLen", section: "Similarity", tomlPath: ["similarity", "context_max_len"], type: "number", description: "Max length for the short preview shown when comparing similar notes", defaultValue: 120 },
  { key: "sync.gatherMaxTokens", section: "Sync", tomlPath: ["sync", "gather_max_tokens"], type: "number", description: "Token budget for each gathered note. Lower means more concise synced notes, higher means more detail preserved", defaultValue: 250 },
  { key: "capture.aggressiveness", section: "Capture", tomlPath: ["capture", "capture_aggressiveness"], type: "number", description: "How aggressively Claude suggests capturing knowledge (0 = disabled, 1 = very aggressive)", defaultValue: 0.5 },
  { key: "auto_update", section: "Updates", tomlPath: ["auto_update"], type: "boolean", description: "Automatically update claude-shards on server startup", defaultValue: true },
]

export function loadPersistedConfig(shardsDir: string): PersistedConfig {
  try {
    const raw = readFileSync(join(shardsDir, "config.toml"), "utf-8")
    return PersistedConfigSchema.parse(parse(raw))
  } catch {
    return {}
  }
}

export function savePersistedConfig(shardsDir: string, config: PersistedConfig): void {
  mkdirSync(shardsDir, { recursive: true })
  const existing = loadPersistedConfig(shardsDir)
  const merged = { ...existing, ...config }
  writeFileSync(join(shardsDir, "config.toml"), stringify(merged as Record<string, unknown>))
}

export function getConfigValue(entry: ConfigEntry, persisted: PersistedConfig): number | boolean {
  if (entry.tomlPath.length === 1) {
    const val = (persisted as Record<string, unknown>)[entry.tomlPath[0]!]
    return val !== undefined ? val as number | boolean : entry.defaultValue
  }
  const section = (persisted as Record<string, Record<string, unknown> | undefined>)[entry.tomlPath[0]!]
  if (!section) return entry.defaultValue
  const val = section[entry.tomlPath[1]!]
  return val !== undefined ? val as number | boolean : entry.defaultValue
}

export function setConfigValue(persisted: PersistedConfig, entry: ConfigEntry, value: number | boolean): PersistedConfig {
  const clone = JSON.parse(JSON.stringify(persisted)) as Record<string, unknown>
  if (entry.tomlPath.length === 1) {
    clone[entry.tomlPath[0]!] = value
  } else {
    const section = (clone[entry.tomlPath[0]!] ?? {}) as Record<string, unknown>
    section[entry.tomlPath[1]!] = value
    clone[entry.tomlPath[0]!] = section
  }
  return clone as PersistedConfig
}

function resolveVaultPath(shardsDir: string, persisted: PersistedConfig): string {
  if (process.env.CLAUDE_SHARDS_VAULT_PATH) return process.env.CLAUDE_SHARDS_VAULT_PATH
  if (persisted.vault?.path) return persisted.vault.path
  return join(shardsDir, "knowledge-base")
}

export function createConfig(overrides?: Partial<ShardsConfig>): ShardsConfig {
  const shardsDir = overrides?.paths?.shardsDir ?? join(homedir(), ".claude-shards")
  const globalClaudeDir = overrides?.paths?.globalClaudeDir ?? join(homedir(), ".claude")
  const persisted = loadPersistedConfig(shardsDir)

  const defaults: ShardsConfig = {
    paths: {
      vaultPath: resolveVaultPath(shardsDir, persisted),
      shardsDir,
      globalClaudeDir,
      globalClaudeMd: join(globalClaudeDir, "CLAUDE.md"),
      contextToml: ".context.toml",
    },
    noteTypeIcons: {
      architecture: "🏗️",
      gotchas: "🔴",
      decisions: "🟤",
      patterns: "🔵",
      references: "🟢",
    },
    noteTypePriority: {
      architecture: -1,
      gotchas: 0,
      decisions: 1,
      patterns: 2,
      references: 3,
    },
    lifecycle: {
      staleDays: 30,
      deleteDays: 14,
      debounceMs: 300,
    },
    search: {
      semanticWeight: persisted.search?.semantic_weight ?? 0.35,
      candidateK: persisted.search?.candidate_k ?? 50,
      alpha: persisted.search?.alpha ?? 0.3,
      defaultLimit: persisted.search?.default_limit ?? 10,
    },
    similarity: {
      threshold: persisted.similarity?.threshold ?? 0.7,
      slugMaxLen: persisted.similarity?.slug_max_len ?? 60,
      contextMaxLen: persisted.similarity?.context_max_len ?? 120,
    },
    sync: {
      gatherMaxTokens: persisted.sync?.gather_max_tokens ?? 250,
    },
    capture: {
      aggressiveness: persisted.capture?.capture_aggressiveness ?? 0.5,
    },
    discovery: {
      ignoreDirs: ["node_modules", ".*", "target", "dist", "build"],
      extToTags: {
        rs: ["rust"],
        ts: ["typescript"],
        tsx: ["typescript", "react"],
        js: ["javascript"],
        jsx: ["javascript", "react"],
        vue: ["vue"],
        py: ["python"],
        go: ["go"],
        rb: ["ruby"],
        java: ["java"],
        kt: ["kotlin"],
        scala: ["scala"],
        cs: ["csharp"],
        cpp: ["cpp"],
        cc: ["cpp"],
        cxx: ["cpp"],
        c: ["c"],
        h: ["c"],
        swift: ["swift"],
        dart: ["dart", "flutter"],
        ex: ["elixir"],
        exs: ["elixir"],
        zig: ["zig"],
        hs: ["haskell"],
        php: ["php"],
        lua: ["lua"],
      },
      techTags: new Set([
        "bash", "c", "clojure", "cpp", "csharp", "css", "dart", "elixir", "erlang",
        "fsharp", "go", "haskell", "html", "java", "javascript", "kotlin", "lua",
        "ocaml", "perl", "php", "python", "ruby", "rust", "scala", "sql", "swift",
        "typescript", "zig",
        "angular", "astro", "bevy", "django", "docker", "electron", "express",
        "fastapi", "fastify", "flask", "flutter", "gatsby", "gin", "godot",
        "htmx", "kubernetes", "laravel", "nestjs", "nextjs", "nuxt", "rails",
        "react", "react-native", "remix", "solid", "spring", "svelte", "tailwind",
        "tauri", "unity", "unreal", "vue",
        "bun", "deno", "node", "nodejs",
      ]),
    },
    display: {
      sectionTitle: "## Knowledge Index",
      iconLegend: "🔴 = gotchas  🟤 = decisions  🔵 = patterns  🟢 = references",
      architectureLegend: "🏗️ = architecture  🔴 = gotchas  🟤 = decisions  🔵 = patterns  🟢 = references",
      instructionLine: "Notes listed here are auto-loaded into context. Use `search` to find other vault notes.",
    },
  }

  if (!overrides) return Object.freeze(defaults)

  return Object.freeze({
    paths: { ...defaults.paths, ...overrides.paths },
    noteTypeIcons: overrides.noteTypeIcons ?? defaults.noteTypeIcons,
    noteTypePriority: overrides.noteTypePriority ?? defaults.noteTypePriority,
    lifecycle: { ...defaults.lifecycle, ...overrides.lifecycle },
    search: { ...defaults.search, ...overrides.search },
    similarity: { ...defaults.similarity, ...overrides.similarity },
    sync: { ...defaults.sync, ...overrides.sync },
    capture: { ...defaults.capture, ...overrides.capture },
    discovery: { ...defaults.discovery, ...overrides.discovery },
    display: { ...defaults.display, ...overrides.display },
  })
}

const config = createConfig()
export default config
