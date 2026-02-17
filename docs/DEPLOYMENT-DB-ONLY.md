# Notebook DB-Only 部署說明（給 Dockerfile 版 hub-backend）

目標：`hub-backend` 繼續用既有 Dockerfile 部署；Notebook 需要的資料庫（Postgres/Qdrant/Redis）改為單獨部署一次。

## 1) 你現在的模式
- `gotradetalk-client/hub-backend`: 獨立 Dockerfile 服務（不改）
- `gotradetalk-client/notebook/docker-compose.db-only.yml`: 只起 DB stack
- client 端不需要部署 agent

## 2) 需要的檔案
- Compose: `/Users/mac/Documents/github/gotradetalk-client/notebook/docker-compose.db-only.yml`
- Env 範本: `/Users/mac/Documents/github/gotradetalk-client/notebook/.env.db-only.example`

## 3) 部署步驟（Coolify）
1. 在 repo `gotradetalk-client` 新增一個 Compose/Stack 服務（名稱可用 `notebook-db`）。
2. Base directory 設為 repo root（`/`）。
3. Compose file path 設為：`notebook/docker-compose.db-only.yml`
4. 建立下列環境變量（參考 `.env.db-only.example`）：
   - `POSTGRES_DB`
   - `POSTGRES_USER`
   - `POSTGRES_PASSWORD`
   - `POSTGRES_PORT`（預設 5432）
   - `QDRANT_API_KEY`
   - `QDRANT_HTTP_PORT`（預設 6333）
   - `QDRANT_GRPC_PORT`（預設 6334）
   - `REDIS_PASSWORD`
   - `REDIS_PORT`（預設 6379）
5. 這個 DB stack 不需要填 Domains（留空）。
6. Deploy。

## 4) hub-backend 要填的連線變量
當 `hub-backend` 與 DB stack 不是同一個 compose project 時，不要用 `postgres`/`redis`/`qdrant` 作主機名；請改用「資料庫伺服器可達位址」。

範例（請把 `<DB_SERVER_IP_OR_HOST>` 改成實際值）：

```env
DATABASE_URL=postgresql://hululucky_app:你的postgres密碼@<DB_SERVER_IP_OR_HOST>:5432/hululucky
REDIS_URL=redis://:你的redis密碼@<DB_SERVER_IP_OR_HOST>:6379
QDRANT_URL=http://<DB_SERVER_IP_OR_HOST>:6333
QDRANT_API_KEY=你的qdrant_api_key
```

## 5) 安全建議
- 請在雲主機安全群組/防火牆限制 5432/6379/6333/6334，只允許 `hub-backend` 所在機器存取。
- `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`QDRANT_API_KEY` 使用高強度隨機字串。

## 6) 驗證指令（在 hub-backend 容器內）
```bash
node -e "console.log(process.env.DATABASE_URL)"
node -e "console.log(process.env.REDIS_URL)"
node -e "console.log(process.env.QDRANT_URL)"
```

若連線失敗，先檢查：
- DB stack 是否健康
- 防火牆是否放行
- hub-backend 使用的主機位址與埠是否正確
