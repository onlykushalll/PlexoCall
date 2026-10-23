import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'
import { z } from 'zod'
import { config } from '../config.js'
import { pool } from '../db.js'
import { databaseRateLimit } from '../rateLimit.js'

const CALL_TTL_MS = 12 * 60 * 60 * 1000
const ROOM_EMPTY_TIMEOUT_SECONDS = 600
const MAX_PARTICIPANTS = 8
const PARTICIPANT_TOKEN_TTL = '2m'
const ROOM_CLOSE_GRACE_SECONDS = 180
const SECRET_PATTERN = /^[A-Za-z0-9_-]{40,64}$/

const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), 'Name contains unsupported characters.')

const createBodySchema = z.object({ displayName: displayNameSchema, idempotencyKey: z.string().uuid() }).strict()
const joinBodySchema = z
  .object({
    inviteSecret: z.string().regex(SECRET_PATTERN),
    displayName: displayNameSchema
  })
  .strict()
const revokeBodySchema = z.object({ ownerSecret: z.string().regex(SECRET_PATTERN) }).strict()
const callIdSchema = z.string().uuid()

const roomService = new RoomServiceClient(
  config.LIVEKIT_API_URL,
  config.LIVEKIT_API_KEY,
  config.LIVEKIT_API_SECRET
)

function hashSecret(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

function deriveCreateSecret(kind: 'invite' | 'owner', idempotencyKey: string, callId: string): string {
  return createHmac('sha256', config.LIVEKIT_API_SECRET)
    .update(`plexocall:create:${kind}:${callId}:${idempotencyKey}`, 'utf8')
    .digest('base64url')
}

function matchesSecret(candidate: string, stored: Buffer): boolean {
  const digest = hashSecret(candidate)
  return stored.length === digest.length && timingSafeEqual(stored, digest)
}

function invalidRequest(reply: { code: (status: number) => { send: (body: unknown) => unknown } }): unknown {
  return reply.code(400).send({ error: 'invalid_request' })
}

async function ensureRoom(roomName: string): Promise<void> {
  const rooms = await roomService.listRooms([roomName])
  if (rooms.some((room) => room.name === roomName)) return
  try {
    await roomService.createRoom({
      name: roomName,
      emptyTimeout: ROOM_EMPTY_TIMEOUT_SECONDS,
      maxParticipants: MAX_PARTICIPANTS
    })
  } catch (error) {
    const currentRooms = await roomService.listRooms([roomName])
    if (!currentRooms.some((room) => room.name === roomName)) throw error
  }
}

async function closeRoom(callId: string, roomName: string): Promise<void> {
  const rooms = await roomService.listRooms([roomName])
  if (rooms.some((room) => room.name === roomName)) {
    try {
      await roomService.deleteRoom(roomName)
    } catch (error) {
      const currentRooms = await roomService.listRooms([roomName]).catch(() => { throw error })
      if (currentRooms.some((room) => room.name === roomName)) throw error
    }
  }
  await pool.query(
    'UPDATE calls SET room_closed_at = NOW() WHERE id = $1',
    [callId]
  )
}

export async function reconcileCallRooms(): Promise<void> {
  await pool.query(`
    UPDATE calls
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE expires_at <= NOW() AND revoked_at IS NULL
  `)
  const pending = await pool.query<{ id: string; room_name: string }>(`
    SELECT id, room_name
    FROM calls
    WHERE revoked_at IS NOT NULL AND room_close_finalized_at IS NULL
    ORDER BY revoked_at
    LIMIT 100
  `)
  const failedCallIds: string[] = []
  for (let offset = 0; offset < pending.rows.length; offset += 10) {
    const batch = pending.rows.slice(offset, offset + 10)
    const outcomes = await Promise.all(batch.map(async (call) => {
      try {
        await closeRoom(call.id, call.room_name)
        await pool.query(
          `UPDATE calls
           SET room_close_finalized_at = NOW()
           WHERE id = $1
             AND room_close_finalized_at IS NULL
             AND revoked_at <= NOW() - ($2::double precision * INTERVAL '1 second')`,
          [call.id, ROOM_CLOSE_GRACE_SECONDS]
        )
        return null
      } catch {
        return call.id
      }
    }))
    failedCallIds.push(...outcomes.filter((callId): callId is string => callId !== null))
  }
  if (failedCallIds.length) throw new Error(`Media-room closure is still pending for ${failedCallIds.length} call(s).`)
}

async function createParticipantToken(roomName: string, displayName: string): Promise<{
  identity: string
  participantToken: string
}> {
  const identity = randomUUID()
  const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity,
    name: displayName,
    ttl: PARTICIPANT_TOKEN_TTL
  })
  token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true })
  return { identity, participantToken: await token.toJwt() }
}

function credentials(
  callId: string,
  displayName: string,
  expiresAt: Date,
  roomName: string
): Promise<{
  callId: string
  displayName: string
  identity: string
  participantToken: string
  serverUrl: string
  expiresAt: string
}> {
  return createParticipantToken(roomName, displayName).then(({ identity, participantToken }) => ({
    callId,
    displayName,
    identity,
    participantToken,
    serverUrl: config.LIVEKIT_PUBLIC_URL,
    expiresAt: expiresAt.toISOString()
  }))
}

export async function registerCallRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/calls',
    { onRequest: databaseRateLimit('call-create', 5, 10 * 60 * 1000) },
    async (request, reply) => {
      const parsed = createBodySchema.safeParse(request.body)
      if (!parsed.success) return invalidRequest(reply)

      const createRequestHash = hashSecret(parsed.data.idempotencyKey)
      const createRequestFingerprint = createHmac('sha256', config.LIVEKIT_API_SECRET)
        .update(`plexocall:create-fingerprint:${parsed.data.displayName}`, 'utf8')
        .digest()
      const client = await pool.connect()
      let call: { id: string; room_name: string; expires_at: Date } | undefined
      let inviteSecret = ''
      let ownerSecret = ''
      try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [createRequestHash.toString('hex')])
        const existing = await client.query<{
          id: string
          room_name: string
          expires_at: Date
          revoked_at: Date | null
          invite_hash: Buffer
          owner_hash: Buffer
          create_request_fingerprint: Buffer | null
        }>(
          `SELECT id, room_name, expires_at, revoked_at, invite_hash, owner_hash, create_request_fingerprint
           FROM calls WHERE create_request_hash = $1`,
          [createRequestHash]
        )
        if (existing.rows[0]) {
          const saved = existing.rows[0]
          if (saved.revoked_at || new Date(saved.expires_at).getTime() <= Date.now()) {
            await client.query('COMMIT')
            return reply.code(409).send({ error: 'idempotency_key_unavailable' })
          }
          call = { id: saved.id, room_name: saved.room_name, expires_at: saved.expires_at }
          inviteSecret = deriveCreateSecret('invite', parsed.data.idempotencyKey, call.id)
          ownerSecret = deriveCreateSecret('owner', parsed.data.idempotencyKey, call.id)
          if (!matchesSecret(inviteSecret, saved.invite_hash) || !matchesSecret(ownerSecret, saved.owner_hash)) {
            await client.query('COMMIT')
            return reply.code(409).send({ error: 'idempotency_key_unavailable' })
          }
          if (saved.create_request_fingerprint && !saved.create_request_fingerprint.equals(createRequestFingerprint)) {
            await client.query('COMMIT')
            return reply.code(409).send({ error: 'idempotency_key_unavailable' })
          }
          if (!saved.create_request_fingerprint) {
            await client.query(
              'UPDATE calls SET create_request_fingerprint = $2 WHERE id = $1',
              [saved.id, createRequestFingerprint]
            )
          }
        } else {
          const callId = randomUUID()
          call = {
            id: callId,
            room_name: `pc_${callId.replaceAll('-', '')}`,
            expires_at: new Date(Date.now() + CALL_TTL_MS)
          }
          inviteSecret = deriveCreateSecret('invite', parsed.data.idempotencyKey, call.id)
          ownerSecret = deriveCreateSecret('owner', parsed.data.idempotencyKey, call.id)
          await client.query(
            `INSERT INTO calls (id, room_name, invite_hash, owner_hash, create_request_hash, create_request_fingerprint, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [call.id, call.room_name, hashSecret(inviteSecret), hashSecret(ownerSecret), createRequestHash, createRequestFingerprint, call.expires_at]
          )
        }
        await client.query('COMMIT')

        // Serialize credential issuance against revoke, including idempotent create replays.
        await client.query('BEGIN')
        const active = await client.query<{ room_name: string; expires_at: Date }>(
          `SELECT room_name, expires_at
           FROM calls
           WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()
           FOR UPDATE`,
          [call.id]
        )
        if (!active.rows[0]) {
          await client.query('ROLLBACK')
          return reply.code(409).send({ error: 'idempotency_key_unavailable' })
        }
        await ensureRoom(call.room_name)
        const issued = await credentials(call.id, parsed.data.displayName, active.rows[0].expires_at, call.room_name)
        await client.query('COMMIT')
        return reply.code(201).send({ ...issued, inviteSecret, ownerSecret })
      } catch {
        await client.query('ROLLBACK').catch(() => undefined)
        request.log.error({ callId: call?.id }, 'call creation failed')
        return reply.code(503).send({ error: 'service_unavailable' })
      } finally {
        client.release()
      }
    }
  )

  app.post(
    '/v1/calls/:callId/join',
    { onRequest: databaseRateLimit('call-join', 60, 60 * 1000) },
    async (request, reply) => {
      const params = z.object({ callId: callIdSchema }).safeParse(request.params)
      const body = joinBodySchema.safeParse(request.body)
      if (!params.success || !body.success) return invalidRequest(reply)

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await client.query<{
          room_name: string
          invite_hash: Buffer
          expires_at: Date
        }>(
          `SELECT room_name, invite_hash, expires_at
           FROM calls
           WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()
           FOR UPDATE`,
          [params.data.callId]
        )
        const call = result.rows[0]
        if (!call || !matchesSecret(body.data.inviteSecret, call.invite_hash)) {
          await client.query('ROLLBACK')
          return reply.code(404).send({ error: 'invite_unavailable' })
        }

        await ensureRoom(call.room_name)
        const issued = await credentials(params.data.callId, body.data.displayName, call.expires_at, call.room_name)
        await client.query('COMMIT')
        return reply.send(issued)
      } catch {
        await client.query('ROLLBACK').catch(() => undefined)
        request.log.error({ callId: params.data.callId }, 'call join token could not be issued')
        return reply.code(503).send({ error: 'service_unavailable' })
      } finally {
        client.release()
      }
    }
  )

  app.post(
    '/v1/calls/:callId/revoke',
    { onRequest: databaseRateLimit('call-revoke', 20, 60 * 1000) },
    async (request, reply) => {
      const params = z.object({ callId: callIdSchema }).safeParse(request.params)
      const body = revokeBodySchema.safeParse(request.body)
      if (!params.success || !body.success) return invalidRequest(reply)

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await client.query<{ room_name: string; owner_hash: Buffer }>(
          `SELECT room_name, owner_hash FROM calls WHERE id = $1 FOR UPDATE`,
          [params.data.callId]
        )
        const call = result.rows[0]
        if (!call || !matchesSecret(body.data.ownerSecret, call.owner_hash)) {
          await client.query('ROLLBACK')
          return reply.code(404).send({ error: 'invite_unavailable' })
        }
        const callRoomName = call.room_name
        await client.query('UPDATE calls SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1', [params.data.callId])
        await client.query('COMMIT')
        await closeRoom(params.data.callId, callRoomName)
        return reply.send({ ended: true })
      } catch {
        await client.query('ROLLBACK').catch(() => undefined)
        request.log.error({ callId: params.data.callId }, 'call was revoked but the media room could not be confirmed as closed')
        return reply.code(503).send({ error: 'service_unavailable' })
      } finally {
        client.release()
      }
    }
  )
}

export { roomService }
