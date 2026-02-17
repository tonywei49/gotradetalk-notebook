# Notebook Backend Split Runbook (2.1)

## Service Location
- `/Users/mac/Documents/github/gotradetalk-notebook/services/notebook-backend`

## Start
```bash
cd /Users/mac/Documents/github/gotradetalk-notebook/services/notebook-backend
npm install
npm run build
npm run migrate:up
npm run dev
```

## Workers
```bash
npm run worker:notebook-queue
# or fallback:
npm run worker:notebook-index
```

## Smoke
```bash
curl -s http://127.0.0.1:4010/health
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4010/me/capabilities
```

## Migration
```bash
npm run migrate:down
npm run migrate:up
```

## Stack E2E
Requires `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`.
```bash
npm run test:e2e:stack
```
