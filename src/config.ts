import { homedir } from "os"
import { join } from "path"
import { parse } from "smol-toml"
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
  discovery: {
    ignoreDirs: string[]
    extToTags: Record<string, string[]>
    techTags: Set<string>
  }
  display: {
    sectionTitle: string
    iconLegend: string
    instructionLine: string
  }
}

const PersistedConfigSchema = z.object({
  vault: z.object({ path: z.string().optional() }).optional(),
})
function loadPersistedVaultPath(shardsDir: string): string | undefined {
  try {
    const raw = require("fs").readFileSync(join(shardsDir, "config.toml"), "utf-8")
    const parsed = PersistedConfigSchema.parse(parse(raw))
    return parsed.vault?.path
  } catch {
    return undefined
  }
}

function resolveVaultPath(shardsDir: string): string {
  if (process.env.CLAUDE_SHARDS_VAULT_PATH) return process.env.CLAUDE_SHARDS_VAULT_PATH
  const persisted = loadPersistedVaultPath(shardsDir)
  if (persisted) return persisted
  return join(shardsDir, "knowledge-base")
}

export function createConfig(overrides?: Partial<ShardsConfig>): ShardsConfig {
  const shardsDir = overrides?.paths?.shardsDir ?? join(homedir(), ".claude-shards")
  const globalClaudeDir = overrides?.paths?.globalClaudeDir ?? join(homedir(), ".claude")

  const defaults: ShardsConfig = {
    paths: {
      vaultPath: resolveVaultPath(shardsDir),
      shardsDir,
      globalClaudeDir,
      globalClaudeMd: join(globalClaudeDir, "CLAUDE.md"),
      contextToml: ".context.toml",
    },
    noteTypeIcons: {
      gotchas: "🔴",
      decisions: "🟤",
      patterns: "🔵",
      references: "🟢",
    },
    noteTypePriority: {
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
      semanticWeight: 0.35,
      candidateK: 50,
      alpha: 0.3,
      defaultLimit: 10,
    },
    similarity: {
      threshold: 0.7,
      slugMaxLen: 60,
      contextMaxLen: 120,
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
      instructionLine: "Use MCP tool `read` with the note path to fetch full details on demand.",
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
    discovery: { ...defaults.discovery, ...overrides.discovery },
    display: { ...defaults.display, ...overrides.display },
  })
}

const config = createConfig()
export default config
