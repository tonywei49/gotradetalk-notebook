import 'dotenv/config';
import path from 'path';
import pg from 'pg';
import Redis from 'ioredis';
import { ensureQdrantCollection, upsertNotebookPoints, searchNotebookVectors } from '../src/services/notebookQdrant.js';
async function assertTableExists(client, table) {
    const result = await client.query(`select to_regclass($1) as exists_name`, [`public.${table}`]);
    if (!result.rows[0]?.exists_name) {
        throw new Error(`Table missing: ${table}`);
    }
}
async function verifyMigrations(databaseUrl) {
    const { Client } = pg;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const { spawnSync } = await import('node:child_process');
    const runMigrate = (action) => {
        const bin = process.platform === 'win32' ? 'node.exe' : 'node';
        const script = path.join(process.cwd(), 'dist', 'scripts', 'migrate.js');
        const result = spawnSync(bin, [script, action], {
            env: { ...process.env, DATABASE_URL: databaseUrl },
            encoding: 'utf8'
        });
        if (result.status !== 0) {
            throw new Error(`migrate ${action} failed: ${result.stderr || result.stdout}`);
        }
    };
    runMigrate('down');
    runMigrate('up');
    await assertTableExists(client, 'notebook_items');
    await assertTableExists(client, 'notebook_chunks');
    await assertTableExists(client, 'notebook_index_jobs');
    await assertTableExists(client, 'assist_logs');
    await assertTableExists(client, 'notebook_sync_ops');
    await assertTableExists(client, 'companies');
    await assertTableExists(client, 'profiles');
    await assertTableExists(client, 'company_settings');
    runMigrate('down');
    const dropped = await client.query(`select to_regclass('public.notebook_items') as exists_name`);
    if (dropped.rows[0]?.exists_name) {
        throw new Error('Rollback failed: notebook_items still exists');
    }
    runMigrate('up');
    await assertTableExists(client, 'notebook_items');
    await client.end();
}
async function verifyRedis(redisUrl) {
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
    const key = 'notebook:index:jobs:e2e';
    await redis.del(key);
    await redis.lpush(key, 'job-a');
    const popped = await redis.brpop(key, 1);
    if (!popped || popped[1] !== 'job-a') {
        throw new Error('Redis queue flow failed');
    }
    await redis.quit();
}
async function verifyQdrant() {
    await ensureQdrantCollection();
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
    ]);
    const vector = new Array(Number(process.env.QDRANT_VECTOR_SIZE || 1536)).fill(0).map((_, i) => (i === 0 ? 1 : 0));
    const results = await searchNotebookVectors('company-e2e', 'user-e2e', vector, 3);
    if (!results.length) {
        throw new Error('Qdrant search returned empty');
    }
}
async function main() {
    const databaseUrl = String(process.env.DATABASE_URL || '').trim();
    const redisUrl = String(process.env.REDIS_URL || '').trim();
    const qdrantUrl = String(process.env.QDRANT_URL || '').trim();
    if (!databaseUrl)
        throw new Error('Missing DATABASE_URL');
    if (!redisUrl)
        throw new Error('Missing REDIS_URL');
    if (!qdrantUrl)
        throw new Error('Missing QDRANT_URL');
    await verifyMigrations(databaseUrl);
    console.log('[e2e] postgres migration up/down/up ok');
    await verifyRedis(redisUrl);
    console.log('[e2e] redis queue push/pop ok');
    await verifyQdrant();
    console.log('[e2e] qdrant init/upsert/search ok');
    console.log('[e2e] notebook stack PASS');
}
main().catch((error) => {
    console.error('[e2e] notebook stack FAIL', error?.message || error);
    process.exit(1);
});
