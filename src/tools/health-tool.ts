import type { NoteEntry, LinkGraph } from "../vault/types"
import type { ToolDefinition } from "./types"
import { markStaleNotes, detectStaleSynced, type StaleResult } from "./index-tool"

interface HealthReport {
  totalNotes: number
  linkedNotes: number
  orphanNotes: { title: string; relativePath: string }[]
  hubNotes: { title: string; relativePath: string; degree: number }[]
  clusters: { size: number; members: string[] }[]
}

export function analyzeHealth(entries: NoteEntry[], linkGraph: LinkGraph): HealthReport {
  const allPaths = new Set(entries.map((e) => e.relativePath))
  const titleByPath = new Map(entries.map((e) => [e.relativePath, e.title]))

  const degreeMap = new Map<string, number>()
  const connectedPaths = new Set<string>()

  for (const [src, targets] of linkGraph.forward) {
    connectedPaths.add(src)
    degreeMap.set(src, (degreeMap.get(src) ?? 0) + targets.size)
    for (const t of targets) {
      connectedPaths.add(t)
    }
  }
  for (const [target, sources] of linkGraph.reverse) {
    connectedPaths.add(target)
    degreeMap.set(target, (degreeMap.get(target) ?? 0) + sources.size)
  }

  const orphanNotes: HealthReport["orphanNotes"] = []
  for (const path of allPaths) {
    if (!connectedPaths.has(path)) {
      orphanNotes.push({ title: titleByPath.get(path) ?? path, relativePath: path })
    }
  }
  orphanNotes.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  const hubEntries = [...degreeMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  const hubNotes: HealthReport["hubNotes"] = hubEntries.map(([path, degree]) => ({
    title: titleByPath.get(path) ?? path,
    relativePath: path,
    degree,
  }))

  const adjacency = new Map<string, Set<string>>()
  for (const path of allPaths) {
    adjacency.set(path, new Set())
  }
  for (const [src, targets] of linkGraph.forward) {
    if (!adjacency.has(src)) adjacency.set(src, new Set())
    for (const t of targets) {
      if (!adjacency.has(t)) adjacency.set(t, new Set())
      adjacency.get(src)!.add(t)
      adjacency.get(t)!.add(src)
    }
  }

  const visited = new Set<string>()
  const clusters: HealthReport["clusters"] = []

  for (const path of allPaths) {
    if (visited.has(path)) continue
    const members: string[] = []
    const queue = [path]
    visited.add(path)
    while (queue.length > 0) {
      const current = queue.pop()!
      members.push(current)
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }
    members.sort()
    clusters.push({ size: members.length, members })
  }
  clusters.sort((a, b) => b.size - a.size)

  const linkedNotes = allPaths.size - orphanNotes.length

  return { totalNotes: allPaths.size, linkedNotes, orphanNotes, hubNotes, clusters }
}

function formatLifecycleSection(result: StaleResult): string {
  const lines: string[] = ["## Lifecycle"]
  const parts: string[] = []
  if (result.staleCount > 0) parts.push(`${result.staleCount} marked stale`)
  if (result.activatedCount > 0) parts.push(`${result.activatedCount} reactivated`)
  if (result.deletedCount > 0) parts.push(`${result.deletedCount} deleted: ${result.deletedPaths.join(", ")}`)
  if (result.staleSynced.length > 0) parts.push(`⚠ Stale notes still synced to projects: ${result.staleSynced.join(", ")}. Run sync to update, or update the notes to reactivate them.`)
  lines.push(parts.length > 0 ? parts.join(", ") : "No lifecycle changes")
  return lines.join("\n")
}

export function formatHealthReport(report: HealthReport, staleResult?: StaleResult): string {
  const lines: string[] = []

  if (staleResult) {
    lines.push(formatLifecycleSection(staleResult))
    lines.push("")
  }

  lines.push("## Overview")
  lines.push(`- Total notes: ${report.totalNotes}`)
  lines.push(`- Linked: ${report.linkedNotes}`)
  lines.push(`- Orphans: ${report.orphanNotes.length}`)

  lines.push("")
  lines.push("## Hubs")
  if (report.hubNotes.length === 0) {
    lines.push("No hub notes found.")
  } else {
    for (const hub of report.hubNotes) {
      lines.push(`- ${hub.title} (${hub.relativePath}) — degree ${hub.degree}`)
    }
  }

  lines.push("")
  lines.push("## Orphans")
  if (report.orphanNotes.length === 0) {
    lines.push("No orphan notes found.")
  } else {
    for (const orphan of report.orphanNotes) {
      lines.push(`- ${orphan.title} (${orphan.relativePath})`)
    }
  }

  lines.push("")
  lines.push("## Clusters")
  if (report.clusters.length === 0) {
    lines.push("No clusters found.")
  } else {
    for (let i = 0; i < report.clusters.length; i++) {
      const cluster = report.clusters[i]!
      lines.push(`- Cluster ${i + 1}: ${cluster.size} notes — ${cluster.members.join(", ")}`)
    }
  }

  return lines.join("\n")
}

export const healthTool: ToolDefinition = {
  name: "health",
  description: "Run vault lifecycle hygiene and analyze health: stale/expired notes, orphans, hubs, and clusters",
  handler: async (_args, ctx) => {
    const staleResult = await markStaleNotes(ctx.entries, ctx.vaultPath)
    if (staleResult.stalePaths.length > 0) {
      staleResult.staleSynced = await detectStaleSynced(staleResult.stalePaths, process.cwd())
    }
    const report = analyzeHealth(ctx.entries, ctx.linkGraph)
    return { text: formatHealthReport(report, staleResult) }
  },
}
