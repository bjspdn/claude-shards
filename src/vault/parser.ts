import matter from "gray-matter"
import { get_encoding } from "tiktoken"
import { NoteFrontmatter, type NoteEntry } from "./types"
import { relative, basename } from "path"

const encoder = get_encoding("cl100k_base")

export function countTokens(text: string): number {
  if (!text) return 0
  return encoder.encode(text).length
}

export function extractTitle(
  frontmatter: { title?: string },
  content: string,
  filePath: string,
): string {
  if (frontmatter.title) return frontmatter.title

  const headingMatch = content.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1]!.trim()

  return basename(filePath, ".md")
}

export async function parseNote(
  filePath: string,
  vaultPath: string,
): Promise<NoteEntry | null> {
  const raw = await Bun.file(filePath).text()
  const { data, content } = matter(raw)

  const result = NoteFrontmatter.safeParse(data)
  if (!result.success) {
    console.error(`Skipping ${relative(vaultPath, filePath)}: invalid frontmatter`)
    return null
  }

  const body = content.trim()

  return {
    frontmatter: result.data,
    filePath,
    relativePath: relative(vaultPath, filePath),
    title: extractTitle(data, content, filePath),
    body,
    tokenCount: countTokens(body),
  }
}
