import { z } from "zod"
import { join, dirname, basename } from "path"
import { mkdir, readdir, rm } from "fs/promises"
import type { NoteEntry } from "../vault/types"
import {
  formatKnowledgeSection,
  injectKnowledgeSection,
  formatTokenCount,
  toIndexEntry,
} from "../index-engine/index"
import type { ToolDefinition } from "./types"
import globalConfig from "../config"

export interface SyncResult {
  entryCount: number
  totalTokens: number
  summary: string
}

export function extractTableEntries(content: string): string[] | null {
  const sectionStart = content.indexOf(globalConfig.display.sectionTitle)
  if (sectionStart === -1) return null

  const sectionEnd = content.indexOf(
    "\n## ",
    sectionStart + globalConfig.display.sectionTitle.length,
  )
  const section =
    sectionEnd === -1
      ? content.substring(sectionStart)
      : content.substring(sectionStart, sectionEnd)

  const tableLines = section.split("\n").filter((line) => line.startsWith("|"))
  if (tableLines.length < 2) return null

  return tableLines.slice(2).map((row) =>
    row
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim())
      .join("|"),
  )
}

export function buildEntryFingerprint(entries: NoteEntry[], pathPrefix: string): string[] {
  return entries.map((e) => {
    const idx = toIndexEntry(e)
    const localPath = `@docs/knowledge/${e.frontmatter.type}/${basename(e.relativePath)}`
    return [idx.icon, idx.title, pathPrefix ? localPath : idx.relativePath, idx.tokenDisplay].join("|")
  })
}

async function syncToFile(
  claudeMdPath: string,
  filtered: NoteEntry[],
  targetDir: string,
): Promise<{ entryCount: number; totalTokens: number; changed: boolean }> {
  const totalTokens = filtered.reduce((sum, e) => sum + e.tokenCount, 0)

  const file = Bun.file(claudeMdPath)
  const existing = (await file.exists()) ? await file.text() : ""

  if (existing) {
    const sectionAtTop = existing.trimStart().startsWith(globalConfig.display.sectionTitle)
    const existingEntries = extractTableEntries(existing)
    if (
      sectionAtTop &&
      existingEntries !== null &&
      existingEntries.join("\n") === buildEntryFingerprint(filtered, targetDir).join("\n")
    ) {
      return { entryCount: filtered.length, totalTokens, changed: false }
    }
  }

  const localEntries = filtered.map((e) => ({
    ...e,
    relativePath: `@docs/knowledge/${e.frontmatter.type}/${basename(e.relativePath)}`,
  }))

  const updated = existing
    ? injectKnowledgeSection(existing, localEntries)
    : formatKnowledgeSection(localEntries) + "\n"

  await Bun.write(claudeMdPath, updated)

  return { entryCount: filtered.length, totalTokens, changed: true }
}

async function copyNotesToProject(
  entries: NoteEntry[],
  vaultPath: string,
  targetDir: string,
): Promise<void> {
  for (const entry of entries) {
    const typePath = join(targetDir, "docs", "knowledge", entry.frontmatter.type)
    await mkdir(typePath, { recursive: true })
    const dest = join(typePath, basename(entry.relativePath))
    const content = await Bun.file(entry.filePath).text()
    await Bun.write(dest, content)
  }
}

async function cleanupRemovedNotes(
  syncedEntries: NoteEntry[],
  targetDir: string,
): Promise<string[]> {
  const knowledgeDir = join(targetDir, "docs", "knowledge")
  const removed: string[] = []

  const syncedFiles = new Set(
    syncedEntries.map((e) => `${e.frontmatter.type}/${basename(e.relativePath)}`),
  )

  try {
    const typeDirs = await readdir(knowledgeDir)
    for (const typeDir of typeDirs) {
      const typePath = join(knowledgeDir, typeDir)
      try {
        const files = await readdir(typePath)
        for (const file of files) {
          const key = `${typeDir}/${file}`
          if (!syncedFiles.has(key)) {
            await rm(join(typePath, file))
            removed.push(key)
          }
        }
        const remaining = await readdir(typePath)
        if (remaining.length === 0) {
          await rm(typePath, { recursive: true })
        }
      } catch {}
    }
    const remaining = await readdir(knowledgeDir)
    if (remaining.length === 0) {
      await rm(knowledgeDir, { recursive: true })
    }
  } catch {}

  return removed
}

export async function executeSync(
  notes: string[],
  allEntries: NoteEntry[],
  targetDir?: string,
): Promise<SyncResult> {
  const dir = targetDir ?? process.cwd()

  if (notes.length === 0) {
    return {
      entryCount: 0,
      totalTokens: 0,
      summary: "No notes specified. Provide vault-relative paths of notes to sync into the project (e.g. gotchas/SYNC_BEFORE_INIT.md).",
    }
  }

  const found: NoteEntry[] = []
  const skippedStale: string[] = []
  const notFound: string[] = []

  for (const notePath of notes) {
    const entry = allEntries.find((e) => e.relativePath === notePath)
    if (!entry) {
      notFound.push(notePath)
      continue
    }
    if (entry.frontmatter.status === "stale") {
      skippedStale.push(notePath)
      continue
    }
    found.push(entry)
  }

  await copyNotesToProject(found, "", dir)
  const removed = await cleanupRemovedNotes(found, dir)

  const { entryCount, totalTokens, changed } = await syncToFile(
    join(dir, "CLAUDE.md"),
    found,
    dir,
  )

  const parts: string[] = []

  if (changed) {
    parts.push(`Synced ${entryCount} entries to CLAUDE.md (${formatTokenCount(totalTokens)} total index tokens)`)
  } else {
    parts.push(`CLAUDE.md already up to date (${entryCount} entries, ${formatTokenCount(totalTokens)} total index tokens)`)
  }

  if (removed.length > 0) {
    parts.push(`Removed ${removed.length} stale files from docs/knowledge/: ${removed.join(", ")}`)
  }

  if (skippedStale.length > 0) {
    parts.push(`Skipped stale: ${skippedStale.join(", ")}`)
  }

  if (notFound.length > 0) {
    parts.push(`Not found: ${notFound.join(", ")}`)
  }

  return {
    entryCount,
    totalTokens,
    summary: parts.join("\n"),
  }
}

export const syncTool: ToolDefinition = {
  name: "sync",
  description: "Copy specified vault notes into docs/knowledge/ and update CLAUDE.md Knowledge Index",
  inputSchema: z.object({
    notes: z.array(z.string()).describe("Vault-relative paths of notes to sync into the project"),
  }),
  handler: async ({ notes }, ctx) => {
    const result = await executeSync(notes, ctx.entries)
    return { text: result.summary }
  },
}
