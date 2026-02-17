# 公司私有一體部署（獨立檔，不影響既有部署）

## 檔案
- Compose: `/Users/mac/Documents/github/gotradetalk-notebook/docker-compose.company-private.yml`
- Backend env: `/Users/mac/Documents/github/gotradetalk-notebook/.env.company-private`
- Agent env: `/Users/mac/Documents/github/gotradetalk-notebook/.env.agent.company-private`（可選）

## 目的
- 一次啟動公司私有 Notebook stack（`hub-backend + postgres + qdrant + redis`）
- `agent` 以 profile 方式可選，不會強制動到你現有 agent 部署

## 使用方式
1. 建立 env
```bash
cd /Users/mac/Documents/github/gotradetalk-notebook
cp .env.company-private.example .env.company-private
cp .env.agent.company-private.example .env.agent.company-private
```

2. 只啟 notebook stack（不含 agent）
```bash
docker compose -f docker-compose.company-private.yml up -d --build
```

3. 要一起啟 agent 再加 profile
```bash
docker compose -f docker-compose.company-private.yml --profile agent up -d --build
```

4. 查看狀態
```bash
docker compose -f docker-compose.company-private.yml ps
```

## 注意
- 這是新增的獨立部署檔，不會覆蓋你既有部署。
- 若 agent 仍連總控制台，請在 `.env.agent.company-private` 的 `HUB_BASE_URL` 填中央地址。
