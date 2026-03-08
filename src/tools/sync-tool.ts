import { z } from "zod"
import { join, dirname, basename } from "path"
import { mkdir, readdir, rm } from "fs/promises"
import { NOTE_TYPE_PRIORITY, type NoteEntry, type LinkGraph } from "../vault/types"
import { logError } from "../logger"
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

export interface GatheredNote {
  path: string
  type: string
  description?: string
  body: string
  dependencies: { path: string; title: string; description?: string; type: string; body: string }[]
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

export function gatherNoteContent(
  entry: NoteEntry,
  allEntries: NoteEntry[],
  linkGraph: LinkGraph,
): GatheredNote {
  const forwardLinks = linkGraph.forward.get(entry.relativePath)
  const dependencies: GatheredNote["dependencies"] = []

  if (forwardLinks) {
    for (const targetPath of forwardLinks) {
      const dep = allEntries.find((e) => e.relativePath === targetPath)
      if (!dep) continue
      dependencies.push({
        path: dep.relativePath,
        title: dep.title,
        description: dep.frontmatter.description,
        type: dep.frontmatter.type,
        body: dep.body,
      })
    }
  }

  return {
    path: entry.relativePath,
    type: entry.frontmatter.type,
    description: entry.frontmatter.description,
    body: entry.body,
    dependencies,
  }
}

export function formatGatheredOutput(
  gathered: GatheredNote[],
  requestedPaths: Set<string>,
  maxTokens: number,
): string {
  const lines: string[] = []
  lines.push(`Synthesize into ≤${maxTokens} tokens. Sacrifice grammar for conciseness.`)
  lines.push("")

  for (const note of gathered) {
    lines.push(`# ${note.path} (${note.type})`)
    if (note.description) lines.push(`> ${note.description}`)
    lines.push("")
    lines.push(note.body)
    lines.push("")

    if (note.dependencies.length > 0) {
      lines.push("## Dependencies")
      lines.push("")

      const bodyBudget = Math.max(0, maxTokens - estimateTokens(lines.join("\n")))
      const perDep = note.dependencies.length > 0 ? Math.floor(bodyBudget / note.dependencies.length) : 0

      for (const dep of note.dependencies) {
        const isDuplicate = requestedPaths.has(dep.path)
        lines.push(`### ${dep.title} (${dep.type}) — ${dep.path}`)
        if (isDuplicate) {
          lines.push("(Also directly requested — deduplicate in synthesis)")
        }
        if (dep.description) lines.push(`> ${dep.description}`)
        lines.push("")

        if (perDep > 20 && !isDuplicate) {
          const truncated = truncateToTokens(dep.body, perDep)
          lines.push(truncated)
        } else if (!isDuplicate) {
          lines.push(dep.description ?? "(no description)")
        }
        lines.push("")
      }
    }
  }

  return lines.join("\n").trimEnd()
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function truncateToTokens(text: string, maxTokens: number): string {
  const charBudget = maxTokens * 4
  if (text.length <= charBudget) return text
  return text.slice(0, charBudget) + "\n[truncated]"
}

async function discoverExistingSyncedEntries(
  targetDir: string,
  allEntries: NoteEntry[],
): Promise<NoteEntry[]> {
  const knowledgeDir = join(targetDir, "docs", "knowledge")
  const existing: NoteEntry[] = []
  try {
    const typeDirs = await readdir(knowledgeDir)
    for (const typeDir of typeDirs) {
      try {
        const files = await readdir(join(knowledgeDir, typeDir))
        for (const file of files) {
          const entry = allEntries.find(
            (e) => e.frontmatter.type === typeDir && basename(e.relativePath) === file,
          )
          if (entry) existing.push(entry)
        }
      } catch { /* type dir may not exist */ }
    }
  } catch { /* knowledge dir may not exist */ }
  return existing
}

async function copyNotesToProject(
  entries: NoteEntry[],
  vaultPath: string,
  targetDir: string,
  synthesized?: Record<string, string>,
): Promise<void> {
  for (const entry of entries) {
    const typePath = join(targetDir, "docs", "knowledge", entry.frontmatter.type)
    await mkdir(typePath, { recursive: true })
    const dest = join(typePath, basename(entry.relativePath))
    const content = synthesized?.[entry.relativePath]
      ?? await Bun.file(entry.filePath).text()
    await Bun.write(dest, content)
  }
}

async function cleanupRemovedNotes(
  syncedEntries: NoteEntry[],
  targetDir: string,
  requestedPaths: Set<string>,
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
          const vaultPath = `${typeDir}/${file}`
          if (!syncedFiles.has(key) && requestedPaths.has(vaultPath)) {
            await rm(join(typePath, file))
            removed.push(key)
          }
        }
        const remaining = await readdir(typePath)
        if (remaining.length === 0) {
          await rm(typePath, { recursive: true })
        }
      } catch (err) {
        logError("tool", `sync cleanup failed for ${typePath}`, { error: String(err) })
      }
    }
    const remaining = await readdir(knowledgeDir)
    if (remaining.length === 0) {
      await rm(knowledgeDir, { recursive: true })
    }
  } catch (err) {
    logError("tool", `sync cleanup failed for ${knowledgeDir}`, { error: String(err) })
  }

  return removed
}

export async function executeSync(
  notes: string[],
  allEntries: NoteEntry[],
  targetDir?: string,
  options?: { mode?: "sync" | "gather"; synthesized?: Record<string, string>; linkGraph?: LinkGraph },
): Promise<SyncResult> {
  const dir = targetDir ?? process.cwd()
  const mode = options?.mode ?? "sync"

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

  if (mode === "gather") {
    const linkGraph = options?.linkGraph ?? { forward: new Map(), reverse: new Map() }
    const gathered = found.map((e) => gatherNoteContent(e, allEntries, linkGraph))
    const requestedPaths = new Set(notes)
    const output = formatGatheredOutput(gathered, requestedPaths, globalConfig.sync.gatherMaxTokens)

    const parts: string[] = [output]
    if (skippedStale.length > 0) parts.push(`\nSkipped stale: ${skippedStale.join(", ")}`)
    if (notFound.length > 0) parts.push(`\nNot found: ${notFound.join(", ")}`)

    return {
      entryCount: found.length,
      totalTokens: found.reduce((sum, e) => sum + e.tokenCount, 0),
      summary: parts.join("\n"),
    }
  }

  await copyNotesToProject(found, "", dir, options?.synthesized)
  const removed = await cleanupRemovedNotes(found, dir, new Set(notes))

  const existingEntries = await discoverExistingSyncedEntries(dir, allEntries)
  const foundPaths = new Set(found.map((e) => `${e.frontmatter.type}/${basename(e.relativePath)}`))
  const merged = [
    ...existingEntries.filter((e) => !foundPaths.has(`${e.frontmatter.type}/${basename(e.relativePath)}`)),
    ...found,
  ].sort((a, b) => NOTE_TYPE_PRIORITY[a.frontmatter.type] - NOTE_TYPE_PRIORITY[b.frontmatter.type])

  const { entryCount, totalTokens, changed } = await syncToFile(
    join(dir, "CLAUDE.md"),
    merged,
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
  description: "Gather vault notes with resolved dependencies for synthesis, or write synthesized notes into project context. Use mode: 'gather' to get note content with linked dependencies, then pass back synthesized content to write to docs/knowledge/.",
  inputSchema: z.object({
    notes: z.array(z.string().max(500)).max(100).describe("Vault-relative paths of notes to sync into the project"),
    mode: z.enum(["sync", "gather"]).default("sync").describe("'gather' returns note content with resolved dependencies for synthesis; 'sync' writes files and updates CLAUDE.md"),
    synthesized: z.record(z.string(), z.string()).optional().describe("Map of vault-relative path → synthesized content to write instead of vault originals"),
    targetDir: z.string().max(1000).optional().describe("Project directory to sync into (defaults to server cwd)"),
  }),
  handler: async ({ notes, mode, synthesized, targetDir }, ctx) => {
    const result = await executeSync(notes, ctx.entries, targetDir, {
      mode,
      synthesized,
      linkGraph: ctx.linkGraph,
    })
    return { text: result.summary }
  },
}
