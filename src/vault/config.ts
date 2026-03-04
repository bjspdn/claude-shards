import { parse, stringify } from "smol-toml"
import { ProjectConfigSchema, type ProjectConfig, type NoteEntry } from "./types"
import { join, basename, extname } from "path"
import { Glob } from "bun"
import globalConfig from "../config"

export async function loadProjectConfig(dir: string): Promise<ProjectConfig | null> {
  const configPath = join(dir, globalConfig.paths.contextToml)
  const file = Bun.file(configPath)

  if (!(await file.exists())) return null

  try {
    const raw = await file.text()
    const parsed = parse(raw)
    const result = ProjectConfigSchema.safeParse(parsed)
    if (!result.success) {
      console.error(`Warning: Invalid .context.toml in ${dir}`)
      return null
    }
    return result.data
  } catch {
    console.error(`Warning: Failed to parse .context.toml in ${dir}`)
    return null
  }
}

function collectVaultTags(entries: NoteEntry[]): Set<string> {
  const tags = new Set<string>()
  for (const entry of entries) {
    for (const tag of entry.frontmatter.tags) {
      tags.add(tag)
    }
  }
  return tags
}

async function detectTagsFromExtensions(dir: string, vaultTags: Set<string>): Promise<string[]> {
  const glob = new Glob(`**/*.*`)
  const extensions = new Set<string>()

  for await (const path of glob.scan({ cwd: dir, dot: false, followSymlinks: false })) {
    const skip = globalConfig.discovery.ignoreDirs.some((d) =>
      d.startsWith(".")
        ? path.startsWith(".")
        : path.startsWith(d + "/"),
    )
    if (skip) continue
    const ext = extname(path).slice(1).toLowerCase()
    if (ext) extensions.add(ext)
  }

  const candidates = new Set<string>()
  for (const ext of extensions) {
    const tags = globalConfig.discovery.extToTags[ext]
    if (tags) {
      for (const tag of tags) candidates.add(tag)
    }
  }

  return [...candidates].filter((t) => vaultTags.has(t)).sort()
}

export async function createDefaultConfig(
  dir: string,
  allEntries?: NoteEntry[],
): Promise<ProjectConfig> {
  const config: ProjectConfig = { project: { name: basename(dir) } }

  if (allEntries) {
    const vaultTags = collectVaultTags(allEntries)
    const inferred = await detectTagsFromExtensions(dir, vaultTags)
    if (inferred.length > 0) {
      config.filter = { tags: inferred }
    }
  }

  const configPath = join(dir, globalConfig.paths.contextToml)
  await Bun.write(configPath, stringify(config) + "\n")
  return config
}
