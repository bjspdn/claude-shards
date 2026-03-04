import { z } from "zod"
import { unlink } from "fs/promises"
import matter from "gray-matter"
import type { NoteEntry } from "../vault/types"
import { buildIndexTable } from "../index-engine/index"
import { formatDate } from "../utils"
import type { ToolDefinition } from "./types"

interface IndexArgs {
  project?: string
}

interface StaleResult {
  staleCount: number
  activatedCount: number
  deletedCount: number
  deletedPaths: string[]
}

export async function markStaleNotes(
  entries: NoteEntry[],
  vaultPath: string,
  staleDays = 30,
  deleteDays = 14,
  now = new Date(),
): Promise<StaleResult> {
  const result: StaleResult = { staleCount: 0, activatedCount: 0, deletedCount: 0, deletedPaths: [] }
  const staleThreshold = new Date(now.getTime() - staleDays * 86400000)
  const deleteThreshold = new Date(now.getTime() - deleteDays * 86400000)

  const toRemove: number[] = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    const updated = entry.frontmatter.updated
    const isOld = updated < staleThreshold

    if (isOld) {
      if (entry.frontmatter.status === "stale" && entry.frontmatter.staleAt && entry.frontmatter.staleAt < deleteThreshold) {
        await unlink(entry.filePath)
        toRemove.push(i)
        result.deletedCount++
        result.deletedPaths.push(entry.relativePath)
        continue
      }

      if (entry.frontmatter.status !== "stale") {
        await updateNoteStatus(entry, "stale", formatDate(now))
        entry.frontmatter.status = "stale"
        entry.frontmatter.staleAt = now
        result.staleCount++
      }
    } else {
      if (entry.frontmatter.status === "stale") {
        await updateNoteStatus(entry, "active")
        entry.frontmatter.status = "active"
        entry.frontmatter.staleAt = undefined
        result.activatedCount++
      }
    }
  }

  for (let i = toRemove.length - 1; i >= 0; i--) {
    entries.splice(toRemove[i]!, 1)
  }

  return result
}

async function updateNoteStatus(entry: NoteEntry, status: "active" | "stale", staleAt?: string): Promise<void> {
  const raw = await Bun.file(entry.filePath).text()
  const { data, content } = matter(raw)

  data.status = status
  if (status === "stale" && staleAt) {
    data.staleAt = staleAt
  } else {
    delete data.staleAt
  }

  const updated = matter.stringify(content, data)
  await Bun.write(entry.filePath, updated)
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

function formatStaleReport(result: StaleResult): string {
  const parts: string[] = []
  if (result.staleCount > 0) parts.push(`${result.staleCount} marked stale`)
  if (result.activatedCount > 0) parts.push(`${result.activatedCount} reactivated`)
  if (result.deletedCount > 0) parts.push(`${result.deletedCount} deleted: ${result.deletedPaths.join(", ")}`)
  return parts.length > 0 ? `\n\nStale lifecycle: ${parts.join(", ")}` : ""
}

export const indexTool: ToolDefinition = {
  name: "index",
  description: "Return the compressed knowledge index table for the current project or vault",
  inputSchema: z.object({
    project: z.string().optional().describe("Filter to notes tagged with this project name"),
  }),
  handler: async (args, ctx) => {
    const staleResult = await markStaleNotes(ctx.entries, ctx.vaultPath)
    const table = executeIndex(args, ctx.entries)
    return { text: table + formatStaleReport(staleResult) }
  },
}
