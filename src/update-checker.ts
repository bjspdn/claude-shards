import pkg from "../package.json" with { type: "json" }

const NPM_URL = "https://registry.npmjs.org/@bennys001/claude-code-memory/latest"
const CHANGELOG_URL = "https://raw.githubusercontent.com/Ben-Spn/claude-code-memory/master/CHANGELOG.md"

let latestVersion: string | null = null
let releaseNotes: string[] = []
let checkDone: Promise<void> = Promise.resolve()

export async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(NPM_URL)
  if (!res.ok) throw new Error(`npm registry returned ${res.status}`)
  const data = (await res.json()) as { version: string }
  return data.version
}

export function parseChangelog(markdown: string, version: string): string[] {
  const heading = `## ${version}`
  const start = markdown.indexOf(heading)
  if (start === -1) return []

  const afterHeading = start + heading.length
  const nextSection = markdown.indexOf("\n## ", afterHeading)
  const section = nextSection === -1
    ? markdown.substring(afterHeading)
    : markdown.substring(afterHeading, nextSection)

  return section
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
}

export async function fetchReleaseNotes(version: string): Promise<string[]> {
  const res = await fetch(CHANGELOG_URL)
  if (!res.ok) return []
  const markdown = await res.text()
  return parseChangelog(markdown, version)
}

export function initUpdateCheck(): void {
  const done = fetchLatestVersion()
    .then(async (v) => {
      latestVersion = v
      if (v !== pkg.version) {
        releaseNotes = await fetchReleaseNotes(v)
      }
    })
    .catch(() => {})

  checkDone = Promise.race([
    done,
    new Promise<void>((resolve) => setTimeout(resolve, 4000)),
  ])
}

export function _resetForTesting(): void {
  latestVersion = null
  releaseNotes = []
  checkDone = Promise.resolve()
}

export async function getUpdateNotice(): Promise<string> {
  await checkDone
  if (!latestVersion || latestVersion === pkg.version) return ""
  const lines = [`\n\n---\nUpdate available: v${pkg.version} → v${latestVersion}`]
  if (releaseNotes.length > 0) {
    lines.push("What's new:")
    for (const note of releaseNotes) lines.push(`  - ${note}`)
  }
  lines.push("Run `ccm --update` to upgrade")
  return lines.join("\n")
}
