import { loadVault, buildLinkGraph } from "../src/vault/loader"
import { executeSearch, formatSearchResults } from "../src/tools/search-tool"
import { buildIdfTable } from "../src/tools/bm25"
import { buildIndexTable } from "../src/index-engine/index"
import { executeRead } from "../src/tools/read-tool"
import { join } from "path"
import { homedir } from "os"

const VAULT_PATH = join(homedir(), ".claude-shards", "vault-10k")

const SEARCH_QUERIES = [
  "React hooks state management",
  "Kubernetes pod scheduling",
  "Stripe payment webhook",
  "sourdough fermentation",
  "Redis session cache",
]

function hr(label: string) {
  console.log(`\n${"=".repeat(60)}`)
  console.log(` ${label}`)
  console.log("=".repeat(60))
}

function bytes(str: string): string {
  const b = Buffer.byteLength(str, "utf8")
  if (b < 1024) return `${b} B`
  return `${(b / 1024).toFixed(1)} KB`
}

async function main() {
  hr("LOAD VAULT")
  const t0 = performance.now()
  const entries = await loadVault(VAULT_PATH)
  const loadMs = performance.now() - t0
  console.log(`Loaded ${entries.length} notes in ${loadMs.toFixed(0)} ms`)

  const t1 = performance.now()
  const linkGraph = buildLinkGraph(entries)
  const graphMs = performance.now() - t1
  const fwdEdges = [...linkGraph.forward.values()].reduce((s, v) => s + v.size, 0)
  console.log(`Built link graph in ${graphMs.toFixed(0)} ms  (${linkGraph.forward.size} sources, ${fwdEdges} edges)`)

  const t1b = performance.now()
  const idfTable = buildIdfTable(entries)
  const idfMs = performance.now() - t1b
  console.log(`Built IDF table in ${idfMs.toFixed(0)} ms  (${idfTable.idf.size} tokens, N=${idfTable.N})`)

  hr("SEARCH — BM25 + graph propagation")
  for (const query of SEARCH_QUERIES) {
    const t = performance.now()
    const results = executeSearch({ query, limit: 10 }, entries, linkGraph, idfTable)
    const ms = performance.now() - t
    console.log(`\n--- "${query}" --- (${results.length} results, ${ms.toFixed(1)} ms)`)
    if (results.length === 0) {
      console.log("  (no matches)")
    } else {
      for (const r of results.slice(0, 5)) {
        console.log(`  [${r.score.toFixed(2)}] ${r.icon} ${r.title}  (${r.relativePath})`)
      }
      if (results.length > 5) console.log(`  ... and ${results.length - 5} more`)
    }
  }

  hr("SEARCH — BM25 keyword only (no graph)")
  for (const query of SEARCH_QUERIES) {
    const results = executeSearch({ query, limit: 10 }, entries, undefined, idfTable)
    console.log(`\n--- "${query}" --- (${results.length} results)`)
    if (results.length === 0) {
      console.log("  (no matches)")
    } else {
      for (const r of results.slice(0, 5)) {
        console.log(`  [${r.score.toFixed(2)}] ${r.icon} ${r.title}  (${r.relativePath})`)
      }
      if (results.length > 5) console.log(`  ... and ${results.length - 5} more`)
    }
  }

  hr("SEARCH — legacy substring scorer (baseline comparison)")
  for (const query of SEARCH_QUERIES) {
    const results = executeSearch({ query, limit: 10 }, entries, linkGraph)
    console.log(`\n--- "${query}" --- (${results.length} results)`)
    if (results.length === 0) {
      console.log("  (no matches)")
    } else {
      for (const r of results.slice(0, 5)) {
        console.log(`  [${r.score.toFixed(2)}] ${r.icon} ${r.title}  (${r.relativePath})`)
      }
      if (results.length > 5) console.log(`  ... and ${results.length - 5} more`)
    }
  }

  hr("INDEX GENERATION")
  const ti = performance.now()
  const indexOutput = buildIndexTable(entries)
  const indexMs = performance.now() - ti
  const lines = indexOutput.split("\n")
  const entryCount = lines.length - 2
  console.log(`Generated index: ${entryCount} entries, ${bytes(indexOutput)}, ${indexMs.toFixed(0)} ms`)
  console.log(`First 5 rows:`)
  for (const line of lines.slice(2, 7)) {
    console.log(`  ${line}`)
  }

  hr("READ")
  const samplePaths = entries.slice(0, 3).map((e) => e.relativePath)
  for (const p of samplePaths) {
    const tr = performance.now()
    const result = await executeRead(p, VAULT_PATH)
    const rMs = performance.now() - tr
    if (result.ok) {
      const preview = result.content.slice(0, 120).replace(/\n/g, "\\n")
      console.log(`  ${p}  (${bytes(result.content)}, ${rMs.toFixed(1)} ms)  "${preview}..."`)
    } else {
      console.log(`  ${p}  ERROR: ${result.error}`)
    }
  }

  const badResult = await executeRead("nonexistent/fake-note.md", VAULT_PATH)
  console.log(`  nonexistent/fake-note.md  => ok=${(badResult as any).ok}, error=${"error" in badResult ? badResult.error : "n/a"}`)

  hr("SUMMARY")
  console.log(`Vault:       ${VAULT_PATH}`)
  console.log(`Notes:       ${entries.length}`)
  console.log(`Load time:   ${loadMs.toFixed(0)} ms`)
  console.log(`Graph build: ${graphMs.toFixed(0)} ms`)
  console.log(`IDF build:   ${idfMs.toFixed(0)} ms  (${idfTable.idf.size} tokens)`)
  console.log(`Index size:  ${bytes(indexOutput)}`)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
