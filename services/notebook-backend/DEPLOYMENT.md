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

## Coolify note
- Prefer image pull deployment for `notebook-backend` to avoid server-side build failures.
- Database services do not require public domains.
