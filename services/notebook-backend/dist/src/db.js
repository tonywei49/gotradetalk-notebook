import { Pool } from 'pg';
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL');
}
export const dbPool = new Pool({ connectionString: databaseUrl });
export async function dbQuery(text, params = []) {
    return dbPool.query(text, params);
}
