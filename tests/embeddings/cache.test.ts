import { test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { warmup } from "../../src/embeddings/embedder"
import { buildEmbeddingIndex, updateEmbeddings } from "../../src/embeddings/cache"
import type { NoteEntry } from "../../src/vault/types"

let tempDir: string

function makeEntry(relativePath: string, title: string, tags: string[]): NoteEntry {
  return {
    frontmatter: {
      type: "patterns",
      tags,
      decisions: [],
      patterns: [],
      gotchas: [],
      references: [],
      created: new Date(),
      updated: new Date(),
      status: "active",
    },
    filePath: join(tempDir, relativePath),
    relativePath,
    title,
    body: `Body of ${title}`,
    tokenCount: 10,
  }
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "shards-embed-test-"))
  await warmup()
}, 60_000)

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

test("buildEmbeddingIndex creates embeddings for all entries", async () => {
  const entries = [
    makeEntry("patterns/auth.md", "Auth Pattern", ["auth", "security"]),
    makeEntry("decisions/jwt.md", "Chose JWT", ["auth", "jwt"]),
  ]

  const index = await buildEmbeddingIndex(entries, tempDir)
  expect(index.size).toBe(2)
  expect(index.get("patterns/auth.md")?.embedding.length).toBe(384)
  expect(index.get("decisions/jwt.md")?.embedding.length).toBe(384)
})

test("buildEmbeddingIndex uses cache on second call", async () => {
  const entries = [
    makeEntry("patterns/cached.md", "Cached Note", ["test"]),
  ]

  const first = await buildEmbeddingIndex(entries, tempDir)
  const firstHash = first.get("patterns/cached.md")!.contentHash

  const second = await buildEmbeddingIndex(entries, tempDir)
  expect(second.get("patterns/cached.md")!.contentHash).toBe(firstHash)
})

test("buildEmbeddingIndex recomputes on content change", async () => {
  const entries1 = [makeEntry("patterns/changing.md", "Original", ["v1"])]
  const first = await buildEmbeddingIndex(entries1, tempDir)
  const hash1 = first.get("patterns/changing.md")!.contentHash

  const entries2 = [makeEntry("patterns/changing.md", "Updated Title", ["v2"])]
  const second = await buildEmbeddingIndex(entries2, tempDir)
  const hash2 = second.get("patterns/changing.md")!.contentHash

  expect(hash1).not.toBe(hash2)
})

test("updateEmbeddings adds new entries incrementally", async () => {
  const entries = [makeEntry("patterns/base.md", "Base", ["test"])]
  const index = await buildEmbeddingIndex(entries, tempDir)
  expect(index.size).toBe(1)

  entries.push(makeEntry("patterns/new.md", "New Note", ["added"]))
  await updateEmbeddings(index, entries, tempDir)
  expect(index.size).toBe(2)
  expect(index.get("patterns/new.md")?.embedding.length).toBe(384)
})

test("updateEmbeddings removes deleted entries", async () => {
  const entries = [
    makeEntry("patterns/keep.md", "Keep", ["test"]),
    makeEntry("patterns/remove.md", "Remove", ["test"]),
  ]
  const index = await buildEmbeddingIndex(entries, tempDir)
  expect(index.size).toBe(2)

  const remaining = [entries[0]!]
  await updateEmbeddings(index, remaining, tempDir)
  expect(index.size).toBe(1)
  expect(index.has("patterns/remove.md")).toBe(false)
})

test("cache persists to disk and roundtrips", async () => {
  const rtDir = await mkdtemp(join(tmpdir(), "shards-rt-"))
  try {
    const entries = [makeEntry("patterns/rt.md", "Roundtrip", ["persist"])]
    const built = await buildEmbeddingIndex(entries, rtDir)
    const embedding1 = Array.from(built.get("patterns/rt.md")!.embedding)

    const loaded = await buildEmbeddingIndex(entries, rtDir)
    const embedding2 = Array.from(loaded.get("patterns/rt.md")!.embedding)

    expect(embedding1).toEqual(embedding2)
  } finally {
    await rm(rtDir, { recursive: true, force: true })
  }
})
