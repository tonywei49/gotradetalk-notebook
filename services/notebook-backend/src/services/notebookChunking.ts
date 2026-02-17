import { createHash } from 'crypto'

export type TextChunk = {
  chunkIndex: number
  text: string
  tokenCount: number
  contentHash: string
}

export function estimateTokenCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return Math.ceil(trimmed.length / 4)
}

export function splitIntoChunks(text: string, chunkSize = 1000, overlap = 200): TextChunk[] {
  const normalized = String(text || '').trim()
  if (!normalized) return []

  const safeChunkSize = Math.max(100, chunkSize)
  const safeOverlap = Math.max(0, Math.min(overlap, safeChunkSize - 1))
  const chunks: TextChunk[] = []
  let offset = 0
  let index = 0

  while (offset < normalized.length) {
    const end = Math.min(normalized.length, offset + safeChunkSize)
    const piece = normalized.slice(offset, end).trim()
    if (piece) {
      chunks.push({
        chunkIndex: index,
        text: piece,
        tokenCount: estimateTokenCount(piece),
        contentHash: createHash('sha256').update(piece).digest('hex')
      })
      index += 1
    }

    if (end >= normalized.length) break
    offset = Math.max(end - safeOverlap, offset + 1)
  }

  return chunks
}
