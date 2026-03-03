export interface EmbeddingEntry {
  contentHash: string
  embedding: Float32Array
}

export type EmbeddingIndex = Map<string, EmbeddingEntry>
