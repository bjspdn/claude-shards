import { parse, stringify } from "smol-toml"
import { ProjectConfigSchema, type ProjectConfig } from "./types"
import { join, basename } from "path"

export async function loadProjectConfig(dir: string): Promise<ProjectConfig | null> {
  const configPath = join(dir, ".context.toml")
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

export async function createDefaultConfig(dir: string): Promise<ProjectConfig> {
  const config = { project: { name: basename(dir) } }
  const configPath = join(dir, ".context.toml")
  await Bun.write(configPath, stringify(config) + "\n")
  return config
}
