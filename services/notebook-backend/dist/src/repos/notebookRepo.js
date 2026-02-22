import { dbQuery } from '../db.js';
function mapNotebookItem(row) {
    return {
        ...row,
        revision: Number(row.revision)
    };
}
function mapNotebookItemFile(row) {
    return {
        ...row,
        matrix_media_size: row.matrix_media_size == null ? null : Number(row.matrix_media_size)
    };
}
export async function listNotebookItems(params) {
    const values = [params.companyId, params.ownerUserId, params.status];
    const where = ['company_id = $1', 'owner_user_id = $2', 'status = $3'];
    if (params.itemType) {
        values.push(params.itemType);
        where.push(`item_type = $${values.length}`);
    }
    if (params.query) {
        values.push(`%${params.query}%`);
        where.push(`(title ilike $${values.length} or content_markdown ilike $${values.length})`);
    }
    if (params.updatedBefore) {
        values.push(params.updatedBefore);
        where.push(`updated_at < $${values.length}`);
    }
    values.push(params.limit);
    const result = await dbQuery(`select id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            title, content_markdown, item_type::text as item_type,
            matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
            is_indexable, index_status::text as index_status, index_error,
            status::text as status, revision, created_at::text as created_at, updated_at::text as updated_at
     from public.notebook_items
     where ${where.join(' and ')}
     order by updated_at desc, id desc
     limit $${values.length}`, values);
    return result.rows.map(mapNotebookItem);
}
export async function listNotebookItemsAfterCursor(params) {
    const values = [params.companyId, params.ownerUserId];
    const where = ['company_id = $1', 'owner_user_id = $2'];
    if (params.cursor) {
        values.push(params.cursor);
        where.push(`updated_at > $${values.length}`);
    }
    values.push(params.limit);
    const result = await dbQuery(`select id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            title, content_markdown, item_type::text as item_type,
            matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
            is_indexable, index_status::text as index_status, index_error,
            status::text as status, revision, created_at::text as created_at, updated_at::text as updated_at
     from public.notebook_items
     where ${where.join(' and ')}
     order by updated_at asc
     limit $${values.length}`, values);
    return result.rows.map(mapNotebookItem);
}
export async function getNotebookItemByOwner(companyId, ownerUserId, itemId) {
    const result = await dbQuery(`select id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            title, content_markdown, item_type::text as item_type,
            matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
            is_indexable, index_status::text as index_status, index_error,
            status::text as status, revision, created_at::text as created_at, updated_at::text as updated_at
     from public.notebook_items
     where id = $1 and company_id = $2 and owner_user_id = $3
     limit 1`, [itemId, companyId, ownerUserId]);
    return result.rows[0] ? mapNotebookItem(result.rows[0]) : null;
}
export async function getNotebookItemByCompany(itemId, companyId) {
    const result = await dbQuery(`select id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            title, content_markdown, item_type::text as item_type,
            matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
            is_indexable, index_status::text as index_status, index_error,
            status::text as status, revision, created_at::text as created_at, updated_at::text as updated_at
     from public.notebook_items
     where id = $1 and company_id = $2
     limit 1`, [itemId, companyId]);
    return result.rows[0] ? mapNotebookItem(result.rows[0]) : null;
}
export async function createNotebookItem(params) {
    const columns = ['company_id', 'owner_user_id', 'title', 'content_markdown', 'item_type', 'is_indexable', 'index_status', 'status', 'revision'];
    const values = [params.companyId, params.ownerUserId, params.title, params.contentMarkdown, params.itemType, params.isIndexable, params.isIndexable ? 'pending' : 'skipped', 'active', 1];
    if (params.fixedId) {
        columns.unshift('id');
        values.unshift(params.fixedId);
    }
    const placeholders = values.map((_, idx) => `$${idx + 1}`).join(', ');
    const result = await dbQuery(`insert into public.notebook_items (${columns.join(', ')})
     values (${placeholders})
     returning id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
               title, content_markdown, item_type::text as item_type,
               matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
               is_indexable, index_status::text as index_status, index_error,
               status::text as status, revision, created_at::text as created_at, updated_at::text as updated_at`, values);
    return mapNotebookItem(result.rows[0]);
}
export async function updateNotebookItemByOwner(companyId, ownerUserId, itemId, updates) {
    const setClauses = [];
    const values = [];
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
    ];
    for (const key of updatable) {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
            values.push(updates[key]);
            setClauses.push(`${key} = $${values.length}`);
        }
    }
    if (setClauses.length === 0) {
        return getNotebookItemByOwner(companyId, ownerUserId, itemId);
    }
    values.push(itemId, companyId, ownerUserId);
    const result = await dbQuery(`update public.notebook_items
     set ${setClauses.join(', ')}
     where id = $${values.length - 2} and company_id = $${values.length - 1} and owner_user_id = $${values.length}
     returning id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
               title, content_markdown, item_type::text as item_type,
               matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
               is_indexable, index_status::text as index_status, index_error,
               status::text as status, revision, created_at::text as created_at, updated_at::text as updated_at`, values);
    return result.rows[0] ? mapNotebookItem(result.rows[0]) : null;
}
export async function listNotebookItemFilesByItemIds(companyId, ownerUserId, itemIds) {
    const cleaned = Array.from(new Set(itemIds.map((id) => String(id || '').trim()).filter(Boolean)));
    const byItem = new Map();
    if (cleaned.length === 0)
        return byItem;
    const result = await dbQuery(`select id::text as id, item_id::text as item_id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
            is_indexable, status::text as status, created_at::text as created_at, updated_at::text as updated_at
       from public.notebook_item_files
      where company_id = $1
        and owner_user_id = $2
        and status = 'active'
        and item_id = any($3::uuid[])
      order by created_at desc`, [companyId, ownerUserId, cleaned]);
    for (const row of result.rows) {
        const mapped = mapNotebookItemFile(row);
        const current = byItem.get(mapped.item_id) || [];
        current.push(mapped);
        byItem.set(mapped.item_id, current);
    }
    return byItem;
}
export async function listNotebookItemFilesByItem(companyId, ownerUserId, itemId) {
    const result = await dbQuery(`select id::text as id, item_id::text as item_id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
            is_indexable, status::text as status, created_at::text as created_at, updated_at::text as updated_at
       from public.notebook_item_files
      where company_id = $1 and owner_user_id = $2 and item_id = $3 and status = 'active'
      order by created_at desc`, [companyId, ownerUserId, itemId]);
    return result.rows.map(mapNotebookItemFile);
}
export async function listActiveNotebookItemFilesByItem(companyId, itemId) {
    const result = await dbQuery(`select id::text as id, item_id::text as item_id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
            is_indexable, status::text as status, created_at::text as created_at, updated_at::text as updated_at
       from public.notebook_item_files
      where company_id = $1 and item_id = $2 and status = 'active'
      order by created_at desc`, [companyId, itemId]);
    return result.rows.map(mapNotebookItemFile);
}
export async function createNotebookItemFile(params) {
    const result = await dbQuery(`insert into public.notebook_item_files (
        item_id, company_id, owner_user_id, matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size, is_indexable, status
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
     returning id::text as id, item_id::text as item_id, company_id::text as company_id, owner_user_id::text as owner_user_id,
               matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
               is_indexable, status::text as status, created_at::text as created_at, updated_at::text as updated_at`, [
        params.itemId,
        params.companyId,
        params.ownerUserId,
        params.matrixMediaMxc,
        params.matrixMediaName,
        params.matrixMediaMime,
        params.matrixMediaSize,
        params.isIndexable
    ]);
    return mapNotebookItemFile(result.rows[0]);
}
export async function getNotebookItemFileByOwner(companyId, ownerUserId, itemId, fileId) {
    const result = await dbQuery(`select id::text as id, item_id::text as item_id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
            is_indexable, status::text as status, created_at::text as created_at, updated_at::text as updated_at
       from public.notebook_item_files
      where company_id = $1 and owner_user_id = $2 and item_id = $3 and id = $4 and status = 'active'
      limit 1`, [companyId, ownerUserId, itemId, fileId]);
    return result.rows[0] ? mapNotebookItemFile(result.rows[0]) : null;
}
export async function softDeleteNotebookItemFileByOwner(companyId, ownerUserId, itemId, fileId) {
    const result = await dbQuery(`update public.notebook_item_files
        set status = 'deleted'
      where company_id = $1 and owner_user_id = $2 and item_id = $3 and id = $4 and status = 'active'
      returning id`, [companyId, ownerUserId, itemId, fileId]);
    return Number(result.rowCount || 0) > 0;
}
export async function getLatestActiveNotebookItemFile(companyId, itemId) {
    const result = await dbQuery(`select id::text as id, item_id::text as item_id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            matrix_media_mxc, matrix_media_name, matrix_media_mime, matrix_media_size,
            is_indexable, status::text as status, created_at::text as created_at, updated_at::text as updated_at
       from public.notebook_item_files
      where company_id = $1 and item_id = $2 and status = 'active'
      order by created_at desc
      limit 1`, [companyId, itemId]);
    return result.rows[0] ? mapNotebookItemFile(result.rows[0]) : null;
}
export async function syncNotebookItemPrimaryFileFromLatest(companyId, ownerUserId, itemId) {
    const latest = await getLatestActiveNotebookItemFile(companyId, itemId);
    return updateNotebookItemByOwner(companyId, ownerUserId, itemId, {
        item_type: latest ? 'file' : 'text',
        matrix_media_mxc: latest?.matrix_media_mxc || null,
        matrix_media_name: latest?.matrix_media_name || null,
        matrix_media_mime: latest?.matrix_media_mime || null,
        matrix_media_size: latest?.matrix_media_size ?? null
    });
}
export async function createIndexJob(params) {
    const result = await dbQuery(`insert into public.notebook_index_jobs (company_id, owner_user_id, item_id, job_type, status)
     values ($1, $2, $3, $4, 'pending')
     returning id::text as id`, [params.companyId, params.ownerUserId, params.itemId, params.jobType]);
    return result.rows[0];
}
export async function getLatestIndexJobByItem(companyId, itemId) {
    const result = await dbQuery(`select id::text as id, status::text as status, created_at::text as created_at
     from public.notebook_index_jobs
     where company_id = $1 and item_id = $2
     order by created_at desc
     limit 1`, [companyId, itemId]);
    return result.rows[0] || null;
}
export async function getIndexJobByOwner(jobId, companyId, ownerUserId) {
    const result = await dbQuery(`select id::text as id, item_id::text as item_id
     from public.notebook_index_jobs
     where id = $1 and company_id = $2 and owner_user_id = $3
     limit 1`, [jobId, companyId, ownerUserId]);
    return result.rows[0] || null;
}
export async function markIndexJobPending(jobId) {
    await dbQuery(`update public.notebook_index_jobs
     set status = 'pending', error_message = null
     where id = $1`, [jobId]);
}
export async function getIndexJobById(jobId) {
    const result = await dbQuery(`select id::text as id, company_id::text as company_id, owner_user_id::text as owner_user_id,
            item_id::text as item_id, job_type::text as job_type, status::text as status,
            error_message, started_at::text as started_at, finished_at::text as finished_at, created_at::text as created_at
     from public.notebook_index_jobs
     where id = $1
     limit 1`, [jobId]);
    return result.rows[0] || null;
}
export async function markIndexJobRunning(jobId) {
    await dbQuery(`update public.notebook_index_jobs
     set status = 'running', started_at = now(), error_message = null
     where id = $1`, [jobId]);
}
export async function markIndexJobSuccess(jobId) {
    await dbQuery(`update public.notebook_index_jobs
     set status = 'success', finished_at = now()
     where id = $1`, [jobId]);
}
export async function markIndexJobFailed(jobId, message) {
    await dbQuery(`update public.notebook_index_jobs
     set status = 'failed', finished_at = now(), error_message = $2
     where id = $1`, [jobId, message]);
}
export async function listPendingIndexJobIds(limit) {
    const result = await dbQuery(`select id::text as id
     from public.notebook_index_jobs
     where status = 'pending'
     order by created_at asc
     limit $1`, [limit]);
    return result.rows.map((row) => row.id);
}
export async function upsertItemIndexState(itemId, status, indexError) {
    await dbQuery(`update public.notebook_items
     set index_status = $2, index_error = $3
     where id = $1`, [itemId, status, indexError]);
}
export async function replaceItemChunks(params) {
    await dbQuery(`delete from public.notebook_chunks
     where company_id = $1 and item_id = $2`, [params.companyId, params.itemId]);
    if (params.chunks.length === 0) {
        return;
    }
    const values = [];
    const tuples = [];
    let cursor = 1;
    for (const chunk of params.chunks) {
        values.push(params.itemId, params.companyId, params.ownerUserId, chunk.chunkIndex, chunk.text, chunk.tokenCount, chunk.contentHash, chunk.sourceType, chunk.sourceLocator);
        tuples.push(`($${cursor}, $${cursor + 1}, $${cursor + 2}, $${cursor + 3}, $${cursor + 4}, $${cursor + 5}, $${cursor + 6}, $${cursor + 7}, $${cursor + 8})`);
        cursor += 9;
    }
    await dbQuery(`insert into public.notebook_chunks
      (item_id, company_id, owner_user_id, chunk_index, chunk_text, token_count, content_hash, source_type, source_locator)
     values ${tuples.join(', ')}`, values);
}
export async function deleteChunksByItem(companyId, itemId) {
    await dbQuery(`delete from public.notebook_chunks
     where company_id = $1 and item_id = $2`, [companyId, itemId]);
}
export async function searchChunksByQuery(params) {
    const ftsResult = await dbQuery(`select
      item_id::text as item_id,
      chunk_index,
      chunk_text,
      source_locator,
      ts_rank_cd(to_tsvector('simple', chunk_text), websearch_to_tsquery('simple', $3)) as score
     from public.notebook_chunks
     where company_id = $1
       and owner_user_id = $2
       and to_tsvector('simple', chunk_text) @@ websearch_to_tsquery('simple', $3)
     order by score desc
     limit $4`, [params.companyId, params.ownerUserId, params.query, params.limit]).catch(async () => {
        return dbQuery(`select
        item_id::text as item_id,
        chunk_index,
        chunk_text,
        source_locator,
        0.1::float8 as score
       from public.notebook_chunks
       where company_id = $1 and owner_user_id = $2 and chunk_text ilike $3
       limit $4`, [params.companyId, params.ownerUserId, `%${params.query.slice(0, 64)}%`, params.limit]);
    });
    if (ftsResult.rows.length > 0) {
        return ftsResult.rows.map((row) => ({ ...row, score: Number(row.score || 0) }));
    }
    const fallback = await dbQuery(`select
      item_id::text as item_id,
      chunk_index,
      chunk_text,
      source_locator,
      0.1::float8 as score
     from public.notebook_chunks
     where company_id = $1 and owner_user_id = $2 and chunk_text ilike $3
     limit $4`, [params.companyId, params.ownerUserId, `%${params.query.slice(0, 64)}%`, params.limit]);
    return fallback.rows.map((row) => ({ ...row, score: Number(row.score || 0) }));
}
export async function getNotebookItemTitles(companyId, ownerUserId, itemIds) {
    if (itemIds.length === 0)
        return new Map();
    const result = await dbQuery(`select id::text as id, title
     from public.notebook_items
     where company_id = $1 and owner_user_id = $2 and id = any($3::uuid[])`, [companyId, ownerUserId, itemIds]);
    return new Map(result.rows.map((row) => [row.id, row.title]));
}
function mapNotebookChunk(row) {
    return {
        ...row,
        chunk_index: Number(row.chunk_index),
        token_count: row.token_count == null ? null : Number(row.token_count)
    };
}
export async function listNotebookChunksByItem(params) {
    const result = await dbQuery(`select id::text as id, item_id::text as item_id, chunk_index, chunk_text, token_count,
            source_type, source_locator, created_at::text as created_at, updated_at::text as updated_at
       from public.notebook_chunks
      where company_id = $1 and owner_user_id = $2 and item_id = $3
      order by chunk_index asc
      limit $4`, [params.companyId, params.ownerUserId, params.itemId, params.limit]);
    return result.rows.map(mapNotebookChunk);
}
export async function getNotebookChunkStatsByItem(params) {
    const result = await dbQuery(`select
        count(*)::int as chunk_count,
        coalesce(sum(length(chunk_text)), 0)::int as total_chars,
        coalesce(sum(token_count), 0)::int as total_tokens
       from public.notebook_chunks
      where company_id = $1 and owner_user_id = $2 and item_id = $3`, [params.companyId, params.ownerUserId, params.itemId]);
    return result.rows[0] || { chunk_count: 0, total_chars: 0, total_tokens: 0 };
}
export async function insertAssistLog(params) {
    await dbQuery(`insert into public.assist_logs
      (company_id, user_id, room_id, trigger_type, trigger_event_id, query_text, context_message_ids, used_sources, response_text, response_confidence, adopted_action, latency_ms)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12)`, [
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
    ]);
}
export async function getSyncOpByClientOpId(companyId, userId, clientOpId) {
    const result = await dbQuery(`select client_op_id, status::text as status
     from public.notebook_sync_ops
     where company_id = $1 and user_id = $2 and client_op_id = $3
     limit 1`, [companyId, userId, clientOpId]);
    return result.rows[0] || null;
}
export async function createSyncOp(params) {
    await dbQuery(`insert into public.notebook_sync_ops
      (company_id, user_id, device_id, entity_type, entity_id, op_type, op_payload, base_revision, client_op_id, status)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'pending')`, [
        params.companyId,
        params.userId,
        params.deviceId,
        params.entityType,
        params.entityId,
        params.opType,
        JSON.stringify(params.opPayload || {}),
        params.baseRevision,
        params.clientOpId
    ]);
}
export async function updateSyncOpStatus(params) {
    await dbQuery(`update public.notebook_sync_ops
     set status = $2,
         conflict_copy = coalesce($3::jsonb, conflict_copy),
         applied_at = case when $4::boolean then now() else applied_at end
     where client_op_id = $1`, [params.clientOpId, params.status, params.conflictCopy ? JSON.stringify(params.conflictCopy) : null, params.appliedAt === true]);
}
