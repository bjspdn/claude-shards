import { parse } from "smol-toml"
import { ProjectConfigSchema, type ProjectConfig } from "./types"
import { join } from "path"
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
