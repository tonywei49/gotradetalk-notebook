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
- `POST /notebook/index/jobs/:id/retry`

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
