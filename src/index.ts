#!/usr/bin/env bun
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

type CliCommand = "init" | "serve"

const VAULT_PATH = join(homedir(), ".ccm", "knowledge-base")

function parseCliArgs(): CliCommand {
  if (process.argv.includes("--init")) return "init"
  return "serve"
}

async function runInit() {
  const result = await executeInit()
  console.error(formatInitSummary(result))

  const failed = result.steps.filter((s) => s.status === "failed").length
  process.exit(failed > 0 ? 1 : 0)
}

async function runServer() {
  const entries = await loadVault(VAULT_PATH)

  console.error(`Loaded ${entries.length} notes from ${VAULT_PATH}`)

  const server = new McpServer({
    name: "ccm",
    version: "0.9.0",
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

if (cli === "init") {
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
