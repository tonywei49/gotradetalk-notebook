import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '../supabase.js'
import {
  ensureAssistAllowed,
  ensureNotebookBasic,
  resolveNotebookAccessContext,
  sendNotebookError
} from '../services/notebookAuth.js'
import { enqueueNotebookIndexJob, hybridSearchNotebook } from '../services/notebookIndexing.js'
import { generateAssistAnswer, getNotebookAiConfig } from '../services/notebookLlm.js'

function getBearerToken(req: Request) {
  const authHeader = String(req.headers.authorization || '')
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  return ''
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

async function getContextMessages(req: Request, roomId: string, anchorEventId: string, windowSize = 5) {
  const token = getBearerToken(req)
  const hsUrl = getMatrixBaseUrl(req)
  if (!token || !hsUrl) {
    throw new Error('INVALID_CONTEXT')
  }

  const url = new URL(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/context/${encodeURIComponent(anchorEventId)}`, hsUrl)
  url.searchParams.set('limit', String(windowSize))

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  })

  if (!resp.ok) {
    throw new Error('INVALID_CONTEXT')
  }

  const body = await resp.json() as {
    event?: { event_id?: string; content?: { body?: string } }
    events_before?: Array<{ event_id?: string; content?: { body?: string } }>
  }

  const before = (body.events_before || []).slice(-windowSize)
  const ordered = [...before, ...(body.event ? [body.event] : [])]
  const messages = ordered
    .map((m) => ({ event_id: String(m.event_id || ''), body: String(m.content?.body || '').trim() }))
    .filter((m) => m.event_id && m.body)

  return messages
}

export async function getMeCapabilities(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) {
    return sendNotebookError(res, 401, 'UNAUTHORIZED')
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
  const status = String(req.query.status || 'active').trim()
  const cursor = parseCursor(String(req.query.cursor || ''))

  let query = supabaseAdmin
    .from('notebook_items')
    .select('id, company_id, owner_user_id, title, content_markdown, item_type, matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size, is_indexable, index_status, index_error, status, revision, updated_at, created_at')
    .eq('company_id', context.companyId)
    .eq('owner_user_id', context.userId)
    .eq('status', status)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (itemType) query = query.eq('item_type', itemType)
  if (q) query = query.or(`title.ilike.%${q}%,content_markdown.ilike.%${q}%`)

  if (cursor) {
    query = query.lt('updated_at', cursor.updatedAt)
  }

  const { data, error } = await query

  if (error) {
    return sendNotebookError(res, 500, 'INTERNAL_ERROR', error.message)
  }

  const rows = data || []
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]

  return res.json({
    items,
    next_cursor: hasMore && last ? encodeCursor(String(last.updated_at), String(last.id)) : null
  })
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

  const { data, error } = await supabaseAdmin
    .from('notebook_items')
    .insert({
      company_id: context.companyId,
      owner_user_id: context.userId,
      title,
      content_markdown: contentMarkdown,
      item_type: itemType,
      is_indexable: isIndexable,
      index_status: isIndexable ? 'pending' : 'skipped',
      status: 'active',
      revision: 1
    })
    .select('*')
    .maybeSingle()

  if (error || !data) {
    return sendNotebookError(res, 500, 'INTERNAL_ERROR', error?.message || 'CREATE_FAILED')
  }

  if (isIndexable) {
    await enqueueNotebookIndexJob({
      companyId: context.companyId,
      ownerUserId: context.userId,
      itemId: String(data.id),
      jobType: 'upsert'
    })
  }

  return res.status(201).json({ item: data })
}

export async function updateNotebookItem(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const id = String(req.params.id || '').trim()
  if (!id) return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing id')

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('notebook_items')
    .select('id, company_id, owner_user_id, revision, is_indexable')
    .eq('id', id)
    .eq('company_id', context.companyId)
    .eq('owner_user_id', context.userId)
    .maybeSingle()

  if (existingError || !existing) return sendNotebookError(res, 404, 'NOT_FOUND')

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
    updates.index_status = body.is_indexable ? 'pending' : 'skipped'
    updates.index_error = null
  }

  const { data, error } = await supabaseAdmin
    .from('notebook_items')
    .update(updates)
    .eq('id', id)
    .eq('company_id', context.companyId)
    .eq('owner_user_id', context.userId)
    .select('*')
    .maybeSingle()

  if (error || !data) {
    return sendNotebookError(res, 500, 'INTERNAL_ERROR', error?.message || 'UPDATE_FAILED')
  }

  const shouldIndex = Boolean((updates.is_indexable ?? existing.is_indexable) === true)
  await enqueueNotebookIndexJob({
    companyId: context.companyId,
    ownerUserId: context.userId,
    itemId: id,
    jobType: shouldIndex ? 'upsert' : 'delete'
  })

  return res.json({ item: data, conflict: false })
}

export async function deleteNotebookItem(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const id = String(req.params.id || '').trim()
  if (!id) return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing id')

  const { data: existing } = await supabaseAdmin
    .from('notebook_items')
    .select('id, revision')
    .eq('id', id)
    .eq('company_id', context.companyId)
    .eq('owner_user_id', context.userId)
    .maybeSingle()

  if (!existing) return sendNotebookError(res, 404, 'NOT_FOUND')

  const { error } = await supabaseAdmin
    .from('notebook_items')
    .update({ status: 'deleted', revision: Number(existing.revision) + 1, index_status: 'pending', index_error: null })
    .eq('id', id)
    .eq('company_id', context.companyId)
    .eq('owner_user_id', context.userId)

  if (error) return sendNotebookError(res, 500, 'INTERNAL_ERROR', error.message)

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

  const supported = ['pdf', 'docx', 'csv', 'xlsx', 'txt', 'md']
  const fileName = String(body.matrix_media_name || '').toLowerCase()
  const mime = String(body.matrix_media_mime || '').toLowerCase()
  const ext = fileName.split('.').pop() || ''
  const isSupported = supported.includes(ext) || supported.some((t) => mime.includes(t))

  if (!isSupported && body.is_indexable) {
    return sendNotebookError(res, 400, 'UNSUPPORTED_FILE_TYPE')
  }

  const { data, error } = await supabaseAdmin
    .from('notebook_items')
    .update({
      item_type: 'file',
      matrix_media_mxc: matrixMediaMxc,
      matrix_media_name: body.matrix_media_name || null,
      matrix_media_mime: body.matrix_media_mime || null,
      matrix_media_size: body.matrix_media_size || null,
      is_indexable: Boolean(body.is_indexable),
      index_status: body.is_indexable ? 'pending' : 'skipped',
      index_error: null
    })
    .eq('id', id)
    .eq('company_id', context.companyId)
    .eq('owner_user_id', context.userId)
    .select('*')
    .maybeSingle()

  if (error || !data) {
    return sendNotebookError(res, 404, 'NOT_FOUND')
  }

  const indexJobType = body.is_indexable ? 'upsert' : 'delete'
  await enqueueNotebookIndexJob({
    companyId: context.companyId,
    ownerUserId: context.userId,
    itemId: id,
    jobType: indexJobType
  })

  const { data: indexJob } = await supabaseAdmin
    .from('notebook_index_jobs')
    .select('id, status, created_at')
    .eq('company_id', context.companyId)
    .eq('item_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return res.status(202).json({ item: data, index_job: indexJob || null })
}

export async function getNotebookIndexStatus(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const id = String(req.params.id || '').trim()
  const { data, error } = await supabaseAdmin
    .from('notebook_items')
    .select('id, index_status, index_error')
    .eq('id', id)
    .eq('company_id', context.companyId)
    .eq('owner_user_id', context.userId)
    .maybeSingle()

  if (error || !data) return sendNotebookError(res, 404, 'NOT_FOUND')

  return res.json({ item_id: data.id, index_status: data.index_status, index_error: data.index_error || null })
}

export async function retryNotebookIndexJob(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const jobId = String(req.params.id || '').trim()

  const { data: job, error } = await supabaseAdmin
    .from('notebook_index_jobs')
    .select('id, item_id')
    .eq('id', jobId)
    .eq('company_id', context.companyId)
    .eq('owner_user_id', context.userId)
    .maybeSingle()

  if (error || !job) return sendNotebookError(res, 404, 'JOB_NOT_FOUND')

  await supabaseAdmin.from('notebook_index_jobs').update({ status: 'pending', error_message: null }).eq('id', jobId)
  return res.status(202).json({ job_id: jobId, status: 'pending' })
}

export async function assistQuery(req: Request, res: Response) {
  const start = Date.now()
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureAssistAllowed(context, res)) return

  const body = req.body as { room_id?: string; query?: string; top_k?: number }
  const queryText = String(body.query || '').trim()
  const roomId = String(body.room_id || '').trim() || null
  if (!queryText) return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing query')

  const topK = Math.max(1, Math.min(Number(body.top_k || context.policy.retrieval_top_k || 5), 20))
  try {
    const sources = await hybridSearchNotebook({
      companyId: context.companyId,
      ownerUserId: context.userId,
      query: queryText,
      topK
    })

    const aiConfig = await getNotebookAiConfig(context.companyId)
    const blocks = sources.map((s) => ({
      source: `${s.title || s.item_id}${s.source_locator ? ` (${s.source_locator})` : ''}`,
      text: s.snippet
    }))

    const { answer, confidence } = await generateAssistAnswer(aiConfig, queryText, blocks)
    const traceId = randomUUID()

    await supabaseAdmin.from('assist_logs').insert({
      company_id: context.companyId,
      user_id: context.userId,
      room_id: roomId,
      trigger_type: 'manual_query',
      query_text: queryText,
      context_message_ids: null,
      used_sources: sources,
      response_text: answer,
      response_confidence: confidence,
      adopted_action: 'none',
      latency_ms: Date.now() - start
    })

    return res.json({
      answer,
      sources,
      citations: sources.map((s, idx) => ({ source_id: `${s.item_id}:${idx + 1}`, locator: s.source_locator })),
      confidence,
      trace_id: traceId,
      guardrail: {
        insufficient_evidence: answer.includes('知識庫未找到明確依據')
      }
    })
  } catch (error: any) {
    return sendNotebookError(res, 502, 'MODEL_ERROR', error?.message || 'MODEL_ERROR')
  }
}

export async function assistFromContext(req: Request, res: Response) {
  const start = Date.now()
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureAssistAllowed(context, res)) return

  const body = req.body as { room_id?: string; anchor_event_id?: string; window_size?: number }
  const roomId = String(body.room_id || '').trim()
  const anchorEventId = String(body.anchor_event_id || '').trim()
  const windowSize = Math.min(Math.max(Number(body.window_size || 5), 1), 20)

  if (!roomId || !anchorEventId) {
    return sendNotebookError(res, 422, 'INVALID_CONTEXT')
  }

  try {
    const contextMessages = await getContextMessages(req, roomId, anchorEventId, windowSize)
    if (contextMessages.length === 0) {
      return sendNotebookError(res, 422, 'INVALID_CONTEXT')
    }

    const queryText = contextMessages.map((m) => m.body).join('\n')
    const sources = await hybridSearchNotebook({
      companyId: context.companyId,
      ownerUserId: context.userId,
      query: queryText,
      topK: context.policy.retrieval_top_k || 5
    })

    const aiConfig = await getNotebookAiConfig(context.companyId)
    const blocks = sources.map((s) => ({
      source: `${s.title || s.item_id}${s.source_locator ? ` (${s.source_locator})` : ''}`,
      text: s.snippet
    }))

    const { answer, confidence } = await generateAssistAnswer(aiConfig, queryText, blocks)
    const traceId = randomUUID()

    await supabaseAdmin.from('assist_logs').insert({
      company_id: context.companyId,
      user_id: context.userId,
      room_id: roomId,
      trigger_type: 'from_message_context',
      trigger_event_id: anchorEventId,
      query_text: queryText,
      context_message_ids: contextMessages.map((m) => m.event_id),
      used_sources: sources,
      response_text: answer,
      response_confidence: confidence,
      adopted_action: 'none',
      latency_ms: Date.now() - start
    })

    return res.json({
      answer,
      sources,
      citations: sources.map((s, idx) => ({ source_id: `${s.item_id}:${idx + 1}`, locator: s.source_locator })),
      confidence,
      trace_id: traceId,
      context_message_ids: contextMessages.map((m) => m.event_id),
      guardrail: {
        insufficient_evidence: answer.includes('知識庫未找到明確依據')
      }
    })
  } catch (_error) {
    return sendNotebookError(res, 422, 'INVALID_CONTEXT')
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

    const { data: existed } = await supabaseAdmin
      .from('notebook_sync_ops')
      .select('client_op_id, status')
      .eq('client_op_id', clientOpId)
      .eq('company_id', context.companyId)
      .eq('user_id', context.userId)
      .maybeSingle()

    if (existed) {
      results.push({ client_op_id: clientOpId, status: 'duplicate', server_revision: null, conflict_copy_id: null })
      continue
    }

    await supabaseAdmin.from('notebook_sync_ops').insert({
      company_id: context.companyId,
      user_id: context.userId,
      device_id: deviceId,
      entity_type: entityType,
      entity_id: entityId,
      op_type: opType,
      op_payload: op.op_payload || {},
      base_revision: op.base_revision || null,
      client_op_id: clientOpId,
      status: 'pending'
    })

    const { data: item } = await supabaseAdmin
      .from('notebook_items')
      .select('id, revision, title, content_markdown, status')
      .eq('id', entityId)
      .eq('company_id', context.companyId)
      .eq('owner_user_id', context.userId)
      .maybeSingle()

    const baseRevision = Number(op.base_revision || 0)

    if (item && baseRevision > 0 && Number(item.revision) !== baseRevision) {
      const copyId = randomUUID()
      await supabaseAdmin.from('notebook_sync_ops').update({
        status: 'conflict',
        conflict_copy: {
          id: copyId,
          server: item,
          client_payload: op.op_payload || {},
          strategy: 'LWW_WITH_COPY'
        },
        applied_at: new Date().toISOString()
      }).eq('client_op_id', clientOpId)

      results.push({ client_op_id: clientOpId, status: 'conflict', server_revision: Number(item.revision), conflict_copy_id: copyId })
      continue
    }

    let nextRevision = Number(item?.revision || 0)
    if (opType === 'create') {
      const payload = op.op_payload || {}
      const { data: created } = await supabaseAdmin
        .from('notebook_items')
        .insert({
          id: entityId,
          company_id: context.companyId,
          owner_user_id: context.userId,
          title: String(payload.title || '').trim() || null,
          content_markdown: String(payload.content_markdown || '').trim() || null,
          item_type: payload.item_type === 'file' ? 'file' : 'text',
          status: 'active',
          is_indexable: Boolean(payload.is_indexable),
          index_status: Boolean(payload.is_indexable) ? 'pending' : 'skipped',
          revision: 1
        })
        .select('revision')
        .maybeSingle()
      nextRevision = Number(created?.revision || 1)
    } else if (opType === 'update') {
      const payload = op.op_payload || {}
      const { data: updated } = await supabaseAdmin
        .from('notebook_items')
        .update({
          title: payload.title !== undefined ? String(payload.title || '').trim() || null : undefined,
          content_markdown: payload.content_markdown !== undefined ? String(payload.content_markdown || '').trim() || null : undefined,
          status: payload.status === 'deleted' ? 'deleted' : undefined,
          revision: nextRevision + 1
        })
        .eq('id', entityId)
        .eq('company_id', context.companyId)
        .eq('owner_user_id', context.userId)
        .select('revision')
        .maybeSingle()
      nextRevision = Number(updated?.revision || nextRevision + 1)
    } else {
      const { data: deleted } = await supabaseAdmin
        .from('notebook_items')
        .update({ status: 'deleted', revision: nextRevision + 1 })
        .eq('id', entityId)
        .eq('company_id', context.companyId)
        .eq('owner_user_id', context.userId)
        .select('revision')
        .maybeSingle()
      nextRevision = Number(deleted?.revision || nextRevision + 1)
    }

    await supabaseAdmin
      .from('notebook_sync_ops')
      .update({ status: 'applied', applied_at: new Date().toISOString() })
      .eq('client_op_id', clientOpId)

    results.push({ client_op_id: clientOpId, status: 'applied', server_revision: nextRevision, conflict_copy_id: null })
  }

  return res.json({
    results,
    server_cursor: new Date().toISOString()
  })
}

export async function syncPull(req: Request, res: Response) {
  const context = await resolveNotebookAccessContext(req)
  if (!context) return sendNotebookError(res, 401, 'UNAUTHORIZED')
  if (!ensureNotebookBasic(context, res)) return

  const cursor = String(req.query.cursor || '').trim()
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200)

  let query = supabaseAdmin
    .from('notebook_items')
    .select('id, company_id, owner_user_id, title, content_markdown, item_type, matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size, is_indexable, index_status, index_error, status, revision, created_at, updated_at')
    .eq('company_id', context.companyId)
    .eq('owner_user_id', context.userId)
    .order('updated_at', { ascending: true })
    .limit(limit + 1)

  if (cursor) {
    query = query.gt('updated_at', cursor)
  }

  const { data, error } = await query
  if (error) return sendNotebookError(res, 500, 'INTERNAL_ERROR', error.message)

  const rows = data || []
  const hasMore = rows.length > limit
  const changes = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = changes.length > 0 ? String(changes[changes.length - 1].updated_at) : cursor || null

  return res.json({ changes, next_cursor: nextCursor, has_more: hasMore })
}
