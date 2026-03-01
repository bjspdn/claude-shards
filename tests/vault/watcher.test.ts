import { test, expect, beforeEach, afterEach } from "bun:test"
import { watchVault } from "../../src/vault/watcher"
import { NOTE_TYPE_PRIORITY, type NoteEntry } from "../../src/vault/types"
import { join } from "path"
import { mkdtemp, rm, mkdir } from "fs/promises"
import { tmpdir } from "os"

const DEBOUNCE_WAIT = 500

function validNote(type: string, title: string): string {
  return `---\ntype: ${type}\ncreated: 2025-01-01\nupdated: 2025-01-01\n---\n\n# ${title}\n\nBody.\n`
}

let tempVault: string
let entries: NoteEntry[]
let stop: () => void

beforeEach(async () => {
  tempVault = await mkdtemp(join(tmpdir(), "ccm-watcher-test-"))
  entries = []
  stop = watchVault(tempVault, entries)
})

afterEach(async () => {
  stop()
  await rm(tempVault, { recursive: true, force: true })
})

test("detects new .md file and adds entry", async () => {
  await Bun.write(join(tempVault, "gotchas/new.md"), validNote("gotchas", "New Note"))
  await Bun.sleep(DEBOUNCE_WAIT)

  expect(entries.length).toBe(1)
  expect(entries[0]!.title).toBe("New Note")
  expect(entries[0]!.frontmatter.type).toBe("gotchas")
})

test("detects modified .md file and updates entry", async () => {
  const filePath = join(tempVault, "gotchas/note.md")
  await Bun.write(filePath, validNote("gotchas", "Original"))
  await Bun.sleep(DEBOUNCE_WAIT)

  expect(entries[0]!.title).toBe("Original")

  await Bun.write(filePath, validNote("gotchas", "Modified"))
  await Bun.sleep(DEBOUNCE_WAIT)

  expect(entries.length).toBe(1)
  expect(entries[0]!.title).toBe("Modified")
})

test("detects deleted .md file and removes entry", async () => {
  const filePath = join(tempVault, "gotchas/note.md")
  await Bun.write(filePath, validNote("gotchas", "ToDelete"))
  await Bun.sleep(DEBOUNCE_WAIT)

  expect(entries.length).toBe(1)

  await rm(filePath)
  await Bun.sleep(DEBOUNCE_WAIT)

  expect(entries.length).toBe(0)
})

test("ignores non-.md files", async () => {
  await Bun.write(join(tempVault, "notes.txt"), "plain text")
  await Bun.write(join(tempVault, "data.json"), "{}")
  await Bun.sleep(DEBOUNCE_WAIT)

  expect(entries.length).toBe(0)
})

test("ignores dotfile directories", async () => {
  await mkdir(join(tempVault, ".obsidian"), { recursive: true })
  await Bun.write(join(tempVault, ".obsidian/workspace.md"), validNote("gotchas", "Hidden"))
  await mkdir(join(tempVault, ".git"), { recursive: true })
  await Bun.write(join(tempVault, ".git/config.md"), validNote("gotchas", "Git"))
  await Bun.sleep(DEBOUNCE_WAIT)

  expect(entries.length).toBe(0)
})

test("maintains sort order after upsert", async () => {
  await Bun.write(join(tempVault, "references/ref.md"), validNote("references", "Ref"))
  await Bun.sleep(DEBOUNCE_WAIT)

  await Bun.write(join(tempVault, "gotchas/gotcha.md"), validNote("gotchas", "Gotcha"))
  await Bun.sleep(DEBOUNCE_WAIT)

  expect(entries.length).toBe(2)
  for (let i = 1; i < entries.length; i++) {
    const prev = NOTE_TYPE_PRIORITY[entries[i - 1]!.frontmatter.type]
    const curr = NOTE_TYPE_PRIORITY[entries[i]!.frontmatter.type]
    expect(prev).toBeLessThanOrEqual(curr)
  }
})
