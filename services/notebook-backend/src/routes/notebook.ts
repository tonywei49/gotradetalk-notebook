import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import {
  createNotebookItemFile,
  createNotebookItem as repoCreateNotebookItem,
  getNotebookChunkStatsByItem,
  getLatestActiveNotebookItemFile,
  getNotebookItemFileByOwner,
  getIndexJobByOwner,
  getLatestIndexJobByItem,
  getNotebookItemByOwner,
  getSyncOpByClientOpId,
  listNotebookItemFilesByItem,
  listNotebookItemFilesByItemIds,
  listNotebookChunksByItem,
  listNotebookItems as repoListNotebookItems,
  listNotebookItemsAfterCursor,
  markIndexJobPending,
  softDeleteNotebookItemFileByOwner,
  syncNotebookItemPrimaryFileFromLatest,
  updateNotebookItemByOwner,
  createSyncOp,
  updateSyncOpStatus
} from '../repos/notebookRepo.js'
import {
  ensureAssistAllowed,
  ensureNotebookBasic,
  resolveNotebookAccessContext,
  sendNotebookError
} from '../services/notebookAuth.js'
import { enqueueNotebookIndexJob } from '../services/notebookIndexing.js'
import { resolveMatrixContextMessages } from '../services/notebookContextResolver.js'
import { runNotebookAssist } from '../services/notebookAssistOrchestrator.js'
import { getNotebookAiConfig, refineContextAssistQuery } from '../services/notebookLlm.js'

function getBearerToken(req: Request) {
  const authHeader = String(req.headers.authorization || '')
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  return ''
}

function getMatrixContextToken(req: Request) {
  return String(req.headers['x-matrix-access-token'] || req.query.matrix_access_token || '').trim()
}

function getMatrixBaseUrl(req: Request) {
  return String(req.query.hs_url || req.headers['x-hs-url'] || '').trim()
}

function parseCursor(value: string | undefined) {
  if (!value) return null
  const [updatedAt, id] = value.split('|')
  if (!updatedAt || !id) return null
  return { updatedAt, id }
}

function encodeCursor(updatedAt: string, id: string) {
  return `${updatedAt}|${id}`
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function sendAiRuntimeError(res: Response, message: string) {
  if (message === 'CAPABILITY_DISABLED') return sendNotebookError(res, 403, 'CAPABILITY_DISABLED')
  if (message === 'CAPABILITY_EXPIRED') return sendNotebookError(res, 403, 'CAPABILITY_EXPIRED')
  if (message === 'QUOTA_EXCEEDED') return sendNotebookError(res, 429, 'QUOTA_EXCEEDED')
  return sendNotebookError(res, 502, 'MODEL_ERROR', message || 'MODEL_ERROR')
}

async function withItemFiles<T extends { id: string }>(context: { companyId: string; userId: string }, item: T | null) {
  if (!item) return null
  const files = await listNotebookItemFilesByItem(context.companyId, context.userId, item.id)
  return { ...item, files }
}

async function withItemsFiles<T extends { id: string }>(context: { companyId: string; userId: string }, items: T[]) {
  const byItem = await listNotebookItemFilesByItemIds(context.companyId, context.userId, items.map((item) => item.id))
  return items.map((item) => ({ ...item, files: byItem.get(item.id) || [] }))
}

export async function getMeCapabilities(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) {
    return sendNotebookError(res, 401, 'UNAUTHORIZED')
  }

  if (context.policy.runtime_rejection_code === 'QUOTA_EXCEEDED') {
    return sendNotebookError(res, 429, 'QUOTA_EXCEEDED')
  }
  if (context.policy.runtime_rejection_code === 'CAPABILITY_EXPIRED') {
    return sendNotebookError(res, 403, 'CAPABILITY_EXPIRED')
  }
  if (context.policy.runtime_rejection_code === 'CAPABILITY_DISABLED') {
    return sendNotebookError(res, 403, 'CAPABILITY_DISABLED')
  }

  return res.json({
    user_id: context.userId,
    company_id: context.companyId,
    role: context.role,
    capabilities: context.capabilities,
    policy: context.policy
  })
}

export async function listNotebookItems(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100)
  const q = String(req.query.q || '').trim()
  const itemType = String(req.query.item_type || '').trim()
  const filter = String(req.query.filter || 'all').trim().toLowerCase()
  const status = String(req.query.status || 'active').trim()
  const cursor = parseCursor(String(req.query.cursor || ''))
  const isIndexable = filter === 'knowledge' ? true : filter === 'note' ? false : undefined

  try {
    const rows = await repoListNotebookItems({
      companyId: context.companyId,
      ownerUserId: context.userId,
      status,
      itemType: itemType || undefined,
      isIndexable,
      query: q || undefined,
      updatedBefore: cursor?.updatedAt || null,
      limit: limit + 1
    })

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const withFiles = await withItemsFiles(context, items)
    const last = items[items.length - 1]

    return res.json({
      items: withFiles,
      next_cursor: hasMore && last ? encodeCursor(String(last.updated_at), String(last.id)) : null
    })
  } catch (error: any) {
    return sendNotebookError(res, 500, 'INTERNAL_ERROR', error?.message || 'LIST_FAILED')
  }
}

export async function createNotebookItem(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const body = req.body as {
    title?: string
    content_markdown?: string
    item_type?: 'text' | 'file'
    is_indexable?: boolean
  }

  const itemType = body.item_type === 'file' ? 'file' : 'text'
  const title = String(body.title || '').trim() || null
  const contentMarkdown = String(body.content_markdown || '').trim() || null
  const isIndexable = Boolean(body.is_indexable)

  try {
    const item = await repoCreateNotebookItem({
      companyId: context.companyId,
      ownerUserId: context.userId,
      title,
      contentMarkdown,
      itemType,
      isIndexable
    })

    if (isIndexable) {
      await enqueueNotebookIndexJob({
        companyId: context.companyId,
        ownerUserId: context.userId,
        itemId: String(item.id),
        jobType: 'upsert'
      })
    }

    return res.status(201).json({ item: await withItemFiles(context, item) })
  } catch (error: any) {
    return sendNotebookError(res, 500, 'INTERNAL_ERROR', error?.message || 'CREATE_FAILED')
  }
}

export async function updateNotebookItem(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const id = String(req.params.id || '').trim()
  if (!id) return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing id')

  const existing = await getNotebookItemByOwner(context.companyId, context.userId, id)
  if (!existing) return sendNotebookError(res, 404, 'NOT_FOUND')

  const body = req.body as {
    title?: string
    content_markdown?: string
    is_indexable?: boolean
    status?: 'active' | 'deleted'
    revision?: number
  }

  if (body.revision !== undefined && Number(body.revision) !== Number(existing.revision)) {
    return sendNotebookError(res, 409, 'REVISION_CONFLICT')
  }

  const updates: Record<string, unknown> = {
    revision: Number(existing.revision) + 1
  }

  if (body.title !== undefined) updates.title = String(body.title || '').trim() || null
  if (body.content_markdown !== undefined) updates.content_markdown = String(body.content_markdown || '').trim() || null
  if (body.status !== undefined) updates.status = body.status === 'deleted' ? 'deleted' : 'active'
  if (body.is_indexable !== undefined) {
    updates.is_indexable = Boolean(body.is_indexable)
    updates.index_status = 'pending'
    updates.index_error = null
  }

  try {
    const item = await updateNotebookItemByOwner(context.companyId, context.userId, id, updates)
    if (!item) {
      return sendNotebookError(res, 404, 'NOT_FOUND')
    }

    const shouldIndex = Boolean((updates.is_indexable ?? existing.is_indexable) === true)
    await enqueueNotebookIndexJob({
      companyId: context.companyId,
      ownerUserId: context.userId,
      itemId: id,
      jobType: shouldIndex ? 'upsert' : 'delete'
    })

    return res.json({ item: await withItemFiles(context, item), conflict: false })
  } catch (error: any) {
    return sendNotebookError(res, 500, 'INTERNAL_ERROR', error?.message || 'UPDATE_FAILED')
  }
}

export async function deleteNotebookItem(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const id = String(req.params.id || '').trim()
  if (!id) return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing id')

  const existing = await getNotebookItemByOwner(context.companyId, context.userId, id)
  if (!existing) return sendNotebookError(res, 404, 'NOT_FOUND')

  const item = await updateNotebookItemByOwner(context.companyId, context.userId, id, {
    status: 'deleted',
    revision: Number(existing.revision) + 1,
    index_status: 'pending',
    index_error: null
  })

  if (!item) return sendNotebookError(res, 404, 'NOT_FOUND')

  await enqueueNotebookIndexJob({
    companyId: context.companyId,
    ownerUserId: context.userId,
    itemId: id,
    jobType: 'delete'
  })

  return res.json({ ok: true, revision: Number(existing.revision) + 1 })
}

export async function attachNotebookFile(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const id = String(req.params.id || '').trim()
  if (!id) return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing id')

  const body = req.body as {
    matrix_media_mxc?: string
    matrix_media_name?: string
    matrix_media_mime?: string
    matrix_media_size?: number
    is_indexable?: boolean
  }

  const matrixMediaMxc = String(body.matrix_media_mxc || '').trim()
  if (!matrixMediaMxc) {
    return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing matrix_media_mxc')
  }

  const supported = ['pdf', 'docx', 'csv', 'xlsx', 'txt', 'md', 'jpg', 'jpeg', 'png', 'webp']
  const fileName = String(body.matrix_media_name || '').toLowerCase()
  const mime = String(body.matrix_media_mime || '').toLowerCase()
  const ext = fileName.split('.').pop() || ''
  const isSupported = supported.includes(ext) || supported.some((t) => mime.includes(t))

  if (!isSupported && body.is_indexable) {
    return sendNotebookError(res, 400, 'UNSUPPORTED_FILE_TYPE')
  }

  const existing = await getNotebookItemByOwner(context.companyId, context.userId, id)
  if (!existing) {
    return sendNotebookError(res, 404, 'NOT_FOUND')
  }

  await createNotebookItemFile({
    itemId: id,
    companyId: context.companyId,
    ownerUserId: context.userId,
    matrixMediaMxc,
    matrixMediaName: body.matrix_media_name || null,
    matrixMediaMime: body.matrix_media_mime || null,
    matrixMediaSize: body.matrix_media_size || null,
    isIndexable: body.is_indexable !== false
  })

  const item = await updateNotebookItemByOwner(context.companyId, context.userId, id, {
    item_type: 'file',
    is_indexable: body.is_indexable !== false,
    index_status: 'pending',
    index_error: null,
    revision: Number(existing.revision) + 1
  })

  if (!item) {
    return sendNotebookError(res, 404, 'NOT_FOUND')
  }

  await syncNotebookItemPrimaryFileFromLatest(context.companyId, context.userId, id)

  const indexJobType = body.is_indexable === false ? 'delete' : 'upsert'
  await enqueueNotebookIndexJob({
    companyId: context.companyId,
    ownerUserId: context.userId,
    itemId: id,
    jobType: indexJobType
  })

  const indexJob = await getLatestIndexJobByItem(context.companyId, id)

  return res.status(202).json({ item: await withItemFiles(context, item), index_job: indexJob || null })
}

export async function listNotebookItemFiles(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const id = String(req.params.id || '').trim()
  if (!id) return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing id')

  const item = await getNotebookItemByOwner(context.companyId, context.userId, id)
  if (!item) return sendNotebookError(res, 404, 'NOT_FOUND')

  const files = await listNotebookItemFilesByItem(context.companyId, context.userId, id)
  return res.json({ item_id: id, files })
}

export async function deleteNotebookItemFile(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const id = String(req.params.id || '').trim()
  const fileId = String(req.params.fileId || '').trim()
  if (!id || !fileId) return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing id or fileId')

  const item = await getNotebookItemByOwner(context.companyId, context.userId, id)
  if (!item) return sendNotebookError(res, 404, 'NOT_FOUND')

  const target = await getNotebookItemFileByOwner(context.companyId, context.userId, id, fileId)
  if (!target) return sendNotebookError(res, 404, 'NOT_FOUND')

  const deleted = await softDeleteNotebookItemFileByOwner(context.companyId, context.userId, id, fileId)
  if (!deleted) return sendNotebookError(res, 404, 'NOT_FOUND')

  const latest = await getLatestActiveNotebookItemFile(context.companyId, id)
  const updated = await updateNotebookItemByOwner(context.companyId, context.userId, id, {
    item_type: latest ? 'file' : 'text',
    matrix_media_mxc: latest?.matrix_media_mxc || null,
    matrix_media_name: latest?.matrix_media_name || null,
    matrix_media_mime: latest?.matrix_media_mime || null,
    matrix_media_size: latest?.matrix_media_size ?? null,
    is_indexable: latest ? latest.is_indexable : false,
    index_status: 'pending',
    index_error: null,
    revision: Number(item.revision) + 1
  })

  if (!updated) return sendNotebookError(res, 404, 'NOT_FOUND')

  await enqueueNotebookIndexJob({
    companyId: context.companyId,
    ownerUserId: context.userId,
    itemId: id,
    jobType: latest?.is_indexable ? 'upsert' : 'delete'
  })

  return res.status(202).json({ ok: true, item: await withItemFiles(context, updated) })
}

export async function getNotebookIndexStatus(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const id = String(req.params.id || '').trim()
  const item = await getNotebookItemByOwner(context.companyId, context.userId, id)

  if (!item) return sendNotebookError(res, 404, 'NOT_FOUND')

  return res.json({ item_id: item.id, index_status: item.index_status, index_error: item.index_error || null })
}

export async function getNotebookItemParsedPreview(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const id = String(req.params.id || '').trim()
  if (!id) return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing id')

  const item = await getNotebookItemByOwner(context.companyId, context.userId, id)
  if (!item) return sendNotebookError(res, 404, 'NOT_FOUND')

  const limit = Math.min(Math.max(Number(req.query.limit || 8), 1), 50)
  const chars = Math.min(Math.max(Number(req.query.chars || 6000), 500), 40000)
  const chunks = await listNotebookChunksByItem({
    companyId: context.companyId,
    ownerUserId: context.userId,
    itemId: id,
    limit
  })
  const stats = await getNotebookChunkStatsByItem({
    companyId: context.companyId,
    ownerUserId: context.userId,
    itemId: id
  })

  const parsedText = chunks
    .map((chunk) => String(chunk.chunk_text || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, chars)

  return res.json({
    item_id: id,
    index_status: item.index_status,
    index_error: item.index_error || null,
    preview: {
      text: parsedText,
      truncated: parsedText.length >= chars,
      chunk_count_sampled: chunks.length,
      chunk_count_total: Number(stats.chunk_count || 0),
      total_chars: Number(stats.total_chars || 0),
      total_tokens: Number(stats.total_tokens || 0)
    }
  })
}

export async function getNotebookItemChunks(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const id = String(req.params.id || '').trim()
  if (!id) return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing id')

  const item = await getNotebookItemByOwner(context.companyId, context.userId, id)
  if (!item) return sendNotebookError(res, 404, 'NOT_FOUND')

  const limit = Math.min(Math.max(Number(req.query.limit || 120), 1), 400)
  const chunks = await listNotebookChunksByItem({
    companyId: context.companyId,
    ownerUserId: context.userId,
    itemId: id,
    limit
  })
  const stats = await getNotebookChunkStatsByItem({
    companyId: context.companyId,
    ownerUserId: context.userId,
    itemId: id
  })

  return res.json({
    item_id: id,
    index_status: item.index_status,
    index_error: item.index_error || null,
    chunks,
    total: Number(stats.chunk_count || 0)
  })
}

export async function retryNotebookIndexJob(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const jobId = String(req.params.id || '').trim()

  const job = await getIndexJobByOwner(jobId, context.companyId, context.userId)

  if (!job) return sendNotebookError(res, 404, 'JOB_NOT_FOUND')

  await markIndexJobPending(jobId)
  return res.status(202).json({ job_id: jobId, status: 'pending' })
}

export async function reindexNotebookItem(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const itemId = String(req.params.id || '').trim()
  if (!itemId) return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing id')

  const item = await getNotebookItemByOwner(context.companyId, context.userId, itemId)
  if (!item) return sendNotebookError(res, 404, 'NOT_FOUND')

  await updateNotebookItemByOwner(context.companyId, context.userId, itemId, {
    index_status: 'pending',
    index_error: null
  })

  await enqueueNotebookIndexJob({
    companyId: context.companyId,
    ownerUserId: context.userId,
    itemId,
    jobType: item.is_indexable ? 'upsert' : 'delete'
  })

  const indexJob = await getLatestIndexJobByItem(context.companyId, itemId)
  return res.status(202).json({ item_id: itemId, status: 'pending', index_job: indexJob || null })
}

export async function assistQuery(req: Request, res: Response) {
  const start = Date.now()
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureAssistAllowed(context, res)) return

  const body = req.body as { room_id?: string; query?: string; top_k?: number; response_lang?: string }
  const queryText = String(body.query || '').trim()
  const roomId = String(body.room_id || '').trim() || null
  const responseLang = String(body.response_lang || '').trim() || 'zh-TW'
  if (!queryText) return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing query')

  const topK = Math.max(1, Math.min(Number(body.top_k || context.policy.retrieval_top_k || 5), 20))
  try {
    const traceId = randomUUID()
    const result = await runNotebookAssist({
      companyId: context.companyId,
      userId: context.userId,
      roomId,
      queryText,
      topK,
      responseLang,
      triggerType: 'manual_query',
      startAtMs: start
    })

    return res.json({ ...result, trace_id: traceId })
  } catch (error: any) {
    return sendAiRuntimeError(res, String(error?.message || 'MODEL_ERROR'))
  }
}

export async function assistFromContext(req: Request, res: Response) {
  const start = Date.now()
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureAssistAllowed(context, res)) return

  const body = req.body as { room_id?: string; anchor_event_id?: string; window_size?: number; response_lang?: string }
  const roomId = String(body.room_id || '').trim()
  const anchorEventId = String(body.anchor_event_id || '').trim()
  const windowSize = Math.min(Math.max(Number(body.window_size || 5), 1), 20)
  const responseLang = String(body.response_lang || '').trim() || 'zh-TW'

  if (!roomId || !anchorEventId) {
    return sendNotebookError(res, 422, 'INVALID_CONTEXT')
  }

  try {
    const contextMessages = await resolveMatrixContextMessages({
      hsUrl: getMatrixBaseUrl(req),
      accessToken: getMatrixContextToken(req),
      roomId,
      anchorEventId,
      windowSize
    })

    const anchorMessage = contextMessages[contextMessages.length - 1]?.body || ''
    const contextBefore = contextMessages.slice(0, -1).map((m) => m.body)
    const fallbackQuery = [anchorMessage, ...contextBefore].filter(Boolean).join('\n')
    let queryText = fallbackQuery
    try {
      const aiConfig = await getNotebookAiConfig(context.companyId)
      queryText = await refineContextAssistQuery(aiConfig, {
        anchorText: anchorMessage,
        contextTexts: contextBefore,
        responseLanguage: responseLang
      })
    } catch {
      queryText = fallbackQuery
    }
    const traceId = randomUUID()
    const result = await runNotebookAssist({
      companyId: context.companyId,
      userId: context.userId,
      roomId,
      queryText,
      topK: context.policy.retrieval_top_k || 5,
      responseLang,
      triggerType: 'from_message_context',
      triggerEventId: anchorEventId,
      contextMessageIds: contextMessages.map((m) => m.event_id),
      startAtMs: start
    })

    return res.json({
      ...result,
      trace_id: traceId,
      context_message_ids: contextMessages.map((m) => m.event_id)
    })
  } catch (error: any) {
    const message = String(error?.message || '')
    if (message === 'INVALID_CONTEXT') {
      return sendNotebookError(res, 422, 'INVALID_CONTEXT')
    }
    return sendAiRuntimeError(res, message || 'MODEL_ERROR')
  }
}

export async function syncPush(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const body = req.body as {
    device_id?: string
    ops?: Array<{
      client_op_id?: string
      entity_type?: 'item' | 'item_file'
      entity_id?: string
      op_type?: 'create' | 'update' | 'delete'
      op_payload?: Record<string, unknown>
      base_revision?: number
    }>
  }

  const deviceId = String(body.device_id || '').trim()
  if (!deviceId || !Array.isArray(body.ops)) {
    return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing device_id or ops')
  }

  try {
    const results: Array<{ client_op_id: string; status: string; server_revision: number | null; conflict_copy_id: string | null }> = []

    for (const op of body.ops) {
      const clientOpId = String(op.client_op_id || '').trim()
      const entityId = String(op.entity_id || '').trim()
      const entityType = op.entity_type === 'item_file' ? 'item_file' : 'item'
      const opType = op.op_type === 'delete' ? 'delete' : op.op_type === 'create' ? 'create' : 'update'

      if (!clientOpId || !entityId) {
        results.push({ client_op_id: clientOpId || '', status: 'rejected', server_revision: null, conflict_copy_id: null })
        continue
      }

      if (!isUuid(entityId)) {
        return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Invalid entity_id, must be UUID')
      }

      const existed = await getSyncOpByClientOpId(context.companyId, context.userId, clientOpId)
      if (existed) {
        results.push({ client_op_id: clientOpId, status: 'duplicate', server_revision: null, conflict_copy_id: null })
        continue
      }

      try {
        await createSyncOp({
          companyId: context.companyId,
          userId: context.userId,
          deviceId,
          entityType,
          entityId,
          opType,
          opPayload: op.op_payload || {},
          baseRevision: op.base_revision || null,
          clientOpId
        })
      } catch (error: any) {
        if (error?.code === '23505') {
          results.push({ client_op_id: clientOpId, status: 'duplicate', server_revision: null, conflict_copy_id: null })
          continue
        }
        throw error
      }

      const item = await getNotebookItemByOwner(context.companyId, context.userId, entityId)
      const baseRevision = Number(op.base_revision || 0)

      if (item && baseRevision > 0 && Number(item.revision) !== baseRevision) {
        const copyId = randomUUID()
        await updateSyncOpStatus({
          clientOpId,
          status: 'conflict',
          conflictCopy: {
            id: copyId,
            server: item,
            client_payload: op.op_payload || {},
            strategy: 'LWW_WITH_COPY'
          },
          appliedAt: true
        })

        results.push({ client_op_id: clientOpId, status: 'conflict', server_revision: Number(item.revision), conflict_copy_id: copyId })
        continue
      }

      let nextRevision = Number(item?.revision || 0)
      if (opType === 'create') {
        const payload = op.op_payload || {}
        const created = await repoCreateNotebookItem({
          companyId: context.companyId,
          ownerUserId: context.userId,
          title: String(payload.title || '').trim() || null,
          contentMarkdown: String(payload.content_markdown || '').trim() || null,
          itemType: payload.item_type === 'file' ? 'file' : 'text',
          isIndexable: Boolean(payload.is_indexable),
          fixedId: entityId
        })
        nextRevision = Number(created.revision || 1)
      } else if (opType === 'update') {
        const payload = op.op_payload || {}
        const updated = await updateNotebookItemByOwner(context.companyId, context.userId, entityId, {
          title: payload.title !== undefined ? String(payload.title || '').trim() || null : undefined,
          content_markdown: payload.content_markdown !== undefined ? String(payload.content_markdown || '').trim() || null : undefined,
          status: payload.status === 'deleted' ? 'deleted' : undefined,
          revision: nextRevision + 1
        })
        nextRevision = Number(updated?.revision || nextRevision + 1)
      } else {
        const deleted = await updateNotebookItemByOwner(context.companyId, context.userId, entityId, {
          status: 'deleted',
          revision: nextRevision + 1
        })
        nextRevision = Number(deleted?.revision || nextRevision + 1)
      }

      await updateSyncOpStatus({ clientOpId, status: 'applied', appliedAt: true })

      results.push({ client_op_id: clientOpId, status: 'applied', server_revision: nextRevision, conflict_copy_id: null })
    }

    return res.json({
      results,
      server_cursor: new Date().toISOString()
    })
  } catch (error: any) {
    return sendNotebookError(res, 500, 'INTERNAL_ERROR', error?.message || 'SYNC_PUSH_FAILED')
  }
}

export async function syncPull(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const cursor = String(req.query.cursor || '').trim()
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200)

  try {
    const rows = await listNotebookItemsAfterCursor({
      companyId: context.companyId,
      ownerUserId: context.userId,
      cursor: cursor || null,
      limit: limit + 1
    })

    const hasMore = rows.length > limit
    const changes = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = changes.length > 0 ? String(changes[changes.length - 1].updated_at) : cursor || null

    return res.json({ changes, next_cursor: nextCursor, has_more: hasMore })
  } catch (error: any) {
    return sendNotebookError(res, 500, 'INTERNAL_ERROR', error?.message || 'SYNC_PULL_FAILED')
  }
}
