import { join } from "path"
import { readFile, writeFile } from "fs/promises"

export interface VaultManifest {
  version: string
  files: Record<string, string>
}

const MANIFEST_FILENAME = ".vault-manifest.json"

export function hashContent(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(content)
  return hasher.digest("hex")
}

export async function loadManifest(vaultPath: string): Promise<VaultManifest | null> {
  try {
    const raw = await readFile(join(vaultPath, MANIFEST_FILENAME), "utf-8")
    return JSON.parse(raw) as VaultManifest
  } catch {
    return null
  }
}

export async function saveManifest(vaultPath: string, manifest: VaultManifest): Promise<void> {
  await writeFile(join(vaultPath, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2) + "\n")
}
