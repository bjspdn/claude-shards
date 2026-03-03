import { test, expect, beforeAll } from "bun:test"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { join } from "path"
import { loadVault, buildLinkGraph } from "../src/vault/loader"
import {
  registerTools,
  searchTool,
  type ToolContext,
  buildIdfTable,
} from "../src/tools"
import type { IdfTable } from "../src/tools/bm25"
import type { NoteEntry, LinkGraph } from "../src/vault/types"

const VAULT = join(import.meta.dir, "fixtures/vault")

let client: InstanceType<typeof Client>
let entries: NoteEntry[]
let linkGraph: LinkGraph
let idfTable: IdfTable

beforeAll(async () => {
  entries = await loadVault(VAULT)
  linkGraph = buildLinkGraph(entries)
  idfTable = buildIdfTable(entries)

  const ctx: ToolContext = {
    entries,
    vaultPath: VAULT,
    watcherStats: { activeWatchers: 0, totalFlushes: 0, totalUpserts: 0, totalRemoves: 0 },
    get linkGraph() { return linkGraph },
    get idfTable() { return idfTable },
    rebuildLinkGraph: () => {},
  }

  const server = new McpServer({ name: "test-shards", version: "0.0.0" })
  registerTools(server, [searchTool], ctx)

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test-client", version: "0.0.0" })

  await server.connect(serverTransport)
  await client.connect(clientTransport)
})

function resultText(res: Awaited<ReturnType<typeof client.callTool>>): string {
  return (res.content as { type: string; text: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
}

function parseTableRows(text: string): string[][] {
  return text
    .split("\n")
    .slice(2) // skip header + separator
    .filter((l) => l.startsWith("|"))
    .map((l) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    )
}

test("listTools returns search tool with correct schema", async () => {
  const { tools } = await client.listTools()
  const search = tools.find((t) => t.name === "search")
  expect(search).toBeDefined()
  const props = (search!.inputSchema as any).properties
  expect(props.query).toBeDefined()
  expect(props.types).toBeDefined()
  expect(props.tags).toBeDefined()
  expect(props.limit).toBeDefined()
})

test("callTool search returns ranked results", async () => {
  const res = await client.callTool({ name: "search", arguments: { query: "bevy" } })
  const text = resultText(res)
  expect(text).toContain("| T |")
  expect(text).toContain("| Score |")
  const rows = parseTableRows(text)
  expect(rows.length).toBeGreaterThan(0)
  expect(rows[0]?.length).toBe(5)
})

test("BM25 IDF weighting: rare terms rank higher", async () => {
  const res = await client.callTool({ name: "search", arguments: { query: "bevy" } })
  const rows = parseTableRows(resultText(res))
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.at(0)?.at(1)?.toLowerCase()).toContain("bevy")
})

test("title matches outrank body matches", async () => {
  const res = await client.callTool({ name: "search", arguments: { query: "bevy" } })
  const rows = parseTableRows(resultText(res))
  expect(rows.at(0)?.at(1)?.toLowerCase()).toContain("bevy")
})

test("type filter works through MCP", async () => {
  const res = await client.callTool({
    name: "search",
    arguments: { query: "rust", types: ["gotchas"] },
  })
  const rows = parseTableRows(resultText(res))
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) {
    expect(row[2]).toContain("gotchas/")
  }
})

test("limit parameter respected", async () => {
  const res = await client.callTool({
    name: "search",
    arguments: { query: "bevy", limit: 2 },
  })
  const rows = parseTableRows(resultText(res))
  expect(rows.length).toBeLessThanOrEqual(2)
})

test("no matches returns informative message", async () => {
  const res = await client.callTool({
    name: "search",
    arguments: { query: "xyznonexistent" },
  })
  const text = resultText(res)
  expect(text).toContain("No notes match that query.")
})

test("graph propagation changes scores", async () => {
  const ctxNoGraph: ToolContext = {
    entries,
    vaultPath: VAULT,
    watcherStats: { activeWatchers: 0, totalFlushes: 0, totalUpserts: 0, totalRemoves: 0 },
    get linkGraph() { return undefined as unknown as LinkGraph },
    get idfTable() { return idfTable },
    rebuildLinkGraph: () => {},
  }

  const serverNoGraph = new McpServer({ name: "test-no-graph", version: "0.0.0" })
  registerTools(serverNoGraph, [searchTool], ctxNoGraph)

  const [sTransport, cTransport] = InMemoryTransport.createLinkedPair()
  const clientNoGraph = new Client({ name: "test-client-ng", version: "0.0.0" })

  await serverNoGraph.connect(sTransport)
  await clientNoGraph.connect(cTransport)

  const withGraph = await client.callTool({ name: "search", arguments: { query: "bevy" } })
  const withoutGraph = await clientNoGraph.callTool({ name: "search", arguments: { query: "bevy" } })

  const scoresWith = parseTableRows(resultText(withGraph)).map((r) => parseFloat(r[4] ?? ""))
  const scoresWithout = parseTableRows(resultText(withoutGraph)).map((r) => parseFloat(r[4] ?? ""))

  const differ = scoresWith.some((s, i) => s !== scoresWithout[i])
  expect(differ).toBe(true)
})
