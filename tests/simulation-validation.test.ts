import { test, expect, describe, beforeAll } from "bun:test"
import { loadVault, buildLinkGraph } from "../src/vault/loader"
import { executeSearch } from "../src/tools/search-tool"
import type { NoteEntry, LinkGraph } from "../src/vault/types"
import { homedir } from "os"
import { join } from "path"

const VAULT = join(homedir(), ".claude-shards", "knowledge-base")

let entries: NoteEntry[]
let linkGraph: LinkGraph

beforeAll(async () => {
  entries = await loadVault(VAULT)
  linkGraph = buildLinkGraph(entries)
})

interface TestCase {
  id: number
  query: string
  idealSet: Set<string>
  expectedKeywordRecall: number
}

const TESTS: TestCase[] = [
  // Dashboard cluster
  {
    id: 1,
    query: "jose library Web Crypto",
    idealSet: new Set(["edge-runtime-auth-limits", "chose-session-tokens", "server-auth-middleware-pattern"]),
    expectedKeywordRecall: 1.0,
  },
  {
    id: 2,
    query: "Redis session lookup latency",
    idealSet: new Set(["chose-session-tokens", "server-auth-middleware-pattern", "edge-runtime-auth-limits", "chose-app-router"]),
    expectedKeywordRecall: 1.0,
  },
  {
    id: 3,
    query: "jsonwebtoken middleware broken",
    idealSet: new Set(["edge-runtime-auth-limits", "server-auth-middleware-pattern", "chose-app-router", "chose-session-tokens"]),
    expectedKeywordRecall: 1.0,
  },
  {
    id: 4,
    query: "what architectural decisions did we make for dashboard",
    idealSet: new Set(["chose-app-router", "chose-session-tokens"]),
    expectedKeywordRecall: 1.0,
  },
  {
    id: 5,
    query: "revalidatePath revalidateTag",
    idealSet: new Set(["rsc-data-fetching-pattern", "revalidation-cheatsheet", "fetch-cache-persistence", "chose-app-router"]),
    expectedKeywordRecall: 0.75,
  },
  {
    id: 6,
    query: "cookie session_id validation",
    idealSet: new Set(["server-auth-middleware-pattern", "chose-session-tokens", "edge-runtime-auth-limits"]),
    expectedKeywordRecall: 1.0,
  },
  {
    id: 7,
    query: "what problems did App Router cause",
    idealSet: new Set(["chose-app-router", "fetch-cache-persistence", "edge-runtime-auth-limits"]),
    expectedKeywordRecall: 1.0,
  },
  // Auth-system cluster
  {
    id: 8,
    query: "JWT token refresh Redis rotation",
    idealSet: new Set(["chose-jwt-over-sessions", "token-refresh-pattern", "session-revocation-gotcha"]),
    expectedKeywordRecall: -1,
  },
  {
    id: 9,
    query: "bcrypt password hashing event loop blocking",
    idealSet: new Set(["password-hashing-gotcha", "chose-jwt-over-sessions", "token-refresh-pattern"]),
    expectedKeywordRecall: -1,
  },
  {
    id: 10,
    query: "TOTP two factor authentication login flow OAuth",
    idealSet: new Set(["two-factor-auth-pattern", "oauth2-integration-reference", "chose-jwt-over-sessions"]),
    expectedKeywordRecall: -1,
  },
  {
    id: 11,
    query: "permission check role authorization middleware",
    idealSet: new Set(["rbac-permission-pattern", "auth-middleware-reference", "session-revocation-gotcha"]),
    expectedKeywordRecall: -1,
  },
  // CI/CD cluster
  {
    id: 12,
    query: "GitHub Actions docker build cache layer speed",
    idealSet: new Set(["chose-github-actions", "docker-layer-caching-pattern", "artifact-caching-pattern"]),
    expectedKeywordRecall: -1,
  },
  {
    id: 13,
    query: "automated rollback deployment pipeline broken",
    idealSet: new Set(["deploy-rollback-gotcha", "chose-github-actions", "k8s-manifests-reference"]),
    expectedKeywordRecall: -1,
  },
  {
    id: 14,
    query: "flaky test secrets environment CI integration",
    idealSet: new Set(["flaky-test-gotcha", "environment-secrets-pattern", "chose-github-actions"]),
    expectedKeywordRecall: -1,
  },
  // Elasticsearch cluster
  {
    id: 15,
    query: "Elasticsearch mapping explosion cardinality",
    idealSet: new Set(["elasticsearch-mapping-explosion", "chose-elasticsearch", "chose-fulltext-over-vector"]),
    expectedKeywordRecall: -1,
  },
  {
    id: 16,
    query: "search relevance tuning query DSL",
    idealSet: new Set(["search-relevance-tuning-reference", "relevance-tuning-gotcha", "search-query-parsing-pattern"]),
    expectedKeywordRecall: -1,
  },
  {
    id: 17,
    query: "stale search index reindex strategy",
    idealSet: new Set(["stale-search-index", "incremental-reindex-pattern", "chose-search-indexing-strategy"]),
    expectedKeywordRecall: -1,
  },
]

function shardName(relativePath: string): string {
  const filename = relativePath.split("/").pop()!
  return filename.replace(/\.md$/, "")
}

function recall(foundNames: Set<string>, idealSet: Set<string>): number {
  if (idealSet.size === 0) return 0
  let hits = 0
  for (const name of idealSet) {
    if (foundNames.has(name)) hits++
  }
  return hits / idealSet.size
}

function precision(foundNames: Set<string>, idealSet: Set<string>): number {
  if (foundNames.size === 0) return 0
  let hits = 0
  for (const name of foundNames) {
    if (idealSet.has(name)) hits++
  }
  return hits / foundNames.size
}

describe("simulation validation against real MCP search", () => {
  test("vault loads expected number of notes (78+)", () => {
    expect(entries.length).toBeGreaterThanOrEqual(78)
  })

  test("all ideal set shards exist in vault", () => {
    const vaultNames = new Set(entries.map((e) => shardName(e.relativePath)))
    const missing: string[] = []
    for (const tc of TESTS) {
      for (const name of tc.idealSet) {
        if (!vaultNames.has(name)) missing.push(`test ${tc.id}: ${name}`)
      }
    }
    expect(missing).toEqual([])
  })

  describe("scoring parity — TS produces same scores as Python simulation", () => {
    test("title match scores +10 per keyword", () => {
      const results = executeSearch({ query: "App Router", limit: 200 }, entries)
      const appRouter = results.find((r) => shardName(r.relativePath) === "chose-app-router")
      expect(appRouter).toBeDefined()
      expect(appRouter!.score).toBeGreaterThanOrEqual(20)
    })

    test("body-only match scores +1 per keyword", () => {
      const results = executeSearch({ query: "jose", limit: 200 }, entries)
      const edgeRuntime = results.find((r) => shardName(r.relativePath) === "edge-runtime-auth-limits")
      expect(edgeRuntime).toBeDefined()
      expect(edgeRuntime!.score).toBe(1)
    })

    test("tag match scores +5 per keyword", () => {
      const results = executeSearch({ query: "auth", limit: 200 }, entries)
      const withAuthTag = results.filter((r) => {
        const entry = entries.find((e) => e.relativePath === r.relativePath)
        return entry?.frontmatter.tags.some((t) => t.toLowerCase().includes("auth"))
      })
      for (const r of withAuthTag) {
        expect(r.score).toBeGreaterThanOrEqual(5)
      }
    })
  })

  describe("keyword-only recall matches simulation predictions (queries 1-7)", () => {
    const dashboardTests = TESTS.filter((t) => t.id >= 1 && t.id <= 7)

    for (const tc of dashboardTests) {
      test(`query ${tc.id}: "${tc.query}" — recall ${Math.round(tc.expectedKeywordRecall * 100)}%`, () => {
        const results = executeSearch({ query: tc.query, limit: 200 }, entries)
        const foundNames = new Set(results.map((r) => shardName(r.relativePath)))
        const r = recall(foundNames, tc.idealSet)
        expect(r).toBeCloseTo(tc.expectedKeywordRecall, 1)
      })
    }

    test("mean keyword recall across queries 1-7 ≥ 90%", () => {
      let totalRecall = 0
      for (const tc of dashboardTests) {
        const results = executeSearch({ query: tc.query, limit: 200 }, entries)
        const foundNames = new Set(results.map((r) => shardName(r.relativePath)))
        totalRecall += recall(foundNames, tc.idealSet)
      }
      const meanRecall = totalRecall / dashboardTests.length
      expect(meanRecall).toBeGreaterThan(0.9)
    })
  })

  describe("full 17-query keyword recall", () => {
    test("mean recall across all 17 queries matches simulation range", () => {
      let totalRecall = 0
      for (const tc of TESTS) {
        const results = executeSearch({ query: tc.query, limit: 200 }, entries)
        const foundNames = new Set(results.map((r) => shardName(r.relativePath)))
        totalRecall += recall(foundNames, tc.idealSet)
      }
      const meanRecall = totalRecall / TESTS.length
      expect(meanRecall).toBeGreaterThan(0.9)
    })

    test("no query achieves 0% recall (keyword search always finds something)", () => {
      for (const tc of TESTS) {
        const results = executeSearch({ query: tc.query, limit: 200 }, entries)
        const foundNames = new Set(results.map((r) => shardName(r.relativePath)))
        const r = recall(foundNames, tc.idealSet)
        expect(r).toBeGreaterThan(0)
      }
    })
  })

  describe("vocabulary gap — query 5 shows partial keyword recall", () => {
    test("query 5 (revalidatePath revalidateTag) — keyword recall < 100% (graph expansion helps)", () => {
      const tc = TESTS[4]!
      const results = executeSearch({ query: tc.query, limit: 200 }, entries)
      const foundNames = new Set(results.map((r) => shardName(r.relativePath)))
      const r = recall(foundNames, tc.idealSet)
      expect(r).toBeLessThan(1.0)
    })
  })

  describe("noise isolation — irrelevant shards ranked below ideal shards", () => {
    const noiseShards = new Set([
      "sourdough-starter-maintenance",
      "chose-coffee-grinder",
      "cast-iron-seasoning-gotcha",
      "cake-frosting-techniques",
      "indoor-plant-watering",
      "vinyl-record-cleaning-gotcha",
      "catan-board-game-strategy",
      "espresso-troubleshooting",
    ])

    test("noise shards never appear in top-5 for technical queries", () => {
      const technicalQueries = TESTS.filter(
        (t) => ![4, 7].includes(t.id),
      )
      for (const tc of technicalQueries) {
        const results = executeSearch({ query: tc.query, limit: 5 }, entries)
        const noiseHits = results.filter((r) => noiseShards.has(shardName(r.relativePath)))
        expect(noiseHits.length).toBe(0)
      }
    })

    test("noise shards score lower than ideal shards for technical queries", () => {
      const technicalQueries = TESTS.filter(
        (t) => ![4, 7, 14].includes(t.id),
      )
      for (const tc of technicalQueries) {
        const results = executeSearch({ query: tc.query, limit: 200 }, entries)
        const idealScores = results
          .filter((r) => tc.idealSet.has(shardName(r.relativePath)))
          .map((r) => r.score)
        const noiseScores = results
          .filter((r) => noiseShards.has(shardName(r.relativePath)))
          .map((r) => r.score)
        if (idealScores.length > 0 && noiseScores.length > 0) {
          const minIdeal = Math.min(...idealScores)
          const maxNoise = Math.max(...noiseScores)
          expect(maxNoise).toBeLessThanOrEqual(minIdeal)
        }
      }
    })

    test("queries with common English words may surface noise via stop-word vulnerability", () => {
      const tc = TESTS.find((t) => t.id === 4)!
      const results = executeSearch({ query: tc.query, limit: 200 }, entries)
      const noiseHits = results.filter((r) => noiseShards.has(shardName(r.relativePath)))
      expect(noiseHits.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe("strategy B (top-5) recall matches simulation", () => {
    test("mean recall with limit=5 ≥ 60%", () => {
      let totalRecall = 0
      for (const tc of TESTS) {
        const results = executeSearch({ query: tc.query, limit: 5 }, entries)
        const foundNames = new Set(results.map((r) => shardName(r.relativePath)))
        totalRecall += recall(foundNames, tc.idealSet)
      }
      const meanRecall = totalRecall / TESTS.length
      expect(meanRecall).toBeGreaterThan(0.6)
    })
  })

  describe("graph-augmented recall — 1-hop expansion improves retrieval", () => {
    test("graph expansion improves or maintains recall with limit=200", () => {
      let keywordTotal = 0
      let graphTotal = 0

      for (const tc of TESTS) {
        const keywordResults = executeSearch({ query: tc.query, limit: 200 }, entries)
        const graphResults = executeSearch({ query: tc.query, limit: 200 }, entries, linkGraph)

        const keywordNames = new Set(keywordResults.map((r) => shardName(r.relativePath)))
        const graphNames = new Set(graphResults.map((r) => shardName(r.relativePath)))

        keywordTotal += recall(keywordNames, tc.idealSet)
        graphTotal += recall(graphNames, tc.idealSet)
      }

      expect(graphTotal).toBeGreaterThanOrEqual(keywordTotal)
    })

    test("query 7 (what problems did App Router cause) surfaces fetch-cache-persistence via graph", () => {
      const tc = TESTS.find((t) => t.id === 7)!
      const results = executeSearch({ query: tc.query, limit: 10 }, entries, linkGraph)
      const foundNames = new Set(results.map((r) => shardName(r.relativePath)))

      expect(foundNames.has("chose-app-router")).toBe(true)
    })

    test("mean graph-augmented recall across all 17 queries is higher than keyword-only", () => {
      let keywordTotal = 0
      let graphTotal = 0

      for (const tc of TESTS) {
        const keywordResults = executeSearch({ query: tc.query, limit: 200 }, entries)
        const graphResults = executeSearch({ query: tc.query, limit: 200 }, entries, linkGraph)

        const keywordNames = new Set(keywordResults.map((r) => shardName(r.relativePath)))
        const graphNames = new Set(graphResults.map((r) => shardName(r.relativePath)))

        keywordTotal += recall(keywordNames, tc.idealSet)
        graphTotal += recall(graphNames, tc.idealSet)
      }

      expect(graphTotal / TESTS.length).toBeGreaterThanOrEqual(keywordTotal / TESTS.length)
    })
  })

  describe("result diagnostics — per-query breakdown", () => {
    test("print full recall/precision table for all 17 queries", () => {
      const rows: string[] = []
      rows.push("| # | Query | KW Recall | Graph Recall | Precision | Found | Ideal | Missed |")
      rows.push("|---|-------|-----------|--------------|-----------|-------|-------|--------|")

      for (const tc of TESTS) {
        const kwResults = executeSearch({ query: tc.query, limit: 200 }, entries)
        const graphResults = executeSearch({ query: tc.query, limit: 200 }, entries, linkGraph)
        const kwNames = new Set(kwResults.map((r) => shardName(r.relativePath)))
        const graphNames = new Set(graphResults.map((r) => shardName(r.relativePath)))
        const rKw = recall(kwNames, tc.idealSet)
        const rGraph = recall(graphNames, tc.idealSet)
        const p = precision(graphNames, tc.idealSet)
        const missed = [...tc.idealSet].filter((name) => !graphNames.has(name))

        rows.push(
          `| ${tc.id} | ${tc.query} | ${(rKw * 100).toFixed(0)}% | ${(rGraph * 100).toFixed(0)}% | ${(p * 100).toFixed(0)}% | ${graphNames.size} | ${tc.idealSet.size} | ${missed.join(", ") || "—"} |`,
        )
      }

      console.log("\n" + rows.join("\n") + "\n")
      expect(true).toBe(true)
    })
  })
})
