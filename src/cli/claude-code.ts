import { spawn } from "child_process"

export type McpRegisterResult =
  | { success: true; output: string }
  | { success: false; error: string; manualCommand: string }

export type GlobalInstallResult =
  | { success: true }
  | { success: false; error: string }

export const SERVER_CMD = ["ccm", "--stdio"]

export function installGlobal(): Promise<GlobalInstallResult> {
  return new Promise((resolve) => {
    let stderr = ""

    const proc = spawn("bun", ["install", "-g", "@bennys001/claude-code-memory"], { stdio: ["ignore", "ignore", "pipe"] })

    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString() })

    proc.on("error", (err: NodeJS.ErrnoException) => {
      resolve({ success: false, error: err.message })
    })

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: stderr.trim() || `bun install exited with code ${code}` })
      }
    })
  })
}

export function uninstallGlobal(): Promise<GlobalInstallResult> {
  return new Promise((resolve) => {
    let stderr = ""

    const proc = spawn("bun", ["remove", "-g", "@bennys001/claude-code-memory"], { stdio: ["ignore", "ignore", "pipe"] })

    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString() })

    proc.on("error", (err: NodeJS.ErrnoException) => {
      resolve({ success: false, error: err.message })
    })

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: stderr.trim() || `bun remove exited with code ${code}` })
      }
    })
  })
}

const REGISTER_ARGS = [
  "mcp", "add",
  "--transport", "stdio",
  "--scope", "user",
  "ccm",
  "--",
  ...SERVER_CMD,
]

const MANUAL_COMMAND = `claude mcp add --transport stdio --scope user ccm -- ${SERVER_CMD.join(" ")}`

export function removeMcpServer(): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["mcp", "remove", "ccm"], { stdio: "ignore" })
    proc.on("error", () => resolve())
    proc.on("close", () => resolve())
  })
}

export async function registerMcpServer(): Promise<McpRegisterResult> {
  await removeMcpServer()

  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""

    const proc = spawn("claude", REGISTER_ARGS, { stdio: "pipe" })

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString() })
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString() })

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        resolve({
          success: false,
          error: "Claude CLI not found in PATH",
          manualCommand: MANUAL_COMMAND,
        })
      } else {
        resolve({
          success: false,
          error: err.message,
          manualCommand: MANUAL_COMMAND,
        })
      }
    })

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, output: (stdout || stderr).trim() })
      } else {
        resolve({
          success: false,
          error: (stderr || stdout).trim() || `Process exited with code ${code}`,
          manualCommand: MANUAL_COMMAND,
        })
      }
    })
  })
}
