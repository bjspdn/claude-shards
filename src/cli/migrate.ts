import { readdir, rename, mkdir, rmdir } from "fs/promises"
import { join, basename } from "path"
import matter from "gray-matter"
import { draftFolder } from "../vault/paths"

const LEGACY_FOLDERS = ["gotchas", "decisions", "patterns", "references"]

export interface MigrationResult {
  moved: { from: string; to: string }[]
  skipped: string[]
  removedDirs: string[]
}

export async function detectLegacyLayout(vaultPath: string): Promise<boolean> {
  for (const folder of LEGACY_FOLDERS) {
    const dirPath = join(vaultPath, folder)
    try {
      const entries = await readdir(dirPath)
      if (entries.some((e) => e.endsWith(".md"))) return true
    } catch {}
  }
  return false
}

async function resolveCollision(targetPath: string): Promise<string> {
  const file = Bun.file(targetPath)
  if (!(await file.exists())) return targetPath

  const base = targetPath.replace(/\.md$/, "")
  let i = 2
  while (await Bun.file(`${base}-${i}.md`).exists()) i++
  return `${base}-${i}.md`
}

export async function executeMigration(vaultPath: string): Promise<MigrationResult> {
  const result: MigrationResult = { moved: [], skipped: [], removedDirs: [] }

  for (const folder of LEGACY_FOLDERS) {
    const dirPath = join(vaultPath, folder)
    let entries: string[]
    try {
      entries = await readdir(dirPath)
    } catch {
      continue
    }

    const mdFiles = entries.filter((e) => e.endsWith(".md"))

    for (const file of mdFiles) {
      const srcPath = join(dirPath, file)
      const srcRelative = `${folder}/${file}`

      let tags: string[] | undefined
      try {
        const raw = await Bun.file(srcPath).text()
        const { data } = matter(raw)
        tags = Array.isArray(data.tags) ? data.tags : undefined
      } catch {
        result.skipped.push(srcRelative)
        continue
      }

      const targetFolder = draftFolder(tags)
      const targetDir = join(vaultPath, targetFolder)
      await mkdir(targetDir, { recursive: true })

      const targetPath = await resolveCollision(join(targetDir, file))
      const targetRelative = targetPath.slice(vaultPath.length + 1)

      if (srcPath === targetPath) {
        result.skipped.push(srcRelative)
        continue
      }

      await rename(srcPath, targetPath)
      result.moved.push({ from: srcRelative, to: targetRelative })
    }

    try {
      const remaining = await readdir(dirPath)
      if (remaining.length === 0) {
        await rmdir(dirPath)
        result.removedDirs.push(folder)
      }
    } catch {}
  }

  return result
}
