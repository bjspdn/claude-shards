import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { logToolCall } from "./logger"

export function instrumentToolLogging(server: McpServer): void {
  const original = server.registerTool.bind(server)

  server.registerTool = (name: string, config: any, cb: (...args: any[]) => any) => {
    const hasInputSchema = config.inputSchema !== undefined

    const wrapped = async (...cbArgs: any[]) => {
      const toolArgs = hasInputSchema ? (cbArgs[0] as Record<string, unknown>) : {}
      const start = performance.now()
      try {
        const result = await cb(...cbArgs)
        logToolCall(name, toolArgs, Math.round(performance.now() - start))
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logToolCall(name, toolArgs, Math.round(performance.now() - start), message)
        throw err
      }
    }

    return original(name, config, wrapped as any)
  }
}
