import { logInfo, logError } from "../logger"

type Pipeline = (text: string, options: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>

let pipelinePromise: Promise<Pipeline> | null = null
let ready = false

async function initPipeline(): Promise<Pipeline> {
  const { pipeline } = await import("@huggingface/transformers")
  const pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    dtype: "q8",
  })
  ready = true
  return pipe as unknown as Pipeline
}

export function isReady(): boolean {
  return ready
}

export async function warmup(): Promise<void> {
  if (pipelinePromise) return
  pipelinePromise = initPipeline()
  try {
    await pipelinePromise
    logInfo("embedder", "pipeline ready")
  } catch (err) {
    pipelinePromise = null
    logError("embedder", "warmup failed", { error: String(err) })
    throw err
  }
}

export async function encode(text: string): Promise<Float32Array> {
  if (!pipelinePromise) throw new Error("Embedder not initialized — call warmup() first")
  const pipe = await pipelinePromise
  const result = await pipe(text, { pooling: "mean", normalize: true })
  return new Float32Array(result.data)
}
