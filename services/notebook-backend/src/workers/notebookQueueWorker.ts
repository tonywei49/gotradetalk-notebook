import 'dotenv/config'
import { popNotebookJobId, closeNotebookQueue } from '../services/notebookQueue.js'
import { runNotebookIndexJob } from '../services/notebookIndexing.js'
import { ensureQdrantCollection } from '../services/notebookQdrant.js'

const idleTimeoutSec = Math.max(Number(process.env.NOTEBOOK_INDEX_QUEUE_BRPOP_TIMEOUT_SEC || 5), 1)
const workerMatrixBaseUrl = String(process.env.NOTEBOOK_INDEX_MATRIX_HS_URL || '').trim() || undefined
const workerMatrixAccessToken = String(process.env.NOTEBOOK_INDEX_MATRIX_ACCESS_TOKEN || '').trim() || undefined

async function loop() {
  while (true) {
    try {
      const jobId = await popNotebookJobId(idleTimeoutSec)
      if (!jobId) continue
      await runNotebookIndexJob(jobId, {
        matrixBaseUrl: workerMatrixBaseUrl,
        accessToken: workerMatrixAccessToken
      })
      console.log(`[notebook-queue-worker] processed job=${jobId}`)
    } catch (error: any) {
      console.error('[notebook-queue-worker] failed', error?.message || error)
    }
  }
}

async function main() {
  if (!process.env.REDIS_URL) {
    console.log('[notebook-queue-worker] REDIS_URL not set, fallback to polling worker')
    process.exit(0)
  }

  process.on('SIGINT', async () => {
    await closeNotebookQueue()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await closeNotebookQueue()
    process.exit(0)
  })

  try {
    await ensureQdrantCollection()
  } catch (error: any) {
    console.error('[notebook-queue-worker] ensureQdrantCollection failed', error?.message || error)
  }

  console.log('[notebook-queue-worker] started')
  await loop()
}

void main()
