import { test, expect } from "bun:test"
import { convertHTMLToMarkdown } from "../../src/web/fetcher"

const TEST_URL = "https://example.com/article"

function wrapHTML(body: string, title = "Test Article"): string {
  return `<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body><article>${body}</article></body></html>`
}

test("extracts title from HTML", () => {
  const html = wrapHTML("<p>Hello world</p>", "My Page Title")
  const result = convertHTMLToMarkdown(html, TEST_URL)
  expect(result.title).toBe("My Page Title")
})

test("converts paragraphs and links to markdown", () => {
  const html = wrapHTML(
    '<p>Visit <a href="https://example.com">this site</a> for details.</p>' +
      "<p>Second paragraph here.</p>",
  )
  const result = convertHTMLToMarkdown(html, TEST_URL)
  expect(result.markdown).toContain("[this site](https://example.com)")
  expect(result.markdown).toContain("Second paragraph here.")
})

test("converts inline code to markdown", () => {
  const html = wrapHTML("<p>Use the <code>bun test</code> command.</p>")
  const result = convertHTMLToMarkdown(html, TEST_URL)
  expect(result.markdown).toContain("`bun test`")
})

test("converts code blocks to fenced markdown", () => {
  const html = wrapHTML(
    "<pre><code>const x = 1;\nconsole.log(x);</code></pre>",
  )
  const result = convertHTMLToMarkdown(html, TEST_URL)
  expect(result.markdown).toContain("```")
  expect(result.markdown).toContain("const x = 1;")
})

test("throws on empty HTML", () => {
  expect(() => convertHTMLToMarkdown("", TEST_URL)).toThrow(
    "Could not extract readable content",
  )
})

test("throws on unparseable HTML with no article content", () => {
  const html = "<html><head></head><body></body></html>"
  expect(() => convertHTMLToMarkdown(html, TEST_URL)).toThrow(
    "Could not extract readable content",
  )
})

test("strips inline script tags from output", () => {
  const html = wrapHTML(
    '<p>Safe text</p><script>alert("xss")</script><p>More safe text</p>',
  )
  const result = convertHTMLToMarkdown(html, TEST_URL)
  expect(result.markdown).not.toContain("alert")
  expect(result.markdown).not.toContain("<script")
  expect(result.markdown).toContain("Safe text")
})

test("strips onerror and other event handler attributes", () => {
  const html = wrapHTML(
    '<p>Text with <img src="x" onerror="alert(1)"> an image</p>',
  )
  const result = convertHTMLToMarkdown(html, TEST_URL)
  expect(result.markdown).not.toContain("onerror")
  expect(result.markdown).not.toContain("alert")
})

test("strips javascript: URIs from links", () => {
  const html = wrapHTML(
    '<p>Click <a href="javascript:alert(document.cookie)">here</a> for info.</p>',
  )
  const result = convertHTMLToMarkdown(html, TEST_URL)
  expect(result.markdown).not.toContain("javascript:")
})

test("strips iframe injections", () => {
  const html = wrapHTML(
    '<p>Article content</p><iframe src="https://evil.com/steal"></iframe><p>End</p>',
  )
  const result = convertHTMLToMarkdown(html, TEST_URL)
  expect(result.markdown).not.toContain("iframe")
  expect(result.markdown).not.toContain("evil.com")
  expect(result.markdown).toContain("Article content")
})

test("strips embedded SVG with onload handler", () => {
  const html = wrapHTML(
    '<p>Before</p><svg onload="alert(1)"><circle r="10"/></svg><p>After</p>',
  )
  const result = convertHTMLToMarkdown(html, TEST_URL)
  expect(result.markdown).not.toContain("onload")
  expect(result.markdown).not.toContain("alert")
})
