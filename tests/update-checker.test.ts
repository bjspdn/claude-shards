import { test, expect, beforeEach, afterEach } from "bun:test"
import {
  parseChangelog,
  initUpdateCheck,
  getUpdateNotice,
  _resetForTesting,
} from "../src/update-checker"
import pkg from "../package.json"

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

const originalFetch = globalThis.fetch

afterEach(() => {
  _resetForTesting()
  globalThis.fetch = originalFetch
})

test("getUpdateNotice returns empty before initUpdateCheck is called", async () => {
  expect(await getUpdateNotice()).toBe("")
})

test("getUpdateNotice returns notice with changelog when update is available", async () => {
  globalThis.fetch = ((url: string) => {
    if (url.includes("registry.npmjs.org")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ version: "99.0.0" }),
      })
    }
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve("## 99.0.0\n\n- Awesome feature\n- Bug fix\n"),
    })
  }) as typeof fetch

  initUpdateCheck()
  const notice = await getUpdateNotice()

  expect(notice).toContain("Update available")
  expect(notice).toContain("v99.0.0")
  expect(notice).toContain("Awesome feature")
  expect(notice).toContain("Bug fix")
})

test("getUpdateNotice returns empty when already on latest version", async () => {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ version: pkg.version }),
    })
  ) as typeof fetch

  initUpdateCheck()
  expect(await getUpdateNotice()).toBe("")
})

test("getUpdateNotice returns notice without changelog when changelog fetch fails", async () => {
  globalThis.fetch = ((url: string) => {
    if (url.includes("registry.npmjs.org")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ version: "99.0.0" }),
      })
    }
    return Promise.resolve({ ok: false })
  }) as typeof fetch

  initUpdateCheck()
  const notice = await getUpdateNotice()

  expect(notice).toContain("Update available")
  expect(notice).toContain("v99.0.0")
  expect(notice).not.toContain("What's new")
})

test("getUpdateNotice returns empty when version fetch fails", async () => {
  globalThis.fetch = (() =>
    Promise.reject(new Error("network error"))
  ) as typeof fetch

  initUpdateCheck()
  expect(await getUpdateNotice()).toBe("")
})

test("getUpdateNotice resolves within timeout on hanging fetch", async () => {
  globalThis.fetch = (() => new Promise(() => {})) as typeof fetch

  initUpdateCheck()
  const start = Date.now()
  const notice = await getUpdateNotice()
  const elapsed = Date.now() - start

  expect(notice).toBe("")
  expect(elapsed).toBeGreaterThanOrEqual(3900)
  expect(elapsed).toBeLessThan(5000)
}, 6000)
