import { readdir, readFile } from "fs/promises"
import { join, relative } from "path"

const VAULT_TEMPLATE_DIR = join(import.meta.dir, "..", "vault-template")
const OUTPUT_FILE = join(import.meta.dir, "..", "src", "cli", "vault-bundle.gen.ts")

const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot"])

async function collectFiles(dir: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>()

  async function walk(currentDir: string) {
    const items = await readdir(currentDir, { withFileTypes: true })
    for (const item of items) {
      const fullPath = join(currentDir, item.name)
      if (item.isDirectory()) {
        if (item.name === ".git") continue
        const relPath = relative(VAULT_TEMPLATE_DIR, fullPath)
        entries.set(relPath + "/", "")
        await walk(fullPath)
      } else {
        const relPath = relative(VAULT_TEMPLATE_DIR, fullPath)
        const ext = relPath.substring(relPath.lastIndexOf("."))
        if (BINARY_EXTENSIONS.has(ext)) {
          const buf = await readFile(fullPath)
          entries.set(relPath, "base64:" + buf.toString("base64"))
        } else {
          entries.set(relPath, await readFile(fullPath, "utf-8"))
        }
      }
    }
  }

  await walk(VAULT_TEMPLATE_DIR)
  return entries
}

async function main() {
  const files = await collectFiles(VAULT_TEMPLATE_DIR)

  const lines = [
    "// AUTO-GENERATED — do not edit. Run `bun scripts/bundle-vault.ts` to regenerate.",
    "export const VAULT_BUNDLE: Record<string, string> = {",
  ]

  for (const [path, content] of files) {
    lines.push(`  ${JSON.stringify(path)}: ${JSON.stringify(content)},`)
  }

  lines.push("}")
  lines.push("")

  await Bun.write(OUTPUT_FILE, lines.join("\n"))
  console.log(`Generated ${OUTPUT_FILE} with ${files.size} entries`)
}

main()
