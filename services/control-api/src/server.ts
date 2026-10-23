import Fastify, { type FastifyError } from 'fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { config } from './config.js'
import { deleteOldCalls, initializeDatabase, pool } from './db.js'
import { pruneRateLimitBuckets } from './rateLimit.js'
import { reconcileCallRooms, registerCallRoutes, roomService } from './routes/calls.js'

const app = Fastify({
  bodyLimit: 16 * 1024,
  trustProxy: config.trustedProxyAddresses.length ? config.trustedProxyAddresses : false,
  logger: {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.headers.cookie']
  }
})

await app.register(helmet, { contentSecurityPolicy: false })
await app.register(rateLimit, { global: false })

app.addHook('onRequest', async (request, reply) => {
  // The desktop client calls this service from Electron main, which sends no Origin header.
  // Reject browser-originated requests so an unrelated website cannot consume call resources.
  if (request.headers.origin) return reply.code(403).send({ error: 'invalid_request' })
})

app.setErrorHandler<FastifyError>((error, request, reply) => {
  if (error.statusCode === 429) return reply.code(429).send({ error: 'too_many_requests' })
  if (error.validation) return reply.code(400).send({ error: 'invalid_request' })
  request.log.error({ code: error.code, statusCode: error.statusCode }, 'unhandled control API error')
  return reply.code(500).send({ error: 'service_error' })
})

app.get('/health', { config: { rateLimit: { max: 600, timeWindow: 60 * 1000 } } }, async (_request, reply) => {
  try {
    await pool.query('SELECT 1')
    await roomService.listRooms(['__plexocall_health_probe__'])
    return reply.send({ status: 'ok' })
  } catch {
    return reply.code(503).send({ status: 'unavailable' })
  }
})

await registerCallRoutes(app)
await initializeDatabase()
await pruneRateLimitBuckets()
await reconcileCallRooms().catch((error) => app.log.error({ err: error }, 'pending media-room closure reconciliation failed'))
await deleteOldCalls()

let reconciliationRunning = false
const roomReconciliationTimer = setInterval(() => {
  if (reconciliationRunning) return
  reconciliationRunning = true
  void reconcileCallRooms()
    .catch((error) => app.log.error({ err: error }, 'pending media-room closure reconciliation failed'))
    .finally(() => { reconciliationRunning = false })
}, 15_000)
roomReconciliationTimer.unref()

const cleanupTimer = setInterval(() => {
  void deleteOldCalls().catch(() => app.log.error('expired invitation cleanup failed'))
}, 24 * 60 * 60 * 1000)
cleanupTimer.unref()

const rateLimitCleanupTimer = setInterval(() => {
  void pruneRateLimitBuckets().catch(() => app.log.error('expired rate-limit cleanup failed'))
}, 60 * 60 * 1000)
rateLimitCleanupTimer.unref()

app.addHook('onClose', async () => {
  clearInterval(roomReconciliationTimer)
  clearInterval(cleanupTimer)
  clearInterval(rateLimitCleanupTimer)
  await pool.end()
})

const shutdown = async (): Promise<void> => {
  await app.close()
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

await app.listen({ port: config.PORT, host: '0.0.0.0' })
