# Notebook Backend Deployment

## Scope
- This path is the deployment standard for Notebook backend:
  - `/Users/mac/Documents/github/gotradetalk-notebook/services/notebook-backend`
- Deployment model is decentralized:
  - each company deploys its own `notebook-backend + postgres + qdrant + redis`
  - `client` is treated as one independent company and deploys its own stack
- No cross-company shared Notebook database or shared vector store.

## Files
- Full stack: `docker-compose.yml`
- DB only: `docker-compose.db-only.yml`
- Full stack env: `.env.example`
- DB-only env: `.env.db.example`

## Option A: Full stack (recommended)
1. Copy env:
   - `cp .env.example .env`
2. Fill secrets:
   - `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `QDRANT_API_KEY`
   - `NOTEBOOK_BACKEND_IMAGE` (published image tag)
3. Deploy:
   - `docker compose --env-file .env -f docker-compose.yml up -d`

## Option B: DB only
Use when backend is deployed separately (e.g., Dockerfile service in Coolify).

1. Copy env:
   - `cp .env.db.example .env.db`
2. Fill secrets.
3. Deploy:
   - `docker compose --env-file .env.db -f docker-compose.db-only.yml up -d`

Then set backend env to DB endpoints:
- `DATABASE_URL=postgresql://<user>:<password>@<db-host>:5432/<db-name>`
- `REDIS_URL=redis://:<redis-password>@<redis-host>:6379`
- `QDRANT_URL=http://<qdrant-host>:6333`
- `QDRANT_API_KEY=<qdrant-api-key>`

Auth env (Supabase auth only):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` (optional)

Data-path rule:
- Notebook business tables (`notebook_*`, `assist_logs`, `company_settings`, `profiles`, `company_memberships`) are read/written only through `DATABASE_URL` Postgres.
- Supabase is only used for token validation (`auth.getUser`), not for business table CRUD.

## Coolify note
- Prefer image pull deployment for `notebook-backend` to avoid server-side build failures.
- Database services do not require public domains.

## Standalone DB Bootstrap (Empty Postgres)
- `notebook-backend` supports empty Postgres bootstrap using:
  - `000_notebook_baseline.up.sql`
  - `016_notebook_rag_core.up.sql`
- FK strategy:
  - Keep FK integrity in notebook core tables.
  - Provide local minimal dependency tables in baseline migration:
    - `companies`
    - `profiles`
    - `company_settings`
    - `company_memberships`
- Container startup flow:
  - `node dist/scripts/migrate.js up && node dist/src/index.js`

## Auth fallback behavior
- If `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are missing, service still boots.
- `/health` remains available.
- Auth-required routes return `503 AUTH_NOT_CONFIGURED` when they require Supabase token validation path.
