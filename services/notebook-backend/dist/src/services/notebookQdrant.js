export function getQdrantConfig() {
    const baseUrl = String(process.env.QDRANT_URL || '').trim();
    const apiKey = String(process.env.QDRANT_API_KEY || '').trim();
    const collection = String(process.env.QDRANT_NOTEBOOK_COLLECTION || 'notebook_chunks_v1').trim();
    const vectorSize = Number(process.env.QDRANT_VECTOR_SIZE || 1536);
    return { baseUrl, apiKey, collection, vectorSize };
}
function buildHeaders(apiKey) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['api-key'] = apiKey;
    }
    return headers;
}
function isCollectionMissing(status, text) {
    return status === 404 && /not\s+exist|not\s+found|doesn't exist|does not exist/i.test(text);
}
export async function ensureQdrantCollection() {
    const { baseUrl, apiKey, collection, vectorSize } = getQdrantConfig();
    if (!baseUrl)
        return;
    const headers = buildHeaders(apiKey);
    const getResp = await fetch(`${baseUrl}/collections/${encodeURIComponent(collection)}`, { headers });
    if (getResp.ok) {
        const body = await getResp.json().catch(() => null);
        const existingSize = body?.result?.config?.params?.vectors?.size;
        if (typeof existingSize === 'number' && existingSize !== vectorSize) {
            throw new Error(`EMBEDDING_DIM_MISMATCH: expected ${vectorSize} got ${existingSize}`);
        }
        return;
    }
    await fetch(`${baseUrl}/collections/${encodeURIComponent(collection)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
            vectors: {
                size: vectorSize,
                distance: 'Cosine'
            }
        })
    });
}
export async function upsertNotebookPoints(points) {
    const { baseUrl, apiKey, collection } = getQdrantConfig();
    if (!baseUrl || points.length === 0)
        return;
    const expectedDim = getQdrantConfig().vectorSize;
    const first = points[0]?.vector || [];
    if (first.length !== expectedDim) {
        throw new Error(`EMBEDDING_DIM_MISMATCH: expected ${expectedDim} got ${first.length}`);
    }
    const headers = buildHeaders(apiKey);
    const resp = await fetch(`${baseUrl}/collections/${encodeURIComponent(collection)}/points?wait=true`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ points })
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`QDRANT_UPSERT_FAILED: ${resp.status} ${text}`);
    }
}
export async function deleteNotebookPointsByItem(companyId, itemId) {
    const { baseUrl, apiKey, collection } = getQdrantConfig();
    if (!baseUrl)
        return;
    const headers = buildHeaders(apiKey);
    const resp = await fetch(`${baseUrl}/collections/${encodeURIComponent(collection)}/points/delete?wait=true`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            filter: {
                must: [
                    { key: 'company_id', match: { value: companyId } },
                    { key: 'item_id', match: { value: itemId } }
                ]
            }
        })
    });
    if (!resp.ok) {
        const text = await resp.text();
        if (isCollectionMissing(resp.status, text)) {
            return;
        }
        throw new Error(`QDRANT_DELETE_FAILED: ${resp.status} ${text}`);
    }
}
export async function searchNotebookVectors(companyId, ownerUserId, vector, limit = 10, scope = 'both') {
    const { baseUrl, apiKey, collection } = getQdrantConfig();
    if (!baseUrl || vector.length === 0)
        return [];
    const headers = buildHeaders(apiKey);
    const resp = await fetch(`${baseUrl}/collections/${encodeURIComponent(collection)}/points/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            vector,
            limit,
            with_payload: true,
            filter: {
                must: [
                    { key: 'company_id', match: { value: companyId } }
                ]
            }
        })
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`QDRANT_SEARCH_FAILED: ${resp.status} ${text}`);
    }
    const body = await resp.json();
    const rows = body.result || [];
    return rows.filter((row) => {
        const payload = row?.payload || {};
        const sourceScope = String(payload.source_scope || 'personal');
        if (scope === 'company')
            return sourceScope === 'company';
        if (scope === 'personal') {
            return sourceScope === 'personal' && String(payload.owner_user_id || '') === ownerUserId;
        }
        return sourceScope === 'company'
            || (sourceScope === 'personal' && String(payload.owner_user_id || '') === ownerUserId);
    });
}
