import { mkdir, readFile } from "fs/promises"
import { join, dirname } from "path"
import { C } from "../utils"
import { VAULT_BUNDLE } from "./vault-bundle.gen"
import { loadManifest, saveManifest, hashContent, type VaultManifest } from "./vault-manifest"
import { registerVaultWithObsidian } from "./obsidian"
import { installGlobal, registerMcpServer } from "./claude-code"
import config from "../config"
import { detectLegacyLayout, executeMigration } from "./migrate"

export type StepStatus = "created" | "skipped" | "failed"

export type InitStep = {
  name: string
  status: StepStatus
  detail: string
}

export type InitResult = {
  vaultPath: string
  steps: InitStep[]
}

export async function executeInit(vaultPathOverride?: string): Promise<InitResult> {
  const steps: InitStep[] = []
  const VAULT_PATH = vaultPathOverride ?? config.paths.vaultPath
  await mkdir(VAULT_PATH, { recursive: true })
  steps.push({ name: "vault directory", status: "created", detail: VAULT_PATH })

  const previousManifest = await loadManifest(VAULT_PATH)
  const newManifest: VaultManifest = {
    version: process.env.npm_package_version ?? "0.0.0",
    files: {},
  }

  for (const [relativePath, content] of Object.entries(VAULT_BUNDLE)) {
    if (relativePath.endsWith("/")) {
      await mkdir(join(VAULT_PATH, relativePath), { recursive: true })
      continue
    }

    const fullPath = join(VAULT_PATH, relativePath)
    const bundleHash = hashContent(content)
    newManifest.files[relativePath] = bundleHash

    await mkdir(dirname(fullPath), { recursive: true })

    const file = Bun.file(fullPath)
    if (await file.exists()) {
      const existingContent = await readFile(fullPath, "utf-8")
      const existingHash = hashContent(existingContent)
      const previousHash = previousManifest?.files[relativePath]

      if (previousHash && existingHash !== previousHash) {
        steps.push({ name: relativePath, status: "skipped", detail: "user modified" })
        continue
      }

      if (existingHash === bundleHash) {
        continue
      }
    }

    const data = content.startsWith("base64:")
      ? Buffer.from(content.slice(7), "base64")
      : content
    await Bun.write(fullPath, data)
    steps.push({ name: relativePath, status: "created", detail: "" })
  }

  await saveManifest(VAULT_PATH, newManifest)

  if (await detectLegacyLayout(VAULT_PATH)) {
    const migration = await executeMigration(VAULT_PATH)
    if (migration.moved.length > 0) {
      const detail = `${migration.moved.length} notes moved to tag-based folders`
      steps.push({ name: "folder migration", status: "created", detail })
    }
    for (const dir of migration.removedDirs) {
      steps.push({ name: `remove ${dir}/`, status: "created", detail: "empty legacy folder" })
    }
  }

  const obsidianResult = await registerVaultWithObsidian(VAULT_PATH)
  if ("registered" in obsidianResult) {
    steps.push({
      name: "Obsidian registration",
      status: "created",
      detail: `vault ID: ${obsidianResult.vaultId}`,
    })
  } else {
    steps.push({
      name: "Obsidian registration",
      status: "skipped",
      detail: obsidianResult.reason,
    })
  }

  const installResult = await installGlobal()
  if (installResult.success) {
    steps.push({ name: "global install", status: "created", detail: "claude-shards binary installed" })
  } else {
    steps.push({ name: "global install", status: "failed", detail: installResult.error })
  }

  const mcpResult = await registerMcpServer()
  if (mcpResult.success) {
    steps.push({ name: "Claude Code MCP", status: "created", detail: mcpResult.output })
  } else {
    steps.push({
      name: "Claude Code MCP",
      status: "failed",
      detail: `${mcpResult.error}\n  Run manually: ${mcpResult.manualCommand}`,
    })
  }

  return { vaultPath: VAULT_PATH, steps }
}

function formatStep(step: InitStep): string {
  const icons = {
    created: `${C.green}+${C.reset}`,
    skipped: `${C.yellow}-${C.reset}`,
    failed: `${C.red}!${C.reset}`,
  }
  const detail = step.detail ? ` ${C.dim}(${step.detail})${C.reset}` : ""
  return `  ${icons[step.status]} ${step.name}${detail}`
}

export function formatInitSummary(result: InitResult): string {
  const lines = [
    `${C.bold}claude-shards init${C.reset}`,
    `${C.dim}vault:${C.reset} ${result.vaultPath}`,
    "",
    ...result.steps.map(formatStep),
  ]

  const created = result.steps.filter((s) => s.status === "created").length
  const skipped = result.steps.filter((s) => s.status === "skipped").length
  const failed = result.steps.filter((s) => s.status === "failed").length

  lines.push("")
  if (failed > 0) {
    lines.push(`${C.red}${created} created, ${skipped} skipped, ${failed} failed${C.reset}`)
  } else {
    lines.push(`${C.green}${created} created${C.reset}, ${skipped} skipped`)
  }

  return lines.join("\n")
}
