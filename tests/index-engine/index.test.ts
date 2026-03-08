import { test, expect } from "bun:test"
import {
  buildIndexTable,
  formatKnowledgeSection,
  injectKnowledgeSection,
} from "../../src/index-engine/index"
import type { NoteEntry } from "../../src/vault/types"

const MOCK_ENTRIES: NoteEntry[] = [
  {
    frontmatter: {
      type: "gotchas",
      tags: ["bevy"],
      created: new Date(),
      updated: new Date(),
      status: "active",
    },
    filePath: "/vault/gotchas/ordering.md",
    relativePath: "gotchas/ordering.md",
    title: "System ordering matters",
    body: "Some body text",
    tokenCount: 127,
  },
  {
    frontmatter: {
      type: "decisions",
      tags: ["typescript"],
      created: new Date(),
      updated: new Date(),
      status: "active",
    },
    filePath: "/vault/decisions/bun.md",
    relativePath: "decisions/bun.md",
    title: "Use Bun over Node",
    body: "Reasons here",
    tokenCount: 83,
  },
]

test("buildIndexTable generates padded markdown table with 4 columns", () => {
  const table = buildIndexTable(MOCK_ENTRIES)
  const lines = table.split("\n")
  expect(lines).toHaveLength(4)
  expect(lines[0]).toContain("| T")
  expect(lines[0]).toContain("Title")
  expect(lines[0]).not.toContain("S")
  expect(lines[1]).toMatch(/^\|[-]+\|[-]+\|[-]+\|[-]+\|$/)
  expect(lines[2]).toContain("System ordering matters")
  expect(lines[2]).toContain("gotchas/ordering.md")
  expect(lines[3]).toContain("Use Bun over Node")
  expect(lines[3]).toContain("decisions/bun.md")
  const rowLengths = lines.filter((_, i) => i !== 1).map((l) => l.length)
  expect(new Set(rowLengths).size).toBe(1)
})

test("buildIndexTable uses description over title when available", () => {
  const entries: NoteEntry[] = [
    {
      frontmatter: {
        type: "gotchas",
        description: "A concise description",
        tags: [],
        created: new Date(),
        updated: new Date(),
        status: "active",
      },
      filePath: "/vault/gotchas/test.md",
      relativePath: "gotchas/test.md",
      title: "The Full Title",
      body: "body",
      tokenCount: 50,
    },
  ]
  const table = buildIndexTable(entries)
  expect(table).toContain("A concise description")
  expect(table).not.toContain("The Full Title")
})

test("buildIndexTable returns empty message for no entries", () => {
  const table = buildIndexTable([])
  expect(table).toContain("No knowledge entries")
})

test("formatKnowledgeSection wraps table with header and legend", () => {
  const section = formatKnowledgeSection(MOCK_ENTRIES)
  expect(section).toContain("## Knowledge Index")
  expect(section).toContain("Notes listed here are auto-loaded into context.")
  expect(section).toContain("🔴 = gotchas")
  expect(section).toContain("| T")
  expect(section).toContain("Title")
})

test("injectKnowledgeSection prepends to file without existing section", () => {
  const existing = "# My Project\n\nSome content here.\n"
  const result = injectKnowledgeSection(existing, MOCK_ENTRIES)
  expect(result).toContain("# My Project")
  expect(result).toContain("Some content here.")
  expect(result).toContain("## Knowledge Index")
  expect(result.indexOf("## Knowledge Index")).toBeLessThan(
    result.indexOf("# My Project"),
  )
})

test("injectKnowledgeSection replaces existing Knowledge Index section", () => {
  const existing = [
    "# My Project",
    "",
    "## Knowledge Index",
    "Old index content here.",
    "| old | table |",
    "",
    "## Other Section",
    "Keep this.",
  ].join("\n")
  const result = injectKnowledgeSection(existing, MOCK_ENTRIES)
  expect(result).not.toContain("Old index content")
  expect(result).toContain("## Knowledge Index")
  expect(result).toContain("System ordering matters")
  expect(result).toContain("## Other Section")
  expect(result).toContain("Keep this.")
})

test("injectKnowledgeSection replaces section at end of file", () => {
  const existing = "# My Project\n\n## Knowledge Index\nOld stuff.\n"
  const result = injectKnowledgeSection(existing, MOCK_ENTRIES)
  expect(result).not.toContain("Old stuff")
  expect(result).toContain("## Knowledge Index")
  expect(result).toContain("System ordering matters")
})
