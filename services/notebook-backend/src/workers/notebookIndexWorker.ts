import 'dotenv/config'
import { pollAndRunNotebookIndexJobs } from '../services/notebookIndexing.js'

const intervalMs = Math.max(Number(process.env.NOTEBOOK_INDEX_WORKER_INTERVAL_MS || 3000), 1000)

async function tick() {
  try {
    const processed = await pollAndRunNotebookIndexJobs(5)
    if (processed > 0) {
      console.log(`[notebook-index-worker] processed=${processed}`)
    }
  } catch (error: any) {
    console.error('[notebook-index-worker] tick failed', error?.message || error)
  }
}

async function main() {
  if (process.env.REDIS_URL) {
    console.log('[notebook-index-worker] REDIS_URL detected, prefer worker:notebook-queue')
  }
  console.log(`[notebook-index-worker] started interval=${intervalMs}ms`)
  await tick()
  setInterval(() => {
    tick()
  }, intervalMs)
}

void main()
