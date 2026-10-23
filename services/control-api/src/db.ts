import { readFile } from 'node:fs/promises'
import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'plexocall-control-api'
})

export async function initializeDatabase(): Promise<void> {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  await pool.query(schema)
}

export async function deleteOldCalls(): Promise<void> {
  await pool.query("DELETE FROM calls WHERE room_closed_at IS NOT NULL AND room_close_finalized_at IS NOT NULL AND expires_at < NOW() - INTERVAL '7 days'")
}
