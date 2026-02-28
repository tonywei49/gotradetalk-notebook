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

type BreakPoint = {
  pos: number
  score: number
}

type CodeFenceRegion = {
  start: number
  end: number
}

function scanBreakPoints(text: string): BreakPoint[] {
  const rules: Array<{ regex: RegExp; score: number }> = [
    { regex: /\n#{1,3}\s+/g, score: 100 },
    { regex: /\n#{4,6}\s+/g, score: 80 },
    { regex: /\n(?:---|\*\*\*|___)\s*\n/g, score: 65 },
    { regex: /\n[-*]\s+/g, score: 35 },
    { regex: /\n\d+\.\s+/g, score: 35 },
    { regex: /\n\n+/g, score: 25 },
    { regex: /\n/g, score: 8 }
  ]

  const bestByPos = new Map<number, number>()
  for (const rule of rules) {
    for (const match of text.matchAll(rule.regex)) {
      const pos = match.index ?? -1
      if (pos < 0) continue
      const current = bestByPos.get(pos) || 0
      if (rule.score > current) {
        bestByPos.set(pos, rule.score)
      }
    }
  }

  return Array.from(bestByPos.entries())
    .map(([pos, score]) => ({ pos, score }))
    .sort((a, b) => a.pos - b.pos)
}

function findCodeFenceRegions(text: string): CodeFenceRegion[] {
  const regions: CodeFenceRegion[] = []
  const pattern = /\n```/g
  let openStart: number | null = null

  for (const match of text.matchAll(pattern)) {
    const pos = match.index ?? -1
    if (pos < 0) continue

    if (openStart === null) {
      openStart = pos
    } else {
      regions.push({ start: openStart, end: pos + match[0].length })
      openStart = null
    }
  }

  if (openStart !== null) {
    regions.push({ start: openStart, end: text.length })
  }

  return regions
}

function locateFenceAtPosition(pos: number, fences: CodeFenceRegion[]) {
  for (const fence of fences) {
    if (pos > fence.start && pos < fence.end) return fence
  }
  return null
}

function findBestCutoff(
  breakPoints: BreakPoint[],
  codeFences: CodeFenceRegion[],
  start: number,
  target: number,
  window: number
) {
  const targetFence = locateFenceAtPosition(target, codeFences)
  if (targetFence) {
    if (targetFence.start > start + 1) {
      return targetFence.start
    }
    return targetFence.end
  }

  let bestPos = target
  let bestScore = -Infinity
  const windowStart = Math.max(start + 1, target - window)

  for (const bp of breakPoints) {
    if (bp.pos < windowStart) continue
    if (bp.pos >= target) break
    if (locateFenceAtPosition(bp.pos, codeFences)) continue

    const distance = target - bp.pos
    const normalized = Math.min(1, distance / Math.max(window, 1))
    const decay = 1 - normalized * normalized * 0.7
    const score = bp.score * decay
    if (score > bestScore) {
      bestScore = score
      bestPos = bp.pos
    }
  }

  return Math.max(start + 1, bestPos)
}

export function splitIntoChunks(text: string, chunkSize = 1000, overlap = 200): TextChunk[] {
  const normalized = String(text || '').trim()
  if (!normalized) return []

  const safeChunkSize = Math.max(100, chunkSize)
  const safeOverlap = Math.max(0, Math.min(overlap, safeChunkSize - 1))
  const searchWindow = Math.max(120, Math.floor(safeChunkSize * 0.25))
  const breakPoints = scanBreakPoints(normalized)
  const codeFences = findCodeFenceRegions(normalized)
  const chunks: TextChunk[] = []
  let offset = 0
  let index = 0

  while (offset < normalized.length) {
    const targetEnd = Math.min(normalized.length, offset + safeChunkSize)
    const end = targetEnd < normalized.length
      ? findBestCutoff(breakPoints, codeFences, offset, targetEnd, searchWindow)
      : targetEnd
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
    const dynamicOverlap = piece.includes('```')
      ? Math.min(safeOverlap, Math.floor(safeChunkSize * 0.1))
      : safeOverlap
    offset = Math.max(end - dynamicOverlap, offset + 1)
    const overlapFence = locateFenceAtPosition(offset, codeFences)
    if (overlapFence) {
      offset = Math.max(offset, overlapFence.end)
    }
  }

  return chunks
}

export type ChunkStrategy = 'smart' | 'paragraph' | 'heading' | 'custom'

function splitByDelimiter(text: string, delimiter: string): string[] {
  if (!delimiter) return [text]
  return text.split(delimiter).map((s) => s.trim()).filter(Boolean)
}

function mergeSegments(segments: string[], chunkSize: number): TextChunk[] {
  const safeSize = Math.max(300, Math.min(chunkSize, 2000))
  const overlap = Math.min(Math.floor(safeSize * 0.2), 200)
  const chunks: TextChunk[] = []
  let buffer = ''
  let index = 0

  for (const segment of segments) {
    if (buffer && (buffer.length + segment.length + 1) > safeSize) {
      const piece = buffer.trim()
      if (piece) {
        chunks.push({
          chunkIndex: index,
          text: piece,
          tokenCount: estimateTokenCount(piece),
          contentHash: createHash('sha256').update(piece).digest('hex')
        })
        index += 1
      }
      const overlapText = piece.length > overlap ? piece.slice(-overlap) : ''
      buffer = overlapText ? overlapText + '\n' + segment : segment
    } else {
      buffer = buffer ? buffer + '\n' + segment : segment
    }
  }

  if (buffer.trim()) {
    const piece = buffer.trim()
    chunks.push({
      chunkIndex: index,
      text: piece,
      tokenCount: estimateTokenCount(piece),
      contentHash: createHash('sha256').update(piece).digest('hex')
    })
  }

  return chunks
}

export function splitIntoChunksByStrategy(
  text: string,
  strategy: ChunkStrategy = 'smart',
  chunkSize = 1000,
  separator?: string
): TextChunk[] {
  const normalized = String(text || '').trim()
  if (!normalized) return []

  const safeSize = Math.max(300, Math.min(chunkSize, 2000))
  const overlap = Math.min(Math.floor(safeSize * 0.2), 200)

  if (strategy === 'smart') {
    return splitIntoChunks(normalized, safeSize, overlap)
  }

  if (strategy === 'paragraph') {
    const segments = splitByDelimiter(normalized, '\n\n')
    return mergeSegments(segments, safeSize)
  }

  if (strategy === 'heading') {
    const segments = normalized.split(/\n(?=#{1,2}\s+)/).map((s) => s.trim()).filter(Boolean)
    return mergeSegments(segments, safeSize)
  }

  // custom
  const customSep = separator || '\n'
  const segments = splitByDelimiter(normalized, customSep)
  return mergeSegments(segments, safeSize)
}
