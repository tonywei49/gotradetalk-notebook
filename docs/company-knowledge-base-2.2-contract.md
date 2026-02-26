# Company Knowledge Base 2.2 API Contract

## Scope
- Hub backend (company admin + platform admin proxy)
- Notebook backend internal API (secret protected)
- Capability gate aligned to company notebook policy (`enabled/expire`)

## 1) Company Admin APIs (`hub-backend`)

### GET `/company/knowledge/items`
Query:
- `status`: `active|deleted` (default `active`)
- `q`: optional search keyword
- `limit`: `1..100` (default `50`)

Response `200`:
```json
{
  "items": [
    {
      "id": "uuid",
      "company_id": "uuid",
      "title": "IMG_6279.jpg",
      "content_markdown": "...",
      "item_type": "file",
      "source_scope": "company",
      "is_indexable": true,
      "index_status": "pending|running|success|failed|skipped",
      "index_error": null,
      "status": "active",
      "revision": 1,
      "updated_at": "ISO",
      "created_at": "ISO",
      "uploaded_by": "company_admin:admin",
      "owner_user_id": "uuid",
      "source_file_name": "IMG_6279.jpg",
      "source_file_mime": "image/jpeg",
      "source_file_size": 12034
    }
  ]
}
```

### POST `/company/knowledge/items`
Request:
```json
{
  "title": "optional",
  "source_file_name": "optional",
  "source_file_mime": "optional",
  "source_file_size": 1234,
  "content_markdown": "required if title empty",
  "is_indexable": true
}
```

Response `201`:
```json
{
  "item": { "id": "uuid", "index_status": "pending" },
  "index_job": { "id": "uuid", "status": "pending", "created_at": "ISO" }
}
```

### DELETE `/company/knowledge/items/:id`
Response `200`:
```json
{ "ok": true, "item_id": "uuid", "index_job": { "id": "uuid", "status": "pending" } }
```

### POST `/company/knowledge/items/:id/offline`
Response `200`:
```json
{ "ok": true, "item": { "id": "uuid", "is_indexable": false, "index_status": "pending" } }
```

### POST `/company/knowledge/items/:id/retry-index`
Response `202`:
```json
{ "ok": true, "item_id": "uuid", "status": "pending", "index_job": { "id": "uuid" } }
```

## 2) Platform Admin APIs (`hub-backend`)

- `GET /admin/companies/:company_id/knowledge/items`
- `POST /admin/companies/:company_id/knowledge/items`
- `DELETE /admin/companies/:company_id/knowledge/items/:id`
- `POST /admin/companies/:company_id/knowledge/items/:id/offline`
- `POST /admin/companies/:company_id/knowledge/items/:id/retry-index`

Request/response body shape is same as company admin APIs.

## 3) Notebook Internal APIs (`notebook-backend`, secret protected)

Headers:
- `x-notebook-admin-secret`: must match `NOTEBOOK_ADMIN_SYNC_SECRET`
- `x-company-id`: target company uuid
- `x-actor-profile-id`: actor profile id for owner tracking
- `x-actor-label`: uploader label displayed in list

Endpoints:
- `GET /internal/company/knowledge/items`
- `POST /internal/company/knowledge/items`
- `DELETE /internal/company/knowledge/items/:id`
- `POST /internal/company/knowledge/items/:id/offline`
- `POST /internal/company/knowledge/items/:id/retry-index`

## 4) Error Contract

Common error shape:
```json
{ "code": "ERROR_CODE", "message": "..." }
```

Main codes:
- `UNAUTHORIZED` (401): invalid/missing token or invalid internal secret
- `FORBIDDEN` (403): role/permission rejected by guard
- `CAPABILITY_DISABLED` (403): company notebook capability disabled
- `CAPABILITY_EXPIRED` (403): company notebook capability expired
- `INVALID_INPUT` (400): missing id/company_id/title/content
- `NOT_FOUND` (404): knowledge item not found
- `INTERNAL_ERROR` (500): upstream notebook/db/internal failure

## 5) Required Env

### hub-backend
- `HUB_NOTEBOOK_ADMIN_SYNC_SECRET` (required)
- `HUB_NOTEBOOK_API_BASE_URL` (optional fallback if company row has no `notebook_api_base_url`)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### notebook-backend
- `NOTEBOOK_ADMIN_SYNC_SECRET` (must equal hub `HUB_NOTEBOOK_ADMIN_SYNC_SECRET`)
- `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL` (+ `QDRANT_API_KEY` if enabled)

## 6) Audit

Write actions to `admin_audit_logs`:
- `company.knowledge.upload|delete|offline|retry_index`
- `admin.company.knowledge.upload|delete|offline|retry_index`

Audit payload contains `actor_type`, `company_id`, item snapshot/result.
