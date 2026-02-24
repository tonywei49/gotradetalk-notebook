# Notebook + Assist API Contract (Backend 2.1)

## Capability
- `GET /me/capabilities`
- `200`: `{ user_id, company_id, role, capabilities[], policy }`
- `401`: `UNAUTHORIZED`

## Notebook CRUD
- `GET /notebook/items`
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
- `403 CAPABILITY_DISABLED`
- `404 NOT_FOUND`
- `409 REVISION_CONFLICT`
- `400 UNSUPPORTED_FILE_TYPE`

## Assist
- `POST /chat/assist/query`
- `POST /chat/assist/from-context`

Guardrail behavior:
- client role always `403 FORBIDDEN_ROLE`
- capability disabled: `403 CAPABILITY_DISABLED`
- context invalid: `422 INVALID_CONTEXT`
- anti-hallucination system prompt is always injected server-side

Retrieval hard-limit:
- Only `is_indexable=true` and `status=active` items are eligible in retrieval/rerank.

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
