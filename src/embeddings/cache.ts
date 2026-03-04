import { join } from "path"
import { mkdir } from "fs/promises"
import { encode, isReady } from "./embedder"
import { logInfo, logError } from "../logger"
import type { EmbeddingEntry, EmbeddingIndex } from "./types"
import type { NoteEntry } from "../vault/types"

const CACHE_FILE = "embeddings.json"
const CACHE_DIR = ".claude-shards"

function cachePath(vaultPath: string): string {
  return join(vaultPath, CACHE_DIR, CACHE_FILE)
}

function contentHash(entry: NoteEntry): string {
  const desc = entry.frontmatter.description ?? ""
  return Bun.hash(`${entry.title} ${entry.frontmatter.tags.join(" ")} ${desc}`).toString(36)
}

function embedText(entry: NoteEntry): string {
  const desc = entry.frontmatter.description ?? ""
  return `${entry.title} ${entry.frontmatter.tags.join(" ")} ${desc}`
}

interface SerializedCache {
  [relativePath: string]: {
    contentHash: string
    embedding: number[]
  }
}

async function loadCache(vaultPath: string): Promise<EmbeddingIndex> {
  const index: EmbeddingIndex = new Map()
  try {
    const raw = await Bun.file(cachePath(vaultPath)).text()
    const data: SerializedCache = JSON.parse(raw)
    for (const [path, entry] of Object.entries(data)) {
      index.set(path, {
        contentHash: entry.contentHash,
        embedding: new Float32Array(entry.embedding),
      })
    }
  } catch {}
  return index
}

async function saveCache(index: EmbeddingIndex, vaultPath: string): Promise<void> {
  const dir = join(vaultPath, CACHE_DIR)
  await mkdir(dir, { recursive: true })
  const data: SerializedCache = {}
  for (const [path, entry] of index) {
    data[path] = {
      contentHash: entry.contentHash,
      embedding: Array.from(entry.embedding),
    }
  }
  await Bun.write(cachePath(vaultPath), JSON.stringify(data))
}

export async function buildEmbeddingIndex(
  entries: NoteEntry[],
  vaultPath: string,
): Promise<EmbeddingIndex> {
  if (!isReady()) throw new Error("Embedder not ready")

  const cached = await loadCache(vaultPath)
  const index: EmbeddingIndex = new Map()
  let recomputed = 0

  for (const entry of entries) {
    const hash = contentHash(entry)
    const existing = cached.get(entry.relativePath)

    if (existing && existing.contentHash === hash) {
      index.set(entry.relativePath, existing)
      continue
    }

    try {
      const embedding = await encode(embedText(entry))
      index.set(entry.relativePath, { contentHash: hash, embedding })
      recomputed++
    } catch (err) {
      logError("embeddings", `failed to embed ${entry.relativePath}`, { error: String(err) })
    }
  }

  await saveCache(index, vaultPath)
  logInfo("embeddings", `built index: ${entries.length} notes, ${recomputed} recomputed`)
  return index
}

export async function updateEmbeddings(
  index: EmbeddingIndex,
  entries: NoteEntry[],
  vaultPath: string,
): Promise<void> {
  if (!isReady()) return

  const currentPaths = new Set(entries.map((e) => e.relativePath))
  for (const path of index.keys()) {
    if (!currentPaths.has(path)) index.delete(path)
  }

  let updated = 0
  for (const entry of entries) {
    const hash = contentHash(entry)
    const existing = index.get(entry.relativePath)
    if (existing && existing.contentHash === hash) continue

    try {
      const embedding = await encode(embedText(entry))
      index.set(entry.relativePath, { contentHash: hash, embedding })
      updated++
    } catch (err) {
      logError("embeddings", `failed to embed ${entry.relativePath}`, { error: String(err) })
    }
  }

  if (updated > 0) {
    await saveCache(index, vaultPath)
    logInfo("embeddings", `incremental update: ${updated} re-embedded`)
  }
}
