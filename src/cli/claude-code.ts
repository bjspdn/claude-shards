import { spawn } from "child_process"
import { resolve as resolvePath } from "path"

export type McpRegisterResult =
  | { success: true; output: string }
  | { success: false; error: string; manualCommand: string }

function buildServerCommand(): string[] {
  const runtime = resolvePath(process.argv[0]!)
  const script = resolvePath(process.argv[1]!)
  return [runtime, script]
}

function buildRegisterArgs(serverCmd: string[]): string[] {
  return [
    "mcp", "add",
    "--transport", "stdio",
    "--scope", "user",
    "ccm",
    "--",
    ...serverCmd,
  ]
}

function formatManualCommand(serverCmd: string[]): string {
  return `claude mcp add --transport stdio --scope user ccm -- ${serverCmd.join(" ")}`
}

export function registerMcpServer(): Promise<McpRegisterResult> {
  const serverCmd = buildServerCommand()
  const registerArgs = buildRegisterArgs(serverCmd)
  const manualCommand = formatManualCommand(serverCmd)

  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""

    const proc = spawn("claude", registerArgs, { stdio: "pipe" })

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString() })
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString() })

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        resolve({
          success: false,
          error: "Claude CLI not found in PATH",
          manualCommand,
        })
      } else {
        resolve({
          success: false,
          error: err.message,
          manualCommand,
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
          manualCommand,
        })
      }
    })
  })
}
