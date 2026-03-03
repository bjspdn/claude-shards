import { test, expect, beforeAll } from "bun:test"
import { warmup, encode, isReady } from "../../src/embeddings/embedder"
import { dotProduct } from "../../src/tools/search-tool"

beforeAll(async () => {
  await warmup()
}, 60_000)

test("isReady returns true after warmup", () => {
  expect(isReady()).toBe(true)
})

test("encode returns 384-dimensional Float32Array", async () => {
  const vec = await encode("hello world")
  expect(vec).toBeInstanceOf(Float32Array)
  expect(vec.length).toBe(384)
})

test("encode returns L2-normalized vectors (unit length)", async () => {
  const vec = await encode("semantic search re-ranking")
  const norm = Math.sqrt(dotProduct(vec, vec))
  expect(norm).toBeCloseTo(1.0, 3)
})

test("similar texts have higher cosine similarity than dissimilar texts", async () => {
  const a = await encode("session cookie authentication middleware")
  const b = await encode("auth token validation login")
  const c = await encode("sourdough bread baking recipe")

  const simAB = dotProduct(a, b)
  const simAC = dotProduct(a, c)
  expect(simAB).toBeGreaterThan(simAC)
})

test("warmup is idempotent — second call does not throw", async () => {
  await warmup()
  expect(isReady()).toBe(true)
})
