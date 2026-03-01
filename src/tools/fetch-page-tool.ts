import { join } from "path"
import { mkdtemp, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { z } from "zod"
import { fetchPageAsMarkdown, type ParsedPage } from "../web/fetcher"
import { getUpdateNotice } from "../update-checker"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

type FetchPageResult =
  | { ok: true; tempPath: string; title: string; excerpt: string | null; siteName: string | null }
  | { ok: false; error: string }

type Fetcher = (url: string) => Promise<ParsedPage>

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

  const tempDir = await mkdtemp(join(tmpdir(), "ccm-fetch-"))
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

export function registerFetchPageTool(server: McpServer) {
  server.registerTool(
    "fetch-page",
    {
      description:
        "Fetch a web page and convert it to markdown. " +
        "Returns a temp file path containing the raw markdown. " +
        "After calling this tool, read the temp file, clean up the markdown, " +
        "pick appropriate title/tags/type, then call the write tool to save to the vault.",
      inputSchema: z.object({
        url: z.url().describe("URL of the web page to fetch"),
      }),
    },
    async (args) => {
      const result = await executeFetchPage(args.url)
      if (result.ok) {
        const parts = [
          `Temp file: ${result.tempPath}`,
          `Title: ${result.title}`,
        ]
        if (result.excerpt) parts.push(`Excerpt: ${result.excerpt}`)
        if (result.siteName) parts.push(`Site: ${result.siteName}`)
        return { content: [{ type: "text" as const, text: parts.join("\n") + getUpdateNotice() }] }
      }
      return { content: [{ type: "text" as const, text: result.error }], isError: true }
    },
  )
}
