#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" }
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { loadVault, buildLinkGraph } from "./vault/loader"
import { watchVault } from "./vault/watcher"
import {
  registerTools,
  readTool, searchTool, syncTool,
  writeTool, diagnosticsTool, healthTool, suggestCaptureTool,
  buildIdfTable,
  type ToolContext,
} from "./tools"
import { warmup, encode, isReady, buildEmbeddingIndex, updateEmbeddings, type EmbeddingIndex } from "./embeddings"
import { installGlobal, uninstallGlobal, registerMcpServer, removeMcpServer } from "./cli/claude-code"
import { spinner } from "./cli/spinner"
import { executeInit, formatInitSummary } from "./cli/init"
import { unregisterVaultFromObsidian } from "./cli/obsidian"
import { C } from "./utils"
import config from "./config"
import { fetchLatestVersion, fetchReleaseNotes, initUpdateCheck } from "./update-checker"
import { initLogFile, logInfo, logError } from "./logger"
import { instrumentToolLogging } from "./tool-logger"
import { runLogViewer } from "./cli/logging"
import { mkdir, rm } from "fs/promises"
import { stringify } from "smol-toml"
import { createInterface } from "readline"

type CliCommand = "init" | "serve" | "version" | "update" | "uninstall" | "logging" | "help"

const VAULT_PATH = config.paths.vaultPath

function parseCliArgs(): { command: CliCommand; vaultPath?: string } {
  const args = process.argv.slice(2)
  const vaultPathIdx = args.indexOf("--vault-path")
  const vaultPath = vaultPathIdx !== -1 ? args[vaultPathIdx + 1] : undefined

  if (args.includes("--version") || args.includes("-v")) return { command: "version" }
  if (args.includes("--update")) return { command: "update" }
  if (args.includes("--uninstall")) return { command: "uninstall" }
  if (args.includes("--init")) return { command: "init", vaultPath }
  if (args.includes("--logging")) return { command: "logging" }
  if (args.includes("--stdio")) return { command: "serve" }
  if (!process.stdin.isTTY) return { command: "serve" }
  return { command: "help" }
}

async function printHelp() {
  let updateLine = ""
  try {
    const latest = await fetchLatestVersion()
    if (latest !== pkg.version) {
      const notes = await fetchReleaseNotes(latest)
      const parts = [`\n\n${C.yellow}Update available:${C.reset} v${pkg.version} → ${C.green}v${latest}${C.reset}`]
      if (notes.length > 0) {
        parts.push(`${C.bold}What's new:${C.reset}`)
        for (const note of notes) parts.push(`  ${C.dim}-${C.reset} ${note}`)
      }
      parts.push(`Run ${C.cyan}claude-shards --update${C.reset} to upgrade`)
      updateLine = parts.join("\n")
    }
  } catch {}

  console.log(`${C.bold}Claude Shards${C.reset} — Persistent memory for Claude Code

${C.bold}Usage:${C.reset}
  ${C.cyan}claude-shards --init${C.reset}        Set up vault and register MCP server
  ${C.cyan}  --vault-path <path>${C.reset}    Use a custom vault directory
  ${C.cyan}claude-shards --update${C.reset}      Update to the latest version
  ${C.cyan}claude-shards --uninstall${C.reset}   Remove Claude Shards, MCP server, and optionally the vault
  ${C.cyan}claude-shards --version${C.reset}     Show installed version
  ${C.cyan}claude-shards --logging${C.reset}     Tail the MCP server log

${C.bold}First-time install:${C.reset}
  ${C.cyan}bun install -g claude-shards && claude-shards --init${C.reset}

${C.dim}Vault:${C.reset} ${VAULT_PATH}
${C.dim}Docs:${C.reset}  https://github.com/0xspdn/claude-shards${updateLine}`)
}

async function runUpdate() {
  let s = spinner("Checking for updates")
  const latest = await fetchLatestVersion()

  if (latest === pkg.version) {
    s.succeed(`Already on latest: ${C.green}v${pkg.version}${C.reset}`)
    return
  }

  s.succeed(`${C.dim}v${pkg.version}${C.reset} → ${C.green}v${latest}${C.reset}`)

  s = spinner("Installing")
  const installResult = await installGlobal()
  if (!installResult.success) {
    s.fail("Install failed")
    throw new Error(`Global install failed: ${installResult.error}`)
  }
  s.succeed("Installed package")

  s = spinner("Registering MCP server")
  const mcpResult = await registerMcpServer()
  if (!mcpResult.success) {
    s.fail("Registration failed")
    throw new Error(`MCP registration failed: ${mcpResult.error}`)
  }
  s.succeed("Registered MCP server")

  console.log(`\n${C.green}Updated to v${latest}${C.reset}`)
}

function promptConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === "y")
    })
  })
}

async function runUninstall() {
  console.log(`${C.bold}claude-shards uninstall${C.reset}\n`)

  await removeMcpServer()
  console.log(`  ${C.green}+${C.reset} Removed MCP server`)

  await unregisterVaultFromObsidian(VAULT_PATH)
  console.log(`  ${C.green}+${C.reset} Unregistered Obsidian vault`)

  const shardsDir = config.paths.shardsDir
  const deleteVault = await promptConfirm(`  Delete vault at ${C.dim}${VAULT_PATH}${C.reset}? ${C.dim}(y/N)${C.reset} `)
  if (deleteVault) {
    await rm(shardsDir, { recursive: true, force: true })
    console.log(`  ${C.green}+${C.reset} Deleted vault`)
  } else {
    console.log(`  ${C.yellow}-${C.reset} Kept vault`)
  }

  const uninstallResult = await uninstallGlobal()
  if (uninstallResult.success) {
    console.log(`  ${C.green}+${C.reset} Uninstalled claude-shards binary`)
  } else {
    console.log(`  ${C.red}!${C.reset} Failed to uninstall: ${uninstallResult.error}`)
  }

  console.log(`\n${C.green}Done${C.reset}`)
}

async function persistVaultPath(vaultPath: string) {
  const shardsDir = config.paths.shardsDir
  await mkdir(shardsDir, { recursive: true })
  const configPath = `${shardsDir}/config.toml`
  await Bun.write(configPath, stringify({ vault: { path: vaultPath } }) + "\n")
}

async function runInit(vaultPath?: string) {
  if (vaultPath) {
    await persistVaultPath(vaultPath)
  }
  const result = await executeInit(vaultPath)
  console.log(formatInitSummary(result))

  const failed = result.steps.filter((s) => s.status === "failed").length
  process.exit(failed > 0 ? 1 : 0)
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

  const { stop: stopWatcher, stats: watcherStats } = watchVault(VAULT_PATH, entries, onFlush)

  initEmbeddings()
  initUpdateCheck()
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
    watcherStats,
    get linkGraph() { return linkGraph },
    get idfTable() { return idfTable },
    rebuildLinkGraph: rebuildGraph,
    get embeddingIndex() { return embeddingIndex },
    get embedQuery() { return isReady() ? encode : undefined },
  }

  registerTools(server, [
    readTool, searchTool, syncTool,
    writeTool, diagnosticsTool, healthTool, suggestCaptureTool,
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

const cli = parseCliArgs()

if (cli.command === "version") {
  console.log(pkg.version)
  process.exit(0)
} else if (cli.command === "help") {
  printHelp().then(() => process.exit(0)).catch(() => process.exit(0))
} else if (cli.command === "update") {
  runUpdate().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
} else if (cli.command === "uninstall") {
  runUninstall().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
} else if (cli.command === "init") {
  runInit(cli.vaultPath).catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
} else if (cli.command === "logging") {
  runLogViewer().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
} else {
  runServer().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
}
