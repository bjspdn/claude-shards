import { test, expect, beforeEach, afterEach, mock } from "bun:test"
import { spinner } from "../../src/cli/spinner"

let written: string[]
const originalWrite = process.stdout.write

beforeEach(() => {
  written = []
  process.stdout.write = ((chunk: string) => {
    written.push(chunk)
    return true
  }) as typeof process.stdout.write
})

afterEach(() => {
  process.stdout.write = originalWrite
})

test("succeed clears spinner and prints success line", () => {
  const s = spinner("Loading")
  s.succeed("Done")

  const last = written.at(-1)!
  expect(last).toContain("+")
  expect(last).toContain("Done")
  expect(last).toContain("\r")
})

test("fail clears spinner and prints failure line", () => {
  const s = spinner("Loading")
  s.fail("Oops")

  const last = written.at(-1)!
  expect(last).toContain("!")
  expect(last).toContain("Oops")
  expect(last).toContain("\r")
})

test("update changes the spinner message", async () => {
  const s = spinner("Step 1")
  s.update("Step 2")

  await new Promise((r) => setTimeout(r, 100))
  s.succeed("Done")

  const frames = written.filter((w) => w.includes("Step 2"))
  expect(frames.length).toBeGreaterThan(0)
})
