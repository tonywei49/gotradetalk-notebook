import { randomUUID } from 'crypto'
import {
  createIndexJob,
  deleteChunksByItem,
  getIndexJobById,
  getNotebookItemByCompany,
  getNotebookItemTitles,
  listPendingIndexJobIds,
  markIndexJobFailed,
  markIndexJobRunning,
  markIndexJobSuccess,
  replaceItemChunks,
  searchChunksByQuery,
  upsertItemIndexState
} from '../repos/notebookRepo.js'
import { splitIntoChunks } from './notebookChunking.js'
import { createEmbedding, getNotebookAiConfig, rerankCandidates } from './notebookLlm.js'
import { parseDocument, fetchMatrixMediaBuffer } from './notebookParsing.js'
import { deleteNotebookPointsByItem, ensureQdrantCollection, searchNotebookVectors, upsertNotebookPoints } from './notebookQdrant.js'
import { enqueueNotebookJobId } from './notebookQueue.js'

export type IndexItemRow = {
  id: string
  company_id: string
  owner_user_id: string
  item_type: 'text' | 'file'
  content_markdown: string | null
  title: string | null
  matrix_media_mxc: string | null
  matrix_media_name: string | null
  matrix_media_mime: string | null
  is_indexable: boolean
}

async function extractItemText(item: IndexItemRow, matrixBaseUrl?: string, accessToken?: string) {
  if (item.item_type === 'text') {
    const text = `${item.title || ''}\n${item.content_markdown || ''}`.trim()
    return { text, sourceType: 'text', sourceLocator: null as string | null }
  }

  if (!item.matrix_media_mxc || !matrixBaseUrl || !accessToken) {
    throw new Error('INVALID_CONTEXT')
  }

  const media = await fetchMatrixMediaBuffer(matrixBaseUrl, accessToken, item.matrix_media_mxc)
  const parsed = await parseDocument(media, item.matrix_media_mime, item.matrix_media_name)
  return {
    text: parsed.text,
    sourceType: parsed.sourceType,
    sourceLocator: parsed.sourceLocator || null
  }
}

export async function enqueueNotebookIndexJob(params: {
  companyId: string
  ownerUserId: string
  itemId: string
  jobType: 'upsert' | 'delete' | 'reindex'
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
      const extracted = await extractItemText(item as IndexItemRow, options?.matrixBaseUrl, options?.accessToken)
      const chunks = splitIntoChunks(extracted.text, Number(process.env.NOTEBOOK_CHUNK_SIZE || 1000), Number(process.env.NOTEBOOK_CHUNK_OVERLAP || 200))

      const aiConfig = await getNotebookAiConfig(job.company_id)
      await ensureQdrantCollection()

      await replaceItemChunks({
        itemId: item.id,
        companyId: item.company_id,
        ownerUserId: item.owner_user_id,
        sourceType: extracted.sourceType,
        sourceLocator: extracted.sourceLocator,
        chunks
      })

      const points = [] as Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>
      for (const chunk of chunks) {
        const vector = await createEmbedding(aiConfig, chunk.text)
        points.push({
          id: randomUUID(),
          vector,
          payload: {
            chunk_id: `${item.id}:${chunk.chunkIndex}`,
            item_id: item.id,
            company_id: item.company_id,
            owner_user_id: item.owner_user_id,
            chunk_index: chunk.chunkIndex,
            content_hash: chunk.contentHash,
            source_type: extracted.sourceType,
            source_locator: extracted.sourceLocator,
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
    await runNotebookIndexJob(String(jobId), options)
  }

  return jobIds.length
}

export async function hybridSearchNotebook(params: {
  companyId: string
  ownerUserId: string
  query: string
  topK: number
}): Promise<Array<{ item_id: string; title: string | null; snippet: string; source_locator: string | null; score: number }>> {
  const aiConfig = await getNotebookAiConfig(params.companyId)
  const topK = Math.max(1, params.topK)
  const vector = await createEmbedding(aiConfig, params.query)
  const vectorHits = await searchNotebookVectors(params.companyId, params.ownerUserId, vector, topK * 2)
  const bmRows = await searchChunksByQuery({
    companyId: params.companyId,
    ownerUserId: params.ownerUserId,
    query: params.query,
    limit: topK * 2
  })

  const merged = new Map<string, { item_id: string; snippet: string; source_locator: string | null; score: number }>()

  for (const hit of vectorHits) {
    const payload = hit.payload || {}
    const itemId = String(payload.item_id || '')
    const snippet = String(payload.chunk_text || payload.text || '')
    if (!itemId) continue
    merged.set(`${itemId}:${String(payload.chunk_index || 0)}`, {
      item_id: itemId,
      snippet,
      source_locator: payload.source_locator ? String(payload.source_locator) : null,
      score: Number(hit.score || 0)
    })
  }

  for (const row of bmRows || []) {
    const key = `${row.item_id}:${row.source_locator || row.chunk_text.slice(0, 20)}`
    if (!merged.has(key)) {
      merged.set(key, {
        item_id: String(row.item_id),
        snippet: String(row.chunk_text || ''),
        source_locator: row.source_locator ? String(row.source_locator) : null,
        score: 0.5
      })
    }
  }

  const candidates = Array.from(merged.values())
  const ranked = await rerankCandidates(
    aiConfig,
    params.query,
    candidates.map((c) => ({ text: c.snippet, score: c.score }))
  )

  const titleMap = await getNotebookItemTitles(
    params.companyId,
    params.ownerUserId,
    Array.from(new Set(candidates.map((c) => c.item_id)))
  )

  return ranked.slice(0, topK).map((row) => {
    const candidate = candidates[row.index]
    return {
      item_id: candidate.item_id,
      title: titleMap.get(candidate.item_id) || null,
      snippet: candidate.snippet,
      source_locator: candidate.source_locator,
      score: row.score
    }
  })
}
