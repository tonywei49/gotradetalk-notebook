# GoTradeTalk Notebook 開發拆解清單（對應 E2E UAT）

## 1. 交付節奏
- Sprint 1: 核心資料與基本 Notebook + 權限框架
- Sprint 2: 文件索引、RAG、聊天 AI 流程
- Sprint 3: 離線同步、衝突處理、穩定性與觀測

## 2. 任務清單（按模組）

## 2.1 Backend（notebook-backend @ gotradetalk-notebook/services/notebook-backend）

### BE-01 資料表與 migration（Postgres）
- [x] 進度: 已完成（含 up/down migration 與驗證；017_notebook_ai_provider_profiles 已套用）
- 內容:
  - 建立 `notebook_items`, `notebook_chunks`, `notebook_index_jobs`, `assist_logs`, `notebook_sync_ops`
  - 增加必要索引（company_id, owner_user_id, updated_at, status）
- 產出:
  - migration SQL
  - schema 文檔
- 對應 UAT: `UAT-01`, `UAT-03`, `UAT-11`, `UAT-12`, `UAT-15`

### BE-02 Notebook CRUD API
- [x] 進度: 已完成
- 內容:
  - `GET/POST/PATCH/DELETE /notebook/items`
  - 權限檢查（NOTEBOOK_BASIC）
- 產出:
  - API handler + contract test
- 對應 UAT: `UAT-01`, `UAT-02`, `UAT-13`

### BE-03 文件上傳後關聯與索引任務 API
- [x] 進度: 已完成
- 內容:
  - `POST /notebook/items/:id/files`
  - 寫入 `index_status=pending` + 建立 `index_job`
- 對應 UAT: `UAT-03`

### BE-04 文件解析 Pipeline（PDF/DOCX/CSV/XLSX）
- [x] 進度: 已完成
- 內容:
  - PDF 文本抽取
  - DOCX 段落抽取
  - CSV 解析
  - XLSX（sheet/row/column）解析
- 對應 UAT: `UAT-03`, `UAT-04`, `UAT-10`

### BE-05 切塊、向量化、Qdrant upsert Worker
- [x] 進度: 已完成（含 Redis queue / poll worker）
- 內容:
  - chunk + overlap
  - embedding 請求
  - Qdrant upsert + payload（含 source_locator）
  - 回寫 `index_status`
- 對應 UAT: `UAT-03`, `UAT-04`

### BE-06 混合檢索與 Rerank
- [x] 進度: 已完成
- 內容:
  - vector + BM25 merge
  - rerank（可配置）
  - topK + score threshold
- 對應 UAT: `UAT-05`, `UAT-06`, `UAT-08`

### BE-07 Assist API（含 5 句上下文）
- [x] 進度: 已完成
- 內容:
  - `POST /chat/assist/query`
  - `POST /chat/assist/from-context`
  - `answer + citations + confidence`
- 對應 UAT: `UAT-05`, `UAT-06`

### BE-08 反幻覺防護（服務端強制）
- [x] 進度: 已完成（服務端強制 prompt 注入）
- 內容:
  - system prompt 防捏造規則
  - 無證據時拒答策略
  - 低信心標記
- 對應 UAT: `UAT-07`, `UAT-08`

### BE-09 Capability 與角色閘門
- [x] 進度: 已完成（assist 403 行為已實作）
- 內容:
  - `GET /me/capabilities`
  - assist API 403 行為（FORBIDDEN_ROLE / CAPABILITY_DISABLED）
- 對應 UAT: `UAT-02`, `UAT-14`

### BE-10 同步 API（離線回寫）
- [x] 進度: 已完成（client_op_id 幂等）
- 內容:
  - `POST /notebook/sync/push`
  - `GET /notebook/sync/pull`
  - 幂等 client_op_id
- 對應 UAT: `UAT-09`, `UAT-10`, `UAT-11`, `UAT-12`

### BE-11 衝突處理策略
- [x] 進度: 已完成（revision/LWW/conflict copy）
- 內容:
  - revision + updated_at
  - LWW + conflict 副本
- 對應 UAT: `UAT-12`

### BE-12 審計與觀測
- [x] 進度: 已完成（assist logs / worker error logs）
- 內容:
  - assist logs
  - 任務與錯誤日志
  - 指標（latency, success rate）
- 對應 UAT: `UAT-15`

### 2.1 RAG 優化映射（延伸）
- [ ] 進度: 規劃完成，待排程實作
- 方案文件:
  - `docs/notebook-rag-optimization-plan-2.1.md`
- 2.1.1 深度解析（Advanced Parsing）:
  - 對應 BE: `BE-04`
  - 對應 UAT: `UAT-03`, `UAT-04`, `UAT-10`
- 2.1.2 語義智能切塊（Smart Semantic Chunking）:
  - 對應 BE: `BE-05`
  - 對應 UAT: `UAT-03`, `UAT-04`, `UAT-05`
- 2.1.3 檢索融合與重排序（Hybrid + RRF + Rerank）:
  - 對應 BE: `BE-06`, `BE-07`, `BE-08`
  - 對應 UAT: `UAT-05`, `UAT-06`, `UAT-07`, `UAT-08`
- 驗收指標（建議）:
  - Hit@3 較現況提升 >= 15%
  - `/chat/assist/query` P95 延遲增幅 <= 30%

### 2.1 RAG 延伸子任務拆解（可執行）

#### Sprint A（資料品質）
- [ ] `RAG-A1` PDF 深度解析接入（Marker/Docling 二擇一）
  - 內容: 解析結果轉結構化 markdown，保留段落/標題/表格信息
  - 工時估算: 2~3 人日
  - 風險等級: 中
  - 依賴: `BE-04` 現有解析管線
  - 驗收:
    - 同文件解析後噪聲行數下降
    - 表格問答可引用到列欄內容
- [ ] `RAG-A2` PDF 去噪（頁首頁尾/頁碼重複段）
  - 內容: 索引前增加規則化清洗
  - 工時估算: 1~1.5 人日
  - 風險等級: 低
  - 依賴: `RAG-A1`
  - 驗收:
    - `notebook_chunks` 重複文本比例下降
    - 不影響非 PDF 檔案解析結果

#### Sprint B（切塊品質）
- [ ] `RAG-B1` Smart Chunking（標題/段落/列表邊界）
  - 內容: 由固定長度切塊改為語義邊界優先
  - 工時估算: 1.5~2 人日
  - 風險等級: 中
  - 依賴: `BE-05`
  - 驗收:
    - chunk 平均可讀長度提升
    - 同 query 檢索結果更集中於正確段落
- [ ] `RAG-B2` Code fence 保護與 overlap 調參
  - 內容: 避免在程式碼區塊中間切段，調整 overlap 策略
  - 工時估算: 0.5~1 人日
  - 風險等級: 低
  - 依賴: `RAG-B1`
  - 驗收:
    - 技術文件問題命中率提升
    - 不出現 code snippet 斷裂導致語意損失

#### Sprint C（排序品質）
- [ ] `RAG-C1` Hybrid 檢索改造（BM25 + Vector + RRF）
  - 內容: 由 merge 改為 RRF 融合（含可配置權重）
  - 工時估算: 2~3 人日
  - 風險等級: 中
  - 依賴: `BE-06`
  - 驗收:
    - Hit@3 相對基線提升 >= 10%
    - 排序前 5 名穩定度提升
- [ ] `RAG-C2` 強信號捷徑（strong-signal shortcut）
  - 內容: lexical 高信號 query 跳過昂貴步驟
  - 工時估算: 0.5~1 人日
  - 風險等級: 低
  - 依賴: `RAG-C1`
  - 驗收:
    - 易命中 query 的延遲下降
    - 回答品質不低於基線
- [ ] `RAG-C3` Chunk-level rerank + position-aware blending
  - 內容: rerank 目標改為最佳 chunk，並加位置權重融合
  - 工時估算: 1.5~2 人日
  - 風險等級: 中
  - 依賴: `RAG-C1`
  - 驗收:
    - 引用段落精準度提升
    - `UAT-05`/`UAT-06` 主觀評分改善

#### 共通驗收與回歸
- [ ] `RAG-X1` 檢索評測腳本（Hit@1/3/5 + latency）
  - 工時估算: 1 人日
  - 風險等級: 低
  - 對應 UAT: `UAT-05`, `UAT-06`, `UAT-07`, `UAT-08`
- [ ] `RAG-X2` 回歸基準建立（上線前後對比報告）
  - 工時估算: 0.5 人日
  - 風險等級: 低
  - 產出: baseline 指標表 + 調參記錄

## 2.2 Admin/Company Console（gotradetalk-client/visitor）

### AD-01 Notebook AI 設定頁
- [x] 進度: 已完成（含 capability/permission 驅動顯示）
- 內容:
  - chat/embedding/rerank model
  - base URL / API key
  - topK / threshold / max tokens
- 對應 UAT: `UAT-14`

### AD-02 OCR 與策略開關
- [x] 進度: 已完成
- 內容:
  - 是否允許 OCR
  - 是否允許低信心直發
- 對應 UAT: `UAT-08`, `UAT-14`

### AD-03 設定測試工具
- [x] 進度: 已完成（embedding/retrieval/response）
- 內容:
  - embedding test
  - retrieval test
  - response test
- 對應 UAT: `UAT-14`

### AD-04 平台統一配置與公司側唯讀
- [x] 進度: 已完成（含最小 E2E）
- 內容:
  - provider/key/model 改為平台級統一配置（`platform_ai_settings`）
  - 主體策略改為 `subject_ai_policies`（company/client/personal）
  - company 側設定頁降權唯讀，回傳 `managed_by_platform`
  - company 側 provider/key/model 更新 API 改為 `MANAGED_BY_PLATFORM`
- 對應 UAT: `UAT-14`, `UAT-08`

### AD-05 公司知識庫（Company Knowledge Base）
- [x] 進度: 已完成（公司管理台 + 平台代理 API + 最小 E2E）
- 內容:
  - 公司管理台新增公司知識庫管理（上傳、列表、下線、刪除、重試索引）
  - hub-backend 新增公司端/平台端公司知識庫代理 API（透過 notebook internal secret）
  - 審計寫入 `admin_audit_logs`（upload/delete/offline/retry）
  - 嚴格沿用能力/策略閘門（`notebook enabled/expire`）
- 對應 UAT: `UAT-03`, `UAT-05`, `UAT-14`

## 2.3 UI（gotradetalk-ui）

### UI-01 左側 Notebook 模組頁
- [x] 進度: 已完成
- 內容:
  - 列表、搜尋、CRUD、文件關聯
- 對應 UAT: `UAT-01`, `UAT-02`

### UI-02 Capability 驅動顯示
- [x] 進度: 已完成
- 內容:
  - 根據 `/me/capabilities` 控制顯示
  - client 隱藏 LLM 控件
- 對應 UAT: `UAT-02`, `UAT-14`

### UI-03 聊天 AI 入口與輸出框
- [x] 進度: 已完成
- 內容:
  - 工具列 AI 圖示
  - 訊息下方調用知識庫
  - 可編輯輸出框、套用、直發
- 對應 UAT: `UAT-05`, `UAT-06`

### UI-04 引用展示與低信心提示
- [x] 進度: 已完成
- 內容:
  - citations 渲染
  - confidence 提示與按鈕禁用
- 對應 UAT: `UAT-07`, `UAT-08`

### UI-05 索引狀態提示
- [x] 進度: 已完成
- 內容:
  - pending/running/success/failed UI
- 對應 UAT: `UAT-03`

## 2.4 App 端與移動端（離線）

### APP-01 本地 SQLite 結構
- [x] 進度: 已完成（schema v1 + 實作 + E2E）
- 內容:
  - 本地 item 表、oplog 表、cursor 表
- 交付:
  - `docs/app-offline-sync-spec.md`（第 2、3、4、7 節，v1）
  - `gotradetalk-client/visitor/src/notebook/store.ts`
- 對應 UAT: `UAT-09`, `UAT-10`

### APP-02 離線讀寫
- [x] 進度: 已完成（實作 + E2E）
- 內容:
  - 斷網可查看
  - 斷網可編輯
- 交付:
  - `docs/app-offline-sync-spec.md`（第 4 節）
  - `gotradetalk-client/visitor/src/notebook/service.ts`
  - `gotradetalk-client/visitor/src/views/CustomerHome.vue`
- 對應 UAT: `UAT-09`, `UAT-10`

### APP-03 自動同步引擎
- [x] 進度: 已完成（push/pull v1 + checkpoint + 退避 + E2E）
- 內容:
  - 連網自動 push/pull
  - 重試與退避
- 交付:
  - `docs/app-offline-sync-spec.md`（第 3、5、8 節）
  - `gotradetalk-client/visitor/src/notebook/syncEngine.ts`
  - `gotradetalk-client/visitor/src/services/hubApi.ts`
- 對應 UAT: `UAT-09`, `UAT-10`, `UAT-11`

### APP-04 衝突 UI
- [x] 進度: 已完成（LWW + conflict 副本 + E2E）
- 內容:
  - 顯示衝突
  - 選擇本地版/雲端版
- 交付:
  - `docs/app-offline-sync-spec.md`（第 6、7、9 節）
  - `gotradetalk-client/visitor/src/views/CustomerHome.vue`
  - `gotradetalk-client/visitor/src/notebook/store.ts`
- 測試:
  - `cd /Users/mac/Documents/github/gotradetalk-client/visitor && npm run test:e2e:notebook-sync`（PASS）
  - `docs/uat-09-12-offline-sync-report.md`
- 對應 UAT: `UAT-12`

## 3. 建議分 Sprint

## Sprint 1（基礎）
- BE-01, BE-02, BE-03, BE-09
- UI-01, UI-02, UI-05
- AD-01（先模型配置）
- 目標 UAT: `UAT-01`, `UAT-02`, `UAT-03`(部分), `UAT-14`(部分)

## Sprint 2（檢索 + 回覆）
- BE-04, BE-05, BE-06, BE-07, BE-08
- UI-03, UI-04
- AD-02, AD-03
- 目標 UAT: `UAT-04`, `UAT-05`, `UAT-06`, `UAT-07`, `UAT-08`, `UAT-14`

## Sprint 3（離線 + 穩定）
- BE-10, BE-11, BE-12
- APP-01, APP-02, APP-03, APP-04
- 目標 UAT: `UAT-09`, `UAT-10`, `UAT-11`, `UAT-12`, `UAT-15`

## 4. 開工前凍結項
- 凍結 API contract（request/response/error code）
- 凍結 migration
- 凍結 capability 名稱與策略
- 凍結 UAT 判定標準

## 5. 完成定義（DoD）
- 任務 PR 合併前需滿足:
  - 單元測試與整合測試通過
  - 對應 UAT 用例至少在測試環境跑通一次
  - 日志與錯誤碼符合 PRD
  - 無 P0/P1 已知缺陷
