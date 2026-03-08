import { join } from "path"
import { unlink } from "fs/promises"
import matter from "gray-matter"
import type { NoteEntry } from "../vault/types"
import { formatDate } from "../utils"
import config from "../config"

export interface StaleResult {
  staleCount: number
  activatedCount: number
  deletedCount: number
  deletedPaths: string[]
  stalePaths: string[]
  staleSynced: string[]
}

export async function markStaleNotes(
  entries: NoteEntry[],
  vaultPath: string,
  staleDays = config.lifecycle.staleDays,
  deleteDays = config.lifecycle.deleteDays,
  now = new Date(),
): Promise<StaleResult> {
  const result: StaleResult = { staleCount: 0, activatedCount: 0, deletedCount: 0, deletedPaths: [], stalePaths: [], staleSynced: [] }
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
        result.stalePaths.push(entry.relativePath)
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

export async function detectStaleSynced(stalePaths: string[], projectDir: string): Promise<string[]> {
  const synced: string[] = []
  for (const relPath of stalePaths) {
    const syncedPath = join(projectDir, "docs", "knowledge", relPath)
    if (await Bun.file(syncedPath).exists()) {
      synced.push(relPath)
    }
  }
  return synced
}

export async function updateNoteStatus(entry: NoteEntry, status: "active" | "stale", staleAt?: string): Promise<void> {
  const raw = await Bun.file(entry.filePath).text()
  const { data, content } = matter(raw)

  for (const key of Object.keys(data)) {
    if (data[key] instanceof Date) {
      data[key] = formatDate(data[key])
    }
  }

  data.status = status
  if (status === "stale" && staleAt) {
    data.staleAt = staleAt
  } else {
    delete data.staleAt
  }

  const updated = matter.stringify(content, data)
  await Bun.write(entry.filePath, updated)
}

