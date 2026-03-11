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
import { runConfig } from "./cli/config"
import { rm } from "fs/promises"
import config, { loadPersistedConfig } from "./config"
import { C } from "./utils"
import { initLogFile, logInfo, logError } from "./logger"
import { instrumentToolLogging } from "./tool-logger"

const VAULT_PATH = config.paths.vaultPath

function newerThan(remote: string, local: string): boolean {
  const r = remote.split(".").map(Number)
  const l = local.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false
  }
  return false
}

async function autoUpdate() {
  try {
    const persisted = loadPersistedConfig(config.paths.shardsDir)
    if (persisted.auto_update === false) return

    const res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return
    const data = await res.json() as { version?: string }
    const latest = data.version
    if (!latest || !newerThan(latest, pkg.version)) return

    logInfo("update", `updating ${pkg.version} → ${latest}`)
    Bun.spawn(["bun", "add", "-g", `${pkg.name}@${latest}`], {
      stdio: ["ignore", "ignore", "ignore"],
    })
  } catch {
    logError("update", "auto-update check failed")
  }
}

async function runUninstall() {
  await removeMcpServer()
  await rm(config.paths.shardsDir, { recursive: true, force: true })
  Bun.spawn(["bun", "remove", "-g", "@bjspdn/claude-shards"], { stdio: ["ignore", "ignore", "ignore"] })
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
  autoUpdate()
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

  const tools = [readTool, searchTool, syncTool, writeTool, healthTool]
  if (config.capture.aggressiveness > 0) tools.push(suggestCaptureTool)
  registerTools(server, tools, ctx)

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

function printVersion() {
  console.log(pkg.version)
}

function printUsage() {
  console.log(`${C.bold}claude-shards${C.reset} ${C.dim}v${pkg.version}${C.reset}`)
  console.log()
  console.log("Commands:")
  console.log(`  ${C.cyan}--init${C.reset}        ${C.dim}Set up vault and register MCP server${C.reset}`)
  console.log(`  ${C.cyan}--config${C.reset}      ${C.dim}Interactive configuration editor${C.reset}`)
  console.log(`  ${C.cyan}--uninstall${C.reset}   ${C.dim}Remove claude-shards completely${C.reset}`)
}

const args = process.argv.slice(2)

if (args.includes("--version")) {
  printVersion()
} else if (args.includes("--uninstall")) {
  runUninstall().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
} else if (args.includes("--config")) {
  runConfig(config.paths.shardsDir).catch((err) => {
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
  printUsage()
} else {
  runServer().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
}
