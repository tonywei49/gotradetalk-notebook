import { randomUUID } from 'crypto';
import { createNotebookItem as repoCreateNotebookItem, getIndexJobByOwner, getLatestIndexJobByItem, getNotebookItemByOwner, getSyncOpByClientOpId, insertAssistLog, listNotebookItems as repoListNotebookItems, listNotebookItemsAfterCursor, markIndexJobPending, updateNotebookItemByOwner, createSyncOp, updateSyncOpStatus } from '../repos/notebookRepo.js';
import { ensureAssistAllowed, ensureNotebookBasic, resolveNotebookAccessContext, sendNotebookError } from '../services/notebookAuth.js';
import { enqueueNotebookIndexJob, hybridSearchNotebook } from '../services/notebookIndexing.js';
import { generateAssistAnswer, getNotebookAiConfig } from '../services/notebookLlm.js';
function getBearerToken(req) {
    const authHeader = String(req.headers.authorization || '');
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }
    return '';
}
function getMatrixBaseUrl(req) {
    return String(req.query.hs_url || req.headers['x-hs-url'] || '').trim();
}
function parseCursor(value) {
    if (!value)
        return null;
    const [updatedAt, id] = value.split('|');
    if (!updatedAt || !id)
        return null;
    return { updatedAt, id };
}
function encodeCursor(updatedAt, id) {
    return `${updatedAt}|${id}`;
}
async function getContextMessages(req, roomId, anchorEventId, windowSize = 5) {
    const token = getBearerToken(req);
    const hsUrl = getMatrixBaseUrl(req);
    if (!token || !hsUrl) {
        throw new Error('INVALID_CONTEXT');
    }
    const url = new URL(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/context/${encodeURIComponent(anchorEventId)}`, hsUrl);
    url.searchParams.set('limit', String(windowSize));
    const resp = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });
    if (!resp.ok) {
        throw new Error('INVALID_CONTEXT');
    }
    const body = await resp.json();
    const before = (body.events_before || []).slice(-windowSize);
    const ordered = [...before, ...(body.event ? [body.event] : [])];
    const messages = ordered
        .map((m) => ({ event_id: String(m.event_id || ''), body: String(m.content?.body || '').trim() }))
        .filter((m) => m.event_id && m.body);
    return messages;
}
export async function getMeCapabilities(req, res) {
    const context = await resolveNotebookAccessContext(req);
    if (!context) {
        return sendNotebookError(res, 401, 'UNAUTHORIZED');
    }
    return res.json({
        user_id: context.userId,
        company_id: context.companyId,
        role: context.role,
        capabilities: context.capabilities,
        policy: context.policy
    });
}
export async function listNotebookItems(req, res) {
    const context = await resolveNotebookAccessContext(req);
    if (!context)
        return sendNotebookError(res, 401, 'UNAUTHORIZED');
    if (!ensureNotebookBasic(context, res))
        return;
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const q = String(req.query.q || '').trim();
    const itemType = String(req.query.item_type || '').trim();
    const status = String(req.query.status || 'active').trim();
    const cursor = parseCursor(String(req.query.cursor || ''));
    try {
        const rows = await repoListNotebookItems({
            companyId: context.companyId,
            ownerUserId: context.userId,
            status,
            itemType: itemType || undefined,
            query: q || undefined,
            updatedBefore: cursor?.updatedAt || null,
            limit: limit + 1
        });
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const last = items[items.length - 1];
        return res.json({
            items,
            next_cursor: hasMore && last ? encodeCursor(String(last.updated_at), String(last.id)) : null
        });
    }
    catch (error) {
        return sendNotebookError(res, 500, 'INTERNAL_ERROR', error?.message || 'LIST_FAILED');
    }
}
export async function createNotebookItem(req, res) {
    const context = await resolveNotebookAccessContext(req);
    if (!context)
        return sendNotebookError(res, 401, 'UNAUTHORIZED');
    if (!ensureNotebookBasic(context, res))
        return;
    const body = req.body;
    const itemType = body.item_type === 'file' ? 'file' : 'text';
    const title = String(body.title || '').trim() || null;
    const contentMarkdown = String(body.content_markdown || '').trim() || null;
    const isIndexable = Boolean(body.is_indexable);
    try {
        const item = await repoCreateNotebookItem({
            companyId: context.companyId,
            ownerUserId: context.userId,
            title,
            contentMarkdown,
            itemType,
            isIndexable
        });
        if (isIndexable) {
            await enqueueNotebookIndexJob({
                companyId: context.companyId,
                ownerUserId: context.userId,
                itemId: String(item.id),
                jobType: 'upsert'
            });
        }
        return res.status(201).json({ item });
    }
    catch (error) {
        return sendNotebookError(res, 500, 'INTERNAL_ERROR', error?.message || 'CREATE_FAILED');
    }
}
export async function updateNotebookItem(req, res) {
    const context = await resolveNotebookAccessContext(req);
    if (!context)
        return sendNotebookError(res, 401, 'UNAUTHORIZED');
    if (!ensureNotebookBasic(context, res))
        return;
    const id = String(req.params.id || '').trim();
    if (!id)
        return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing id');
    const existing = await getNotebookItemByOwner(context.companyId, context.userId, id);
    if (!existing)
        return sendNotebookError(res, 404, 'NOT_FOUND');
    const body = req.body;
    if (body.revision !== undefined && Number(body.revision) !== Number(existing.revision)) {
        return sendNotebookError(res, 409, 'REVISION_CONFLICT');
    }
    const updates = {
        revision: Number(existing.revision) + 1
    };
    if (body.title !== undefined)
        updates.title = String(body.title || '').trim() || null;
    if (body.content_markdown !== undefined)
        updates.content_markdown = String(body.content_markdown || '').trim() || null;
    if (body.status !== undefined)
        updates.status = body.status === 'deleted' ? 'deleted' : 'active';
    if (body.is_indexable !== undefined) {
        updates.is_indexable = Boolean(body.is_indexable);
        updates.index_status = body.is_indexable ? 'pending' : 'skipped';
        updates.index_error = null;
    }
    try {
        const item = await updateNotebookItemByOwner(context.companyId, context.userId, id, updates);
        if (!item) {
            return sendNotebookError(res, 404, 'NOT_FOUND');
        }
        const shouldIndex = Boolean((updates.is_indexable ?? existing.is_indexable) === true);
        await enqueueNotebookIndexJob({
            companyId: context.companyId,
            ownerUserId: context.userId,
            itemId: id,
            jobType: shouldIndex ? 'upsert' : 'delete'
        });
        return res.json({ item, conflict: false });
    }
    catch (error) {
        return sendNotebookError(res, 500, 'INTERNAL_ERROR', error?.message || 'UPDATE_FAILED');
    }
}
export async function deleteNotebookItem(req, res) {
    const context = await resolveNotebookAccessContext(req);
    if (!context)
        return sendNotebookError(res, 401, 'UNAUTHORIZED');
    if (!ensureNotebookBasic(context, res))
        return;
    const id = String(req.params.id || '').trim();
    if (!id)
        return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing id');
    const existing = await getNotebookItemByOwner(context.companyId, context.userId, id);
    if (!existing)
        return sendNotebookError(res, 404, 'NOT_FOUND');
    const item = await updateNotebookItemByOwner(context.companyId, context.userId, id, {
        status: 'deleted',
        revision: Number(existing.revision) + 1,
        index_status: 'pending',
        index_error: null
    });
    if (!item)
        return sendNotebookError(res, 404, 'NOT_FOUND');
    await enqueueNotebookIndexJob({
        companyId: context.companyId,
        ownerUserId: context.userId,
        itemId: id,
        jobType: 'delete'
    });
    return res.json({ ok: true, revision: Number(existing.revision) + 1 });
}
export async function attachNotebookFile(req, res) {
    const context = await resolveNotebookAccessContext(req);
    if (!context)
        return sendNotebookError(res, 401, 'UNAUTHORIZED');
    if (!ensureNotebookBasic(context, res))
        return;
    const id = String(req.params.id || '').trim();
    if (!id)
        return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing id');
    const body = req.body;
    const matrixMediaMxc = String(body.matrix_media_mxc || '').trim();
    if (!matrixMediaMxc) {
        return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing matrix_media_mxc');
    }
    const supported = ['pdf', 'docx', 'csv', 'xlsx', 'txt', 'md'];
    const fileName = String(body.matrix_media_name || '').toLowerCase();
    const mime = String(body.matrix_media_mime || '').toLowerCase();
    const ext = fileName.split('.').pop() || '';
    const isSupported = supported.includes(ext) || supported.some((t) => mime.includes(t));
    if (!isSupported && body.is_indexable) {
        return sendNotebookError(res, 400, 'UNSUPPORTED_FILE_TYPE');
    }
    const item = await updateNotebookItemByOwner(context.companyId, context.userId, id, {
        item_type: 'file',
        matrix_media_mxc: matrixMediaMxc,
        matrix_media_name: body.matrix_media_name || null,
        matrix_media_mime: body.matrix_media_mime || null,
        matrix_media_size: body.matrix_media_size || null,
        is_indexable: Boolean(body.is_indexable),
        index_status: body.is_indexable ? 'pending' : 'skipped',
        index_error: null
    });
    if (!item) {
        return sendNotebookError(res, 404, 'NOT_FOUND');
    }
    const indexJobType = body.is_indexable ? 'upsert' : 'delete';
    await enqueueNotebookIndexJob({
        companyId: context.companyId,
        ownerUserId: context.userId,
        itemId: id,
        jobType: indexJobType
    });
    const indexJob = await getLatestIndexJobByItem(context.companyId, id);
    return res.status(202).json({ item, index_job: indexJob || null });
}
export async function getNotebookIndexStatus(req, res) {
    const context = await resolveNotebookAccessContext(req);
    if (!context)
        return sendNotebookError(res, 401, 'UNAUTHORIZED');
    if (!ensureNotebookBasic(context, res))
        return;
    const id = String(req.params.id || '').trim();
    const item = await getNotebookItemByOwner(context.companyId, context.userId, id);
    if (!item)
        return sendNotebookError(res, 404, 'NOT_FOUND');
    return res.json({ item_id: item.id, index_status: item.index_status, index_error: item.index_error || null });
}
export async function retryNotebookIndexJob(req, res) {
    const context = await resolveNotebookAccessContext(req);
    if (!context)
        return sendNotebookError(res, 401, 'UNAUTHORIZED');
    if (!ensureNotebookBasic(context, res))
        return;
    const jobId = String(req.params.id || '').trim();
    const job = await getIndexJobByOwner(jobId, context.companyId, context.userId);
    if (!job)
        return sendNotebookError(res, 404, 'JOB_NOT_FOUND');
    await markIndexJobPending(jobId);
    return res.status(202).json({ job_id: jobId, status: 'pending' });
}
export async function assistQuery(req, res) {
    const start = Date.now();
    const context = await resolveNotebookAccessContext(req);
    if (!context)
        return sendNotebookError(res, 401, 'UNAUTHORIZED');
    if (!ensureAssistAllowed(context, res))
        return;
    const body = req.body;
    const queryText = String(body.query || '').trim();
    const roomId = String(body.room_id || '').trim() || null;
    if (!queryText)
        return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing query');
    const topK = Math.max(1, Math.min(Number(body.top_k || context.policy.retrieval_top_k || 5), 20));
    try {
        const sources = await hybridSearchNotebook({
            companyId: context.companyId,
            ownerUserId: context.userId,
            query: queryText,
            topK
        });
        const aiConfig = await getNotebookAiConfig(context.companyId);
        const blocks = sources.map((s) => ({
            source: `${s.title || s.item_id}${s.source_locator ? ` (${s.source_locator})` : ''}`,
            text: s.snippet
        }));
        const { answer, confidence } = await generateAssistAnswer(aiConfig, queryText, blocks);
        const traceId = randomUUID();
        await insertAssistLog({
            companyId: context.companyId,
            userId: context.userId,
            roomId,
            triggerType: 'manual_query',
            queryText,
            contextMessageIds: null,
            usedSources: sources,
            responseText: answer,
            responseConfidence: confidence,
            adoptedAction: 'none',
            latencyMs: Date.now() - start
        });
        return res.json({
            answer,
            sources,
            citations: sources.map((s, idx) => ({ source_id: `${s.item_id}:${idx + 1}`, locator: s.source_locator })),
            confidence,
            trace_id: traceId,
            guardrail: {
                insufficient_evidence: answer.includes('知識庫未找到明確依據')
            }
        });
    }
    catch (error) {
        return sendNotebookError(res, 502, 'MODEL_ERROR', error?.message || 'MODEL_ERROR');
    }
}
export async function assistFromContext(req, res) {
    const start = Date.now();
    const context = await resolveNotebookAccessContext(req);
    if (!context)
        return sendNotebookError(res, 401, 'UNAUTHORIZED');
    if (!ensureAssistAllowed(context, res))
        return;
    const body = req.body;
    const roomId = String(body.room_id || '').trim();
    const anchorEventId = String(body.anchor_event_id || '').trim();
    const windowSize = Math.min(Math.max(Number(body.window_size || 5), 1), 20);
    if (!roomId || !anchorEventId) {
        return sendNotebookError(res, 422, 'INVALID_CONTEXT');
    }
    try {
        const contextMessages = await getContextMessages(req, roomId, anchorEventId, windowSize);
        if (contextMessages.length === 0) {
            return sendNotebookError(res, 422, 'INVALID_CONTEXT');
        }
        const queryText = contextMessages.map((m) => m.body).join('\n');
        const sources = await hybridSearchNotebook({
            companyId: context.companyId,
            ownerUserId: context.userId,
            query: queryText,
            topK: context.policy.retrieval_top_k || 5
        });
        const aiConfig = await getNotebookAiConfig(context.companyId);
        const blocks = sources.map((s) => ({
            source: `${s.title || s.item_id}${s.source_locator ? ` (${s.source_locator})` : ''}`,
            text: s.snippet
        }));
        const { answer, confidence } = await generateAssistAnswer(aiConfig, queryText, blocks);
        const traceId = randomUUID();
        await insertAssistLog({
            companyId: context.companyId,
            userId: context.userId,
            roomId,
            triggerType: 'from_message_context',
            triggerEventId: anchorEventId,
            queryText,
            contextMessageIds: contextMessages.map((m) => m.event_id),
            usedSources: sources,
            responseText: answer,
            responseConfidence: confidence,
            adoptedAction: 'none',
            latencyMs: Date.now() - start
        });
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
        });
    }
    catch (_error) {
        return sendNotebookError(res, 422, 'INVALID_CONTEXT');
    }
}
export async function syncPush(req, res) {
    const context = await resolveNotebookAccessContext(req);
    if (!context)
        return sendNotebookError(res, 401, 'UNAUTHORIZED');
    if (!ensureNotebookBasic(context, res))
        return;
    const body = req.body;
    const deviceId = String(body.device_id || '').trim();
    if (!deviceId || !Array.isArray(body.ops)) {
        return sendNotebookError(res, 400, 'VALIDATION_ERROR', 'Missing device_id or ops');
    }
    const results = [];
    for (const op of body.ops) {
        const clientOpId = String(op.client_op_id || '').trim();
        const entityId = String(op.entity_id || '').trim();
        const entityType = op.entity_type === 'item_file' ? 'item_file' : 'item';
        const opType = op.op_type === 'delete' ? 'delete' : op.op_type === 'create' ? 'create' : 'update';
        if (!clientOpId || !entityId) {
            results.push({ client_op_id: clientOpId || '', status: 'rejected', server_revision: null, conflict_copy_id: null });
            continue;
        }
        const existed = await getSyncOpByClientOpId(context.companyId, context.userId, clientOpId);
        if (existed) {
            results.push({ client_op_id: clientOpId, status: 'duplicate', server_revision: null, conflict_copy_id: null });
            continue;
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
            });
        }
        catch (error) {
            if (error?.code === '23505') {
                results.push({ client_op_id: clientOpId, status: 'duplicate', server_revision: null, conflict_copy_id: null });
                continue;
            }
            throw error;
        }
        const item = await getNotebookItemByOwner(context.companyId, context.userId, entityId);
        const baseRevision = Number(op.base_revision || 0);
        if (item && baseRevision > 0 && Number(item.revision) !== baseRevision) {
            const copyId = randomUUID();
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
            });
            results.push({ client_op_id: clientOpId, status: 'conflict', server_revision: Number(item.revision), conflict_copy_id: copyId });
            continue;
        }
        let nextRevision = Number(item?.revision || 0);
        if (opType === 'create') {
            const payload = op.op_payload || {};
            const created = await repoCreateNotebookItem({
                companyId: context.companyId,
                ownerUserId: context.userId,
                title: String(payload.title || '').trim() || null,
                contentMarkdown: String(payload.content_markdown || '').trim() || null,
                itemType: payload.item_type === 'file' ? 'file' : 'text',
                isIndexable: Boolean(payload.is_indexable),
                fixedId: entityId
            });
            nextRevision = Number(created.revision || 1);
        }
        else if (opType === 'update') {
            const payload = op.op_payload || {};
            const updated = await updateNotebookItemByOwner(context.companyId, context.userId, entityId, {
                title: payload.title !== undefined ? String(payload.title || '').trim() || null : undefined,
                content_markdown: payload.content_markdown !== undefined ? String(payload.content_markdown || '').trim() || null : undefined,
                status: payload.status === 'deleted' ? 'deleted' : undefined,
                revision: nextRevision + 1
            });
            nextRevision = Number(updated?.revision || nextRevision + 1);
        }
        else {
            const deleted = await updateNotebookItemByOwner(context.companyId, context.userId, entityId, {
                status: 'deleted',
                revision: nextRevision + 1
            });
            nextRevision = Number(deleted?.revision || nextRevision + 1);
        }
        await updateSyncOpStatus({ clientOpId, status: 'applied', appliedAt: true });
        results.push({ client_op_id: clientOpId, status: 'applied', server_revision: nextRevision, conflict_copy_id: null });
    }
    return res.json({
        results,
        server_cursor: new Date().toISOString()
    });
}
export async function syncPull(req, res) {
    const context = await resolveNotebookAccessContext(req);
    if (!context)
        return sendNotebookError(res, 401, 'UNAUTHORIZED');
    if (!ensureNotebookBasic(context, res))
        return;
    const cursor = String(req.query.cursor || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    try {
        const rows = await listNotebookItemsAfterCursor({
            companyId: context.companyId,
            ownerUserId: context.userId,
            cursor: cursor || null,
            limit: limit + 1
        });
        const hasMore = rows.length > limit;
        const changes = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = changes.length > 0 ? String(changes[changes.length - 1].updated_at) : cursor || null;
        return res.json({ changes, next_cursor: nextCursor, has_more: hasMore });
    }
    catch (error) {
        return sendNotebookError(res, 500, 'INTERNAL_ERROR', error?.message || 'SYNC_PULL_FAILED');
    }
}
