import Redis from 'ioredis'

const queueKey = process.env.NOTEBOOK_INDEX_QUEUE_KEY || 'notebook:index:jobs'

let redisClient: Redis | null = null

function getRedisClient() {
  const redisUrl = String(process.env.REDIS_URL || '').trim()
  if (!redisUrl) return null
  if (!redisClient) {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    })
  }
  return redisClient
}

export async function enqueueNotebookJobId(jobId: string): Promise<void> {
  const client = getRedisClient()
  if (!client) return
  await client.lpush(queueKey, jobId)
}

export async function popNotebookJobId(timeoutSeconds = 5): Promise<string | null> {
  const client = getRedisClient()
  if (!client) return null
  const result = await client.brpop(queueKey, timeoutSeconds)
  if (!result || result.length < 2) return null
  return result[1]
}

export async function closeNotebookQueue() {
  if (redisClient) {
    const c = redisClient
    redisClient = null
    await c.quit()
  }
}
