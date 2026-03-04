import { mkdir } from "fs/promises"
import { join } from "path"
import { formatDate, C } from "../utils"
import { buildSeedNotes } from "./seed"
import { registerVaultWithObsidian } from "./obsidian"
import { installGlobal, registerMcpServer } from "./claude-code"
import config from "../config"

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
  const subdirs = [...config.noteTypes, "_templates"]

  await mkdir(VAULT_PATH, { recursive: true })
  steps.push({ name: "vault directory", status: "created", detail: VAULT_PATH })

  for (const sub of subdirs) {
    await mkdir(join(VAULT_PATH, sub), { recursive: true })
  }
  steps.push({ name: "subdirectories", status: "created", detail: subdirs.join(", ") })

  const dotObsidian = join(VAULT_PATH, ".obsidian")
  await mkdir(dotObsidian, { recursive: true })

  const dateStr = formatDate(new Date())
  const seedNotes = buildSeedNotes(dateStr)
  for (const note of seedNotes) {
    const fullPath = join(VAULT_PATH, note.relativePath)
    const file = Bun.file(fullPath)
    if (await file.exists()) {
      steps.push({ name: note.relativePath, status: "skipped", detail: "already exists" })
    } else {
      await mkdir(join(VAULT_PATH, note.relativePath, ".."), { recursive: true })
      await Bun.write(fullPath, note.content)
      steps.push({ name: note.relativePath, status: "created", detail: "" })
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
