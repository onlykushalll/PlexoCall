import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CallCredentials, InviteReference, ManagedCall } from '@shared/call-contract'
import { serializeInviteLink } from '@shared/invites'
import { loadSettings, normalizeControlApiUrl } from './settings.js'

interface ApiCredentials {
  callId: string
  displayName: string
  identity: string
  participantToken: string
  serverUrl: string
  expiresAt: string
}

interface OwnerSession {
  callId: string
  endpoint: string
  secret: string
  inviteSecret?: string
  expiresAt?: string
}

interface PendingCreate {
  idempotencyKey: string
  displayName: string
}

const ownerSessions = new Map<string, OwnerSession>()
const pendingCreates = new Map<string, PendingCreate>()
const pendingCreatePreparations = new Map<string, Promise<PendingCreate>>()
let ownerSessionsLoaded: Promise<void> | null = null
let ownerSessionsWriteQueue: Promise<void> = Promise.resolve()

function ownerSessionsPath(): string {
  return join(app.getPath('userData'), 'owner-sessions.bin')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function isOwnerSession(value: unknown): value is OwnerSession {
  if (
    !isRecord(value) ||
    typeof value.callId !== 'string' ||
    typeof value.endpoint !== 'string' ||
    typeof value.secret !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(value.callId) ||
    !/^[A-Za-z0-9_-]{40,64}$/.test(value.secret) ||
    (value.inviteSecret !== undefined && (typeof value.inviteSecret !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(value.inviteSecret))) ||
    (value.expiresAt !== undefined && (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))))
  ) {
    return false
  }
  try {
    normalizeControlApiUrl(value.endpoint)
    return true
  } catch {
    return false
  }
}

function isLegacyPendingCreate(value: unknown): value is [string, string] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'string' ||
    typeof value[1] !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(value[1])
  ) return false
  try {
    normalizeControlApiUrl(value[0])
    return true
  } catch {
    return false
  }
}

function isPendingCreate(value: unknown): value is [string, PendingCreate] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'string' ||
    !isRecord(value[1]) ||
    typeof value[1].idempotencyKey !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(value[1].idempotencyKey) ||
    typeof value[1].displayName !== 'string' ||
    value[1].displayName.length > 40 ||
    /[\p{Cc}\p{Cf}]/u.test(value[1].displayName)
  ) return false
  try {
    normalizeControlApiUrl(value[0])
    return true
  } catch {
    return false
  }
}

function ownerSessionsDocument(): string {
  return JSON.stringify({
    version: 3,
    ownerSessions: [...ownerSessions.entries()],
    pendingCreates: [...pendingCreates.entries()]
  })
}

async function writeEncryptedOwnerSessions(encrypted: Buffer): Promise<void> {
  const target = ownerSessionsPath()
  const temporary = `${target}.${randomUUID()}.tmp`
  await mkdir(app.getPath('userData'), { recursive: true })
  try {
    await writeFile(temporary, encrypted, { mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

async function ensureOwnerSessionsLoaded(): Promise<void> {
  if (!ownerSessionsLoaded) {
    ownerSessionsLoaded = (async () => {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) {
        throw new Error('Windows protected storage is unavailable. Restart the app and try again.')
      }
      try {
        const decrypted = await safeStorage.decryptStringAsync(await readFile(ownerSessionsPath()))
        const saved: unknown = JSON.parse(decrypted.result)
        const legacy = Array.isArray(saved)
        let version2 = false
        let ownerEntries: unknown[] | null = null
        let pendingEntries: unknown[] | null = null
        if (legacy) {
          ownerEntries = saved
          pendingEntries = []
        } else if (
          isRecord(saved) &&
          (saved.version === 2 || saved.version === 3) &&
          Array.isArray(saved.ownerSessions) &&
          Array.isArray(saved.pendingCreates)
        ) {
          version2 = saved.version === 2
          ownerEntries = saved.ownerSessions
          pendingEntries = saved.pendingCreates
        }
        if (!ownerEntries || !pendingEntries) throw new Error('Saved call owner data is invalid.')
        for (const entry of ownerEntries) {
          if (
            !Array.isArray(entry) ||
            entry.length !== 2 ||
            typeof entry[0] !== 'string' ||
            !/^[0-9a-f-]{36}$/i.test(entry[0]) ||
            !isOwnerSession(entry[1])
          ) {
            throw new Error('Saved call owner data is invalid.')
          }
          ownerSessions.set(entry[0], {
            ...entry[1],
            endpoint: normalizeControlApiUrl(entry[1].endpoint)
          })
        }
        for (const entry of pendingEntries) {
          if (isPendingCreate(entry)) {
            pendingCreates.set(normalizeControlApiUrl(entry[0]), entry[1])
          } else if (version2 && isLegacyPendingCreate(entry)) {
            pendingCreates.set(normalizeControlApiUrl(entry[0]), { idempotencyKey: entry[1], displayName: '' })
          } else {
            throw new Error('Saved call owner data is invalid.')
          }
        }
        if (legacy || version2 || decrypted.shouldReEncrypt) {
          await writeEncryptedOwnerSessions(await safeStorage.encryptStringAsync(ownerSessionsDocument()))
        }
      } catch (error) {
        if (isMissingFile(error)) return
        throw new Error('Saved call controls could not be unlocked. Check this Windows user profile and try again.')
      }
    })()
  }
  await ownerSessionsLoaded
}

async function persistOwnerSessions(): Promise<void> {
  const operation = ownerSessionsWriteQueue.then(async () => {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Windows protected storage is unavailable. Restart the app and try again.')
    }
    await writeEncryptedOwnerSessions(await safeStorage.encryptStringAsync(ownerSessionsDocument()))
  })
  ownerSessionsWriteQueue = operation.catch(() => undefined)
  await operation
}

function parseCredentials(value: unknown): ApiCredentials {
  if (
    !isRecord(value) ||
    typeof value.callId !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.callId) ||
    typeof value.displayName !== 'string' || value.displayName.length < 1 || value.displayName.length > 40 || /[\p{Cc}\p{Cf}]/u.test(value.displayName) ||
    typeof value.identity !== 'string' || value.identity.length < 1 || value.identity.length > 128 ||
    typeof value.participantToken !== 'string' || value.participantToken.length < 32 || value.participantToken.length > 8192 ||
    typeof value.serverUrl !== 'string' ||
    typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()
  ) {
    throw new Error('The call service returned an invalid response.')
  }
  const serverUrl = new URL(value.serverUrl)
  if (
    (serverUrl.protocol !== 'wss:' && !(serverUrl.protocol === 'ws:' && isLoopback(serverUrl.hostname))) ||
    serverUrl.username ||
    serverUrl.password ||
    serverUrl.search ||
    serverUrl.hash ||
    serverUrl.pathname !== '/'
  ) {
    throw new Error('The call service returned an unsafe media-server URL.')
  }
  return {
    callId: value.callId,
    displayName: value.displayName,
    identity: value.identity,
    participantToken: value.participantToken,
    serverUrl: serverUrl.toString(),
    expiresAt: value.expiresAt
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

async function request(endpoint: string, path: string, body?: unknown): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${endpoint}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error'
    })
  } catch {
    throw new Error('Could not reach the call service. Check its address and that it is running.')
  }

  let responseBody: unknown = null
  try {
    const reader = response.body?.getReader()
    if (reader) {
      const chunks: Uint8Array[] = []
      let totalBytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        totalBytes += value.byteLength
        if (totalBytes > 64 * 1024) {
          await reader.cancel()
          throw new Error('The call service returned an oversized response.')
        }
        chunks.push(value)
      }
      const bytes = new Uint8Array(totalBytes)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      responseBody = JSON.parse(new TextDecoder().decode(bytes))
    }
  } catch {
    if (response.ok) throw new Error('The call service returned an invalid response.')
  }
  if (!response.ok) {
    const code = isRecord(responseBody) && typeof responseBody.error === 'string' ? responseBody.error : ''
    const messages: Record<string, string> = {
      invalid_request: 'Check the name or invite link and try again.',
      invite_unavailable: 'This invite has expired or the call has ended.',
      idempotency_key_unavailable: 'This room attempt is no longer available. Start a new room.',
      too_many_requests: 'Too many attempts. Wait a moment and try again.'
    }
    throw new Error(messages[code] ?? 'The call service could not complete that request.')
  }
  return responseBody
}

export async function getHealth(): Promise<{ ready: boolean; message?: string }> {
  const { controlApiUrl } = await loadSettings()
  try {
    const result = await request(controlApiUrl, '/health')
    return isRecord(result) && result.status === 'ok'
      ? { ready: true }
      : { ready: false, message: 'The service did not report ready.' }
  } catch (error) {
    return {
      ready: false,
      message: error instanceof Error ? error.message : 'The call service is unavailable.'
    }
  }
}

export async function createCall(displayName: string): Promise<CallCredentials> {
  await ensureOwnerSessionsLoaded()
  const { controlApiUrl } = await loadSettings()
  const requestedDisplayName = displayName.trim()
  if (!requestedDisplayName || requestedDisplayName.length > 40 || /[\p{Cc}\p{Cf}]/u.test(requestedDisplayName)) {
    throw new Error('Enter a name of 1 to 40 characters without control characters.')
  }
  const existingPreparation = pendingCreatePreparations.get(controlApiUrl)
  let pendingCreate = existingPreparation
    ? await existingPreparation
    : pendingCreates.get(controlApiUrl)
  if (!pendingCreate) {
    let preparation = pendingCreatePreparations.get(controlApiUrl)
    if (!preparation) {
      const nextCreate: PendingCreate = { idempotencyKey: randomUUID(), displayName: requestedDisplayName }
      preparation = (async () => {
        pendingCreates.set(controlApiUrl, nextCreate)
        try {
          await persistOwnerSessions()
          return nextCreate
        } catch {
          if (pendingCreates.get(controlApiUrl) === nextCreate) pendingCreates.delete(controlApiUrl)
          throw new Error('Could not safely save this room attempt on this PC. Check Windows protected storage and try again.')
        }
      })()
      pendingCreatePreparations.set(controlApiUrl, preparation)
    }
    try {
      pendingCreate = await preparation
    } finally {
      if (pendingCreatePreparations.get(controlApiUrl) === preparation) {
        pendingCreatePreparations.delete(controlApiUrl)
      }
    }
  }
  if (!pendingCreate.displayName) {
    pendingCreate = { ...pendingCreate, displayName: requestedDisplayName }
    pendingCreates.set(controlApiUrl, pendingCreate)
    await persistOwnerSessions().catch(() => {
      throw new Error('Could not safely save this room attempt on this PC. Check Windows protected storage and try again.')
    })
  }
  let created: unknown
  try {
    created = await request(controlApiUrl, '/v1/calls', {
      displayName: pendingCreate.displayName,
      idempotencyKey: pendingCreate.idempotencyKey
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'This room attempt is no longer available. Start a new room.') {
      pendingCreates.delete(controlApiUrl)
      await persistOwnerSessions().catch(() => undefined)
    }
    throw error
  }
  if (
    !isRecord(created) ||
    typeof created.inviteSecret !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(created.inviteSecret) ||
    typeof created.ownerSecret !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(created.ownerSecret)
  ) {
    throw new Error('The call service returned an invalid invitation.')
  }
  const credentials = parseCredentials(created)
  const ownerSessionId = randomUUID()
  ownerSessions.set(ownerSessionId, {
    callId: credentials.callId,
    endpoint: controlApiUrl,
    secret: created.ownerSecret,
    inviteSecret: created.inviteSecret,
    expiresAt: credentials.expiresAt
  })
  try {
    await persistOwnerSessions()
  } catch {
    ownerSessions.delete(ownerSessionId)
    let revoked = false
    try {
      await request(controlApiUrl, `/v1/calls/${encodeURIComponent(credentials.callId)}/revoke`, {
        ownerSecret: created.ownerSecret
      })
      revoked = true
    } catch (error) {
      revoked = error instanceof Error && error.message === 'This invite has expired or the call has ended.'
    }
    if (revoked) {
      pendingCreates.delete(controlApiUrl)
      await persistOwnerSessions().catch(() => undefined)
    }
    throw new Error('The room was not started because its owner control could not be saved securely on this PC.')
  }
  pendingCreates.delete(controlApiUrl)
  await persistOwnerSessions().catch(() => undefined)
  const shareLink = serializeInviteLink({ callId: credentials.callId, inviteSecret: created.inviteSecret })
  return { ...credentials, shareLink, ownerSessionId }
}

export async function joinCall(invite: InviteReference, displayName: string): Promise<CallCredentials> {
  const { controlApiUrl } = await loadSettings()
  const result = await request(
    controlApiUrl,
    `/v1/calls/${encodeURIComponent(invite.callId)}/join`,
    { inviteSecret: invite.inviteSecret, displayName }
  )
  return parseCredentials(result)
}

export async function listManagedCalls(): Promise<ManagedCall[]> {
  await ensureOwnerSessionsLoaded()
  const now = Date.now()
  const managed: ManagedCall[] = []
  for (const [ownerSessionId, owner] of ownerSessions) {
    managed.push({
      ownerSessionId,
      callId: owner.callId,
      expiresAt: owner.expiresAt ?? null,
      canRejoin: Boolean(owner.inviteSecret && owner.expiresAt && Date.parse(owner.expiresAt) > now)
    })
  }
  return managed
}

export async function resumeManagedCall(ownerSessionId: string, displayName: string): Promise<CallCredentials> {
  await ensureOwnerSessionsLoaded()
  const owner = ownerSessions.get(ownerSessionId)
  if (!owner || !owner.expiresAt || Date.parse(owner.expiresAt) <= Date.now()) {
    throw new Error('This managed call has expired or is no longer available.')
  }
  if (!owner.inviteSecret) {
    throw new Error('This saved room can still be ended, but its invitation cannot be restored by this app version.')
  }
  const credentials = parseCredentials(await request(
    owner.endpoint,
    `/v1/calls/${encodeURIComponent(owner.callId)}/join`,
    { inviteSecret: owner.inviteSecret, displayName }
  ))
  const invite = { callId: owner.callId, inviteSecret: owner.inviteSecret }
  return {
    ...credentials,
    shareLink: serializeInviteLink(invite),
    ownerSessionId
  }
}

export async function endCall(ownerSessionId: string): Promise<void> {
  await ensureOwnerSessionsLoaded()
  const owner = ownerSessions.get(ownerSessionId)
  if (!owner) throw new Error('This call can no longer be ended from this app session.')
  try {
    await request(owner.endpoint, `/v1/calls/${encodeURIComponent(owner.callId)}/revoke`, {
      ownerSecret: owner.secret
    })
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'This invite has expired or the call has ended.') throw error
  }
  ownerSessions.delete(ownerSessionId)
  await persistOwnerSessions().catch(() => undefined)
}
