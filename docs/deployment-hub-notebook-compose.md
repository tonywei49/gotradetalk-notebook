# Hub Notebook Stack 部署說明（Docker Compose）

## 1. 目的
本部署用於中央 Hub 環境（非各公司 `continuwuity` 節點），提供：
- `hub-backend`
- `Postgres`
- `Qdrant`
- `Redis`

## 2. 檔案位置
- Compose: `/Users/mac/Documents/github/gotradetalk-notebook/docker-compose.yml`
- Env 範本: `/Users/mac/Documents/github/gotradetalk-notebook/.env.example`

## 3. 啟動步驟
1. 複製環境檔並填值
```bash
cd /Users/mac/Documents/github/gotradetalk-notebook
cp .env.example .env
```

2. 啟動服務
```bash
docker compose up -d --build
```

3. 查看狀態
```bash
docker compose ps
```

## 4. 健康檢查
- Hub backend: `http://localhost:4010`
- Qdrant health: `http://localhost:6333/healthz`
- Postgres: `pg_isready`
- Redis: `redis-cli ping`

## 5. 資料持久化
Compose 已配置 volumes：
- `pgdata`
- `qdrant_data`
- `redis_data`

## 6. 注意事項
1. 這是中央多租戶部署，不是每家公司都部署一套。
2. 各公司隔離由 `company_id` 在後端和向量 payload 強制過濾。
3. `notebook-worker` 目前為可選模板，需待 `hub-backend` 實作對應 worker 入口後啟用。

## 7. 常用命令
```bash
# 查看日志
docker compose logs -f hub-backend

# 停止
docker compose down

# 停止且刪除資料（危險）
docker compose down -v
```
