# GoTradeTalk Notebook + Knowledge Retrieval PRD (V1)

## 1. 文件資訊
- 文件版本: v1.4
- 日期: 2026-02-17
- 範圍: `gotradetalk-ui` + `gotradetalk-notebook/services/notebook-backend` + `gotradetalk-client/visitor`
- 定位: 單一 Notebook 核心能力 + 按角色開啟 LLM 增強能力
- 部署模式: 去中心化（每公司私有部署，client 視為一家公司）

## 1.1 Repo Boundary / Code Location Rules
- 本專案倉庫 `gotradetalk-notebook` 主要存放:
  - PRD / 任務拆解 / 驗收文件
  - 部署模板（`docker-compose*.yml`、`.env*.example`）
- Notebook 核心後端程式碼:
  - `gotradetalk-notebook/services/notebook-backend`
- Notebook 後端實作（2.1）必須落在:
  - `gotradetalk-notebook/services/notebook-backend`
- `gotradetalk-client/hub-backend` 不承接 Notebook 核心後端邏輯，避免與 Hub/管理後台職責混用。
- 管理後台與公司設定（2.2）必須落在:
  - `gotradetalk-client/visitor`
- 聊天端與 Notebook UI（2.3）必須落在:
  - `gotradetalk-ui`
- 離線同步與客戶端本地能力（2.4）必須落在:
  - `gotradetalk-client/visitor`（若後續 App 端另立倉庫，需在該倉庫承接）
- 執行規範:
  - 每次提交需附「實際改動檔案清單」。
  - 非本任務範圍檔案（如他人同步修改）不得一併提交。

## 2. 背景與目標

### 2.1 背景
目前聊天系統已具備即時訊息、檔案與翻譯能力，但 Staff 回覆客戶問題仍高度依賴人工記憶，缺乏可沉澱、可檢索、可復用的知識庫。考量資料安全、性能與合規，Notebook/RAG 需採公司私有部署。

### 2.2 目標
- 建立「每個使用者一份」的 Notebook（可跨聊天室使用）。
- 在聊天流程中提供 AI 檢索與建議回覆，縮短回覆時間並提高一致性。
- 採用 `Postgres + Qdrant` 架構，支持多裝置同步與後續規模化。
- 使用同一套產品能力覆蓋 Staff/Client，避免維護兩套系統。
- 支持應用端與 App 端離線查看與離線編輯，連網後自動同步。
- 每家公司自有資料自有存儲，避免跨公司資料外流。

### 2.3 產品原則（能力分級）
- 原則 1: Notebook 是核心通用能力，所有使用者可用。
- 原則 2: LLM/RAG 是增強能力，僅在具備公司端 LLM 設定與權限時啟用。
- 原則 3: `gotradetalk-ui` 開發全功能，但由後端 capability + 角色做顯示與 API 閘門。
- 原則 4: Client 登入後不展示 LLM 入口，但保留完整一般記事本能力。
- 原則 5: 離線本地 SQLite 是快取與操作層，雲端 Postgres + Qdrant 為權威資料與檢索層。
- 原則 6: 每家公司獨立部署，採物理隔離（非中央多租戶共庫）。

### 2.4 非目標（V1 不做）
- 全自動無人工審核發送（V1 仍以人工確認為主）。
- 跨公司共享知識庫。
- 複雜工作流引擎（審批、任務派發等）。
- Web 端完整能力實作（本專案以應用端與 App 端為主）。

## 3. 角色與權限

### 3.1 角色
- Staff: 可使用 Notebook；在 capability 開啟時可使用 AI 輔助。
- Client: 可使用 Notebook 基礎能力；預設隱藏所有 LLM 相關入口。
- Company Admin: 可在後台配置模型與金鑰。
- Hub Admin: 可查看平台級路由與部署狀態（不讀取公司筆記內容）。

### 3.2 資料隔離
- 公司級物理隔離: 每家公司獨立 Postgres/Qdrant。
- 使用者級資料主體: Notebook owner 為 user。
- 聊天檢索僅可查詢當前公司私有資料。

### 3.3 Capability Matrix
- `NOTEBOOK_BASIC`: 筆記 CRUD、附件關聯、跨裝置同步、離線讀寫。
- `NOTEBOOK_LLM_ASSIST`: 聊天 AI 按鈕、調用知識庫、建議回覆。
- `NOTEBOOK_RAG_ADMIN`: 後台管理 LLM/Embedding/Rerank 與策略。
- 預設策略:
  - Staff: `NOTEBOOK_BASIC` 開啟；`NOTEBOOK_LLM_ASSIST` 依公司設定。
  - Client: 僅 `NOTEBOOK_BASIC`。
  - Company Admin: `NOTEBOOK_RAG_ADMIN`。

## 4. 核心使用情境

### 4.1 全域 Notebook 管理
- Staff/Client 在左側主模組進入 Notebook。
- 新增/編輯文字筆記。
- 上傳檔案並關聯到筆記。
- 檔案走既有 Matrix 管道，Notebook 保存引用與可檢索文本。

### 4.2 聊天 AI 問答入口
- 在聊天輸入區工具列新增 Notebook+AI 圖示。
- Staff 在 capability 開啟時可直接輸入問題，調用知識庫檢索並獲得建議回覆。
- Client 不顯示此入口。

### 4.3 訊息下方「調用知識庫」
- 在某條訊息下方點擊「調用知識庫」。
- 系統抓取當前訊息往前 5 句對話，組成上下文查詢。
- LLM 根據檢索結果生成可編輯回覆。
- 顯示在「獨立輸出框」，可:
  - 一鍵帶入輸入框再編輯
  - 直接在輸出框編輯
  - 直接發送
- 若未開啟 LLM capability，該按鈕不展示。

### 4.4 離線工作流
- 斷網下可查看與編輯筆記。
- 本地寫入進入同步隊列。
- 連網後自動同步到公司私有後端，並拉取其他裝置變更。

## 5. 功能需求

## 5.1 前端（gotradetalk-ui）
1. 左側導航新增 Notebook 主模組。
2. Notebook 清單頁:
- 搜索
- 篩選（文字/檔案）
- 新增/編輯/刪除
3. 聊天頁新增:
- 輸入區工具列 Notebook+AI 按鈕
- 訊息底部「調用知識庫」按鈕（Staff only）
- AI 輸出框（可編輯 + 發送策略）
4. 模式切換與顯示規則:
- `NOTEBOOK_BASIC` 模式: 顯示記事本，不顯示 AI 控件
- `NOTEBOOK_LLM_ASSIST` 模式: 顯示 AI 控件與輸出框
- UI 僅作顯示控制，最終權限由後端判定
5. 公司路由:
- 登入後依公司路由資訊切換 API base URL（公司私有後端）
6. 檢索結果來源展示:
- 至少顯示來源筆記標題 + 片段摘要
- 支持展開查看詳細引用（含頁碼或 sheet/row）
7. 狀態與錯誤:
- 索引中/完成/失敗提示
- AI timeout/檢索失敗降級提示
8. 離線能力:
- 內建本地 SQLite 快取（離線查看 + 離線編輯）
- 本地同步隊列與衝突提示

## 5.2 後端（notebook-backend）
1. Notebook CRUD API。
2. 檔案關聯 API（保存 Matrix media metadata 與可抽取文本）。
3. RAG API:
- `assist/query`（主動提問）
- `assist/from-context`（前 5 句上下文）
4. 檢索策略:
- V1: vector + BM25 混合
- 支持 rerank（可開關）
5. 索引任務機制:
- 新增/更新筆記後異步切塊與向量化
- 任務狀態可查
6. 審計與可觀測:
- 記錄每次 assist 請求、來源、耗時、是否採用
7. 權限與能力閘門:
- 登入後下發 capability（依角色/公司設定）
- 未啟用 LLM 時，assist API 返回 `403 CAPABILITY_DISABLED`
- Client 調用 assist API 一律 `403 FORBIDDEN_ROLE`
8. 文件導入與索引:
- 支持多格式文本抽取（含 PDF/Excel）
- 僅可索引文件進入向量庫
9. 私有部署要求:
- 每家公司實例獨立配置 DB/Qdrant/Redis/LLM key

## 5.3 管理後台（gotradetalk-client/visitor）
1. 新增 Notebook AI 設定區:
- LLM base URL
- LLM API key
- chat model
- embedding model
- rerank model（選填）
2. 策略設定:
- 是否允許直接發送建議回覆
- 默認 topK、相似度閾值
- 最大上下文 token
- 是否開啟 OCR
3. 測試按鈕:
- 測試 embedding
- 測試檢索
- 測試回覆

## 6. 技術設計

## 6.1 架構
- 公司私有服務（每家公司一套）:
  - `continuwuity`
  - `gotradetalk-agent`
  - `notebook-backend`
  - `Postgres`
  - `Qdrant`
  - `Redis`
- `client` 端同樣視為一家公司，部署一套獨立 `notebook-backend + Postgres + Qdrant + Redis`。
- 離線端存儲: 應用端/App 本地 SQLite
- 對象/媒體: Matrix media（公司私有）
- LLM/Embedding/Rerank: 由各公司後端代理調用（公司自有 key）

## 6.2 資料模型（Postgres）

### 6.2.1 notebook_items
- id (uuid, pk)
- owner_user_id (uuid, not null)
- title (text)
- content_markdown (text)
- item_type (text: `text` | `file`)
- matrix_media_mxc (text, nullable)
- matrix_media_name (text, nullable)
- matrix_media_mime (text, nullable)
- matrix_media_size (bigint, nullable)
- is_indexable (boolean, default false)
- index_status (`pending` | `running` | `success` | `failed` | `skipped`)
- index_error (text, nullable)
- status (text: `active` | `deleted`)
- revision (bigint, default 1)
- updated_at / created_at

### 6.2.2 notebook_chunks
- id (uuid, pk)
- item_id (uuid, fk -> notebook_items.id)
- owner_user_id (uuid)
- chunk_index (int)
- chunk_text (text)
- token_count (int)
- content_hash (text)
- updated_at / created_at

### 6.2.3 assist_logs
- id (uuid, pk)
- user_id (uuid)
- room_id (text)
- trigger_type (`manual_query` | `from_message_context`)
- trigger_event_id (text, nullable)
- query_text (text)
- context_message_ids (jsonb)
- used_sources (jsonb)
- response_text (text)
- response_confidence (numeric)
- adopted_action (`none` | `inserted` | `sent`)
- latency_ms (int)
- created_at

### 6.2.4 notebook_index_jobs
- id (uuid, pk)
- owner_user_id (uuid)
- item_id (uuid)
- job_type (`upsert` | `delete` | `reindex`)
- status (`pending` | `running` | `success` | `failed`)
- error_message (text, nullable)
- started_at / finished_at / created_at

### 6.2.5 notebook_sync_ops
- id (uuid, pk)
- user_id (uuid)
- device_id (text)
- entity_type (`item` | `item_file`)
- entity_id (uuid/text)
- op_type (`create` | `update` | `delete`)
- op_payload (jsonb)
- client_op_id (text, unique)
- status (`pending` | `applied` | `conflict` | `rejected`)
- created_at / applied_at

## 6.3 Qdrant Collection 設計
- collection: `notebook_chunks_v1`
- vector: `embedding` (size 依模型而定)
- payload:
  - chunk_id
  - item_id
  - owner_user_id
  - chunk_index
  - content_hash
  - source_type (`text` | `pdf` | `docx` | `csv` | `xlsx`)
  - source_locator (頁碼或 sheet/row range)
  - updated_at

## 6.4 切塊與檢索策略
- chunk_size: 800~1200 字符（可配置，默認 1000）
- overlap: 100~250（默認 200）
- topK: 默認 5
- 檢索流程:
  1. Query 生成 embedding
  2. Qdrant 向量召回 topK*2
  3. BM25 補充召回
  4. 合併去重
  5. rerank（可選）
  6. 取最終 topK 並輸出來源

## 6.5 文件支援與導入規格
- V1 可檢索文件格式:
  - `txt`, `md`, `pdf`, `docx`, `csv`, `xlsx`
- V1 可上傳但不索引:
  - 圖片（未開 OCR）, 壓縮檔, 可執行檔, 音視頻檔
- 導入流程:
  1. 文件上傳到 Matrix media
  2. 在 Postgres 寫入 `notebook_items`（`index_status=pending`）
  3. 建立 `notebook_index_jobs`
  4. Worker 抽取文本
  5. 切塊 + embedding
  6. upsert 到 Qdrant
  7. 回寫 `index_status=success/failed`
- Excel（`xlsx`）策略:
  - 後端使用 Node 套件（建議 `exceljs` 或 `xlsx`）解析
  - 每個 sheet 轉為結構化文本（保留 sheet 名、欄名、列號）
  - 以表格語義塊切塊索引
  - 回答時附 `sheet + row range` 引用

## 6.6 一般資料庫 vs 向量資料庫邊界
- Postgres（權威資料）保存:
  - 筆記原文、文件 metadata、權限、索引狀態、審計、同步事件
- Qdrant（檢索索引）保存:
  - chunk embedding + 最小 payload

## 6.7 離線與自動同步（一步到位）
- 端側本地 SQLite 提供:
  - 離線查看
  - 離線編輯
  - 本地操作隊列（op log）
- 同步策略:
  1. 連網恢復後自動上傳本地操作（push）
  2. 拉取雲端增量變更（pull）
  3. 依 `updated_at + revision` 判定衝突
  4. 默認 `LWW`，高風險衝突保留副本並提示人工處理

## 6.8 反幻覺與回答約束
- 服務端系統提示強制注入:
  - 僅可基於檢索來源回答
  - 禁止捏造產品功能、規格、價格、承諾
  - 證據不足時必須回覆「知識庫未找到明確依據」
  - 每段結論附來源標記
- 輸出字段:
  - `answer`
  - `citations[]`
  - `confidence`
- 安全閥:
  - 低信心禁止直接發送（可配置）

## 7. API 草案（Notebook Backend）

## 7.1 Notebook
- `GET /notebook/items`
- `POST /notebook/items`
- `PATCH /notebook/items/:id`
- `DELETE /notebook/items/:id`
- `POST /notebook/items/:id/files`（綁定 Matrix media）
- `GET /notebook/items/:id/index-status`
- `POST /notebook/sync/push`
- `GET /notebook/sync/pull?cursor=...`

## 7.2 Assist
- `POST /chat/assist/query`
- `POST /chat/assist/from-context`
- 回參:
  - answer
  - sources[]
  - citations[]
  - confidence
  - trace_id
- 錯誤碼:
  - `403 FORBIDDEN_ROLE`
  - `403 CAPABILITY_DISABLED`
  - `422 INVALID_CONTEXT`

## 7.3 Settings
- `GET /company/settings/notebook-ai`
- `PUT /company/settings/notebook-ai`
- `POST /company/settings/notebook-ai/test`
- `GET /me/capabilities`

## 8. UX 行為規範

### 8.1 AI 輸出框
- 默認可編輯。
- 按鈕: 套用到輸入框、直接發送、重新生成。
- 僅在 `NOTEBOOK_LLM_ASSIST` 開啟時顯示。

### 8.2 低信心策略
- confidence < 閾值時顯示「建議僅供參考」。
- 可按策略禁用「直接發送」。

### 8.3 索引延遲提示
- 新增/更新筆記後顯示「索引中，約數秒可檢索」。

### 8.4 離線提示
- 斷網顯示「離線模式」。
- 恢復連線後顯示「同步中/完成/衝突」。

## 9. 安全與合規
- API key 僅儲存在公司私有後端（加密存儲）。
- 前端不可直接接觸模型 key。
- 完整審計日志。
- 公司間物理隔離（每公司獨立 DB/Qdrant）。
- 角色與能力雙重校驗。

## 10. 部署模型（去中心化）
- 每家公司（含 client 作為獨立 company）各自獨立部署 stack:
  - `continuwuity`
  - `gotradetalk-agent`
  - `notebook-backend`
  - `postgres`
  - `qdrant`
  - `redis`
- 前端按公司路由到對應公司私有 API。
- 不存在跨公司共用 Notebook 資料層或共用向量庫。

## 11. 里程碑與排期建議

### M1: 基礎能力
- Notebook CRUD + UI
- Postgres schema
- 離線 SQLite 框架

### M2: Assist 閉環
- 調用知識庫
- 5句上下文
- AI 輸出框

### M3: 品質與運維
- BM25 + rerank
- 衝突處理優化
- 觀測與告警

## 12. 驗收標準（UAT）
1. Staff/Client 皆可使用基本 Notebook。
2. Client 不顯示 LLM 入口；assist API 返回 403。
3. Staff 可基於前 5 句觸發知識庫回覆。
4. 回覆可編輯、套用、直發（按策略）。
5. 引用可追溯（含頁碼或 sheet/row）。
6. 離線可讀可寫，連網自動同步。
7. Excel/PDF 可抽取並檢索。
8. 無證據時不得捏造答案。
9. 跨公司物理隔離驗收通過（公司 A 完全不可見公司 B 資料）。

## 13. 開放問題
1. V1 是否支持團隊共享筆記。
2. 低信心直發預設是否關閉。
3. OCR 是否預設開啟。
4. 衝突策略是否允許全局雲端覆蓋。

---

## 附錄 A: 與 note-gen 參考對照
- 參考採納:
  - chunk + overlap 可配置
  - 混合檢索（vector/BM25）
  - 來源片段追溯
- 不採納:
  - Tauri 本地 SQLite 架構
  - 前端直連模型 API
- 補強:
  - 服務端 anti-hallucination prompt（note-gen 預設未強制此規則）

## 附錄 B: E2E 驗收 Gate
- 詳細驗收用例: `/Users/mac/Documents/github/gotradetalk-notebook/docs/e2e-uat-checklist.md`
