import { C } from "../utils"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const INTERVAL = 80

export function spinner(message: string) {
  let i = 0
  const timer = setInterval(() => {
    process.stdout.write(`\r  ${C.cyan}${FRAMES[i]}${C.reset} ${message}`)
    i = (i + 1) % FRAMES.length
  }, INTERVAL)

  return {
    update(text: string) {
      message = text
    },
    succeed(text: string) {
      clearInterval(timer)
      process.stdout.write(`\r  ${C.green}+${C.reset} ${text}\x1b[K\n`)
    },
    fail(text: string) {
      clearInterval(timer)
      process.stdout.write(`\r  ${C.red}!${C.reset} ${text}\x1b[K\n`)
    },
  }
}
