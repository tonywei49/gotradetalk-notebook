# Notebook RAG 升級方案（2.1 範圍）

## 1. 目標
- 提升檢索命中率：讓「有答案」更穩定進入前 3 名。
- 降低幻覺風險：減少低品質 chunk 被送入回答上下文。
- 控制延遲與成本：品質提升下維持可接受的 Assist 響應時間。

## 2. 實作邊界
- 僅限 2.1 後端（`notebook-backend`）。
- 不包含 2.2/2.3/2.4 前端與跨模組功能。
- 優先做可灰度與可回滾的後端優化。

## 3. 分階段方案

### 3.1 深度解析（Advanced Parsing）
目標：提升原始文件轉文本品質，降低雜訊與斷裂語義。

實作方向：
- PDF 解析優先輸出結構化 Markdown，而非純文字直出。
- 表格保真（保留列欄結構，避免展平成不可讀文本）。
- 去除頁首頁尾重複內容、頁碼噪音。
- 保留來源定位資訊（頁碼/段落/表格區塊）供 citation 使用。

預計修改檔案：
- `services/notebook-backend/src/services/notebookParsing.ts`
- `services/notebook-backend/src/services/notebookIndexing.ts`

驗收重點：
- 同一份 PDF，解析後有效文本比例提升，重複噪聲下降。
- 表格型問題可引用正確欄列內容。

---

### 3.2 語義智能切塊（Smart Semantic Chunking）
目標：讓 chunk 成為完整語義單元，提高檢索和 rerank 品質。

實作方向：
- 從固定長度切塊升級為結構優先切塊。
- 優先切點：`#`/`##` 標題、段落邊界、列表邊界、code block 邊界。
- 避免在 code fence 中間切塊。
- 保留 overlap，但以語義邊界為先。

預計修改檔案：
- `services/notebook-backend/src/services/notebookChunking.ts`
- `services/notebook-backend/src/services/notebookChunking.test.ts`

驗收重點：
- chunk 可讀性提升（人工 spot check）。
- 同樣 query 下，命中內容更集中且引用更穩定。

---

### 3.3 檢索融合與重排序（Hybrid + RRF + Rerank）
目標：平衡 lexical 與 semantic 搜索，提升最終排序品質。

實作方向：
- 將檢索分為：BM25（lex）+ Vector（semantic）。
- 使用 RRF（Reciprocal Rank Fusion）融合多路檢索結果。
- 引入強信號捷徑（strong-signal shortcut）：
  - 若 lexical top1 分數高且與 top2 gap 明顯，跳過昂貴步驟（query expansion / 重 rerank）。
- 保留 reranker，但改為對候選 chunk 而非整篇全文重排。
- 使用 position-aware blending，避免 reranker 過度破壞高置信原始排名。

預計修改檔案：
- `services/notebook-backend/src/services/notebookIndexing.ts`
- `services/notebook-backend/src/repos/notebookRepo.ts`
- `services/notebook-backend/src/services/notebookLlm.ts`

驗收重點：
- Hit@3、Hit@5 提升。
- 問答引用來源穩定性提升。
- 延遲可控（可通過 candidateLimit/topK 調參）。

## 4. 指標與驗收口徑（建議）
- 檢索品質：Hit@3 較現況提升 >= 15%。
- 回答品質：`insufficient_evidence` 誤觸率下降。
- 效能：`/chat/assist/query` P95 延遲增幅 <= 30%。
- 穩定性：index job 失敗率不高於現況。

### 4.1 基線評測腳本（RAG-X1）
- 位置:
  - `services/notebook-backend/scripts/rag-eval.ts`
  - `services/notebook-backend/scripts/rag-eval.cases.sample.json`
- 執行:
  - `cd services/notebook-backend`
  - `npm run test:rag -- --cases ./scripts/rag-eval.cases.sample.json --company <company_id> --owner <owner_user_id> --topk 5`
- 輸出指標:
  - `Hit@1`, `Hit@3`, `Hit@5`
  - `latency avg`, `latency p95`
  - 每個 case 的 `HIT@1/HIT@3/HIT@5/MISS` 與 top item ids
  - 可加 `--out ./tmp/rag-baseline.json` 產生 JSON 報告

### 4.2 前後對比報告（RAG-X2）
- 位置:
  - `services/notebook-backend/scripts/rag-eval-compare.ts`
- 執行流程:
  - `npm run test:rag -- --cases <cases.json> --company <company_id> --owner <owner_user_id> --topk 5 --out ./tmp/rag-baseline.json`
  - （完成優化後）`npm run test:rag -- --cases <cases.json> --company <company_id> --owner <owner_user_id> --topk 5 --out ./tmp/rag-current.json`
  - `npm run test:rag:compare -- --baseline ./tmp/rag-baseline.json --current ./tmp/rag-current.json --out ./tmp/rag-compare.md`
- 報告內容:
  - Hit@1/3/5 前後差異（pp）
  - latency avg / p95 前後差異（ms）
  - 改善 case 與退步 case 清單
  - 建議 gate（回歸數、Hit@3、p95 增幅）

## 5. 風險與緩解
- 解析模型太重導致索引變慢：
  - 緩解：保留 parser fallback 開關，支持回退到現有解析器。
- RRF 權重不當導致排序震盪：
  - 緩解：權重參數化、灰度對比。
- rerank 成本增加：
  - 緩解：候選上限與快取（query/rerank 結果）。

## 6. 建議執行順序
1. 先做深度解析（提高資料品質）。
2. 再做智能切塊（提高索引單元品質）。
3. 最後做 Hybrid + RRF + rerank（優化排序決策）。

## 7. 與 qmd 可對齊的技術參考
- Smart Chunking（結構切點 + code fence 保護）
- Typed query routing（lex/vec/hyde）
- RRF 融合 + top rank bonus
- Chunk-level rerank + position-aware blending
- LLM cache（query expansion / rerank）
