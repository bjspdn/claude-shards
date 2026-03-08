import { test, expect } from "bun:test"
import { parseNote, extractTitle, countTokens } from "../../src/vault/parser"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")

test("parseNote extracts frontmatter, body, and metadata", async () => {
  const entry = await parseNote(
    join(VAULT, "gotchas/bevy-system-ordering.md"),
    VAULT,
  )
  expect(entry).not.toBeNull()
  expect(entry!.frontmatter.type).toBe("gotchas")
  expect(entry!.frontmatter.tags).toContain("bevy")
  expect(entry!.title).toBe("Bevy system ordering matters")
  expect(entry!.relativePath).toBe("gotchas/bevy-system-ordering.md")
  expect(entry!.body).toContain("Systems in Bevy")
  expect(entry!.tokenCount).toBeGreaterThan(0)
})

test("parseNote returns null for missing frontmatter", async () => {
  const entry = await parseNote(join(VAULT, "no-frontmatter.md"), VAULT)
  expect(entry).toBeNull()
})

test("parseNote returns null for invalid note type", async () => {
  const entry = await parseNote(join(VAULT, "invalid-type.md"), VAULT)
  expect(entry).toBeNull()
})

test("extractTitle prefers frontmatter title field", () => {
  expect(extractTitle({ title: "FM Title" }, "# Heading\nBody", "file.md"))
    .toBe("FM Title")
})

test("extractTitle falls back to first H1 heading", () => {
  expect(extractTitle({}, "# My Heading\nBody", "file.md"))
    .toBe("My Heading")
})

test("extractTitle falls back to filename without extension", () => {
  expect(extractTitle({}, "No heading here", "my-note.md"))
    .toBe("my-note")
})

test("countTokens returns positive count for non-empty text", () => {
  const count = countTokens("Hello world, this is a test sentence.")
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThan(20)
})

test("countTokens returns 0 for empty text", () => {
  expect(countTokens("")).toBe(0)
})
