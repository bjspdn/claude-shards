import { mkdir } from "fs/promises"
import { join } from "path"
import { homedir } from "os"
import { formatDate } from "../utils"
import { buildSeedNotes } from "./seed"
import { registerVaultWithObsidian } from "./obsidian"
import { registerMcpServer } from "./claude-code"

export const VAULT_PATH = join(homedir(), ".ccm", "knowledge-base")

const SUBDIRS = ["gotchas", "decisions", "patterns", "references", "_templates"]

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

export async function executeInit(): Promise<InitResult> {
  const steps: InitStep[] = []

  await mkdir(VAULT_PATH, { recursive: true })
  steps.push({ name: "vault directory", status: "created", detail: VAULT_PATH })

  for (const sub of SUBDIRS) {
    await mkdir(join(VAULT_PATH, sub), { recursive: true })
  }
  steps.push({ name: "subdirectories", status: "created", detail: SUBDIRS.join(", ") })

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

export function formatInitSummary(result: InitResult): string {
  const lines = [
    "ccm init",
    `  vault: ${result.vaultPath}`,
    "",
  ]

  for (const step of result.steps) {
    const icon = step.status === "created" ? "+" : step.status === "skipped" ? "-" : "!"
    const detail = step.detail ? ` (${step.detail})` : ""
    lines.push(`  [${icon}] ${step.name}${detail}`)
  }

  const created = result.steps.filter((s) => s.status === "created").length
  const skipped = result.steps.filter((s) => s.status === "skipped").length
  const failed = result.steps.filter((s) => s.status === "failed").length

  lines.push("")
  lines.push(`  ${created} created, ${skipped} skipped, ${failed} failed`)

  return lines.join("\n")
}
