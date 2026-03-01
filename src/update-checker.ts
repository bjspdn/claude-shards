import pkg from "../package.json" with { type: "json" }

const NPM_URL = "https://registry.npmjs.org/@bennys001/claude-code-memory/latest"

let latestVersion: string | null = null

export async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(NPM_URL)
  if (!res.ok) throw new Error(`npm registry returned ${res.status}`)
  const data = (await res.json()) as { version: string }
  return data.version
}

export function initUpdateCheck(): void {
  fetchLatestVersion()
    .then((v) => { latestVersion = v })
    .catch(() => {})
}

export function getUpdateNotice(): string {
  if (!latestVersion || latestVersion === pkg.version) return ""
  return `\n\n---\nUpdate available: v${pkg.version} → v${latestVersion} — run \`ccm --update\``
}
