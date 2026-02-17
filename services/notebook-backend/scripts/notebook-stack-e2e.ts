import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import Redis from 'ioredis'
import { ensureQdrantCollection, upsertNotebookPoints, searchNotebookVectors } from '../src/services/notebookQdrant.js'

async function assertTableExists(client: any, table: string) {
  const result = await client.query(
    `select to_regclass($1) as exists_name`,
    [`public.${table}`]
  )
  if (!result.rows[0]?.exists_name) {
    throw new Error(`Table missing: ${table}`)
  }
}

async function runSql(client: any, file: string) {
  const sql = fs.readFileSync(file, 'utf8')
  await client.query('BEGIN')
  try {
    await client.query(sql)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function ensureBaseSchema(client: any) {
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;')
  await client.query(`
    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;
  `)
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.companies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
  `)
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid REFERENCES public.companies(id),
      user_type text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
  `)
}

async function verifyMigrations(databaseUrl: string) {
  const { Client } = pg as any
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()

  const up = path.join(process.cwd(), 'migrations', '016_notebook_rag_core.up.sql')
  const down = path.join(process.cwd(), 'migrations', '016_notebook_rag_core.down.sql')

  await ensureBaseSchema(client)
  await runSql(client, down).catch(() => undefined)
  await runSql(client, up)
  await assertTableExists(client, 'notebook_items')
  await assertTableExists(client, 'notebook_chunks')
  await assertTableExists(client, 'notebook_index_jobs')
  await assertTableExists(client, 'assist_logs')
  await assertTableExists(client, 'notebook_sync_ops')

  await runSql(client, down)
  const dropped = await client.query(`select to_regclass('public.notebook_items') as exists_name`)
  if (dropped.rows[0]?.exists_name) {
    throw new Error('Rollback failed: notebook_items still exists')
  }

  await runSql(client, up)
  await assertTableExists(client, 'notebook_items')

  await client.end()
}

async function verifyRedis(redisUrl: string) {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false })
  const key = 'notebook:index:jobs:e2e'
  await redis.del(key)
  await redis.lpush(key, 'job-a')
  const popped = await redis.brpop(key, 1)
  if (!popped || popped[1] !== 'job-a') {
    throw new Error('Redis queue flow failed')
  }
  await redis.quit()
}

async function verifyQdrant() {
  await ensureQdrantCollection()
  await upsertNotebookPoints([
    {
      id: '11111111-1111-4111-8111-111111111111',
      vector: new Array(Number(process.env.QDRANT_VECTOR_SIZE || 1536)).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
      payload: {
        chunk_id: 'chunk-1',
        item_id: 'item-1',
        company_id: 'company-e2e',
        owner_user_id: 'user-e2e',
        chunk_index: 0,
        content_hash: 'hash-1',
        source_type: 'text',
        source_locator: null
      }
    }
  ])

  const vector = new Array(Number(process.env.QDRANT_VECTOR_SIZE || 1536)).fill(0).map((_, i) => (i === 0 ? 1 : 0))
  const results = await searchNotebookVectors('company-e2e', 'user-e2e', vector, 3)
  if (!results.length) {
    throw new Error('Qdrant search returned empty')
  }
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim()
  const redisUrl = String(process.env.REDIS_URL || '').trim()
  const qdrantUrl = String(process.env.QDRANT_URL || '').trim()

  if (!databaseUrl) throw new Error('Missing DATABASE_URL')
  if (!redisUrl) throw new Error('Missing REDIS_URL')
  if (!qdrantUrl) throw new Error('Missing QDRANT_URL')

  await verifyMigrations(databaseUrl)
  console.log('[e2e] postgres migration up/down/up ok')

  await verifyRedis(redisUrl)
  console.log('[e2e] redis queue push/pop ok')

  await verifyQdrant()
  console.log('[e2e] qdrant init/upsert/search ok')

  console.log('[e2e] notebook stack PASS')
}

main().catch((error: any) => {
  console.error('[e2e] notebook stack FAIL', error?.message || error)
  process.exit(1)
})
