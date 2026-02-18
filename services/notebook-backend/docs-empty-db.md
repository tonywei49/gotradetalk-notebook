# Empty DB to Ready (Shortest Path)

1. Build
```bash
cd /Users/mac/Documents/github/gotradetalk-notebook/services/notebook-backend
npm install
npm run build
```

2. Run migration on empty DB
```bash
DATABASE_URL=postgresql://<user>:<pass>@<host>:5432/<db> node dist/scripts/migrate.js up
```
Expected: all migrations applied without error.

3. Check notebook tables
```bash
psql "postgresql://<user>:<pass>@<host>:5432/<db>" -c "\dt public.notebook*"
```
Expected tables:
- `public.notebook_items`
- `public.notebook_chunks`
- `public.notebook_index_jobs`
- `public.notebook_sync_ops`

4. Start API
```bash
PORT=4010 \
SUPABASE_URL=<url> \
SUPABASE_SERVICE_ROLE_KEY=<key> \
DATABASE_URL=postgresql://<user>:<pass>@<host>:5432/<db> \
REDIS_URL=redis://<host>:6379 \
QDRANT_URL=http://<host>:6333 \
node dist/src/index.js
```

5. Health
```bash
curl -s http://127.0.0.1:4010/health
```
Expected: `{"ok":true}`

6. Notebook route no longer fails on missing table
```bash
curl -i -s http://127.0.0.1:4010/notebook/items
```
Expected: `401` or `403` (auth/capability), and not `500` missing relation.
