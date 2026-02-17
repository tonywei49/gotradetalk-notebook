function getQdrantConfig() {
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
export async function ensureQdrantCollection() {
    const { baseUrl, apiKey, collection, vectorSize } = getQdrantConfig();
    if (!baseUrl)
        return;
    const headers = buildHeaders(apiKey);
    const getResp = await fetch(`${baseUrl}/collections/${encodeURIComponent(collection)}`, { headers });
    if (getResp.ok)
        return;
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
        throw new Error(`QDRANT_DELETE_FAILED: ${resp.status} ${text}`);
    }
}
export async function searchNotebookVectors(companyId, ownerUserId, vector, limit = 10) {
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
                    { key: 'company_id', match: { value: companyId } },
                    { key: 'owner_user_id', match: { value: ownerUserId } }
                ]
            }
        })
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`QDRANT_SEARCH_FAILED: ${resp.status} ${text}`);
    }
    const body = await resp.json();
    return body.result || [];
}
