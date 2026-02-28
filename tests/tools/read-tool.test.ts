import { test, expect } from "bun:test"
import { executeRead } from "../../src/tools/read-tool"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")

test("executeRead returns full note content for valid path", async () => {
  const result = await executeRead("gotchas/bevy-system-ordering.md", VAULT)
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.content).toContain("type: gotchas")
    expect(result.content).toContain("Systems in Bevy")
  }
})

test("executeRead rejects path traversal with ..", async () => {
  const result = await executeRead("../../../etc/passwd", VAULT)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.error).toContain("outside vault")
  }
})

test("executeRead rejects absolute paths", async () => {
  const result = await executeRead("/etc/passwd", VAULT)
  expect(result.ok).toBe(false)
})

test("executeRead returns error for nonexistent note", async () => {
  const result = await executeRead("does-not-exist.md", VAULT)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.error).toContain("not found")
  }
})
