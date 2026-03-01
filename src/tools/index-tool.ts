import { z } from "zod"
import type { NoteEntry } from "../vault/types"
import { buildIndexTable } from "../index-engine/index"
import type { ToolDefinition } from "./types"

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

export const indexTool: ToolDefinition = {
  name: "index",
  description: "Return the compressed knowledge index table for the current project or vault",
  inputSchema: z.object({
    project: z.string().optional().describe("Filter to notes tagged with this project name"),
  }),
  handler: (args, ctx) => {
    return { text: executeIndex(args, ctx.entries) }
  },
}
