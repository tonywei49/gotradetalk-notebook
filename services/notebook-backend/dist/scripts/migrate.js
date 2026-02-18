import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import process from 'process';
import pg from 'pg';
async function ensureMigrationsTable(client) {
    await client.query(`
    create table if not exists public.schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}
function loadMigrations(migrationsDir) {
    const files = fs.readdirSync(migrationsDir);
    const upFiles = files.filter((f) => f.endsWith('.up.sql')).sort();
    return upFiles.map((upFile) => {
        const id = upFile.replace(/\.up\.sql$/, '');
        return {
            id,
            upFile: path.join(migrationsDir, upFile),
            downFile: path.join(migrationsDir, `${id}.down.sql`)
        };
    });
}
async function applySqlFile(client, sqlPath) {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await client.query('BEGIN');
    try {
        await client.query(sql);
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}
async function run() {
    const action = String(process.argv[2] || '').trim();
    if (!['up', 'down'].includes(action)) {
        throw new Error('Usage: tsx scripts/migrate.ts <up|down>');
    }
    const databaseUrl = String(process.env.DATABASE_URL || '').trim();
    if (!databaseUrl) {
        throw new Error('Missing DATABASE_URL');
    }
    const migrationsDir = path.join(process.cwd(), 'migrations');
    const migrations = loadMigrations(migrationsDir);
    const { Client } = pg;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        await ensureMigrationsTable(client);
        if (action === 'up') {
            const { rows } = await client.query('select id from public.schema_migrations');
            const applied = new Set((rows || []).map((r) => String(r.id)));
            for (const migration of migrations) {
                if (applied.has(migration.id)) {
                    console.log(`[migrate] skip already applied: ${migration.id}`);
                    continue;
                }
                await applySqlFile(client, migration.upFile);
                await client.query('insert into public.schema_migrations (id) values ($1)', [migration.id]);
                console.log(`[migrate] up applied: ${migration.id}`);
            }
        }
        else {
            const { rows } = await client.query('select id from public.schema_migrations order by applied_at desc');
            for (const row of rows || []) {
                const id = String(row.id);
                const migration = migrations.find((m) => m.id === id);
                if (!migration || !fs.existsSync(migration.downFile)) {
                    throw new Error(`Missing down migration for ${id}`);
                }
                await applySqlFile(client, migration.downFile);
                await client.query('delete from public.schema_migrations where id = $1', [id]);
                console.log(`[migrate] down applied: ${id}`);
            }
        }
    }
    finally {
        await client.end();
    }
}
run().catch((error) => {
    console.error('[migrate] failed:', error?.message || error);
    process.exit(1);
});
