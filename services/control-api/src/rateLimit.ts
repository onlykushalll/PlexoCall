import { createHmac } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from './config.js'
import { pool } from './db.js'

export function databaseRateLimit(scope: string, maxHits: number, windowMs: number) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const bucketHash = createHmac('sha256', config.LIVEKIT_API_SECRET)
      .update(`plexocall:rate-limit:${scope}:${request.ip}`, 'utf8')
      .digest()

    let allowed: boolean
    try {
      const result = await pool.query<{ allowed: boolean }>(
        `INSERT INTO request_rate_buckets (bucket_hash, hit_count, window_started_at, window_ends_at)
         VALUES ($1, 1, NOW(), NOW() + ($3::double precision * INTERVAL '1 millisecond'))
         ON CONFLICT (bucket_hash) DO UPDATE
         SET hit_count = CASE
               WHEN request_rate_buckets.window_ends_at <= NOW() THEN 1
               ELSE LEAST(request_rate_buckets.hit_count + 1, $2::integer + 1)
             END,
             window_started_at = CASE
               WHEN request_rate_buckets.window_ends_at <= NOW() THEN NOW()
               ELSE request_rate_buckets.window_started_at
             END,
             window_ends_at = CASE
               WHEN request_rate_buckets.window_ends_at <= NOW()
                 THEN NOW() + ($3::double precision * INTERVAL '1 millisecond')
               ELSE request_rate_buckets.window_ends_at
             END
         RETURNING hit_count <= $2 AS allowed`,
        [bucketHash, maxHits, windowMs]
      )
      allowed = result.rows[0]?.allowed === true
    } catch {
      request.log.error({ scope }, 'durable rate-limit storage unavailable')
      reply.code(503).send({ error: 'service_unavailable' })
      return
    }

    if (!allowed) reply.code(429).send({ error: 'too_many_requests' })
  }
}

export async function pruneRateLimitBuckets(): Promise<void> {
  const batchSize = 10_000
  let deleted = batchSize
  while (deleted === batchSize) {
    const result = await pool.query(
      `DELETE FROM request_rate_buckets
       WHERE ctid IN (
         SELECT ctid FROM request_rate_buckets
         WHERE window_ends_at < NOW() - INTERVAL '1 hour'
         LIMIT $1
       )`,
      [batchSize]
    )
    deleted = result.rowCount ?? 0
  }
}
