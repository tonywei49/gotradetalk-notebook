import { randomUUID } from 'crypto'
import {
  createIndexJob,
  deleteChunksByItem,
  getIndexJobById,
  listActiveNotebookItemFilesByItem,
  getNotebookItemByCompany,
  getIndexableActiveItemIdSet,
  getNotebookItemSources,
  listPendingIndexJobIds,
  markIndexJobFailed,
  markIndexJobRunning,
  markIndexJobSuccess,
  replaceItemChunks,
  searchChunksByQuery,
  upsertItemIndexState
} from '../repos/notebookRepo.js'
import { splitIntoChunks, splitIntoChunksByStrategy, type ChunkStrategy } from './notebookChunking.js'
import { createEmbedding, getNotebookAiConfig, rerankCandidates } from './notebookLlm.js'
import { deleteNotebookPointsByItem, ensureQdrantCollection, getQdrantConfig, searchNotebookVectors, upsertNotebookPoints } from './notebookQdrant.js'
import { enqueueNotebookJobId } from './notebookQueue.js'
import { extractItemSources, type IndexItemFileRow, type IndexItemRow } from './sourceExtractors.js'

const STRONG_SIGNAL_MIN_SCORE = 0.82
const STRONG_SIGNAL_MIN_GAP = 0.12

export async function enqueueNotebookIndexJob(params: {
  companyId: string
  ownerUserId: string
  itemId: string
  jobType: 'upsert' | 'delete' | 'reindex'
  chunkStrategy?: string | null
  chunkSize?: number | null
  chunkSeparator?: string | null
}) {
  const data = await createIndexJob(params)
  if (data?.id) {
    await enqueueNotebookJobId(String(data.id))
  }
}

export async function runNotebookIndexJob(jobId: string, options?: { matrixBaseUrl?: string; accessToken?: string }) {
  const job = await getIndexJobById(jobId)

  if (!job) {
    throw new Error('JOB_NOT_FOUND')
  }

  await markIndexJobRunning(job.id)

  try {
    const item = await getNotebookItemByCompany(job.item_id, job.company_id)

    if (!item) {
      throw new Error('ITEM_NOT_FOUND')
    }

    if (job.job_type === 'delete' || !item.is_indexable) {
      await deleteNotebookPointsByItem(job.company_id, item.id)
      await deleteChunksByItem(job.company_id, item.id)
      await upsertItemIndexState(item.id, 'skipped', null)
    } else {
      const aiConfig = await getNotebookAiConfig(job.company_id)
      const files = await listActiveNotebookItemFilesByItem(job.company_id, item.id)
      const extractedList = await extractItemSources({
        item: item as IndexItemRow,
        files: files as IndexItemFileRow[],
        matrixBaseUrl: options?.matrixBaseUrl,
        accessToken: options?.accessToken,
        ocr: {
          enabled: aiConfig.ocrEnabled,
          baseUrl: aiConfig.ocrBaseUrl,
          apiKey: aiConfig.ocrApiKey,
          model: aiConfig.ocrModel
        },
        vision: {
          baseUrl: aiConfig.visionBaseUrl,
          apiKey: aiConfig.visionApiKey,
          model: aiConfig.visionModel,
          fallbackBaseUrl: aiConfig.chatBaseUrl,
          fallbackApiKey: aiConfig.chatApiKey,
          fallbackModel: aiConfig.chatModel
        }
      })
      let chunkIndexOffset = 0
      const jobChunkStrategy = (job.chunk_strategy || 'smart') as ChunkStrategy
      const jobChunkSize = job.chunk_size || Number(process.env.NOTEBOOK_CHUNK_SIZE || 1000)
      const jobChunkSeparator = job.chunk_separator || undefined
      const chunks = extractedList.flatMap((extracted) => {
        const sourceChunks = splitIntoChunksByStrategy(
          extracted.text,
          jobChunkStrategy,
          jobChunkSize,
          jobChunkSeparator
        )
        const mapped = sourceChunks.map((chunk, localIdx) => ({
          ...chunk,
          chunkIndex: chunkIndexOffset + localIdx,
          sourceType: extracted.sourceType,
          sourceLocator: extracted.sourceLocator
        }))
        chunkIndexOffset += sourceChunks.length
        return mapped
      })

      await ensureQdrantCollection()

      await replaceItemChunks({
        itemId: item.id,
        companyId: item.company_id,
        ownerUserId: item.owner_user_id,
        chunks
      })

      const points = [] as Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>
      for (const chunk of chunks) {
        const vector = await createEmbedding(aiConfig, chunk.text)
        const expectedDim = getQdrantConfig().vectorSize
        if (vector.length !== expectedDim) {
          const detail = `EMBEDDING_DIM_MISMATCH: expected ${expectedDim} got ${vector.length}`
          throw new Error(detail)
        }
        points.push({
          id: randomUUID(),
          vector,
          payload: {
            chunk_id: `${item.id}:${chunk.chunkIndex}`,
            item_id: item.id,
            company_id: item.company_id,
            owner_user_id: item.owner_user_id,
            source_scope: item.source_scope,
            chunk_index: chunk.chunkIndex,
            content_hash: chunk.contentHash,
            source_type: chunk.sourceType,
            source_locator: chunk.sourceLocator,
            text: chunk.text,
            updated_at: new Date().toISOString()
          }
        })
      }

      await deleteNotebookPointsByItem(item.company_id, item.id)
      await upsertNotebookPoints(points)
      await upsertItemIndexState(item.id, 'success', null)
    }

    await markIndexJobSuccess(job.id)
  } catch (error: any) {
    const message = error?.message || 'INDEX_FAILED'
    await markIndexJobFailed(job.id, message)
    await upsertItemIndexState(job.item_id, 'failed', message)
    throw error
  }
}

export async function pollAndRunNotebookIndexJobs(limit = 5, options?: { matrixBaseUrl?: string; accessToken?: string }) {
  const jobIds = await listPendingIndexJobIds(limit)

  for (const jobId of jobIds) {
    try {
      await runNotebookIndexJob(String(jobId), options)
    } catch (error: any) {
      console.error('[notebook-indexing] job failed', {
        jobId: String(jobId),
        error: error?.message || String(error)
      })
    }
  }

  return jobIds.length
}

export async function hybridSearchNotebook(params: {
  companyId: string
  ownerUserId: string
  scope: 'personal' | 'company' | 'both'
  query: string
  topK: number
}): Promise<Array<{ item_id: string; title: string | null; source_scope: 'personal' | 'company'; source_title: string | null; source_file_name: string | null; snippet: string; source_locator: string | null; score: number }>> {
  const reciprocalRankFusion = (
    lists: Array<Array<{ key: string }>>,
    weights: number[] = [],
    k = 60
  ) => {
    const scoreByKey = new Map<string, number>()
    for (let listIndex = 0; listIndex < lists.length; listIndex += 1) {
      const list = lists[listIndex] || []
      const weight = weights[listIndex] ?? 1
      for (let rank = 0; rank < list.length; rank += 1) {
        const key = list[rank]?.key
        if (!key) continue
        const next = (scoreByKey.get(key) || 0) + (weight / (k + rank + 1))
        scoreByKey.set(key, next)
      }
    }
    return scoreByKey
  }

  const topK = Math.max(1, params.topK)
  const bmRows = await searchChunksByQuery({
    companyId: params.companyId,
    ownerUserId: params.ownerUserId,
    scope: params.scope,
    query: params.query,
    limit: topK * 4
  })

  const bmTopScore = Number(bmRows[0]?.score || 0)
  const bmSecondScore = Number(bmRows[1]?.score || 0)
  const hasStrongSignal = bmRows.length > 0
    && bmTopScore >= STRONG_SIGNAL_MIN_SCORE
    && (bmTopScore - bmSecondScore) >= STRONG_SIGNAL_MIN_GAP

  if (hasStrongSignal) {
    const lexicalByKey = new Map<string, { item_id: string; snippet: string; source_locator: string | null; score: number }>()
    for (const row of bmRows) {
      const key = `${row.item_id}:${String(row.chunk_index || 0)}`
      if (!lexicalByKey.has(key)) {
        lexicalByKey.set(key, {
          item_id: String(row.item_id),
          snippet: String(row.chunk_text || ''),
          source_locator: row.source_locator ? String(row.source_locator) : null,
          score: Number(row.score || 0)
        })
      }
    }

    const lexicalCandidates = Array.from(lexicalByKey.values()).slice(0, topK)
    const sourceMap = await getNotebookItemSources(
      params.companyId,
      params.ownerUserId,
      Array.from(new Set(lexicalCandidates.map((c) => c.item_id))),
      params.scope
    )

    return lexicalCandidates.map((row) => ({
      item_id: row.item_id,
      source_scope: (sourceMap.get(row.item_id)?.source_scope || 'personal') as 'personal' | 'company',
      source_title: sourceMap.get(row.item_id)?.title || null,
      title: sourceMap.get(row.item_id)?.title || null,
      source_file_name: sourceMap.get(row.item_id)?.source_file_name || null,
      snippet: row.snippet,
      source_locator: row.source_locator,
      score: row.score
    }))
  }

  const aiConfig = await getNotebookAiConfig(params.companyId)
  const vector = await createEmbedding(aiConfig, params.query)
  const expectedDim = getQdrantConfig().vectorSize
  if (vector.length !== expectedDim) {
    throw new Error(`EMBEDDING_DIM_MISMATCH: expected ${expectedDim} got ${vector.length}`)
  }
  const vectorHits = await searchNotebookVectors(params.companyId, params.ownerUserId, vector, topK * 2, params.scope)

  const vectorList: Array<{ key: string; item_id: string; snippet: string; source_locator: string | null; base_score: number }> = []
  const bm25List: Array<{ key: string; item_id: string; snippet: string; source_locator: string | null; base_score: number }> = []

  const candidatesByKey = new Map<string, { item_id: string; snippet: string; source_locator: string | null; score: number }>()

  for (const hit of vectorHits) {
    const payload = hit.payload || {}
    const itemId = String(payload.item_id || '')
    const snippet = String(payload.chunk_text || payload.text || '')
    if (!itemId) continue
    const key = `${itemId}:${String(payload.chunk_index || 0)}`
    vectorList.push({
      key,
      item_id: itemId,
      snippet,
      source_locator: payload.source_locator ? String(payload.source_locator) : null,
      base_score: Number(hit.score || 0)
    })
    candidatesByKey.set(key, {
      item_id: itemId,
      snippet,
      source_locator: payload.source_locator ? String(payload.source_locator) : null,
      score: Number(hit.score || 0)
    })
  }

  for (const row of bmRows || []) {
    const key = `${row.item_id}:${String(row.chunk_index || 0)}`
    bm25List.push({
      key,
      item_id: String(row.item_id),
      snippet: String(row.chunk_text || ''),
      source_locator: row.source_locator ? String(row.source_locator) : null,
      base_score: Number(row.score || 0.1)
    })
    if (!candidatesByKey.has(key)) {
      candidatesByKey.set(key, {
        item_id: String(row.item_id),
        snippet: String(row.chunk_text || ''),
        source_locator: row.source_locator ? String(row.source_locator) : null,
        score: Number(row.score || 0.1)
      })
    }
  }

  const allowedItemIds = await getIndexableActiveItemIdSet(
    params.companyId,
    params.ownerUserId,
    Array.from(new Set(Array.from(candidatesByKey.values()).map((c) => c.item_id))),
    params.scope
  )

  for (const [key, value] of Array.from(candidatesByKey.entries())) {
    if (!allowedItemIds.has(value.item_id)) {
      candidatesByKey.delete(key)
    }
  }

  const fusedScores = reciprocalRankFusion(
    [vectorList, bm25List],
    [1.2, 1.0]
  )

  for (const [key, retrieval] of candidatesByKey.entries()) {
    const fused = fusedScores.get(key) || 0
    retrieval.score = fused > 0 ? fused : retrieval.score
  }

  const candidates = Array.from(candidatesByKey.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(topK * 4, 12))

  const ranked = await rerankCandidates(
    aiConfig,
    params.query,
    candidates.map((c) => ({ text: c.snippet, score: c.score }))
  )

  const maxRetrievalScore = Math.max(Number(candidates[0]?.score || 0), 0.000001)
  const blended = ranked.map((row) => {
    const retrievalRank = row.index + 1
    const retrieval = candidates[row.index]
    const retrievalNorm = Number(retrieval?.score || 0) / maxRetrievalScore

    let retrievalWeight = 0.4
    if (retrievalRank <= 3) retrievalWeight = 0.75
    else if (retrievalRank <= 10) retrievalWeight = 0.6

    const blendedScore = retrievalWeight * retrievalNorm + (1 - retrievalWeight) * Number(row.score || 0)
    return { ...row, score: blendedScore }
  }).sort((a, b) => b.score - a.score)

  const sourceMap = await getNotebookItemSources(
    params.companyId,
    params.ownerUserId,
    Array.from(new Set(candidates.map((c) => c.item_id))),
    params.scope
  )

  return blended.slice(0, topK).map((row) => {
    const candidate = candidates[row.index]
    return {
      item_id: candidate.item_id,
      source_scope: (sourceMap.get(candidate.item_id)?.source_scope || 'personal') as 'personal' | 'company',
      source_title: sourceMap.get(candidate.item_id)?.title || null,
      title: sourceMap.get(candidate.item_id)?.title || null,
      source_file_name: sourceMap.get(candidate.item_id)?.source_file_name || null,
      snippet: candidate.snippet,
      source_locator: candidate.source_locator,
      score: row.score
    }
  })
}
