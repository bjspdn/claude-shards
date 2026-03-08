import { readFile, writeFile, copyFile } from "fs/promises"
import { join } from "path"
import { randomBytes } from "crypto"
import { homedir } from "os"
import { z } from "zod"

const ObsidianVaultSchema = z.object({
  path: z.string(),
  ts: z.number(),
  open: z.boolean().optional(),
})

const ObsidianConfigSchema = z.looseObject({
  vaults: z.record(z.string(), ObsidianVaultSchema),
})

type ObsidianConfig = z.infer<typeof ObsidianConfigSchema>

export type RegisterResult =
  | { registered: true; vaultId: string }
  | { skipped: true; reason: string; vaultId?: string }

function getObsidianPath() {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json")
  } else {
    return join(homedir(), ".config", "obsidian", "obsidian.json")
  }
}

const DEFAULT_CONFIG_PATH = join(homedir(), ".config/obsidian/obsidian.json")

export function generateVaultId(): string {
  return randomBytes(8).toString("hex")
}

export async function loadObsidianConfig(
  configPath = DEFAULT_CONFIG_PATH,
): Promise<ObsidianConfig | null> {
  try {
    const raw = await readFile(configPath, "utf-8")
    return ObsidianConfigSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export function findVaultByPath(
  config: ObsidianConfig,
  vaultPath: string,
): string | null {
  for (const [id, vault] of Object.entries(config.vaults)) {
    if (vault.path === vaultPath) return id
  }
  return null
}

export async function registerVaultWithObsidian(
  vaultPath: string,
  configPath = DEFAULT_CONFIG_PATH,
): Promise<RegisterResult> {
  const config = await loadObsidianConfig(configPath)

  if (!config) {
    return { skipped: true, reason: "Obsidian not installed (config not found)" }
  }

  const existingId = findVaultByPath(config, vaultPath)
  if (existingId) {
    return { skipped: true, reason: "Vault already registered", vaultId: existingId }
  }

  await copyFile(configPath, `${configPath}.backup`)

  const vaultId = generateVaultId()
  config.vaults[vaultId] = {
    path: vaultPath,
    ts: Date.now(),
    open: true,
  }

  await writeFile(configPath, JSON.stringify(config, null, 2))

  return { registered: true, vaultId }
}

export async function unregisterVaultFromObsidian(
  vaultPath: string,
  configPath = DEFAULT_CONFIG_PATH,
): Promise<boolean> {
  const config = await loadObsidianConfig(configPath)
  if (!config) return false

  const vaultId = findVaultByPath(config, vaultPath)
  if (!vaultId) return false

  await copyFile(configPath, `${configPath}.backup`)
  delete config.vaults[vaultId]
  await writeFile(configPath, JSON.stringify(config, null, 2))
  return true
}
