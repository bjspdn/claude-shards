/**
 * BM25 scoring with multi-field boosts.
 *
 * score(q, D) = Σ  IDF(qi) × Σ  Wf × TF_BM25(qi, f)
 *               qi            fields
 *
 * IDF(qi)       = ln((N - n(qi) + 0.5) / (n(qi) + 0.5) + 1)
 * TF_BM25(qi,f) = (tf × (k1 + 1)) / (tf + k1 × (1 - b + b × |f| / avgFL))
 *
 * - N     = total documents
 * - n(qi) = documents containing keyword qi
 * - tf    = occurrences of qi in field f (word-level token match)
 * - |f|   = word count of field f
 * - avgFL = average word count of field f across corpus
 * - k1    = 1.5 (TF saturation), b = 0.75 (length normalization)
 * - Wf    = field boost: title=10, tag=5, body=1
 */
import type { NoteEntry } from "../vault/types"

export interface IdfTable {
  idf: Map<string, number>
  avgTitleLen: number
  avgTagLen: number
  avgDescLen: number
  avgBodyLen: number
  N: number
}

const K1 = 1.5
const B = 0.75
const W_TITLE = 10
const W_DESC = 7
const W_TAG = 5
const W_BODY = 1

export const MIN_BM25_SCORE = 0.5

/**
 * Split text into lowercase alphanumeric tokens.
 * @param {string} text - Raw text to tokenize.
 * @returns {string[]} Lowercase tokens with non-alphanumeric chars stripped.
 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 0)
}

/**
 * Precompute corpus-wide IDF values and per-field average lengths.
 * @param {NoteEntry[]} entries - All vault note entries.
 * @returns {IdfTable} IDF map and field length averages for BM25 scoring.
 */
export function buildIdfTable(entries: NoteEntry[]): IdfTable {
  const N = entries.length
  const df = new Map<string, number>()
  let totalTitleLen = 0
  let totalTagLen = 0
  let totalDescLen = 0
  let totalBodyLen = 0

  for (const entry of entries) {
    const titleTokens = tokenize(entry.title)
    const tagTokens = tokenize(entry.frontmatter.tags.join(" "))
    const descTokens = tokenize(entry.frontmatter.description ?? "")
    const bodyTokens = tokenize(entry.body)

    totalTitleLen += titleTokens.length
    totalTagLen += tagTokens.length
    totalDescLen += descTokens.length
    totalBodyLen += bodyTokens.length

    const unique = new Set([...titleTokens, ...tagTokens, ...descTokens, ...bodyTokens])
    for (const token of unique) {
      df.set(token, (df.get(token) ?? 0) + 1)
    }
  }

  const idf = new Map<string, number>()
  for (const [token, freq] of df) {
    idf.set(token, Math.log((N - freq + 0.5) / (freq + 0.5) + 1))
  }

  return {
    idf,
    avgTitleLen: N > 0 ? totalTitleLen / N : 0,
    avgTagLen: N > 0 ? totalTagLen / N : 0,
    avgDescLen: N > 0 ? totalDescLen / N : 0,
    avgBodyLen: N > 0 ? totalBodyLen / N : 0,
    N,
  }
}

function tfBm25(tf: number, fieldLen: number, avgFieldLen: number): number {
  if (tf === 0) return 0
  const norm = 1 - B + B * (fieldLen / (avgFieldLen || 1))
  return (tf * (K1 + 1)) / (tf + K1 * norm)
}

function countToken(tokens: string[], keyword: string): number {
  let count = 0
  for (const t of tokens) {
    if (t === keyword) count++
  }
  return count
}

/**
 * Score a single note against query keywords using multi-field BM25.
 * @param {NoteEntry} entry - The note to score.
 * @param {string[]} keywords - Query keywords (pre-split on whitespace).
 * @param {IdfTable} idf - Precomputed IDF table from {@link buildIdfTable}.
 * @returns {number} Weighted BM25 score (0 if no keywords match).
 */
export function scoreBM25(entry: NoteEntry, keywords: string[], idf: IdfTable): number {
  const titleTokens = tokenize(entry.title)
  const tagTokens = tokenize(entry.frontmatter.tags.join(" "))
  const descTokens = tokenize(entry.frontmatter.description ?? "")
  const bodyTokens = tokenize(entry.body)

  let score = 0
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase()
    const idfVal = idf.idf.get(kwLower)
    if (!idfVal || idfVal <= 0) continue

    const titleTf = countToken(titleTokens, kwLower)
    const tagTf = countToken(tagTokens, kwLower)
    const descTf = countToken(descTokens, kwLower)
    const bodyTf = countToken(bodyTokens, kwLower)

    const titleScore = W_TITLE * tfBm25(titleTf, titleTokens.length, idf.avgTitleLen)
    const tagScore = W_TAG * tfBm25(tagTf, tagTokens.length, idf.avgTagLen)
    const descScore = W_DESC * tfBm25(descTf, descTokens.length, idf.avgDescLen)
    const bodyScore = W_BODY * tfBm25(bodyTf, bodyTokens.length, idf.avgBodyLen)

    score += idfVal * (titleScore + tagScore + descScore + bodyScore)
  }

  return score
}
