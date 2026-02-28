import { readFile, writeFile, copyFile } from "fs/promises"
import { join } from "path"
import { randomBytes } from "crypto"
import { homedir } from "os"

type ObsidianVault = {
  path: string
  ts: number
  open?: boolean
}

type ObsidianConfig = {
  vaults: Record<string, ObsidianVault>
  [key: string]: unknown
}

export type RegisterResult =
  | { registered: true; vaultId: string }
  | { skipped: true; reason: string; vaultId?: string }

const DEFAULT_CONFIG_PATH = join(homedir(), ".config/obsidian/obsidian.json")

export function generateVaultId(): string {
  return randomBytes(8).toString("hex")
}

export async function loadObsidianConfig(
  configPath = DEFAULT_CONFIG_PATH,
): Promise<ObsidianConfig | null> {
  try {
    const raw = await readFile(configPath, "utf-8")
    return JSON.parse(raw) as ObsidianConfig
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
