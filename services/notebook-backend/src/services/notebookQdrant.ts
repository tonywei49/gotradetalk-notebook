export type QdrantPoint = {
  id: string
  vector: number[]
  payload: Record<string, unknown>
}

const DEFAULT_QDRANT_UPSERT_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_QDRANT_UPSERT_MAX_POINTS = 128

export function getQdrantConfig() {
  const baseUrl = String(process.env.QDRANT_URL || '').trim()
  const apiKey = String(process.env.QDRANT_API_KEY || '').trim()
  const collection = String(process.env.QDRANT_NOTEBOOK_COLLECTION || 'notebook_chunks_v1').trim()
  const vectorSize = Number(process.env.QDRANT_VECTOR_SIZE || 1536)
  return { baseUrl, apiKey, collection, vectorSize }
}

function buildHeaders(apiKey: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) {
    headers['api-key'] = apiKey
  }
  return headers
}

function isCollectionMissing(status: number, text: string) {
  return status === 404 && /not\s+exist|not\s+found|doesn't exist|does not exist/i.test(text)
}

function getUpsertBatchLimits() {
  const maxBytes = Math.max(Number(process.env.QDRANT_UPSERT_MAX_BYTES || DEFAULT_QDRANT_UPSERT_MAX_BYTES), 256 * 1024)
  const maxPoints = Math.max(Number(process.env.QDRANT_UPSERT_MAX_POINTS || DEFAULT_QDRANT_UPSERT_MAX_POINTS), 1)
  return { maxBytes, maxPoints }
}

function splitPointsForUpsert(
  points: QdrantPoint[],
  limits: { maxBytes: number; maxPoints: number } = getUpsertBatchLimits()
) {
  const { maxBytes, maxPoints } = limits
  const batches: QdrantPoint[][] = []
  const baseBytes = Buffer.byteLength('{"points":[]}', 'utf8')
  let current: QdrantPoint[] = []
  let currentBytes = baseBytes

  for (const point of points) {
    const pointBytes = Buffer.byteLength(JSON.stringify(point), 'utf8') + 1
    if (baseBytes + pointBytes > maxBytes) {
      throw new Error(`QDRANT_POINT_TOO_LARGE: point payload (${baseBytes + pointBytes} bytes) exceeds batch limit (${maxBytes} bytes)`)
    }
    const exceedsPointLimit = current.length >= maxPoints
    const exceedsByteLimit = current.length > 0 && (currentBytes + pointBytes > maxBytes)

    if (exceedsPointLimit || exceedsByteLimit) {
      batches.push(current)
      current = []
      currentBytes = baseBytes
    }

    current.push(point)
    currentBytes += pointBytes
  }

  if (current.length > 0) {
    batches.push(current)
  }

  return batches
}

export async function ensureQdrantCollection() {
  const { baseUrl, apiKey, collection, vectorSize } = getQdrantConfig()
  if (!baseUrl) return

  const headers = buildHeaders(apiKey)
  const getResp = await fetch(`${baseUrl}/collections/${encodeURIComponent(collection)}`, { headers })
  if (getResp.ok) {
    const body = await getResp.json().catch(() => null) as { result?: { config?: { params?: { vectors?: { size?: number } } } } }
    const existingSize = body?.result?.config?.params?.vectors?.size
    if (typeof existingSize === 'number' && existingSize !== vectorSize) {
      throw new Error(`EMBEDDING_DIM_MISMATCH: expected ${vectorSize} got ${existingSize}`)
    }
    return
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
  })
}

export async function upsertNotebookPoints(points: QdrantPoint[]) {
  const { baseUrl, apiKey, collection } = getQdrantConfig()
  if (!baseUrl || points.length === 0) return

  const expectedDim = getQdrantConfig().vectorSize
  const first = points[0]?.vector || []
  if (first.length !== expectedDim) {
    throw new Error(`EMBEDDING_DIM_MISMATCH: expected ${expectedDim} got ${first.length}`)
  }

  const headers = buildHeaders(apiKey)
  const batches = splitPointsForUpsert(points)

  for (const batch of batches) {
    const resp = await fetch(`${baseUrl}/collections/${encodeURIComponent(collection)}/points?wait=true`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ points: batch })
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`QDRANT_UPSERT_FAILED: ${resp.status} ${text}`)
    }
  }
}

export async function deleteNotebookPointsByItem(companyId: string, itemId: string) {
  const { baseUrl, apiKey, collection } = getQdrantConfig()
  if (!baseUrl) return

  const headers = buildHeaders(apiKey)
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
  })

  if (!resp.ok) {
    const text = await resp.text()
    if (isCollectionMissing(resp.status, text)) {
      return
    }
    throw new Error(`QDRANT_DELETE_FAILED: ${resp.status} ${text}`)
  }
}

export const __notebookQdrantTestables = {
  splitPointsForUpsert
}

export async function searchNotebookVectors(
  companyId: string,
  ownerUserId: string,
  vector: number[],
  limit = 10,
  scope: 'personal' | 'company' | 'both' = 'both'
) {
  const { baseUrl, apiKey, collection } = getQdrantConfig()
  if (!baseUrl || vector.length === 0) return [] as any[]

  const headers = buildHeaders(apiKey)
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
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`QDRANT_SEARCH_FAILED: ${resp.status} ${text}`)
  }

  const body = await resp.json() as { result?: any[] }
  const rows = body.result || []
  return rows.filter((row) => {
    const payload = row?.payload || {}
    const sourceScope = String(payload.source_scope || 'personal')
    if (scope === 'company') return sourceScope === 'company'
    if (scope === 'personal') {
      return sourceScope === 'personal' && String(payload.owner_user_id || '') === ownerUserId
    }
    return sourceScope === 'company'
      || (sourceScope === 'personal' && String(payload.owner_user_id || '') === ownerUserId)
  })
}
