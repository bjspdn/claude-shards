import { z } from "zod"
import config from "../config"

export const NoteType = z.enum(["gotchas", "decisions", "patterns", "references"])
export type NoteType = z.infer<typeof NoteType>

export const NOTE_TYPE_ICONS = config.noteTypeIcons as Record<NoteType, string>
export const NOTE_TYPE_PRIORITY = config.noteTypePriority as Record<NoteType, number>

export function flattenWikilinks(val: unknown): string[] {
  if (typeof val === "string") return [val.startsWith("[[") ? val : `[[${val}]]`]
  if (Array.isArray(val)) return val.flatMap(flattenWikilinks)
  return []
}

const WikilinkArray = z.any().default([]).transform((val) => flattenWikilinks(val))

export const NoteStatus = z.enum(["active", "stale"]).default("active")
export type NoteStatus = z.infer<typeof NoteStatus>

export const NoteFrontmatter = z.object({
  type: NoteType,
  projects: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  decisions: WikilinkArray,
  patterns: WikilinkArray,
  gotchas: WikilinkArray,
  references: WikilinkArray,
  created: z.coerce.date(),
  updated: z.coerce.date(),
  title: z.string().optional(),
  description: z.string().optional(),
  motivation: z.string().optional(),
  status: NoteStatus,
  staleAt: z.coerce.date().optional(),
})
export type NoteFrontmatter = z.infer<typeof NoteFrontmatter>

export interface NoteEntry {
  frontmatter: NoteFrontmatter
  filePath: string
  relativePath: string
  title: string
  body: string
  tokenCount: number
}

export interface LinkGraph {
  forward: Map<string, Set<string>>
  reverse: Map<string, Set<string>>
}

export interface IndexEntry {
  icon: string
  title: string
  relativePath: string
  tokenDisplay: string
}

export const ProjectConfigSchema = z.object({
  project: z.object({
    name: z.string(),
  }).optional(),
  filter: z.object({
    tags: z.array(z.string()).optional(),
    types: z.array(NoteType).optional(),
    exclude: z.array(z.string()).optional(),
  }).optional(),
})
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>
