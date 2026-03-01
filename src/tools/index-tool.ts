import { z } from "zod"
import type { NoteEntry } from "../vault/types"
import { buildIndexTable } from "../index-engine/index"
import { getUpdateNotice } from "../update-checker"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

interface IndexArgs {
  project?: string
}

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
      return { content: [{ type: "text" as const, text: result + getUpdateNotice() }] }
    }
  )
}
