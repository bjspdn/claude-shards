import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { loadVault } from "./vault/loader"
import { registerIndexTool } from "./tools/index-tool"
import { registerReadTool } from "./tools/read-tool"
import { registerSearchTool } from "./tools/search-tool"
import { registerSyncTool } from "./tools/sync-tool"
import { registerWriteTool } from "./tools/write-tool"
import { registerFetchPageTool } from "./tools/fetch-page-tool"

function parseVaultPath(): string {
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--vault" && args[i + 1]) {
      return args[i + 1]!
    }
  }

  if (process.env.OBSIDIAN_VAULT_PATH) {
    return process.env.OBSIDIAN_VAULT_PATH
  }

  console.error(
    "Error: Vault path required.\n" +
    "  Use: --vault /path/to/vault\n" +
    "  Or set OBSIDIAN_VAULT_PATH environment variable",
  )
  process.exit(1)
}

async function main() {
  const vaultPath = parseVaultPath()
  const entries = await loadVault(vaultPath)

  console.error(`Loaded ${entries.length} notes from ${vaultPath}`)

  const server = new McpServer({
    name: "ccm",
    version: "0.3.4",
  })

  registerIndexTool(server, entries)
  registerReadTool(server, vaultPath)
  registerSearchTool(server, entries)
  registerSyncTool(server, entries, vaultPath)
  registerWriteTool(server, entries, vaultPath)
  registerFetchPageTool(server)

  const transport = new StdioServerTransport()
  await server.connect(transport)

  const shutdown = async () => {
    await server.close()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})

