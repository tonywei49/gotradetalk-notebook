# Notebook + Assist API Contract (Backend 2.1)

## Capability
- `GET /me/capabilities`
- `200`: `{ user_id, company_id, role, capabilities[], policy }`
- `401`: `UNAUTHORIZED`

## Company Settings (Managed by Platform)
- `GET /company/settings/notebook-ai`
- `GET /company/settings/translation`
- `PUT /company/settings/notebook-ai` -> always `403 MANAGED_BY_PLATFORM`
- `PUT /company/settings/translation` -> always `403 MANAGED_BY_PLATFORM`

Notebook-ai response:
- `{ managed_by_platform, notebook_ai_enabled, notebook_ai_expire_at, notebook_ai_quota_monthly_requests, notebook_ai_quota_used_monthly_requests }`

Translation response:
- `{ managed_by_platform, translation_enabled, translation_expire_at, translation_quota_monthly_requests, translation_quota_used_monthly_requests }`

## Notebook CRUD
- `GET /notebook/items?filter=all|knowledge|note`
- `POST /notebook/items`
- `PATCH /notebook/items/:id`
- `DELETE /notebook/items/:id`
- `POST /notebook/items/:id/files`
- `GET /notebook/items/:id/index-status`
- `POST /notebook/items/:id/reindex`
- `POST /notebook/index/jobs/:id/retry`

Notebook item DTO (minimum guaranteed fields):
- `id`
- `title`
- `content_markdown`
- `is_indexable`
- `index_status` (`pending|running|success|failed|skipped`)
- `index_error`
- `updated_at`

Mode semantics:
- Knowledge-base mode: `is_indexable=true` -> enqueue `upsert` job.
- Notebook mode: `is_indexable=false` -> enqueue `delete` job and remove vector/chunks.

Common errors:
- `403 MANAGED_BY_PLATFORM`
- `403 CAPABILITY_DISABLED`
- `403 CAPABILITY_EXPIRED`
- `429 QUOTA_EXCEEDED`
- `404 NOT_FOUND`
- `409 REVISION_CONFLICT`
- `400 UNSUPPORTED_FILE_TYPE`

## Assist
- `POST /chat/assist/query`
- `POST /chat/assist/from-context`

Guardrail behavior:
- client role always `403 FORBIDDEN_ROLE`
- capability disabled: `403 CAPABILITY_DISABLED`
- capability expired: `403 CAPABILITY_EXPIRED`
- quota exceeded: `429 QUOTA_EXCEEDED`
- context invalid: `422 INVALID_CONTEXT`
- anti-hallucination system prompt is always injected server-side

Retrieval hard-limit:
- Only `is_indexable=true` and `status=active` items are eligible in retrieval/rerank.
- No indexable hits returns `200` with `sources=[]` and guardrail insufficient evidence.

Response fields:
- `answer`
- `sources[]`
- `citations[]`
- `confidence`
- `trace_id`

## Sync
- `POST /notebook/sync/push`
- `GET /notebook/sync/pull`

Push guarantees:
- idempotent `client_op_id`
- duplicate replay returns `status=duplicate`
- conflict returns `status=conflict` + `conflict_copy_id`

## Tenant Filter
All notebook/assist/sync data access is filtered by `company_id`.
