import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { getUpdateNotice } from "../update-checker"
import type { ToolDefinition, ToolContext } from "./types"

export function registerTools(
  server: McpServer,
  tools: ToolDefinition[],
  ctx: ToolContext,
): void {
  for (const tool of tools) {
    const config: Record<string, unknown> = { description: tool.description }
    if (tool.inputSchema) config.inputSchema = tool.inputSchema

    server.registerTool(
      tool.name,
      config,
      async (args: any) => {
        const result = await tool.handler(args, ctx)
        if ("isError" in result) {
          return { content: [{ type: "text" as const, text: result.text }], isError: true }
        }
        return { content: [{ type: "text" as const, text: result.text + await getUpdateNotice() }] }
      },
    )
  }
}
