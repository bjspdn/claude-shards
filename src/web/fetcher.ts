import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import DOMPurify from "dompurify"
import TurndownService from "turndown"

export interface ParsedPage {
  title: string
  markdown: string
  siteName: string | null
  excerpt: string | null
}

export function convertHTMLToMarkdown(html: string, url: string): ParsedPage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const window = parseHTML(html) as any
  if (!window.document?.documentElement) {
    throw new Error(`Could not extract readable content from ${url}`)
  }

  const purify = DOMPurify(window)
  const cleanHTML = purify.sanitize(window.document.documentElement.outerHTML, {
    WHOLE_DOCUMENT: true,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cleanWindow = parseHTML(cleanHTML) as any

  const reader = new Readability(cleanWindow.document, {
    charThreshold: 0,
  })
  const article = reader.parse()
  if (!article?.content) {
    throw new Error(`Could not extract readable content from ${url}`)
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  })

  const markdown = turndown.turndown(article.content)

  return {
    title: article.title ?? "",
    markdown,
    siteName: article.siteName ?? null,
    excerpt: article.excerpt ?? null,
  }
}

export async function fetchPageAsMarkdown(url: string): Promise<ParsedPage> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "claude-code-memory/1.0 (vault note fetcher)",
    },
  })

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`)
  }

  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("text/html")) {
    throw new Error(`Expected text/html but got ${contentType}`)
  }

  const html = await response.text()
  return convertHTMLToMarkdown(html, url)
}
