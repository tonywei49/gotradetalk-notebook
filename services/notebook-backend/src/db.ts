import { Pool, type QueryResultRow } from 'pg'

const databaseUrl = String(process.env.DATABASE_URL || '').trim()

if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL')
}

export const dbPool = new Pool({ connectionString: databaseUrl })

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return dbPool.query<T>(text, params)
}
