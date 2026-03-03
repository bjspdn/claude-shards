import { loadVault, buildLinkGraph } from "../src/vault/loader"
import { executeSearch } from "../src/tools/search-tool"
import { buildIdfTable, scoreBM25 } from "../src/tools/bm25"
import { join } from "path"
import { homedir } from "os"
import type { NoteEntry, LinkGraph } from "../src/vault/types"
import type { IdfTable } from "../src/tools/bm25"

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

function verdict(oldVal: number, newVal: number, higherIsBetter: boolean): string {
  const diff = newVal - oldVal
  if (Math.abs(diff) < 0.5) return "SAME"
  return (higherIsBetter ? diff > 0 : diff < 0) ? "IMPROVED" : "REGRESSED"
}

function pct(n: number, d: number): string {
  if (d === 0) return "N/A"
  return `${((n / d) * 100).toFixed(1)}%`
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function recallAtK(
  query: string,
  idealShards: Set<string>,
  entries: NoteEntry[],
  linkGraph: LinkGraph | undefined,
  idf: IdfTable,
  k: number,
): { recall: number; found: string[]; missed: string[] } {
  const results = executeSearch({ query, limit: k }, entries, linkGraph, idf)
  const returnedSlugs = new Set(results.map((r) => shardName(r.relativePath)))
  const found: string[] = []
  const missed: string[] = []
  for (const ideal of idealShards) {
    if (returnedSlugs.has(ideal)) found.push(ideal)
    else missed.push(ideal)
  }
  return { recall: found.length / idealShards.size, found, missed }
}

function scoreAllEntries(
  query: string,
  entries: NoteEntry[],
  idf: IdfTable,
): { total: number; positive: number; scores: Map<string, number> } {
  const keywords = query.split(/\s+/).filter(Boolean)
  const scores = new Map<string, number>()
  let positive = 0
  for (const entry of entries) {
    const s = scoreBM25(entry, keywords, idf)
    scores.set(shardName(entry.relativePath), s)
    if (s > 0) positive++
  }
  return { total: entries.length, positive, scores }
}

async function main() {
  hr("LOADING VAULTS")

  const t0 = performance.now()
  const entries10k = await loadVault(VAULT_10K)
  const load10kMs = performance.now() - t0
  console.log(`10k vault: ${entries10k.length} notes in ${load10kMs.toFixed(0)} ms`)

  const t1 = performance.now()
  const entries78 = await loadVault(VAULT_78)
  const load78Ms = performance.now() - t1
  console.log(`78-shard vault: ${entries78.length} notes in ${load78Ms.toFixed(0)} ms`)

  const existing10kSlugs = new Set(entries10k.map((e) => shardName(e.relativePath)))
  let merged = 0
  const entries = [...entries10k]
  for (const e of entries78) {
    const slug = shardName(e.relativePath)
    if (!existing10kSlugs.has(slug)) {
      entries.push(e)
      merged++
    }
  }
  console.log(`Merged corpus: ${entries.length} notes (${merged} unique from 78-shard vault added)`)

  const linkGraph = buildLinkGraph(entries)
  const idfTable = buildIdfTable(entries)
  console.log(`IDF table: ${idfTable.idf.size} tokens, N=${idfTable.N}`)
  console.log(`Link graph: ${linkGraph.forward.size} sources, ${[...linkGraph.forward.values()].reduce((s, v) => s + v.size, 0)} edges`)

  const idealSlugs = new Set<string>()
  for (const q of QUERIES) for (const s of q.shards) idealSlugs.add(s)
  const foundInVault = new Set<string>()
  for (const entry of entries) {
    const slug = shardName(entry.relativePath)
    if (idealSlugs.has(slug)) foundInVault.add(slug)
  }
  const missing = [...idealSlugs].filter((s) => !foundInVault.has(s))
  if (missing.length > 0) {
    console.log(`\nWARNING: ${missing.length} ideal shards NOT FOUND in merged corpus:`)
    for (const m of missing) console.log(`  - ${m}`)
    console.log(`Recall checks will be unreliable for queries referencing missing shards.`)
  } else {
    console.log(`\nAll ${idealSlugs.size} ideal shards found in merged corpus.`)
  }

  // =========================================================================
  // CHECK 1: R@10 at N=10k
  // =========================================================================
  hr("CHECK 1: R@10 at N~10k (old substring prediction: 69%)")

  console.log("\n| # | Query | Ideal | Found@10 | R@10 | Missed |")
  console.log("|---|-------|-------|----------|------|--------|")

  let totalRecall = 0
  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i]!
    const { recall, found, missed } = recallAtK(q.query, q.shards, entries, undefined, idfTable, 10)
    totalRecall += recall
    const missedStr = missed.length > 0 ? missed.join(", ") : "-"
    console.log(
      `| Q${i + 1} | ${q.query} | ${q.shards.size} | ${found.length} | ${pct(found.length, q.shards.size)} | ${missedStr} |`,
    )
  }

  const meanRecall = (totalRecall / QUERIES.length) * 100
  console.log(`\nMean R@10 under BM25: ${meanRecall.toFixed(1)}%`)
  console.log(`Old substring prediction at N=10k: 69%`)
  console.log(`Python BM25 sim prediction at N=10k: 89%`)
  console.log(`Verdict vs substring: ${verdict(69, meanRecall, true)}`)
  console.log(`Verdict vs Python sim: ${verdict(89, meanRecall, true)}`)

  // =========================================================================
  // CHECK 2: Notes scoring > 0 (old: 53%)
  // =========================================================================
  hr("CHECK 2: Notes scoring > 0 for Q4 (old substring prediction: ~53%)")

  const q4 = QUERIES[3]!
  const q4Scores = scoreAllEntries(q4.query, entries, idfTable)
  const q4Pct = (q4Scores.positive / q4Scores.total) * 100

  console.log(`\nQuery: "${q4.query}"`)
  console.log(`Notes scoring > 0: ${q4Scores.positive} / ${q4Scores.total} (${q4Pct.toFixed(1)}%)`)
  console.log(`Old substring prediction: ~53% (~5,300 notes)`)
  console.log(`Verdict: ${verdict(53, q4Pct, false)}`)

  // =========================================================================
  // CHECK 3: FM-2 Q4 stopword flooding (old: 9,990/10,000)
  // =========================================================================
  hr("CHECK 3: FM-2 Q4 stopword flooding (old substring: 9,990/10,000 notes)")

  console.log(`\nQuery: "${q4.query}"`)
  console.log(`Notes scoring > 0 under BM25: ${q4Scores.positive} / ${q4Scores.total}`)
  console.log(`Old substring scorer: 9,990 / 10,000`)
  const reduction = ((1 - q4Scores.positive / 9990) * 100)
  console.log(`Reduction: ${reduction.toFixed(1)}%`)
  console.log(`Verdict: ${verdict(9990, q4Scores.positive, false)}`)

  console.log(`\nPer-keyword IDF analysis for Q4:`)
  const q4kw = q4.query.split(/\s+/).filter(Boolean)
  for (const kw of q4kw) {
    const kwLower = kw.toLowerCase()
    const idfVal = idfTable.idf.get(kwLower) ?? 0
    console.log(`  "${kw}" -> IDF = ${idfVal.toFixed(4)}${idfVal <= 0 ? " (SUPPRESSED)" : ""}`)
  }

  // =========================================================================
  // CHECK 4: Signal-to-noise ratio (old: 5.0x)
  // =========================================================================
  hr("CHECK 4: Signal-to-noise ratio (old substring: 5.0x)")

  console.log("\n| # | Query | Ideal Median | Non-Ideal Median | SNR |")
  console.log("|---|-------|-------------|-----------------|-----|")

  const snrValues: number[] = []
  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i]!
    const allScores = scoreAllEntries(q.query, entries, idfTable)

    const idealScores: number[] = []
    const nonIdealScores: number[] = []
    for (const [slug, score] of allScores.scores) {
      if (q.shards.has(slug)) idealScores.push(score)
      else if (score > 0) nonIdealScores.push(score)
    }

    const idealMed = median(idealScores)
    const nonIdealMed = median(nonIdealScores)
    const snr = nonIdealMed > 0 ? idealMed / nonIdealMed : Infinity
    if (snr !== Infinity && snr > 0) snrValues.push(snr)

    console.log(
      `| Q${i + 1} | ${q.query.slice(0, 40)}${q.query.length > 40 ? "..." : ""} | ${idealMed.toFixed(2)} | ${nonIdealMed.toFixed(2)} | ${snr === Infinity ? "Inf" : snr.toFixed(1) + "x"} |`,
    )
  }

  const meanSnr = snrValues.length > 0 ? snrValues.reduce((a, b) => a + b, 0) / snrValues.length : 0
  console.log(`\nMean SNR (finite, non-zero queries): ${meanSnr.toFixed(1)}x  (${snrValues.length}/${QUERIES.length} queries)`)
  console.log(`Old substring SNR: 5.0x`)
  console.log(`Python BM25 sim SNR at 10k: 9.2x`)
  console.log(`Verdict vs substring: ${verdict(5.0, meanSnr, true)}`)

  // =========================================================================
  // CHECK 5: Graph augmentation effectiveness
  // =========================================================================
  hr("CHECK 5: Graph augmentation effectiveness under BM25")

  console.log("\n| # | Query | R@10 (no graph) | R@10 (graph) | Top-10 changed? | Ranking changed? |")
  console.log("|---|-------|-----------------|-------------|-----------------|-----------------|")

  let graphHelped = 0
  let graphChangedRanking = 0
  let graphTotal = 0
  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i]!

    const noGraph = recallAtK(q.query, q.shards, entries, undefined, idfTable, 10)
    const withGraph = recallAtK(q.query, q.shards, entries, linkGraph, idfTable, 10)

    const noGraphResults = executeSearch({ query: q.query, limit: 10 }, entries, undefined, idfTable)
    const graphResults = executeSearch({ query: q.query, limit: 10 }, entries, linkGraph, idfTable)

    const noGraphSlugs = noGraphResults.map((r) => shardName(r.relativePath)).join(",")
    const graphSlugs = graphResults.map((r) => shardName(r.relativePath)).join(",")
    const setChanged = noGraphSlugs !== graphSlugs ? "YES" : "no"

    const noGraphOrder = noGraphResults.map((r) => `${shardName(r.relativePath)}:${r.score.toFixed(2)}`).join(",")
    const graphOrder = graphResults.map((r) => `${shardName(r.relativePath)}:${r.score.toFixed(2)}`).join(",")
    const rankChanged = noGraphOrder !== graphOrder ? "YES" : "no"

    if (withGraph.recall > noGraph.recall) graphHelped++
    if (rankChanged === "YES") graphChangedRanking++
    graphTotal++

    console.log(
      `| Q${i + 1} | ${q.query.slice(0, 40)}${q.query.length > 40 ? "..." : ""} | ${pct(noGraph.found.length, q.shards.size)} | ${pct(withGraph.found.length, q.shards.size)} | ${setChanged} | ${rankChanged} |`,
    )
  }

  console.log(`\nGraph improved recall in ${graphHelped}/${graphTotal} queries`)
  console.log(`Graph changed ranking in ${graphChangedRanking}/${graphTotal} queries`)
  console.log(`Old observation: graph augmentation showed zero differentiation at 10k under substring (Section 6.3)`)
  if (graphHelped > 0) {
    console.log(`Verdict: IMPROVED — BM25 unblocks graph augmentation as Section 6.6 predicted`)
  } else if (graphChangedRanking > 0) {
    console.log(`Verdict: PARTIAL — graph changes ranking/scores but doesn't improve recall@10`)
  } else {
    console.log(`Verdict: SAME — graph augmentation still has no effect`)
  }

  // =========================================================================
  // CHECK 6: FM-5 React keyword collision
  // =========================================================================
  hr("CHECK 6: FM-5 React keyword collision")

  const reactQuery = "React hooks state management"
  const reactResults = executeSearch({ query: reactQuery, limit: 10 }, entries, linkGraph, idfTable)

  console.log(`\nQuery: "${reactQuery}"`)
  console.log(`\nTop 10 results:`)
  console.log("| # | Score | Title | Path | Tag |")
  console.log("|---|-------|-------|------|-----|")
  let reactRelated = 0
  let gitHooksRelated = 0
  for (let i = 0; i < reactResults.length; i++) {
    const r = reactResults[i]!
    const titleLower = r.title.toLowerCase()
    const pathLower = r.relativePath.toLowerCase()
    const isReact =
      titleLower.includes("react") ||
      titleLower.includes("component") ||
      titleLower.includes("jsx") ||
      titleLower.includes("redux") ||
      titleLower.includes("zustand") ||
      titleLower.includes("state management") ||
      titleLower.includes("state") ||
      pathLower.includes("frontend") ||
      pathLower.includes("react")
    const isGitHooks =
      titleLower.includes("git") ||
      titleLower.includes("pre-commit") ||
      titleLower.includes("husky") ||
      (titleLower.includes("hook") && !titleLower.includes("react"))

    if (isReact) reactRelated++
    if (isGitHooks) gitHooksRelated++

    const tag = isReact ? "[React]" : isGitHooks ? "[git-hooks]" : "[other]"
    console.log(`| ${i + 1} | ${r.score.toFixed(2)} | ${r.title} | ${r.relativePath} | ${tag} |`)
  }

  console.log(`\nReact-related in top 10: ${reactRelated}`)
  console.log(`Git-hooks related in top 10: ${gitHooksRelated}`)
  console.log(`Other in top 10: ${10 - reactRelated - gitHooksRelated}`)
  console.log(`Old observation: "hooks" matched git-hooks notes under substring (Section 6.3)`)
  if (reactRelated > gitHooksRelated && reactRelated >= 5) {
    console.log(`Verdict: IMPROVED — BM25 IDF helps disambiguate via multi-keyword co-occurrence`)
  } else if (gitHooksRelated > reactRelated) {
    console.log(`Verdict: SAME — git-hooks still dominating (FM-5 vocabulary collision persists under BM25)`)
  } else {
    console.log(`Verdict: MIXED — some disambiguation but not fully resolved`)
  }

  // =========================================================================
  // BONUS: IDF keyword analysis for key terms
  // =========================================================================
  hr("BONUS: IDF values for key terms")

  const keyTerms = [
    "what", "did", "we", "make", "for", "the", "a",
    "react", "hooks", "hook", "state", "management",
    "jose", "crypto", "redis", "session", "jwt", "jsonwebtoken",
    "revalidatepath", "revalidatetag", "cookie", "middleware",
    "dashboard", "architectural", "router", "app",
    "git", "pre", "commit",
  ]

  console.log("\n| Term | IDF | Doc Freq | Suppressed? |")
  console.log("|------|-----|----------|-------------|")
  for (const term of keyTerms) {
    const idfVal = idfTable.idf.get(term) ?? 0
    const suppressed = idfVal <= 0
    const n = idfTable.N
    const approxDf = suppressed ? ">50%" : Math.round(n / (Math.exp(idfVal) - 1 + 1)).toString()
    console.log(`| ${term} | ${idfVal.toFixed(4)} | ~${approxDf} | ${suppressed ? "YES" : "no"} |`)
  }

  // =========================================================================
  // SUMMARY TABLE
  // =========================================================================
  hr("SUMMARY")

  console.log(`\nCorpus: ${entries.length} notes (${entries10k.length} from vault-10k + ${merged} from 78-shard knowledge-base)`)

  console.log("\n| Check | Metric | Old (Substring) | New (BM25) | Verdict |")
  console.log("|-------|--------|-----------------|-----------|---------|")

  const v1 = verdict(69, meanRecall, true)
  console.log(`| 1 | Mean R@10 (Q1-Q7) | 69% | ${meanRecall.toFixed(1)}% | ${v1} |`)

  const v2 = verdict(53, q4Pct, false)
  console.log(`| 2 | Q4 notes > 0 (%) | 53% | ${q4Pct.toFixed(1)}% | ${v2} |`)

  const v3 = verdict(9990, q4Scores.positive, false)
  console.log(`| 3 | FM-2 Q4 flooding (count) | 9,990 | ${q4Scores.positive.toLocaleString()} | ${v3} |`)

  const v4 = verdict(5.0, meanSnr, true)
  console.log(`| 4 | Signal-to-noise ratio | 5.0x | ${meanSnr.toFixed(1)}x | ${v4} |`)

  const v5 = graphHelped > 0 ? "IMPROVED" : graphChangedRanking > 0 ? "PARTIAL" : "SAME"
  console.log(`| 5 | Graph augmentation | 0/5 helped (substring) | ${graphHelped}/${graphTotal} helped, ${graphChangedRanking}/${graphTotal} re-ranked | ${v5} |`)

  const v6 = reactRelated > gitHooksRelated ? "IMPROVED" : gitHooksRelated > reactRelated ? "SAME" : "MIXED"
  console.log(`| 6 | FM-5 React vs git-hooks | git-hooks dominated | React:${reactRelated} git:${gitHooksRelated} | ${v6} |`)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
