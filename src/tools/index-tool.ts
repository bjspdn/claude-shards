import { z } from "zod"
import type { NoteEntry } from "../vault/types"
import { buildIndexTable } from "../index-engine/index"
import { getUpdateNotice } from "../update-checker"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

interface IndexArgs {
  project?: string
}

/**
 * Build the compressed knowledge index table, optionally filtered by project.
 * @param args.project - Optional project name to filter entries.
 * @param entries - All loaded vault note entries.
 */
export function executeIndex(
  args: IndexArgs,
  entries: NoteEntry[],
): string {
  let filtered = entries

  if (args.project) {
    filtered = filtered.filter((e) =>
      e.frontmatter.projects.includes(args.project!),
    )
  }

  return buildIndexTable(filtered)
}

/**
 * Register the `index` MCP tool.
 * @param server - MCP server instance to register on.
 * @param entries - Shared vault entries array (read at call time).
 */
export function registerIndexTool(
  server: McpServer,
  entries: NoteEntry[],
) {
  server.registerTool("index",
    {
      description: "Return the compressed knowledge index table for the current project or vault",
      inputSchema: z.object({
        project: z.string().optional().describe("Filter to notes tagged with this project name"),
      })
    }, 
    async (args) => {
      const result = executeIndex(args, entries)
      return { content: [{ type: "text" as const, text: result + await getUpdateNotice() }] }
    }
  )
}
