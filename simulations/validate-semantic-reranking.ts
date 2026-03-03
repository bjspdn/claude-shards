import { loadVault, buildLinkGraph } from "../src/vault/loader"
import { executeSearch } from "../src/tools/search-tool"
import { buildIdfTable } from "../src/tools/bm25"
import { warmup, encode, isReady, buildEmbeddingIndex } from "../src/embeddings"
import { join } from "path"
import { homedir } from "os"
import type { NoteEntry, LinkGraph } from "../src/vault/types"
import type { IdfTable } from "../src/tools/bm25"
import type { EmbeddingIndex } from "../src/embeddings/types"

const VAULT_10K = join(homedir(), ".claude-shards", "vault-10k")
const VAULT_78 = join(homedir(), ".claude-shards", "knowledge-base")

interface IdealSet {
  query: string
  shards: Set<string>
}

const QUERIES: IdealSet[] = [
  {
    query: "jose library Web Crypto",
    shards: new Set(["edge-runtime-auth-limits", "chose-session-tokens", "server-auth-middleware-pattern"]),
  },
  {
    query: "Redis session lookup latency",
    shards: new Set(["chose-session-tokens", "server-auth-middleware-pattern", "edge-runtime-auth-limits", "chose-app-router"]),
  },
  {
    query: "jsonwebtoken middleware broken",
    shards: new Set(["edge-runtime-auth-limits", "server-auth-middleware-pattern", "chose-app-router", "chose-session-tokens"]),
  },
  {
    query: "what architectural decisions did we make for dashboard",
    shards: new Set(["chose-app-router", "chose-session-tokens"]),
  },
  {
    query: "revalidatePath revalidateTag",
    shards: new Set(["rsc-data-fetching-pattern", "revalidation-cheatsheet", "fetch-cache-persistence", "chose-app-router"]),
  },
  {
    query: "cookie session_id validation",
    shards: new Set(["server-auth-middleware-pattern", "chose-session-tokens", "edge-runtime-auth-limits"]),
  },
  {
    query: "what problems did App Router cause",
    shards: new Set(["chose-app-router", "fetch-cache-persistence", "edge-runtime-auth-limits"]),
  },
]

function shardName(relativePath: string): string {
  return relativePath.replace(/\.md$/, "").split("/").pop()!
}

function hr(label: string) {
  console.log(`\n${"=".repeat(72)}`)
  console.log(` ${label}`)
  console.log("=".repeat(72))
}

function pct(n: number, d: number): string {
  if (d === 0) return "N/A"
  return `${((n / d) * 100).toFixed(1)}%`
}

function recall(found: Set<string>, ideal: Set<string>): number {
  if (ideal.size === 0) return 0
  let hits = 0
  for (const name of ideal) if (found.has(name)) hits++
  return hits / ideal.size
}

function precision(found: Set<string>, ideal: Set<string>): number {
  if (found.size === 0) return 0
  let hits = 0
  for (const name of found) if (ideal.has(name)) hits++
  return hits / found.size
}

async function main() {
  hr("LOADING VAULTS + EMBEDDINGS")

  const t0 = performance.now()
  const entries10k = await loadVault(VAULT_10K)
  console.log(`10k vault: ${entries10k.length} notes in ${(performance.now() - t0).toFixed(0)}ms`)

  const entries78 = await loadVault(VAULT_78)
  console.log(`78-shard vault: ${entries78.length} notes`)

  const existing10kSlugs = new Set(entries10k.map((e) => shardName(e.relativePath)))
  let merged = 0
  const entries = [...entries10k]
  for (const e of entries78) {
    if (!existing10kSlugs.has(shardName(e.relativePath))) {
      entries.push(e)
      merged++
    }
  }
  console.log(`Merged corpus: ${entries.length} notes`)

  const linkGraph = buildLinkGraph(entries)
  const idfTable = buildIdfTable(entries)

  console.log(`\nInitializing embedder...`)
  const t1 = performance.now()
  await warmup()
  console.log(`Embedder warmup: ${(performance.now() - t1).toFixed(0)}ms`)

  const t2 = performance.now()
  const embeddingIndex = await buildEmbeddingIndex(entries, VAULT_10K)
  console.log(`Embedding index: ${embeddingIndex.size} vectors in ${(performance.now() - t2).toFixed(0)}ms`)

  // =========================================================================
  // R@10 COMPARISON: BM25 vs BM25+Graph vs BM25+Graph+Semantic
  // =========================================================================
  hr("R@10 COMPARISON (BM25 vs BM25+Graph vs BM25+Graph+Semantic)")

  console.log("\n| # | Query | BM25 R@10 | +Graph R@10 | +Semantic R@10 | BM25 P@10 | +Sem P@10 |")
  console.log("|---|-------|-----------|-------------|----------------|-----------|-----------|")

  let bm25RecallTotal = 0
  let graphRecallTotal = 0
  let semRecallTotal = 0
  let bm25PrecTotal = 0
  let semPrecTotal = 0

  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i]!

    const bm25Results = executeSearch({ query: q.query, limit: 10 }, entries, undefined, idfTable)
    const graphResults = executeSearch({ query: q.query, limit: 10 }, entries, linkGraph, idfTable)

    const qEmb = await encode(q.query)
    const semResults = executeSearch({ query: q.query, limit: 10 }, entries, linkGraph, idfTable, embeddingIndex, qEmb)

    const bm25Names = new Set(bm25Results.map((r) => shardName(r.relativePath)))
    const graphNames = new Set(graphResults.map((r) => shardName(r.relativePath)))
    const semNames = new Set(semResults.map((r) => shardName(r.relativePath)))

    const rBm25 = recall(bm25Names, q.shards)
    const rGraph = recall(graphNames, q.shards)
    const rSem = recall(semNames, q.shards)

    const pBm25 = precision(bm25Names, q.shards)
    const pSem = precision(semNames, q.shards)

    bm25RecallTotal += rBm25
    graphRecallTotal += rGraph
    semRecallTotal += rSem
    bm25PrecTotal += pBm25
    semPrecTotal += pSem

    const semDelta = rSem > rGraph ? " +" : rSem < rGraph ? " -" : ""

    console.log(
      `| Q${i + 1} | ${q.query.slice(0, 45)}${q.query.length > 45 ? "..." : ""} | ${pct(rBm25 * q.shards.size, q.shards.size)} | ${pct(rGraph * q.shards.size, q.shards.size)} | ${pct(rSem * q.shards.size, q.shards.size)}${semDelta} | ${pct(pBm25 * 10, 10)} | ${pct(pSem * 10, 10)} |`,
    )
  }

  const n = QUERIES.length
  console.log(`\nMean R@10  — BM25: ${((bm25RecallTotal / n) * 100).toFixed(1)}%  +Graph: ${((graphRecallTotal / n) * 100).toFixed(1)}%  +Semantic: ${((semRecallTotal / n) * 100).toFixed(1)}%`)
  console.log(`Mean P@10  — BM25: ${((bm25PrecTotal / n) * 100).toFixed(1)}%  +Semantic: ${((semPrecTotal / n) * 100).toFixed(1)}%`)

  // =========================================================================
  // P@5 COMPARISON
  // =========================================================================
  hr("P@5 COMPARISON (BM25+Graph vs BM25+Graph+Semantic)")

  console.log("\n| # | Query | BM25 P@5 | +Sem P@5 | BM25 top-5 | Sem top-5 |")
  console.log("|---|-------|----------|----------|------------|-----------|")

  let bm25P5Total = 0
  let semP5Total = 0

  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i]!

    const bm25Top5 = executeSearch({ query: q.query, limit: 5 }, entries, linkGraph, idfTable)
    const qEmb = await encode(q.query)
    const semTop5 = executeSearch({ query: q.query, limit: 5 }, entries, linkGraph, idfTable, embeddingIndex, qEmb)

    const bm25Names = new Set(bm25Top5.map((r) => shardName(r.relativePath)))
    const semNames = new Set(semTop5.map((r) => shardName(r.relativePath)))

    const pBm25 = precision(bm25Names, q.shards)
    const pSem = precision(semNames, q.shards)

    bm25P5Total += pBm25
    semP5Total += pSem

    const bm25Slugs = bm25Top5.map((r) => shardName(r.relativePath)).join(", ")
    const semSlugs = semTop5.map((r) => shardName(r.relativePath)).join(", ")

    console.log(
      `| Q${i + 1} | ${q.query.slice(0, 35)}${q.query.length > 35 ? "..." : ""} | ${(pBm25 * 100).toFixed(0)}% | ${(pSem * 100).toFixed(0)}% | ${bm25Slugs.slice(0, 60)}... | ${semSlugs.slice(0, 60)}... |`,
    )
  }

  console.log(`\nMean P@5  — BM25+Graph: ${((bm25P5Total / n) * 100).toFixed(1)}%  BM25+Graph+Semantic: ${((semP5Total / n) * 100).toFixed(1)}%`)

  // =========================================================================
  // R@10 COMPARISON vs FINDINGS BASELINES
  // =========================================================================
  hr("COMPARISON vs FINDINGS.local.md BASELINES")

  const meanBm25R10 = (bm25RecallTotal / n) * 100
  const meanGraphR10 = (graphRecallTotal / n) * 100
  const meanSemR10 = (semRecallTotal / n) * 100
  const meanBm25P5 = (bm25P5Total / n) * 100
  const meanSemP5 = (semP5Total / n) * 100

  console.log("\n| Metric | Substring (S6.3) | BM25 (S7.6) | BM25+Graph+Sem (now) |")
  console.log("|--------|-----------------|-------------|----------------------|")
  console.log(`| Mean R@10 (Q1-7) | 69% | 48.8% | ${meanSemR10.toFixed(1)}% |`)
  console.log(`| Mean P@5 | — | — | ${meanSemP5.toFixed(1)}% |`)

  // =========================================================================
  // DETAILED TOP-10 FOR WORST QUERIES
  // =========================================================================
  hr("DETAILED TOP-10: WORST PERFORMING QUERIES")

  const worstIndices = [1, 2, 3, 6] // Q2, Q3, Q4, Q7 (0-indexed)
  for (const idx of worstIndices) {
    const q = QUERIES[idx]!
    const qEmb = await encode(q.query)

    const bm25Results = executeSearch({ query: q.query, limit: 10 }, entries, linkGraph, idfTable)
    const semResults = executeSearch({ query: q.query, limit: 10 }, entries, linkGraph, idfTable, embeddingIndex, qEmb)

    console.log(`\nQ${idx + 1}: "${q.query}"`)
    console.log(`Ideal: ${[...q.shards].join(", ")}`)
    console.log(`\n  BM25+Graph top-10:`)
    for (let i = 0; i < bm25Results.length; i++) {
      const r = bm25Results[i]!
      const slug = shardName(r.relativePath)
      const marker = q.shards.has(slug) ? " <<<" : ""
      console.log(`    ${i + 1}. ${slug} (${r.score.toFixed(2)})${marker}`)
    }
    console.log(`  BM25+Graph+Semantic top-10:`)
    for (let i = 0; i < semResults.length; i++) {
      const r = semResults[i]!
      const slug = shardName(r.relativePath)
      const marker = q.shards.has(slug) ? " <<<" : ""
      console.log(`    ${i + 1}. ${slug} (${r.score.toFixed(4)})${marker}`)
    }
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  hr("SUMMARY")

  console.log(`\nCorpus: ${entries.length} notes`)
  console.log(`Embedding index: ${embeddingIndex.size} vectors`)
  console.log(`\nMean R@10  — BM25: ${meanBm25R10.toFixed(1)}%  +Graph: ${meanGraphR10.toFixed(1)}%  +Semantic: ${meanSemR10.toFixed(1)}%`)
  console.log(`Mean P@5   — BM25+Graph: ${meanBm25P5.toFixed(1)}%  +Semantic: ${meanSemP5.toFixed(1)}%`)

  const r10Delta = meanSemR10 - meanGraphR10
  const p5Delta = meanSemP5 - meanBm25P5
  console.log(`\nSemantic re-ranking delta:`)
  console.log(`  R@10: ${r10Delta >= 0 ? "+" : ""}${r10Delta.toFixed(1)}pp`)
  console.log(`  P@5:  ${p5Delta >= 0 ? "+" : ""}${p5Delta.toFixed(1)}pp`)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
