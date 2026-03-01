import { join } from "path"
import { mkdtemp, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { z } from "zod"
import { fetchPageAsMarkdown, type ParsedPage } from "../web/fetcher"
import type { ToolDefinition } from "./types"

type FetchPageResult =
  | { ok: true; tempPath: string; title: string; excerpt: string | null; siteName: string | null }
  | { ok: false; error: string }

type Fetcher = (url: string) => Promise<ParsedPage>

/**
 * Fetch a web page, convert it to markdown, and write it to a temp file.
 * @param url - URL of the page to fetch.
 * @param fetcher - Fetch implementation (defaults to `fetchPageAsMarkdown`, overridable for tests).
 */
export async function executeFetchPage(
  url: string,
  fetcher: Fetcher = fetchPageAsMarkdown,
): Promise<FetchPageResult> {
  let page
  try {
    page = await fetcher(url)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to fetch URL: ${msg}` }
  }

  const tempDir = await mkdtemp(join(tmpdir(), "claude-shards-fetch-"))
  const tempPath = join(tempDir, "page.md")
  await writeFile(tempPath, page.markdown)

  return {
    ok: true,
    tempPath,
    title: page.title,
    excerpt: page.excerpt,
    siteName: page.siteName,
  }
}

/** MCP tool: fetches a web page as markdown and writes it to a temp file for vault ingestion. */
export const fetchPageTool: ToolDefinition = {
  name: "fetch-page",
  description:
    "Fetch a web page and convert it to markdown. " +
    "Returns a temp file path containing the raw markdown. " +
    "After calling this tool, read the temp file, clean up the markdown, " +
    "pick appropriate title/tags/type, then call the write tool to save to the vault.",
  inputSchema: z.object({
    url: z.url().describe("URL of the web page to fetch"),
  }),
  handler: async (args) => {
    const result = await executeFetchPage(args.url)
    if (result.ok) {
      const parts = [
        `Temp file: ${result.tempPath}`,
        `Title: ${result.title}`,
      ]
      if (result.excerpt) parts.push(`Excerpt: ${result.excerpt}`)
      if (result.siteName) parts.push(`Site: ${result.siteName}`)
      return { text: parts.join("\n") }
    }
    return { text: result.error, isError: true as const }
  },
}
