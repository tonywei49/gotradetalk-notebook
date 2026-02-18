import { dbQuery } from '../db.js'

export type NotebookItemRow = {
  id: string
  company_id: string
  owner_user_id: string
  title: string | null
  content_markdown: string | null
  item_type: 'text' | 'file'
  matrix_media_mxc: string | null
  matrix_media_name: string | null
  matrix_media_mime: string | null
  matrix_media_size: number | null
  is_indexable: boolean
  index_status: string
  index_error: string | null
  status: 'active' | 'deleted'
  revision: number
  created_at: string
  updated_at: string
}

export type NotebookIndexJobRow = {
  id: string
  company_id: string
  owner_user_id: string
  item_id: string
  job_type: 'upsert' | 'delete' | 'reindex'
  status: 'pending' | 'running' | 'success' | 'failed'
  error_message: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
}

type SyncStatus = 'pending' | 'applied' | 'conflict' | 'rejected'

function mapNotebookItem(row: any): NotebookItemRow {
  return {
    ...row,
    revision: Number(row.revision)
  }
}

export async function listNotebookItems(params: {
  companyId: string
  ownerUserId: string
  status: string
  itemType?: string
  query?: string
  updatedBefore?: string | null
  limit: number
}): Promise<NotebookItemRow[]> {
  const values: unknown[] = [params.companyId, params.ownerUserId, params.status]
  const where: string[] = ['company_id = $1', 'owner_user_id = $2', 'status = $3']

  if (params.itemType) {
    values.push(params.itemType)
    where.push(`item_type = $${values.length}`)
  }

  if (params.query) {
    values.push(`%${params.query}%`)
    where.push(`(title ilike $${values.length} or content_markdown ilike $${values.length})`)
  }

  if (params.updatedBefore) {
    values.push(params.updatedBefore)
    where.push(`updated_at < $${values.length}`)
  }

  values.push(params.limit)

  const result = await dbQuery<any>(
    `select id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            title, content_markdown, item_type::text as item_type,
            matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
            is_indexable, index_status::text as index_status, index_error,
            status::text as status, revision, created_at::text as created_at, updated_at::text as updated_at
     from public.notebook_items
     where ${where.join(' and ')}
     order by updated_at desc, id desc
     limit $${values.length}`,
    values
  )

  return result.rows.map(mapNotebookItem)
}

export async function listNotebookItemsAfterCursor(params: {
  companyId: string
  ownerUserId: string
  cursor?: string | null
  limit: number
}): Promise<NotebookItemRow[]> {
  const values: unknown[] = [params.companyId, params.ownerUserId]
  const where = ['company_id = $1', 'owner_user_id = $2']

  if (params.cursor) {
    values.push(params.cursor)
    where.push(`updated_at > $${values.length}`)
  }

  values.push(params.limit)

  const result = await dbQuery<any>(
    `select id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            title, content_markdown, item_type::text as item_type,
            matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
            is_indexable, index_status::text as index_status, index_error,
            status::text as status, revision, created_at::text as created_at, updated_at::text as updated_at
     from public.notebook_items
     where ${where.join(' and ')}
     order by updated_at asc
     limit $${values.length}`,
    values
  )

  return result.rows.map(mapNotebookItem)
}

export async function getNotebookItemByOwner(companyId: string, ownerUserId: string, itemId: string): Promise<NotebookItemRow | null> {
  const result = await dbQuery<any>(
    `select id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            title, content_markdown, item_type::text as item_type,
            matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
            is_indexable, index_status::text as index_status, index_error,
            status::text as status, revision, created_at::text as created_at, updated_at::text as updated_at
     from public.notebook_items
     where id = $1 and company_id = $2 and owner_user_id = $3
     limit 1`,
    [itemId, companyId, ownerUserId]
  )

  return result.rows[0] ? mapNotebookItem(result.rows[0]) : null
}

export async function getNotebookItemByCompany(itemId: string, companyId: string): Promise<NotebookItemRow | null> {
  const result = await dbQuery<any>(
    `select id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            title, content_markdown, item_type::text as item_type,
            matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
            is_indexable, index_status::text as index_status, index_error,
            status::text as status, revision, created_at::text as created_at, updated_at::text as updated_at
     from public.notebook_items
     where id = $1 and company_id = $2
     limit 1`,
    [itemId, companyId]
  )

  return result.rows[0] ? mapNotebookItem(result.rows[0]) : null
}

export async function createNotebookItem(params: {
  companyId: string
  ownerUserId: string
  title: string | null
  contentMarkdown: string | null
  itemType: 'text' | 'file'
  isIndexable: boolean
  fixedId?: string
}): Promise<NotebookItemRow> {
  const columns = ['company_id', 'owner_user_id', 'title', 'content_markdown', 'item_type', 'is_indexable', 'index_status', 'status', 'revision']
  const values: unknown[] = [params.companyId, params.ownerUserId, params.title, params.contentMarkdown, params.itemType, params.isIndexable, params.isIndexable ? 'pending' : 'skipped', 'active', 1]

  if (params.fixedId) {
    columns.unshift('id')
    values.unshift(params.fixedId)
  }

  const placeholders = values.map((_, idx) => `$${idx + 1}`).join(', ')

  const result = await dbQuery<any>(
    `insert into public.notebook_items (${columns.join(', ')})
     values (${placeholders})
     returning id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
               title, content_markdown, item_type::text as item_type,
               matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
               is_indexable, index_status::text as index_status, index_error,
               status::text as status, revision, created_at::text as created_at, updated_at::text as updated_at`,
    values
  )

  return mapNotebookItem(result.rows[0])
}

export async function updateNotebookItemByOwner(
  companyId: string,
  ownerUserId: string,
  itemId: string,
  updates: Record<string, unknown>
): Promise<NotebookItemRow | null> {
  const setClauses: string[] = []
  const values: unknown[] = []

  const updatable = [
    'title',
    'content_markdown',
    'status',
    'is_indexable',
    'index_status',
    'index_error',
    'item_type',
    'matrix_media_mxc',
    'matrix_media_name',
    'matrix_media_mime',
    'matrix_media_size',
    'revision'
  ]

  for (const key of updatable) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      values.push((updates as any)[key])
      setClauses.push(`${key} = $${values.length}`)
    }
  }

  if (setClauses.length === 0) {
    return getNotebookItemByOwner(companyId, ownerUserId, itemId)
  }

  values.push(itemId, companyId, ownerUserId)

  const result = await dbQuery<any>(
    `update public.notebook_items
     set ${setClauses.join(', ')}
     where id = $${values.length - 2} and company_id = $${values.length - 1} and owner_user_id = $${values.length}
     returning id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
               title, content_markdown, item_type::text as item_type,
               matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
               is_indexable, index_status::text as index_status, index_error,
               status::text as status, revision, created_at::text as created_at, updated_at::text as updated_at`,
    values
  )

  return result.rows[0] ? mapNotebookItem(result.rows[0]) : null
}

export async function createIndexJob(params: {
  companyId: string
  ownerUserId: string
  itemId: string
  jobType: 'upsert' | 'delete' | 'reindex'
}): Promise<{ id: string }> {
  const result = await dbQuery<{ id: string }>(
    `insert into public.notebook_index_jobs (company_id, owner_user_id, item_id, job_type, status)
     values ($1, $2, $3, $4, 'pending')
     returning id::text as id`,
    [params.companyId, params.ownerUserId, params.itemId, params.jobType]
  )

  return result.rows[0]
}

export async function getLatestIndexJobByItem(companyId: string, itemId: string): Promise<{ id: string; status: string; created_at: string } | null> {
  const result = await dbQuery<{ id: string; status: string; created_at: string }>(
    `select id::text as id, status::text as status, created_at::text as created_at
     from public.notebook_index_jobs
     where company_id = $1 and item_id = $2
     order by created_at desc
     limit 1`,
    [companyId, itemId]
  )

  return result.rows[0] || null
}

export async function getIndexJobByOwner(jobId: string, companyId: string, ownerUserId: string): Promise<{ id: string; item_id: string } | null> {
  const result = await dbQuery<{ id: string; item_id: string }>(
    `select id::text as id, item_id::text as item_id
     from public.notebook_index_jobs
     where id = $1 and company_id = $2 and owner_user_id = $3
     limit 1`,
    [jobId, companyId, ownerUserId]
  )

  return result.rows[0] || null
}

export async function markIndexJobPending(jobId: string) {
  await dbQuery(
    `update public.notebook_index_jobs
     set status = 'pending', error_message = null
     where id = $1`,
    [jobId]
  )
}

export async function getIndexJobById(jobId: string): Promise<NotebookIndexJobRow | null> {
  const result = await dbQuery<any>(
    `select id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            item_id::text as item_id, job_type::text as job_type, status::text as status,
            error_message, started_at::text as started_at, finished_at::text as finished_at, created_at::text as created_at
     from public.notebook_index_jobs
     where id = $1
     limit 1`,
    [jobId]
  )

  return result.rows[0] || null
}

export async function markIndexJobRunning(jobId: string) {
  await dbQuery(
    `update public.notebook_index_jobs
     set status = 'running', started_at = now(), error_message = null
     where id = $1`,
    [jobId]
  )
}

export async function markIndexJobSuccess(jobId: string) {
  await dbQuery(
    `update public.notebook_index_jobs
     set status = 'success', finished_at = now()
     where id = $1`,
    [jobId]
  )
}

export async function markIndexJobFailed(jobId: string, message: string) {
  await dbQuery(
    `update public.notebook_index_jobs
     set status = 'failed', finished_at = now(), error_message = $2
     where id = $1`,
    [jobId, message]
  )
}

export async function listPendingIndexJobIds(limit: number): Promise<string[]> {
  const result = await dbQuery<{ id: string }>(
    `select id::text as id
     from public.notebook_index_jobs
     where status = 'pending'
     order by created_at asc
     limit $1`,
    [limit]
  )

  return result.rows.map((row) => row.id)
}

export async function upsertItemIndexState(itemId: string, status: string, indexError: string | null) {
  await dbQuery(
    `update public.notebook_items
     set index_status = $2, index_error = $3
     where id = $1`,
    [itemId, status, indexError]
  )
}

export async function replaceItemChunks(params: {
  itemId: string
  companyId: string
  ownerUserId: string
  sourceType: string
  sourceLocator: string | null
  chunks: Array<{ chunkIndex: number; text: string; tokenCount: number; contentHash: string }>
}) {
  await dbQuery(
    `delete from public.notebook_chunks
     where company_id = $1 and item_id = $2`,
    [params.companyId, params.itemId]
  )

  if (params.chunks.length === 0) {
    return
  }

  const values: unknown[] = []
  const tuples: string[] = []
  let cursor = 1

  for (const chunk of params.chunks) {
    values.push(
      params.itemId,
      params.companyId,
      params.ownerUserId,
      chunk.chunkIndex,
      chunk.text,
      chunk.tokenCount,
      chunk.contentHash,
      params.sourceType,
      params.sourceLocator
    )
    tuples.push(`($${cursor}, $${cursor + 1}, $${cursor + 2}, $${cursor + 3}, $${cursor + 4}, $${cursor + 5}, $${cursor + 6}, $${cursor + 7}, $${cursor + 8})`)
    cursor += 9
  }

  await dbQuery(
    `insert into public.notebook_chunks
      (item_id, company_id, owner_user_id, chunk_index, chunk_text, token_count, content_hash, source_type, source_locator)
     values ${tuples.join(', ')}`,
    values
  )
}

export async function deleteChunksByItem(companyId: string, itemId: string) {
  await dbQuery(
    `delete from public.notebook_chunks
     where company_id = $1 and item_id = $2`,
    [companyId, itemId]
  )
}

export async function searchChunksByQuery(params: {
  companyId: string
  ownerUserId: string
  query: string
  limit: number
}): Promise<Array<{ item_id: string; chunk_text: string; source_locator: string | null }>> {
  const result = await dbQuery<{ item_id: string; chunk_text: string; source_locator: string | null }>(
    `select item_id::text as item_id, chunk_text, source_locator
     from public.notebook_chunks
     where company_id = $1 and owner_user_id = $2 and chunk_text ilike $3
     limit $4`,
    [params.companyId, params.ownerUserId, `%${params.query.slice(0, 64)}%`, params.limit]
  )

  return result.rows
}

export async function getNotebookItemTitles(companyId: string, ownerUserId: string, itemIds: string[]): Promise<Map<string, string | null>> {
  if (itemIds.length === 0) return new Map()

  const result = await dbQuery<{ id: string; title: string | null }>(
    `select id::text as id, title
     from public.notebook_items
     where company_id = $1 and owner_user_id = $2 and id = any($3::uuid[])`,
    [companyId, ownerUserId, itemIds]
  )

  return new Map(result.rows.map((row) => [row.id, row.title]))
}

export async function insertAssistLog(params: {
  companyId: string
  userId: string
  roomId: string | null
  triggerType: 'manual_query' | 'from_message_context'
  triggerEventId?: string | null
  queryText: string
  contextMessageIds?: string[] | null
  usedSources: unknown
  responseText: string
  responseConfidence: number
  adoptedAction: 'none' | 'inserted' | 'sent'
  latencyMs: number
}) {
  await dbQuery(
    `insert into public.assist_logs
      (company_id, user_id, room_id, trigger_type, trigger_event_id, query_text, context_message_ids, used_sources, response_text, response_confidence, adopted_action, latency_ms)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12)`,
    [
      params.companyId,
      params.userId,
      params.roomId,
      params.triggerType,
      params.triggerEventId || null,
      params.queryText,
      JSON.stringify(params.contextMessageIds || null),
      JSON.stringify(params.usedSources || []),
      params.responseText,
      params.responseConfidence,
      params.adoptedAction,
      params.latencyMs
    ]
  )
}

export async function getSyncOpByClientOpId(companyId: string, userId: string, clientOpId: string): Promise<{ client_op_id: string; status: string } | null> {
  const result = await dbQuery<{ client_op_id: string; status: string }>(
    `select client_op_id, status::text as status
     from public.notebook_sync_ops
     where company_id = $1 and user_id = $2 and client_op_id = $3
     limit 1`,
    [companyId, userId, clientOpId]
  )

  return result.rows[0] || null
}

export async function createSyncOp(params: {
  companyId: string
  userId: string
  deviceId: string
  entityType: 'item' | 'item_file'
  entityId: string
  opType: 'create' | 'update' | 'delete'
  opPayload: Record<string, unknown>
  baseRevision: number | null
  clientOpId: string
}) {
  await dbQuery(
    `insert into public.notebook_sync_ops
      (company_id, user_id, device_id, entity_type, entity_id, op_type, op_payload, base_revision, client_op_id, status)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'pending')`,
    [
      params.companyId,
      params.userId,
      params.deviceId,
      params.entityType,
      params.entityId,
      params.opType,
      JSON.stringify(params.opPayload || {}),
      params.baseRevision,
      params.clientOpId
    ]
  )
}

export async function updateSyncOpStatus(params: {
  clientOpId: string
  status: SyncStatus
  conflictCopy?: unknown
  appliedAt?: boolean
}) {
  await dbQuery(
    `update public.notebook_sync_ops
     set status = $2,
         conflict_copy = coalesce($3::jsonb, conflict_copy),
         applied_at = case when $4::boolean then now() else applied_at end
     where client_op_id = $1`,
    [params.clientOpId, params.status, params.conflictCopy ? JSON.stringify(params.conflictCopy) : null, params.appliedAt === true]
  )
}
