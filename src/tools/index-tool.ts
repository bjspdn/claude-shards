import { z } from "zod"
import type { NoteEntry, ProjectConfig } from "../vault/types"
import { filterEntries } from "../vault/loader"
import { buildIndexTable } from "../index-engine/index"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

interface IndexArgs {
  project?: string
}

export function executeIndex(
  args: IndexArgs,
  entries: NoteEntry[],
  projectConfig: ProjectConfig | null,
): string {
  let filtered = filterEntries(entries, projectConfig)

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
  projectConfig: ProjectConfig | null,
) {
  server.registerTool("index",
    {
      description: "Return the compressed knowledge index table for the current project or vault",
      inputSchema: z.object({
        project: z.string().optional().describe("Filter to notes tagged with this project name"),
      })
    }, 
    async (args) => {
      const result = executeIndex(args, entries, projectConfig)
      return { content: [{ type: "text" as const, text: result }] }
    }
  )
}
