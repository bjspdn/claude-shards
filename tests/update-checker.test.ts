import { test, expect } from "bun:test"
import { parseChangelog } from "../src/update-checker"

const SAMPLE = `## 0.13.0

- Real-time file sync
- Diagnostics MCP tool
- Update notifier

## 0.12.0

- Batched research tool
- Web page fetcher
`

test("parseChangelog extracts bullet points for a version", () => {
  const notes = parseChangelog(SAMPLE, "0.13.0")
  expect(notes).toEqual([
    "Real-time file sync",
    "Diagnostics MCP tool",
    "Update notifier",
  ])
})

test("parseChangelog extracts last section without trailing heading", () => {
  const notes = parseChangelog(SAMPLE, "0.12.0")
  expect(notes).toEqual([
    "Batched research tool",
    "Web page fetcher",
  ])
})

test("parseChangelog returns empty array for unknown version", () => {
  expect(parseChangelog(SAMPLE, "0.99.0")).toEqual([])
})
