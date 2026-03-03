import { z } from "zod"

export const NoteType = z.enum(["gotchas", "decisions", "patterns", "references"])
export type NoteType = z.infer<typeof NoteType>

export const NOTE_TYPE_ICONS: Record<NoteType, string> = {
  gotchas: "\uD83D\uDD34",
  decisions: "\uD83D\uDFE4",
  patterns: "\uD83D\uDD35",
  references: "\uD83D\uDFE2",
}

export const NOTE_TYPE_PRIORITY: Record<NoteType, number> = {
  gotchas: 0,
  decisions: 1,
  patterns: 2,
  references: 3,
}

export const NoteFrontmatter = z.object({
  type: NoteType,
  projects: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  links: z.array(z.string()).default([]),
  created: z.coerce.date(),
  updated: z.coerce.date(),
  title: z.string().optional(),
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
