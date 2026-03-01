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
import { spawn } from "child_process"
import { SERVER_CMD } from "./cli/claude-code"
import { executeInit, formatInitSummary } from "./cli/init"
import { C } from "./utils"

type CliCommand = "init" | "serve" | "version" | "update" | "help"

const VAULT_PATH = join(homedir(), ".ccm", "knowledge-base")

function parseCliArgs(): CliCommand {
  const args = process.argv.slice(2)
  if (args.includes("--version") || args.includes("-v")) return "version"
  if (args.includes("--update")) return "update"
  if (args.includes("--init")) return "init"
  if (args.includes("--stdio")) return "serve"
  return "help"
}

function printHelp() {
  console.log(`${C.bold}claude-code-memory${C.reset} ${C.dim}(ccm)${C.reset} — Persistent memory for Claude Code

${C.bold}Usage:${C.reset}
  ${C.cyan}bunx @bennys001/claude-code-memory --init${C.reset}    Set up vault and register MCP server
  ${C.cyan}ccm --update${C.reset}                                  Update to the latest version
  ${C.cyan}ccm --version${C.reset}                                 Show installed version

${C.dim}Vault:${C.reset} ~/.ccm/knowledge-base/
${C.dim}Docs:${C.reset}  https://github.com/bennys001/claude-code-memory`)
}

async function fetchLatestVersion(): Promise<string> {
  const res = await fetch("https://registry.npmjs.org/@bennys001/claude-code-memory/latest")
  if (!res.ok) throw new Error(`npm registry returned ${res.status}`)
  const data = (await res.json()) as { version: string }
  return data.version
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "inherit" })
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`))
    })
  })
}

async function runUpdate() {
  console.log(`${C.dim}Checking for updates...${C.reset}`)
  const latest = await fetchLatestVersion()

  if (latest === pkg.version) {
    console.log(`Already on the latest version: ${C.green}v${pkg.version}${C.reset}`)
    return
  }

  console.log(`${C.dim}v${pkg.version}${C.reset} → ${C.green}v${latest}${C.reset}\n`)

  await runCommand("bun", ["pm", "cache", "rm"])
  await runCommand("claude", ["mcp", "remove", "ccm"])
  await runCommand("claude", ["mcp", "add", "--transport", "stdio", "--scope", "user", "ccm", "--", ...SERVER_CMD])

  console.log(`\n${C.green}Updated to v${latest}${C.reset}`)
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

if (cli === "version") {
  console.log(pkg.version)
  process.exit(0)
} else if (cli === "help") {
  printHelp()
  process.exit(0)
} else if (cli === "update") {
  runUpdate().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
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
