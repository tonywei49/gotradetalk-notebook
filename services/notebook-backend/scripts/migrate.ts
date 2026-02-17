import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import process from 'process'
import pg from 'pg'

async function run() {
  const action = String(process.argv[2] || '').trim()
  if (!['up', 'down'].includes(action)) {
    throw new Error('Usage: tsx scripts/migrate.ts <up|down>')
  }

  const databaseUrl = String(process.env.DATABASE_URL || '').trim()
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL')
  }

  const migrationFile = action === 'up'
    ? '016_notebook_rag_core.up.sql'
    : '016_notebook_rag_core.down.sql'

  const sqlPath = path.join(process.cwd(), 'migrations', migrationFile)
  const sql = fs.readFileSync(sqlPath, 'utf8')

  const { Client } = pg as any
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()

  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    console.log(`[migrate] ${action} success: ${migrationFile}`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

run().catch((error: any) => {
  console.error('[migrate] failed:', error?.message || error)
  process.exit(1)
})
