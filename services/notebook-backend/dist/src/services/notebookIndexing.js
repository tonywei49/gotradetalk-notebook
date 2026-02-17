import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../supabase.js';
import { splitIntoChunks } from './notebookChunking.js';
import { createEmbedding, getNotebookAiConfig, rerankCandidates } from './notebookLlm.js';
import { parseDocument, fetchMatrixMediaBuffer } from './notebookParsing.js';
import { deleteNotebookPointsByItem, ensureQdrantCollection, searchNotebookVectors, upsertNotebookPoints } from './notebookQdrant.js';
import { enqueueNotebookJobId } from './notebookQueue.js';
async function upsertChunksInPostgres(item, chunks, sourceType, sourceLocator) {
    await supabaseAdmin.from('notebook_chunks').delete().eq('company_id', item.company_id).eq('item_id', item.id);
    if (chunks.length === 0) {
        return;
    }
    const payload = chunks.map((chunk) => ({
        item_id: item.id,
        company_id: item.company_id,
        owner_user_id: item.owner_user_id,
        chunk_index: chunk.chunkIndex,
        chunk_text: chunk.text,
        token_count: chunk.tokenCount,
        content_hash: chunk.contentHash,
        source_type: sourceType,
        source_locator: sourceLocator
    }));
    const { error } = await supabaseAdmin.from('notebook_chunks').insert(payload);
    if (error)
        throw new Error(error.message);
}
async function extractItemText(item, matrixBaseUrl, accessToken) {
    if (item.item_type === 'text') {
        const text = `${item.title || ''}\n${item.content_markdown || ''}`.trim();
        return { text, sourceType: 'text', sourceLocator: null };
    }
    if (!item.matrix_media_mxc || !matrixBaseUrl || !accessToken) {
        throw new Error('INVALID_CONTEXT');
    }
    const media = await fetchMatrixMediaBuffer(matrixBaseUrl, accessToken, item.matrix_media_mxc);
    const parsed = await parseDocument(media, item.matrix_media_mime, item.matrix_media_name);
    return {
        text: parsed.text,
        sourceType: parsed.sourceType,
        sourceLocator: parsed.sourceLocator || null
    };
}
export async function enqueueNotebookIndexJob(params) {
    const { data, error } = await supabaseAdmin
        .from('notebook_index_jobs')
        .insert({
        company_id: params.companyId,
        owner_user_id: params.ownerUserId,
        item_id: params.itemId,
        job_type: params.jobType,
        status: 'pending'
    })
        .select('id')
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    if (data?.id) {
        await enqueueNotebookJobId(String(data.id));
    }
}
export async function runNotebookIndexJob(jobId, options) {
    const { data: job, error: jobError } = await supabaseAdmin
        .from('notebook_index_jobs')
        .select('id, company_id, owner_user_id, item_id, job_type, status')
        .eq('id', jobId)
        .maybeSingle();
    if (jobError || !job) {
        throw new Error('JOB_NOT_FOUND');
    }
    await supabaseAdmin
        .from('notebook_index_jobs')
        .update({ status: 'running', started_at: new Date().toISOString(), error_message: null })
        .eq('id', job.id);
    try {
        const { data: item, error: itemError } = await supabaseAdmin
            .from('notebook_items')
            .select('id, company_id, owner_user_id, item_type, content_markdown, title, matrix_media_mxc, matrix_media_name, matrix_media_mime, is_indexable')
            .eq('id', job.item_id)
            .eq('company_id', job.company_id)
            .maybeSingle();
        if (itemError || !item) {
            throw new Error('ITEM_NOT_FOUND');
        }
        if (job.job_type === 'delete' || !item.is_indexable) {
            await deleteNotebookPointsByItem(job.company_id, item.id);
            await supabaseAdmin.from('notebook_chunks').delete().eq('company_id', job.company_id).eq('item_id', item.id);
            await supabaseAdmin.from('notebook_items').update({ index_status: 'skipped', index_error: null }).eq('id', item.id);
        }
        else {
            const extracted = await extractItemText(item, options?.matrixBaseUrl, options?.accessToken);
            const chunks = splitIntoChunks(extracted.text, Number(process.env.NOTEBOOK_CHUNK_SIZE || 1000), Number(process.env.NOTEBOOK_CHUNK_OVERLAP || 200));
            const aiConfig = await getNotebookAiConfig(job.company_id);
            await ensureQdrantCollection();
            await upsertChunksInPostgres(item, chunks, extracted.sourceType, extracted.sourceLocator);
            const points = [];
            for (const chunk of chunks) {
                const vector = await createEmbedding(aiConfig, chunk.text);
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
                        updated_at: new Date().toISOString()
                    }
                });
            }
            await deleteNotebookPointsByItem(item.company_id, item.id);
            await upsertNotebookPoints(points);
            await supabaseAdmin.from('notebook_items').update({ index_status: 'success', index_error: null }).eq('id', item.id);
        }
        await supabaseAdmin
            .from('notebook_index_jobs')
            .update({ status: 'success', finished_at: new Date().toISOString() })
            .eq('id', job.id);
    }
    catch (error) {
        const message = error?.message || 'INDEX_FAILED';
        await supabaseAdmin
            .from('notebook_index_jobs')
            .update({ status: 'failed', finished_at: new Date().toISOString(), error_message: message })
            .eq('id', job.id);
        await supabaseAdmin
            .from('notebook_items')
            .update({ index_status: 'failed', index_error: message })
            .eq('id', job.item_id);
        throw error;
    }
}
export async function pollAndRunNotebookIndexJobs(limit = 5, options) {
    const { data: jobs, error } = await supabaseAdmin
        .from('notebook_index_jobs')
        .select('id')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(limit);
    if (error)
        throw new Error(error.message);
    for (const job of jobs || []) {
        await runNotebookIndexJob(String(job.id), options);
    }
    return (jobs || []).length;
}
export async function hybridSearchNotebook(params) {
    const aiConfig = await getNotebookAiConfig(params.companyId);
    const topK = Math.max(1, params.topK);
    const vector = await createEmbedding(aiConfig, params.query);
    const vectorHits = await searchNotebookVectors(params.companyId, params.ownerUserId, vector, topK * 2);
    const { data: bmRows, error: bmError } = await supabaseAdmin
        .from('notebook_chunks')
        .select('item_id, chunk_text, source_locator')
        .eq('company_id', params.companyId)
        .eq('owner_user_id', params.ownerUserId)
        .ilike('chunk_text', `%${params.query.slice(0, 64)}%`)
        .limit(topK * 2);
    if (bmError)
        throw new Error(bmError.message);
    const merged = new Map();
    for (const hit of vectorHits) {
        const payload = hit.payload || {};
        const itemId = String(payload.item_id || '');
        const snippet = String(payload.chunk_text || payload.text || '');
        if (!itemId)
            continue;
        merged.set(`${itemId}:${String(payload.chunk_index || 0)}`, {
            item_id: itemId,
            snippet,
            source_locator: payload.source_locator ? String(payload.source_locator) : null,
            score: Number(hit.score || 0)
        });
    }
    for (const row of bmRows || []) {
        const key = `${row.item_id}:${row.source_locator || row.chunk_text.slice(0, 20)}`;
        if (!merged.has(key)) {
            merged.set(key, {
                item_id: String(row.item_id),
                snippet: String(row.chunk_text || ''),
                source_locator: row.source_locator ? String(row.source_locator) : null,
                score: 0.5
            });
        }
    }
    const candidates = Array.from(merged.values());
    const ranked = await rerankCandidates(aiConfig, params.query, candidates.map((c) => ({ text: c.snippet, score: c.score })));
    const { data: items } = await supabaseAdmin
        .from('notebook_items')
        .select('id, title')
        .eq('company_id', params.companyId)
        .eq('owner_user_id', params.ownerUserId)
        .in('id', candidates.map((c) => c.item_id));
    const titleMap = new Map((items || []).map((item) => [item.id, item.title]));
    return ranked.slice(0, topK).map((row) => {
        const candidate = candidates[row.index];
        return {
            item_id: candidate.item_id,
            title: titleMap.get(candidate.item_id) || null,
            snippet: candidate.snippet,
            source_locator: candidate.source_locator,
            score: row.score
        };
    });
}
