#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" }
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { loadVault, buildLinkGraph } from "./vault/loader"
import { watchVault } from "./vault/watcher"
import {
  registerTools,
  readTool, searchTool, syncTool,
  writeTool, healthTool, suggestCaptureTool,
  buildIdfTable,
  type ToolContext,
} from "./tools"
import { warmup, encode, isReady, buildEmbeddingIndex, updateEmbeddings, type EmbeddingIndex } from "./embeddings"
import { removeMcpServer } from "./cli/claude-code"
import { executeInit, formatInitSummary } from "./cli/init"
import { rm } from "fs/promises"
import { createInterface } from "readline"
import config from "./config"
import { initLogFile, logInfo, logError } from "./logger"
import { instrumentToolLogging } from "./tool-logger"

const VAULT_PATH = config.paths.vaultPath

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.toLowerCase().startsWith("y"))
    })
  })
}

async function runCleanup() {
  await removeMcpServer()

  const shardsDir = config.paths.shardsDir
  if (process.stdin.isTTY && await confirm(`\nRemove ${shardsDir}? [y/N] `)) {
    await rm(shardsDir, { recursive: true, force: true })
    console.log("Removed.")
  }
}

async function runServer() {
  await initLogFile()
  logInfo("server", "starting", { version: pkg.version })

  const entries = await loadVault(VAULT_PATH)
  let linkGraph = buildLinkGraph(entries)
  let idfTable = buildIdfTable(entries)
  const rebuildGraph = () => {
    linkGraph = buildLinkGraph(entries)
    idfTable = buildIdfTable(entries)
  }

  let embeddingIndex: EmbeddingIndex | undefined

  const initEmbeddings = async () => {
    try {
      await warmup()
      embeddingIndex = await buildEmbeddingIndex(entries, VAULT_PATH)
      logInfo("server", `embedding index ready: ${embeddingIndex.size} vectors`)
    } catch (err) {
      logError("server", "embedding init failed — falling back to BM25-only", { error: String(err) })
    }
  }

  const onFlush = () => {
    rebuildGraph()
    if (embeddingIndex && isReady()) {
      updateEmbeddings(embeddingIndex, entries, VAULT_PATH).catch((err) =>
        logError("server", "embedding update failed", { error: String(err) }),
      )
    }
  }

  const { stop: stopWatcher } = watchVault(VAULT_PATH, entries, onFlush)

  initEmbeddings()
  logInfo("server", `loaded ${entries.length} notes`)
  console.error(`Loaded ${entries.length} notes from ${VAULT_PATH}`)

  const server = new McpServer({
    name: "claude-shards",
    version: pkg.version,
  })

  instrumentToolLogging(server)

  const ctx: ToolContext = {
    entries,
    vaultPath: VAULT_PATH,
    get linkGraph() { return linkGraph },
    get idfTable() { return idfTable },
    rebuildLinkGraph: rebuildGraph,
    get embeddingIndex() { return embeddingIndex },
    get embedQuery() { return isReady() ? encode : undefined },
  }

  registerTools(server, [
    readTool, searchTool, syncTool,
    writeTool, healthTool, suggestCaptureTool,
  ], ctx)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  logInfo("server", "connected")

  const shutdown = async () => {
    logInfo("server", "shutting down")
    stopWatcher()
    await server.close()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

const args = process.argv.slice(2)

if (args.includes("--cleanup")) {
  runCleanup().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
} else if (args.includes("--init")) {
  executeInit().then((result) => {
    console.log(formatInitSummary(result))
    const failed = result.steps.filter((s) => s.status === "failed").length
    process.exit(failed > 0 ? 1 : 0)
  }).catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
} else if (process.stdin.isTTY) {
  console.log("claude-shards — persistent knowledge for Claude Code via MCP.")
  process.exit(0)
} else {
  runServer().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
}
