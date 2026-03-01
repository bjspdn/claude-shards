#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" }
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { homedir } from "os"
import { join } from "path"
import { loadVault } from "./vault/loader"
import { watchVault } from "./vault/watcher"
import { registerIndexTool } from "./tools/index-tool"
import { registerReadTool } from "./tools/read-tool"
import { registerSearchTool } from "./tools/search-tool"
import { registerSyncTool } from "./tools/sync-tool"
import { registerWriteTool } from "./tools/write-tool"
import { registerFetchPageTool } from "./tools/fetch-page-tool"
import { registerResearchTool } from "./tools/research-tool"
import { registerDiagnosticsTool } from "./tools/diagnostics-tool"
import { installGlobal, uninstallGlobal, registerMcpServer, removeMcpServer } from "./cli/claude-code"
import { executeInit, formatInitSummary, VAULT_PATH as INIT_VAULT_PATH } from "./cli/init"
import { unregisterVaultFromObsidian } from "./cli/obsidian"
import { C } from "./utils"
import { fetchLatestVersion, fetchReleaseNotes, initUpdateCheck } from "./update-checker"
import { initLogFile, logInfo } from "./logger"
import { instrumentToolLogging } from "./tool-logger"
import { runLogViewer } from "./cli/logging"
import { rm } from "fs/promises"
import { createInterface } from "readline"

type CliCommand = "init" | "serve" | "version" | "update" | "uninstall" | "logging" | "help"

const VAULT_PATH = join(homedir(), ".ccm", "knowledge-base")

function parseCliArgs(): CliCommand {
  const args = process.argv.slice(2)
  if (args.includes("--version") || args.includes("-v")) return "version"
  if (args.includes("--update")) return "update"
  if (args.includes("--uninstall")) return "uninstall"
  if (args.includes("--init")) return "init"
  if (args.includes("--logging")) return "logging"
  if (args.includes("--stdio")) return "serve"
  if (!process.stdin.isTTY) return "serve"
  return "help"
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
      parts.push(`Run ${C.cyan}ccm --update${C.reset} to upgrade`)
      updateLine = parts.join("\n")
    }
  } catch {}

  console.log(`${C.bold}claude-code-memory${C.reset} ${C.dim}(ccm)${C.reset} — Persistent memory for Claude Code

${C.bold}Usage:${C.reset}
  ${C.cyan}ccm --init${C.reset}        Set up vault and register MCP server
  ${C.cyan}ccm --update${C.reset}      Update to the latest version
  ${C.cyan}ccm --uninstall${C.reset}   Remove ccm, MCP server, and optionally the vault
  ${C.cyan}ccm --version${C.reset}     Show installed version
  ${C.cyan}ccm --logging${C.reset}     Tail the MCP server log

${C.bold}First-time install:${C.reset}
  ${C.cyan}bun install -g @bennys001/claude-code-memory && ccm --init${C.reset}

${C.dim}Vault:${C.reset} ~/.ccm/knowledge-base/
${C.dim}Docs:${C.reset}  https://github.com/Ben-Spn/claude-code-memory${updateLine}`)
}

async function runUpdate() {
  console.log(`${C.dim}Checking for updates...${C.reset}`)
  const latest = await fetchLatestVersion()

  if (latest === pkg.version) {
    console.log(`Already on the latest version: ${C.green}v${pkg.version}${C.reset}`)
    return
  }

  console.log(`${C.dim}v${pkg.version}${C.reset} → ${C.green}v${latest}${C.reset}\n`)

  const installResult = await installGlobal()
  if (!installResult.success) {
    throw new Error(`Global install failed: ${installResult.error}`)
  }

  const mcpResult = await registerMcpServer()
  if (!mcpResult.success) {
    throw new Error(`MCP registration failed: ${mcpResult.error}`)
  }

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
  console.log(`${C.bold}ccm uninstall${C.reset}\n`)

  await removeMcpServer()
  console.log(`  ${C.green}+${C.reset} Removed MCP server`)

  await unregisterVaultFromObsidian(INIT_VAULT_PATH)
  console.log(`  ${C.green}+${C.reset} Unregistered Obsidian vault`)

  const ccmDir = join(homedir(), ".ccm")
  const deleteVault = await promptConfirm(`  Delete vault at ${C.dim}${INIT_VAULT_PATH}${C.reset}? ${C.dim}(y/N)${C.reset} `)
  if (deleteVault) {
    await rm(ccmDir, { recursive: true, force: true })
    console.log(`  ${C.green}+${C.reset} Deleted vault`)
  } else {
    console.log(`  ${C.yellow}-${C.reset} Kept vault`)
  }

  const uninstallResult = await uninstallGlobal()
  if (uninstallResult.success) {
    console.log(`  ${C.green}+${C.reset} Uninstalled ccm binary`)
  } else {
    console.log(`  ${C.red}!${C.reset} Failed to uninstall: ${uninstallResult.error}`)
  }

  console.log(`\n${C.green}Done${C.reset}`)
}

async function runInit() {
  const result = await executeInit()
  console.log(formatInitSummary(result))

  const failed = result.steps.filter((s) => s.status === "failed").length
  process.exit(failed > 0 ? 1 : 0)
}

async function runServer() {
  await initLogFile()
  logInfo("server", "starting", { version: pkg.version })

  const entries = await loadVault(VAULT_PATH)
  const { stop: stopWatcher, stats: watcherStats } = watchVault(VAULT_PATH, entries)

  initUpdateCheck()
  logInfo("server", `loaded ${entries.length} notes`)
  console.error(`Loaded ${entries.length} notes from ${VAULT_PATH}`)

  const server = new McpServer({
    name: "ccm",
    version: pkg.version,
  })

  instrumentToolLogging(server)

  registerIndexTool(server, entries)
  registerReadTool(server, VAULT_PATH)
  registerSearchTool(server, entries)
  registerSyncTool(server, entries, VAULT_PATH)
  registerWriteTool(server, entries, VAULT_PATH)
  registerFetchPageTool(server)
  registerResearchTool(server, entries, VAULT_PATH)
  registerDiagnosticsTool(server, entries, watcherStats)

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

if (cli === "version") {
  console.log(pkg.version)
  process.exit(0)
} else if (cli === "help") {
  printHelp().then(() => process.exit(0)).catch(() => process.exit(0))
} else if (cli === "update") {
  runUpdate().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
} else if (cli === "uninstall") {
  runUninstall().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
} else if (cli === "init") {
  runInit().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
} else if (cli === "logging") {
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
