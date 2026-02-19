import 'dotenv/config';
import { pollAndRunNotebookIndexJobs } from '../services/notebookIndexing.js';
import { ensureQdrantCollection } from '../services/notebookQdrant.js';
const intervalMs = Math.max(Number(process.env.NOTEBOOK_INDEX_WORKER_INTERVAL_MS || 3000), 1000);
const workerMatrixBaseUrl = String(process.env.NOTEBOOK_INDEX_MATRIX_HS_URL || '').trim() || undefined;
const workerMatrixAccessToken = String(process.env.NOTEBOOK_INDEX_MATRIX_ACCESS_TOKEN || '').trim() || undefined;
async function tick() {
    try {
        const processed = await pollAndRunNotebookIndexJobs(5, {
            matrixBaseUrl: workerMatrixBaseUrl,
            accessToken: workerMatrixAccessToken
        });
        if (processed > 0) {
            console.log(`[notebook-index-worker] processed=${processed}`);
        }
    }
    catch (error) {
        console.error('[notebook-index-worker] tick failed', error?.message || error);
    }
}
async function main() {
    if (process.env.REDIS_URL) {
        console.log('[notebook-index-worker] REDIS_URL detected, prefer worker:notebook-queue');
    }
    try {
        await ensureQdrantCollection();
    }
    catch (error) {
        console.error('[notebook-index-worker] ensureQdrantCollection failed', error?.message || error);
    }
    console.log(`[notebook-index-worker] started interval=${intervalMs}ms`);
    await tick();
    setInterval(() => {
        tick();
    }, intervalMs);
}
void main();
