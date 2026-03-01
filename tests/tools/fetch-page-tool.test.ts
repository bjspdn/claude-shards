import { test, expect, afterEach } from "bun:test"
import { executeFetchPage } from "../../src/tools/fetch-page-tool"
import { rm } from "fs/promises"
import { dirname } from "path"

let tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true })
  }
  tempDirs = []
})

test("returns temp file path and metadata on success", async () => {
  const fetcher = async () => ({
    title: "Test Page",
    markdown: "# Hello\n\nSome content.",
    siteName: "Example Site",
    excerpt: "A short excerpt",
  })

  const result = await executeFetchPage("https://example.com/page", fetcher)

  expect(result.ok).toBe(true)
  if (!result.ok) return

  tempDirs.push(dirname(result.tempPath))
  expect(result.tempPath).toContain("claude-shards-fetch-")
  expect(result.tempPath).toEndWith("/page.md")
  expect(result.title).toBe("Test Page")
  expect(result.excerpt).toBe("A short excerpt")
  expect(result.siteName).toBe("Example Site")
})

test("temp file contains the raw markdown content", async () => {
  const markdown = "# Hello\n\nSome **bold** content."

  const fetcher = async () => ({
    title: "Test Page",
    markdown,
    siteName: null,
    excerpt: null,
  })

  const result = await executeFetchPage("https://example.com/page", fetcher)

  expect(result.ok).toBe(true)
  if (!result.ok) return

  tempDirs.push(dirname(result.tempPath))
  const content = await Bun.file(result.tempPath).text()
  expect(content).toBe(markdown)
})

test("returns error result on fetch failure", async () => {
  const fetcher = async () => {
    throw new Error("Network timeout")
  }

  const result = await executeFetchPage("https://example.com/broken", fetcher)

  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toContain("Failed to fetch URL")
  expect(result.error).toContain("Network timeout")
})
