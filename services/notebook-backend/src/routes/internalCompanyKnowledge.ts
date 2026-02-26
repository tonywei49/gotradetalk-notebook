import type { Request, Response } from 'express'
import {
  createNotebookItem,
  getLatestIndexJobByItem,
  getNotebookItemByCompany,
  listNotebookItems,
  updateNotebookItemByOwner,
  type NotebookItemRow
} from '../repos/notebookRepo.js'
import { dbQuery } from '../db.js'
import { enqueueNotebookIndexJob } from '../services/notebookIndexing.js'
import { upsertInternalProfile } from '../repos/authRepo.js'
import { parseDocument } from '../services/notebookParsing.js'

function getInternalSecret(): string {
  return String(process.env.NOTEBOOK_ADMIN_SYNC_SECRET || '').trim()
}

function authorized(req: Request): boolean {
  const expected = getInternalSecret()
  if (!expected) return false
  const provided = String(req.headers['x-notebook-admin-secret'] || '').trim()
  return Boolean(provided && provided === expected)
}

function resolveCompanyId(req: Request): string {
  const fromHeader = String(req.headers['x-company-id'] || '').trim()
  const fromQuery = String(req.query.company_id || '').trim()
  const fromBody = String((req.body as { company_id?: string } | undefined)?.company_id || '').trim()
  return fromHeader || fromQuery || fromBody
}

function resolveActorLabel(req: Request): string {
  const raw = String(req.headers['x-actor-label'] || (req.body as { actor_label?: string } | undefined)?.actor_label || '').trim()
  if (!raw) return 'company_admin'
  return raw.slice(0, 64)
}

function resolveActorProfileId(req: Request, companyId: string): string {
  const headerId = String(req.headers['x-actor-profile-id'] || '').trim()
  if (headerId) return headerId

  const bodyId = String((req.body as { actor_profile_id?: string } | undefined)?.actor_profile_id || '').trim()
  if (bodyId) return bodyId

  return companyId
}

function parseStatus(value: unknown): 'active' | 'deleted' {
  return String(value || '').trim().toLowerCase() === 'deleted' ? 'deleted' : 'active'
}

function normalizeText(value: unknown): string | null {
  const normalized = String(value || '').trim()
  return normalized || null
}

function toKnowledgeItem(row: NotebookItemRow, uploadedBy: string | null) {
  return {
    id: row.id,
    company_id: row.company_id,
    title: row.title,
    content_markdown: row.content_markdown,
    item_type: row.item_type,
    source_scope: row.source_scope,
    is_indexable: row.is_indexable,
    index_status: row.index_status,
    index_error: row.index_error,
    status: row.status,
    revision: row.revision,
    updated_at: row.updated_at,
    created_at: row.created_at,
    uploaded_by: uploadedBy,
    owner_user_id: row.owner_user_id,
    source_file_name: row.matrix_media_name,
    source_file_mime: row.matrix_media_mime,
    source_file_size: row.matrix_media_size
  }
}

async function loadUploaderMap(companyId: string, ownerUserIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(ownerUserIds.map((id) => String(id || '').trim()).filter(Boolean)))
  if (ids.length === 0) return new Map()

  const result = await dbQuery<{ id: string; user_local_id: string | null; auth_user_id: string | null }>(
    `select id::text as id, user_local_id, auth_user_id
       from public.profiles
      where company_id = $1 and id = any($2::uuid[])`,
    [companyId, ids]
  )

  const map = new Map<string, string>()
  for (const row of result.rows) {
    const label = String(row.user_local_id || row.auth_user_id || row.id).trim()
    map.set(row.id, label)
  }
  return map
}

async function ensureActorProfile(req: Request, companyId: string): Promise<{ profileId: string; actorLabel: string }> {
  const actorLabel = resolveActorLabel(req)
  const profileId = resolveActorProfileId(req, companyId)
  await upsertInternalProfile({
    profileId,
    companyId,
    userType: 'admin',
    userLocalId: actorLabel
  })
  return { profileId, actorLabel }
}

export async function listInternalCompanyKnowledgeItems(req: Request, res: Response) {
  if (!authorized(req)) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid internal secret' })
  }

  const companyId = resolveCompanyId(req)
  if (!companyId) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'company_id is required' })
  }

  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100)
  const q = String(req.query.q || '').trim()
  const status = parseStatus(req.query.status)

  try {
    const items = await listNotebookItems({
      companyId,
      ownerUserId: companyId,
      scope: 'company',
      status,
      isIndexable: undefined,
      itemType: undefined,
      query: q || undefined,
      updatedBefore: null,
      limit
    })

    const uploaderMap = await loadUploaderMap(companyId, items.map((item) => item.owner_user_id))

    return res.json({
      items: items.map((item) => toKnowledgeItem(item, uploaderMap.get(item.owner_user_id) || null))
    })
  } catch (error: any) {
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: error?.message || 'LIST_FAILED' })
  }
}

export async function createInternalCompanyKnowledgeItem(req: Request, res: Response) {
  if (!authorized(req)) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid internal secret' })
  }

  const companyId = resolveCompanyId(req)
  if (!companyId) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'company_id is required' })
  }

  const body = req.body as {
    title?: string
    content_markdown?: string
    source_file_name?: string
    source_file_mime?: string
    source_file_size?: number
    file_data_base64?: string
    is_indexable?: boolean
  }

  const title = normalizeText(body.title)
  let contentMarkdown = normalizeText(body.content_markdown)
  const fileDataBase64 = normalizeText(body.file_data_base64)
  const sourceFileName = normalizeText(body.source_file_name)
  const sourceFileMime = normalizeText(body.source_file_mime)

  if (!contentMarkdown && fileDataBase64) {
    try {
      const decoded = Buffer.from(fileDataBase64, 'base64')
      if (decoded.length > 0) {
        const parsed = await parseDocument(decoded, sourceFileMime, sourceFileName)
        contentMarkdown = normalizeText(parsed.text)
      }
    } catch {
      contentMarkdown = null
    }
  }

  if (!title && !contentMarkdown) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'title or content_markdown is required' })
  }

  const { profileId } = await ensureActorProfile(req, companyId)
  const isIndexable = body.is_indexable !== false

  try {
    const item = await createNotebookItem({
      companyId,
      ownerUserId: profileId,
      sourceScope: 'company',
      title,
      contentMarkdown,
      itemType: normalizeText(body.source_file_name) ? 'file' : 'text',
      isIndexable
    })

    const sourceFileSize = Number(body.source_file_size || 0)

    const patched = await updateNotebookItemByOwner(companyId, profileId, item.id, {
      matrix_media_name: sourceFileName,
      matrix_media_mime: sourceFileMime,
      matrix_media_size: Number.isFinite(sourceFileSize) && sourceFileSize > 0 ? sourceFileSize : null
    })

    if (isIndexable) {
      await enqueueNotebookIndexJob({
        companyId,
        ownerUserId: profileId,
        itemId: item.id,
        jobType: 'upsert'
      })
    }

    const indexJob = await getLatestIndexJobByItem(companyId, item.id)
    return res.status(201).json({
      item: toKnowledgeItem(patched || item, resolveActorLabel(req)),
      index_job: indexJob || null
    })
  } catch (error: any) {
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: error?.message || 'CREATE_FAILED' })
  }
}

export async function deleteInternalCompanyKnowledgeItem(req: Request, res: Response) {
  if (!authorized(req)) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid internal secret' })
  }

  const companyId = resolveCompanyId(req)
  const itemId = String(req.params.id || '').trim()
  if (!companyId || !itemId) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'company_id and id are required' })
  }

  const item = await getNotebookItemByCompany(itemId, companyId)
  if (!item || item.source_scope !== 'company') {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Knowledge item not found' })
  }

  const updated = await updateNotebookItemByOwner(companyId, item.owner_user_id, itemId, {
    status: 'deleted',
    revision: Number(item.revision) + 1,
    index_status: 'pending',
    index_error: null
  })

  if (!updated) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Knowledge item not found' })
  }

  await enqueueNotebookIndexJob({
    companyId,
    ownerUserId: item.owner_user_id,
    itemId,
    jobType: 'delete'
  })

  const indexJob = await getLatestIndexJobByItem(companyId, itemId)
  return res.json({ ok: true, item_id: itemId, index_job: indexJob || null })
}

export async function offlineInternalCompanyKnowledgeItem(req: Request, res: Response) {
  if (!authorized(req)) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid internal secret' })
  }

  const companyId = resolveCompanyId(req)
  const itemId = String(req.params.id || '').trim()
  if (!companyId || !itemId) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'company_id and id are required' })
  }

  const item = await getNotebookItemByCompany(itemId, companyId)
  if (!item || item.source_scope !== 'company') {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Knowledge item not found' })
  }

  const updated = await updateNotebookItemByOwner(companyId, item.owner_user_id, itemId, {
    is_indexable: false,
    index_status: 'pending',
    index_error: null,
    revision: Number(item.revision) + 1
  })

  if (!updated) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Knowledge item not found' })
  }

  await enqueueNotebookIndexJob({
    companyId,
    ownerUserId: item.owner_user_id,
    itemId,
    jobType: 'delete'
  })

  const indexJob = await getLatestIndexJobByItem(companyId, itemId)
  return res.json({ ok: true, item: toKnowledgeItem(updated, null), index_job: indexJob || null })
}

export async function retryInternalCompanyKnowledgeIndex(req: Request, res: Response) {
  if (!authorized(req)) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid internal secret' })
  }

  const companyId = resolveCompanyId(req)
  const itemId = String(req.params.id || '').trim()
  if (!companyId || !itemId) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'company_id and id are required' })
  }

  const item = await getNotebookItemByCompany(itemId, companyId)
  if (!item || item.source_scope !== 'company') {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Knowledge item not found' })
  }

  await updateNotebookItemByOwner(companyId, item.owner_user_id, itemId, {
    index_status: 'pending',
    index_error: null
  })

  await enqueueNotebookIndexJob({
    companyId,
    ownerUserId: item.owner_user_id,
    itemId,
    jobType: item.is_indexable ? 'upsert' : 'delete'
  })

  const indexJob = await getLatestIndexJobByItem(companyId, itemId)
  return res.status(202).json({ ok: true, item_id: itemId, status: 'pending', index_job: indexJob || null })
}
