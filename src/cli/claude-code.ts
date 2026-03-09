import { spawn } from "child_process"

export type McpRegisterResult =
  | { success: true; output: string }
  | { success: false; error: string; manualCommand: string }

export const SERVER_CMD = ["claude-shards", "--stdio"]

const REGISTER_ARGS = [
  "mcp", "add",
  "--transport", "stdio",
  "--scope", "user",
  "claude-shards",
  "--",
  ...SERVER_CMD,
]

const MANUAL_COMMAND = `claude mcp add --transport stdio --scope user claude-shards -- ${SERVER_CMD.join(" ")}`

export function removeMcpServer(): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["mcp", "remove", "claude-shards"], { stdio: "ignore" })
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
