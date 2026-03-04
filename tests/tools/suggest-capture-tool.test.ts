import { test, expect } from "bun:test"
import {
  generateSlug,
  generateMotivation,
  executeSuggestCapture,
  formatSuggestion,
  type CaptureSuggestion,
} from "../../src/tools/suggest-capture-tool"
import { loadVault } from "../../src/vault/loader"
import { buildIdfTable } from "../../src/tools/bm25"
import type { NoteEntry } from "../../src/vault/types"
import { join } from "path"
import { existsSync, readdirSync, statSync } from "fs"

const VAULT = join(import.meta.dir, "../fixtures/vault")

let entries: Awaited<ReturnType<typeof loadVault>>
let idf: ReturnType<typeof buildIdfTable>

const setup = loadVault(VAULT).then((e) => {
  entries = e
  idf = buildIdfTable(e)
})

test("generateSlug produces valid slug from topic", () => {
  expect(generateSlug("Bevy System Ordering")).toBe("bevy-system-ordering")
})

test("generateSlug strips leading/trailing hyphens", () => {
  expect(generateSlug("--hello world--")).toBe("hello-world")
})

test("generateSlug truncates to 60 chars", () => {
  const long = "a".repeat(100)
  expect(generateSlug(long).length).toBeLessThanOrEqual(60)
})

test("generateSlug handles special characters", () => {
  expect(generateSlug("foo@bar#baz!qux")).toBe("foo-bar-baz-qux")
})

test("generateMotivation trims to word boundary", () => {
  const context =
    "This is a context string that is definitely longer than eighty characters and should be trimmed at a word boundary properly"
  const motivation = generateMotivation(context)
  expect(motivation.length).toBeLessThanOrEqual(120)
  expect(motivation).not.toEndWith(" ")
  expect(context.startsWith(motivation)).toBe(true)
})

test("generateMotivation returns full text when short", () => {
  const short = "Short context"
  expect(generateMotivation(short)).toBe("Short context")
})

test("executeSuggestCapture generates correct path and type", async () => {
  await setup
  const result = executeSuggestCapture(
    { topic: "new pattern", type: "patterns", context: "Some reusable pattern" },
    entries,
    undefined,
    idf,
  )
  expect(result.draftPath).toBe("_unsorted/new-pattern.md")
  expect(result.draftFrontmatter.type).toBe("patterns")
})

test("executeSuggestCapture finds similar existing notes", async () => {
  await setup
  const result = executeSuggestCapture(
    { topic: "Bevy system ordering", type: "gotchas", context: "Systems run in parallel by default" },
    entries,
    undefined,
    idf,
  )
  expect(result.similarNotes.length).toBeGreaterThan(0)
  expect(result.similarNotes[0]!.title.toLowerCase()).toContain("bevy")
})

test("executeSuggestCapture uses first tag as folder", async () => {
  await setup
  const result = executeSuggestCapture(
    { topic: "new pattern", type: "patterns", context: "Some pattern", tags: ["rust", "lifetimes"] },
    entries,
    undefined,
    idf,
  )
  expect(result.draftPath).toBe("rust/new-pattern.md")
})

test("tags and projects pass through correctly", async () => {
  await setup
  const result = executeSuggestCapture(
    {
      topic: "test topic",
      type: "decisions",
      context: "Some decision context",
      tags: ["typescript", "testing"],
      projects: ["my-project"],
    },
    entries,
    undefined,
    idf,
  )
  expect(result.draftFrontmatter.tags).toEqual(["typescript", "testing"])
  expect(result.draftFrontmatter.projects).toEqual(["my-project"])
})

test("tags and projects default to empty arrays", async () => {
  await setup
  const result = executeSuggestCapture(
    { topic: "test topic", type: "gotchas", context: "Some context" },
    entries,
    undefined,
    idf,
  )
  expect(result.draftFrontmatter.tags).toEqual([])
  expect(result.draftFrontmatter.projects).toEqual([])
})

test("suggestUpdate is set when similarity is high", () => {
  const fakeEntries: NoteEntry[] = [
    {
      frontmatter: {
        type: "gotchas",
        tags: ["exact-match"],
        projects: [],
        decisions: [],
        patterns: [],
        gotchas: [],
        references: [],
        created: new Date(),
        updated: new Date(),
        description: "exact match note",
        status: "active",
      },
      filePath: "/vault/gotchas/exact-match.md",
      relativePath: "gotchas/exact-match.md",
      title: "exact match note",
      body: "exact match note body exact match",
      tokenCount: 10,
    },
  ]
  const fakeIdf = buildIdfTable(fakeEntries)

  const result = executeSuggestCapture(
    { topic: "exact match note", type: "gotchas", context: "Some context" },
    fakeEntries,
    undefined,
    fakeIdf,
  )

  expect(result.suggestUpdate).toBeDefined()
  expect(result.suggestUpdate!.relativePath).toBe("gotchas/exact-match.md")
  expect(result.suggestUpdate!.score).toBeGreaterThanOrEqual(0.7)
})

test("suggestUpdate is undefined when no similar notes exist", async () => {
  await setup
  const result = executeSuggestCapture(
    { topic: "xyznonexistent qqq zzz", type: "gotchas", context: "Something completely unique" },
    entries,
    undefined,
    idf,
  )
  expect(result.suggestUpdate).toBeUndefined()
})

test("does not write to disk", async () => {
  await setup
  const vaultDirs = ["gotchas", "decisions", "patterns", "references"]
  const before: Record<string, string[]> = {}
  for (const dir of vaultDirs) {
    const dirPath = join(VAULT, dir)
    if (existsSync(dirPath)) {
      before[dir] = readdirSync(dirPath)
    }
  }

  executeSuggestCapture(
    {
      topic: "should not create file",
      type: "gotchas",
      context: "This should never be written",
      tags: ["test"],
    },
    entries,
    undefined,
    idf,
  )

  for (const dir of vaultDirs) {
    const dirPath = join(VAULT, dir)
    if (existsSync(dirPath)) {
      expect(readdirSync(dirPath)).toEqual(before[dir])
    }
  }
})

test("formatSuggestion contains draft path", async () => {
  await setup
  const suggestion = executeSuggestCapture(
    { topic: "test format", type: "patterns", context: "Format test context" },
    entries,
    undefined,
    idf,
  )
  const output = formatSuggestion(suggestion)
  expect(output).toContain("**Draft path:**")
  expect(output).toContain("_unsorted/test-format.md")
})

test("formatSuggestion contains frontmatter yaml block", async () => {
  await setup
  const suggestion = executeSuggestCapture(
    { topic: "yaml test", type: "gotchas", context: "Testing yaml output", tags: ["test-tag"] },
    entries,
    undefined,
    idf,
  )
  const output = formatSuggestion(suggestion)
  expect(output).toContain("```yaml")
  expect(output).toContain("type: gotchas")
  expect(output).toContain("test-tag")
})

test("formatSuggestion contains body preview", async () => {
  await setup
  const suggestion = executeSuggestCapture(
    { topic: "body test", type: "references", context: "The actual body content here" },
    entries,
    undefined,
    idf,
  )
  const output = formatSuggestion(suggestion)
  expect(output).toContain("**Body preview:**")
  expect(output).toContain("The actual body content here")
})

test("formatSuggestion shows similar notes when present", async () => {
  await setup
  const suggestion = executeSuggestCapture(
    { topic: "Bevy system ordering", type: "gotchas", context: "Systems run in parallel" },
    entries,
    undefined,
    idf,
  )
  const output = formatSuggestion(suggestion)
  expect(output).toContain("**Similar existing notes:**")
})

test("formatSuggestion shows update suggestion when score is high", () => {
  const suggestion: CaptureSuggestion = {
    draftPath: "gotchas/test.md",
    draftFrontmatter: { type: "gotchas", tags: [], projects: [], motivation: "test" },
    draftBody: "test body",
    motivation: "test",
    similarNotes: [{ title: "Existing Note", relativePath: "gotchas/existing.md", score: 0.85 }],
    suggestUpdate: { title: "Existing Note", relativePath: "gotchas/existing.md", score: 0.85 },
  }
  const output = formatSuggestion(suggestion)
  expect(output).toContain("**Consider updating existing note:**")
  expect(output).toContain("Existing Note")
  expect(output).toContain("0.85")
})

test("draftBody is the raw context passed in", async () => {
  await setup
  const context = "Exact context string to verify"
  const result = executeSuggestCapture(
    { topic: "passthrough", type: "decisions", context },
    entries,
    undefined,
    idf,
  )
  expect(result.draftBody).toBe(context)
})
