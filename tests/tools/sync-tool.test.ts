import { test, expect, beforeEach } from "bun:test"
import { executeSync, gatherNoteContent, formatGatheredOutput } from "../../src/tools/sync-tool"
import type { NoteEntry, LinkGraph } from "../../src/vault/types"
import { join } from "path"
import { mkdtemp, readdir, mkdir } from "fs/promises"
import { tmpdir } from "os"

function makeEntry(overrides: Partial<NoteEntry> & { relativePath: string; filePath: string }): NoteEntry {
  return {
    title: "Test Note",
    body: "body content",
    tokenCount: 100,
    frontmatter: {
      type: "gotchas",
      tags: [],
      created: new Date(),
      updated: new Date(),
      status: "active",
      ...overrides.frontmatter,
    },
    ...overrides,
  } as NoteEntry
}

function makeLinkGraph(forward: Record<string, string[]> = {}): LinkGraph {
  const fwd = new Map<string, Set<string>>()
  const rev = new Map<string, Set<string>>()
  for (const [src, targets] of Object.entries(forward)) {
    fwd.set(src, new Set(targets))
    for (const t of targets) {
      if (!rev.has(t)) rev.set(t, new Set())
      rev.get(t)!.add(src)
    }
  }
  return { forward: fwd, reverse: rev }
}

let tempDir: string
let vaultDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sync-test-"))
  vaultDir = await mkdtemp(join(tmpdir(), "sync-vault-"))
})

async function writeVaultNote(relativePath: string, content: string): Promise<string> {
  const fullPath = join(vaultDir, relativePath)
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"))
  await mkdir(dir, { recursive: true })
  await Bun.write(fullPath, content)
  return fullPath
}

test("executeSync with empty notes returns prompt message", async () => {
  const result = await executeSync([], [], tempDir)
  expect(result.entryCount).toBe(0)
  expect(result.summary).toContain("No notes specified")
})

test("executeSync copies files to docs/knowledge/<type>/ and updates CLAUDE.md", async () => {
  const fp = await writeVaultNote("gotchas/SYNC_BEFORE_INIT.md", "---\ntype: gotchas\n---\n# Note")
  const entries = [
    makeEntry({
      relativePath: "gotchas/SYNC_BEFORE_INIT.md",
      filePath: fp,
      title: "Sync before init",
      frontmatter: { type: "gotchas", tags: [], created: new Date(), updated: new Date(), status: "active" },
    }),
  ]

  const result = await executeSync(["gotchas/SYNC_BEFORE_INIT.md"], entries, tempDir, {
    synthesized: { "gotchas/SYNC_BEFORE_INIT.md": "# Synthesized\n\nSynced content." },
  })
  expect(result.entryCount).toBe(1)
  expect(result.summary).toContain("Synced 1 entries")

  const copied = await Bun.file(join(tempDir, "docs/knowledge/gotchas/SYNC_BEFORE_INIT.md")).exists()
  expect(copied).toBe(true)

  const claudeMd = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(claudeMd).toContain("## Knowledge Index")
  expect(claudeMd).toContain("@docs/knowledge/gotchas/SYNC_BEFORE_INIT.md")
})

test("executeSync skips stale notes with report", async () => {
  const fp = await writeVaultNote("gotchas/STALE_NOTE.md", "---\ntype: gotchas\n---\n# Stale")
  const entries = [
    makeEntry({
      relativePath: "gotchas/STALE_NOTE.md",
      filePath: fp,
      title: "Stale note",
      frontmatter: { type: "gotchas", tags: [], created: new Date(), updated: new Date(), status: "stale", staleAt: new Date() },
    }),
  ]

  const result = await executeSync(["gotchas/STALE_NOTE.md"], entries, tempDir)
  expect(result.entryCount).toBe(0)
  expect(result.summary).toContain("Skipped stale")
  expect(result.summary).toContain("STALE_NOTE.md")
})

test("executeSync reports not-found paths", async () => {
  const result = await executeSync(["gotchas/NONEXISTENT.md"], [], tempDir)
  expect(result.entryCount).toBe(0)
  expect(result.summary).toContain("Not found")
  expect(result.summary).toContain("NONEXISTENT.md")
})

test("executeSync cleans up files no longer in sync list", async () => {
  const knowledgeDir = join(tempDir, "docs/knowledge/gotchas")
  await mkdir(knowledgeDir, { recursive: true })
  await Bun.write(join(knowledgeDir, "OLD_NOTE.md"), "old content")

  const result = await executeSync([], [], tempDir)
  expect(result.summary).toContain("No notes specified")
})

test("executeSync preserves files from previous syncs not in current request", async () => {
  const knowledgeDir = join(tempDir, "docs/knowledge/decisions")
  await mkdir(knowledgeDir, { recursive: true })
  await Bun.write(join(knowledgeDir, "PREVIOUS.md"), "previously synced")

  const fp = await writeVaultNote("gotchas/KEEP.md", "---\ntype: gotchas\n---\n# Keep")
  const entries = [
    makeEntry({
      relativePath: "gotchas/KEEP.md",
      filePath: fp,
      title: "Keep this",
      frontmatter: { type: "gotchas", tags: [], created: new Date(), updated: new Date(), status: "active" },
    }),
  ]

  const result = await executeSync(["gotchas/KEEP.md"], entries, tempDir, {
    synthesized: { "gotchas/KEEP.md": "# Synthesized Keep" },
  })
  expect(result.summary).not.toContain("Removed")

  const previousExists = await Bun.file(join(knowledgeDir, "PREVIOUS.md")).exists()
  expect(previousExists).toBe(true)

  const keptExists = await Bun.file(join(tempDir, "docs/knowledge/gotchas/KEEP.md")).exists()
  expect(keptExists).toBe(true)
})

test("executeSync removes stale files that were explicitly requested", async () => {
  const knowledgeDir = join(tempDir, "docs/knowledge/gotchas")
  await mkdir(knowledgeDir, { recursive: true })
  await Bun.write(join(knowledgeDir, "STALE_NOTE.md"), "stale content")

  const fp = await writeVaultNote("gotchas/STALE_NOTE.md", "---\ntype: gotchas\nstatus: stale\n---\n# Stale")
  const entries = [
    makeEntry({
      relativePath: "gotchas/STALE_NOTE.md",
      filePath: fp,
      title: "Stale note",
      frontmatter: { type: "gotchas", tags: [], created: new Date(), updated: new Date(), status: "stale" },
    }),
  ]

  const result = await executeSync(["gotchas/STALE_NOTE.md"], entries, tempDir)
  expect(result.summary).toContain("Removed")
  expect(result.summary).toContain("gotchas/STALE_NOTE.md")

  const staleExists = await Bun.file(join(knowledgeDir, "STALE_NOTE.md")).exists()
  expect(staleExists).toBe(false)
})

test("executeSync uses description as title in CLAUDE.md table", async () => {
  const fp = await writeVaultNote("decisions/CHOSE_BUN.md", "---\ntype: decisions\n---\n# Chose Bun")
  const entries = [
    makeEntry({
      relativePath: "decisions/CHOSE_BUN.md",
      filePath: fp,
      title: "Chose Bun Over Node",
      frontmatter: { type: "decisions", description: "Why we chose Bun", tags: [], created: new Date(), updated: new Date(), status: "active" },
    }),
  ]

  const result = await executeSync(["decisions/CHOSE_BUN.md"], entries, tempDir, {
    synthesized: { "decisions/CHOSE_BUN.md": "# Synthesized Bun Decision" },
  })
  const claudeMd = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(claudeMd).toContain("Why we chose Bun")
  expect(claudeMd).not.toContain("Chose Bun Over Node")
})

test("executeSync fingerprint skips rewrite when unchanged", async () => {
  const fp = await writeVaultNote("gotchas/STABLE.md", "---\ntype: gotchas\n---\n# Stable")
  const entries = [
    makeEntry({
      relativePath: "gotchas/STABLE.md",
      filePath: fp,
      title: "Stable note",
      frontmatter: { type: "gotchas", tags: [], created: new Date(), updated: new Date(), status: "active" },
    }),
  ]

  const synth = { "gotchas/STABLE.md": "# Synthesized Stable" }
  const result1 = await executeSync(["gotchas/STABLE.md"], entries, tempDir, { synthesized: synth })
  expect(result1.summary).toContain("Synced")

  const result2 = await executeSync(["gotchas/STABLE.md"], entries, tempDir, { synthesized: synth })
  expect(result2.summary).toContain("already up to date")
})

test("gatherNoteContent resolves forward links from link graph", () => {
  const noteA = makeEntry({
    relativePath: "references/NOTE_A.md",
    filePath: "/vault/references/NOTE_A.md",
    title: "Note A",
    body: "Content of A",
    frontmatter: { type: "references", tags: [], created: new Date(), updated: new Date(), status: "active" },
  })
  const noteB = makeEntry({
    relativePath: "gotchas/NOTE_B.md",
    filePath: "/vault/gotchas/NOTE_B.md",
    title: "Note B",
    body: "Content of B",
    frontmatter: { type: "gotchas", description: "B description", tags: [], created: new Date(), updated: new Date(), status: "active" },
  })

  const linkGraph = makeLinkGraph({
    "references/NOTE_A.md": ["gotchas/NOTE_B.md"],
  })

  const gathered = gatherNoteContent(noteA, [noteA, noteB], linkGraph)
  expect(gathered.path).toBe("references/NOTE_A.md")
  expect(gathered.body).toBe("Content of A")
  expect(gathered.dependencies).toHaveLength(1)
  expect(gathered.dependencies[0].path).toBe("gotchas/NOTE_B.md")
  expect(gathered.dependencies[0].title).toBe("Note B")
  expect(gathered.dependencies[0].body).toBe("Content of B")
  expect(gathered.dependencies[0].description).toBe("B description")
})

test("gatherNoteContent returns empty dependencies when no links", () => {
  const note = makeEntry({
    relativePath: "gotchas/SOLO.md",
    filePath: "/vault/gotchas/SOLO.md",
    title: "Solo",
    body: "No links here",
    frontmatter: { type: "gotchas", tags: [], created: new Date(), updated: new Date(), status: "active" },
  })

  const linkGraph = makeLinkGraph()
  const gathered = gatherNoteContent(note, [note], linkGraph)
  expect(gathered.dependencies).toHaveLength(0)
})

test("gatherNoteContent skips unresolved links gracefully", () => {
  const note = makeEntry({
    relativePath: "gotchas/LINKED.md",
    filePath: "/vault/gotchas/LINKED.md",
    title: "Linked",
    body: "Has a link",
    frontmatter: { type: "gotchas", tags: [], created: new Date(), updated: new Date(), status: "active" },
  })

  const linkGraph = makeLinkGraph({
    "gotchas/LINKED.md": ["gotchas/MISSING.md"],
  })

  const gathered = gatherNoteContent(note, [note], linkGraph)
  expect(gathered.dependencies).toHaveLength(0)
})

test("formatGatheredOutput marks duplicates when dependency is also requested", () => {
  const gathered: GatheredNote[] = [
    {
      path: "references/A.md",
      type: "references",
      body: "A content",
      dependencies: [
        { path: "gotchas/B.md", title: "B", type: "gotchas", body: "B content" },
      ],
    },
  ]
  const requestedPaths = new Set(["references/A.md", "gotchas/B.md"])
  const output = formatGatheredOutput(gathered, requestedPaths, 5000)
  expect(output).toContain("deduplicate in synthesis")
})

test("formatGatheredOutput truncates dependencies when exceeding gatherMaxTokens", () => {
  const longBody = "x".repeat(20000)
  const gathered: GatheredNote[] = [
    {
      path: "references/A.md",
      type: "references",
      body: "short",
      dependencies: [
        { path: "gotchas/B.md", title: "B", type: "gotchas", body: longBody },
      ],
    },
  ]
  const requestedPaths = new Set(["references/A.md"])
  const output = formatGatheredOutput(gathered, requestedPaths, 500)
  expect(output).toContain("[truncated]")
  expect(output.length).toBeLessThan(longBody.length)
})

test("sync gather mode returns content tree without writing files", async () => {
  const fp = await writeVaultNote("references/GATHER_ME.md", "---\ntype: references\n---\n# Gather Me")
  const noteA = makeEntry({
    relativePath: "references/GATHER_ME.md",
    filePath: fp,
    title: "Gather Me",
    body: "Gathered body content",
    frontmatter: { type: "references", tags: [], created: new Date(), updated: new Date(), status: "active" },
  })

  const linkGraph = makeLinkGraph()
  const result = await executeSync(
    ["references/GATHER_ME.md"],
    [noteA],
    tempDir,
    { mode: "gather", linkGraph },
  )

  expect(result.entryCount).toBe(1)
  expect(result.summary).toContain("Gathered body content")
  expect(result.summary).toContain("references/GATHER_ME.md")

  const claudeMdExists = await Bun.file(join(tempDir, "CLAUDE.md")).exists()
  expect(claudeMdExists).toBe(false)

  const copiedExists = await Bun.file(join(tempDir, "docs/knowledge/references/GATHER_ME.md")).exists()
  expect(copiedExists).toBe(false)
})

test("sync with synthesized content writes provided content to docs/knowledge/", async () => {
  const fp = await writeVaultNote("gotchas/SYNTH.md", "---\ntype: gotchas\n---\n# Original")
  const entry = makeEntry({
    relativePath: "gotchas/SYNTH.md",
    filePath: fp,
    title: "Synth Note",
    frontmatter: { type: "gotchas", tags: [], created: new Date(), updated: new Date(), status: "active" },
  })

  const synthesizedContent = "# Synthesized\n\nThis is the synthesized version."
  const result = await executeSync(
    ["gotchas/SYNTH.md"],
    [entry],
    tempDir,
    { synthesized: { "gotchas/SYNTH.md": synthesizedContent } },
  )

  expect(result.entryCount).toBe(1)
  const written = await Bun.file(join(tempDir, "docs/knowledge/gotchas/SYNTH.md")).text()
  expect(written).toBe(synthesizedContent)
})

test("sync with synthesized content still updates CLAUDE.md index", async () => {
  const fp = await writeVaultNote("gotchas/SYNTH2.md", "---\ntype: gotchas\n---\n# Original")
  const entry = makeEntry({
    relativePath: "gotchas/SYNTH2.md",
    filePath: fp,
    title: "Synth Note 2",
    frontmatter: { type: "gotchas", tags: [], created: new Date(), updated: new Date(), status: "active" },
  })

  await executeSync(
    ["gotchas/SYNTH2.md"],
    [entry],
    tempDir,
    { synthesized: { "gotchas/SYNTH2.md": "synthesized" } },
  )

  const claudeMd = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(claudeMd).toContain("## Knowledge Index")
  expect(claudeMd).toContain("@docs/knowledge/gotchas/SYNTH2.md")
})

test("sync without synthesized returns gather output and writes nothing", async () => {
  const fp = await writeVaultNote("gotchas/UNSYNTH.md", "---\ntype: gotchas\n---\n# Unsynthesized")
  const entry = makeEntry({
    relativePath: "gotchas/UNSYNTH.md",
    filePath: fp,
    title: "Unsynth Note",
    body: "Raw body content",
    frontmatter: { type: "gotchas", tags: [], created: new Date(), updated: new Date(), status: "active" },
  })

  const result = await executeSync(["gotchas/UNSYNTH.md"], [entry], tempDir)
  expect(result.summary).toContain("Missing synthesized content for 1 note(s)")
  expect(result.summary).toContain("Raw body content")

  const claudeMdExists = await Bun.file(join(tempDir, "CLAUDE.md")).exists()
  expect(claudeMdExists).toBe(false)

  const copiedExists = await Bun.file(join(tempDir, "docs/knowledge/gotchas/UNSYNTH.md")).exists()
  expect(copiedExists).toBe(false)
})

test("sync with partial synthesized returns gather for missing notes and writes nothing", async () => {
  const fp1 = await writeVaultNote("gotchas/HAS_SYNTH.md", "---\ntype: gotchas\n---\n# Has")
  const fp2 = await writeVaultNote("gotchas/NO_SYNTH.md", "---\ntype: gotchas\n---\n# Missing")
  const entry1 = makeEntry({
    relativePath: "gotchas/HAS_SYNTH.md",
    filePath: fp1,
    title: "Has Synth",
    body: "Has body",
    frontmatter: { type: "gotchas", tags: [], created: new Date(), updated: new Date(), status: "active" },
  })
  const entry2 = makeEntry({
    relativePath: "gotchas/NO_SYNTH.md",
    filePath: fp2,
    title: "No Synth",
    body: "Missing body",
    frontmatter: { type: "gotchas", tags: [], created: new Date(), updated: new Date(), status: "active" },
  })

  const result = await executeSync(
    ["gotchas/HAS_SYNTH.md", "gotchas/NO_SYNTH.md"],
    [entry1, entry2],
    tempDir,
    { synthesized: { "gotchas/HAS_SYNTH.md": "# Synthesized Has" } },
  )

  expect(result.summary).toContain("Missing synthesized content for 1 note(s)")
  expect(result.summary).toContain("Missing body")
  expect(result.summary).not.toContain("Has body")

  const claudeMdExists = await Bun.file(join(tempDir, "CLAUDE.md")).exists()
  expect(claudeMdExists).toBe(false)
})

import type { GatheredNote } from "../../src/tools/sync-tool"
