#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" }
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { homedir } from "os"
import { join } from "path"
import { loadVault } from "./vault/loader"
import { registerIndexTool } from "./tools/index-tool"
import { registerReadTool } from "./tools/read-tool"
import { registerSearchTool } from "./tools/search-tool"
import { registerSyncTool } from "./tools/sync-tool"
import { registerWriteTool } from "./tools/write-tool"
import { registerFetchPageTool } from "./tools/fetch-page-tool"
import { registerResearchTool } from "./tools/research-tool"
import { executeInit, formatInitSummary } from "./cli/init"
import { C } from "./utils"

type CliCommand = "init" | "serve" | "help"

const VAULT_PATH = join(homedir(), ".ccm", "knowledge-base")

function parseCliArgs(): CliCommand {
  const args = process.argv.slice(2)
  if (args.includes("--init")) return "init"
  if (args.includes("--stdio")) return "serve"
  return "help"
}

function printHelp() {
  console.log(`${C.bold}ccm${C.reset} ${C.dim}— persistent memory for Claude Code${C.reset}

${C.bold}Usage:${C.reset}
  ${C.cyan}ccm --init${C.reset}    Scaffold vault and register MCP server

${C.dim}Vault:${C.reset} ~/.ccm/knowledge-base/
${C.dim}Docs:${C.reset}  https://github.com/bennys001/claude-code-memory`)
}

async function runInit() {
  const result = await executeInit()
  console.log(formatInitSummary(result))

  const failed = result.steps.filter((s) => s.status === "failed").length
  process.exit(failed > 0 ? 1 : 0)
}

async function runServer() {
  const entries = await loadVault(VAULT_PATH)

  console.error(`Loaded ${entries.length} notes from ${VAULT_PATH}`)

  const server = new McpServer({
    name: "ccm",
    version: pkg.version,
  })

  registerIndexTool(server, entries)
  registerReadTool(server, VAULT_PATH)
  registerSearchTool(server, entries)
  registerSyncTool(server, entries, VAULT_PATH)
  registerWriteTool(server, entries, VAULT_PATH)
  registerFetchPageTool(server)
  registerResearchTool(server, entries, VAULT_PATH)

  const transport = new StdioServerTransport()
  await server.connect(transport)

  const shutdown = async () => {
    await server.close()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

const cli = parseCliArgs()

if (cli === "help") {
  printHelp()
  process.exit(0)
} else if (cli === "init") {
  runInit().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
} else {
  runServer().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
}
