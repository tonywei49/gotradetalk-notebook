import { randomUUID } from 'crypto';
import { createIndexJob, deleteChunksByItem, getIndexJobById, getNotebookItemByCompany, getNotebookItemTitles, listPendingIndexJobIds, markIndexJobFailed, markIndexJobRunning, markIndexJobSuccess, replaceItemChunks, searchChunksByQuery, upsertItemIndexState } from '../repos/notebookRepo.js';
import { splitIntoChunks } from './notebookChunking.js';
import { createEmbedding, getNotebookAiConfig, rerankCandidates } from './notebookLlm.js';
import { deleteNotebookPointsByItem, ensureQdrantCollection, searchNotebookVectors, upsertNotebookPoints } from './notebookQdrant.js';
import { enqueueNotebookJobId } from './notebookQueue.js';
import { extractItemSource } from './sourceExtractors.js';
const STRONG_SIGNAL_MIN_SCORE = 0.82;
const STRONG_SIGNAL_MIN_GAP = 0.12;
export async function enqueueNotebookIndexJob(params) {
    const data = await createIndexJob(params);
    if (data?.id) {
        await enqueueNotebookJobId(String(data.id));
    }
}
export async function runNotebookIndexJob(jobId, options) {
    const job = await getIndexJobById(jobId);
    if (!job) {
        throw new Error('JOB_NOT_FOUND');
    }
    await markIndexJobRunning(job.id);
    try {
        const item = await getNotebookItemByCompany(job.item_id, job.company_id);
        if (!item) {
            throw new Error('ITEM_NOT_FOUND');
        }
        if (job.job_type === 'delete' || !item.is_indexable) {
            await deleteNotebookPointsByItem(job.company_id, item.id);
            await deleteChunksByItem(job.company_id, item.id);
            await upsertItemIndexState(item.id, 'skipped', null);
        }
        else {
            const aiConfig = await getNotebookAiConfig(job.company_id);
            const extracted = await extractItemSource({
                item: item,
                matrixBaseUrl: options?.matrixBaseUrl,
                accessToken: options?.accessToken,
                ocr: {
                    enabled: aiConfig.ocrEnabled,
                    baseUrl: aiConfig.ocrBaseUrl,
                    apiKey: aiConfig.ocrApiKey,
                    model: aiConfig.ocrModel
                }
            });
            const chunks = splitIntoChunks(extracted.text, Number(process.env.NOTEBOOK_CHUNK_SIZE || 1000), Number(process.env.NOTEBOOK_CHUNK_OVERLAP || 200));
            await ensureQdrantCollection();
            await replaceItemChunks({
                itemId: item.id,
                companyId: item.company_id,
                ownerUserId: item.owner_user_id,
                sourceType: extracted.sourceType,
                sourceLocator: extracted.sourceLocator,
                chunks
            });
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
                        text: chunk.text,
                        updated_at: new Date().toISOString()
                    }
                });
            }
            await deleteNotebookPointsByItem(item.company_id, item.id);
            await upsertNotebookPoints(points);
            await upsertItemIndexState(item.id, 'success', null);
        }
        await markIndexJobSuccess(job.id);
    }
    catch (error) {
        const message = error?.message || 'INDEX_FAILED';
        await markIndexJobFailed(job.id, message);
        await upsertItemIndexState(job.item_id, 'failed', message);
        throw error;
    }
}
export async function pollAndRunNotebookIndexJobs(limit = 5, options) {
    const jobIds = await listPendingIndexJobIds(limit);
    for (const jobId of jobIds) {
        try {
            await runNotebookIndexJob(String(jobId), options);
        }
        catch (error) {
            console.error('[notebook-indexing] job failed', {
                jobId: String(jobId),
                error: error?.message || String(error)
            });
        }
    }
    return jobIds.length;
}
export async function hybridSearchNotebook(params) {
    const reciprocalRankFusion = (lists, weights = [], k = 60) => {
        const scoreByKey = new Map();
        for (let listIndex = 0; listIndex < lists.length; listIndex += 1) {
            const list = lists[listIndex] || [];
            const weight = weights[listIndex] ?? 1;
            for (let rank = 0; rank < list.length; rank += 1) {
                const key = list[rank]?.key;
                if (!key)
                    continue;
                const next = (scoreByKey.get(key) || 0) + (weight / (k + rank + 1));
                scoreByKey.set(key, next);
            }
        }
        return scoreByKey;
    };
    const topK = Math.max(1, params.topK);
    const bmRows = await searchChunksByQuery({
        companyId: params.companyId,
        ownerUserId: params.ownerUserId,
        query: params.query,
        limit: topK * 4
    });
    const bmTopScore = Number(bmRows[0]?.score || 0);
    const bmSecondScore = Number(bmRows[1]?.score || 0);
    const hasStrongSignal = bmRows.length > 0
        && bmTopScore >= STRONG_SIGNAL_MIN_SCORE
        && (bmTopScore - bmSecondScore) >= STRONG_SIGNAL_MIN_GAP;
    if (hasStrongSignal) {
        const lexicalByKey = new Map();
        for (const row of bmRows) {
            const key = `${row.item_id}:${String(row.chunk_index || 0)}`;
            if (!lexicalByKey.has(key)) {
                lexicalByKey.set(key, {
                    item_id: String(row.item_id),
                    snippet: String(row.chunk_text || ''),
                    source_locator: row.source_locator ? String(row.source_locator) : null,
                    score: Number(row.score || 0)
                });
            }
        }
        const lexicalCandidates = Array.from(lexicalByKey.values()).slice(0, topK);
        const titleMap = await getNotebookItemTitles(params.companyId, params.ownerUserId, Array.from(new Set(lexicalCandidates.map((c) => c.item_id))));
        return lexicalCandidates.map((row) => ({
            item_id: row.item_id,
            title: titleMap.get(row.item_id) || null,
            snippet: row.snippet,
            source_locator: row.source_locator,
            score: row.score
        }));
    }
    const aiConfig = await getNotebookAiConfig(params.companyId);
    const vector = await createEmbedding(aiConfig, params.query);
    const vectorHits = await searchNotebookVectors(params.companyId, params.ownerUserId, vector, topK * 2);
    const vectorList = [];
    const bm25List = [];
    const candidatesByKey = new Map();
    for (const hit of vectorHits) {
        const payload = hit.payload || {};
        const itemId = String(payload.item_id || '');
        const snippet = String(payload.chunk_text || payload.text || '');
        if (!itemId)
            continue;
        const key = `${itemId}:${String(payload.chunk_index || 0)}`;
        vectorList.push({
            key,
            item_id: itemId,
            snippet,
            source_locator: payload.source_locator ? String(payload.source_locator) : null,
            base_score: Number(hit.score || 0)
        });
        candidatesByKey.set(key, {
            item_id: itemId,
            snippet,
            source_locator: payload.source_locator ? String(payload.source_locator) : null,
            score: Number(hit.score || 0)
        });
    }
    for (const row of bmRows || []) {
        const key = `${row.item_id}:${String(row.chunk_index || 0)}`;
        bm25List.push({
            key,
            item_id: String(row.item_id),
            snippet: String(row.chunk_text || ''),
            source_locator: row.source_locator ? String(row.source_locator) : null,
            base_score: Number(row.score || 0.1)
        });
        if (!candidatesByKey.has(key)) {
            candidatesByKey.set(key, {
                item_id: String(row.item_id),
                snippet: String(row.chunk_text || ''),
                source_locator: row.source_locator ? String(row.source_locator) : null,
                score: Number(row.score || 0.1)
            });
        }
    }
    const fusedScores = reciprocalRankFusion([vectorList, bm25List], [1.2, 1.0]);
    for (const [key, retrieval] of candidatesByKey.entries()) {
        const fused = fusedScores.get(key) || 0;
        retrieval.score = fused > 0 ? fused : retrieval.score;
    }
    const candidates = Array.from(candidatesByKey.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(topK * 4, 12));
    const ranked = await rerankCandidates(aiConfig, params.query, candidates.map((c) => ({ text: c.snippet, score: c.score })));
    const maxRetrievalScore = Math.max(Number(candidates[0]?.score || 0), 0.000001);
    const blended = ranked.map((row) => {
        const retrievalRank = row.index + 1;
        const retrieval = candidates[row.index];
        const retrievalNorm = Number(retrieval?.score || 0) / maxRetrievalScore;
        let retrievalWeight = 0.4;
        if (retrievalRank <= 3)
            retrievalWeight = 0.75;
        else if (retrievalRank <= 10)
            retrievalWeight = 0.6;
        const blendedScore = retrievalWeight * retrievalNorm + (1 - retrievalWeight) * Number(row.score || 0);
        return { ...row, score: blendedScore };
    }).sort((a, b) => b.score - a.score);
    const titleMap = await getNotebookItemTitles(params.companyId, params.ownerUserId, Array.from(new Set(candidates.map((c) => c.item_id))));
    return blended.slice(0, topK).map((row) => {
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
