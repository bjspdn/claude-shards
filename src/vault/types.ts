import { z } from "zod"

export const NoteType = z.enum(["gotcha", "decision", "pattern", "reference"])
export type NoteType = z.infer<typeof NoteType>

export const NOTE_TYPE_ICONS: Record<NoteType, string> = {
  gotcha: "\uD83D\uDD34",
  decision: "\uD83D\uDFE4",
  pattern: "\uD83D\uDD35",
  reference: "\uD83D\uDFE2",
}

export const NOTE_TYPE_PRIORITY: Record<NoteType, number> = {
  gotcha: 0,
  decision: 1,
  pattern: 2,
  reference: 3,
}

export const NoteFrontmatter = z.object({
  type: NoteType,
  projects: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
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
