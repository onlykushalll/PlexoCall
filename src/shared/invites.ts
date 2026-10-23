import type { InviteReference } from './call-contract.js'

const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INVITE_SECRET = /^[A-Za-z0-9_-]{40,64}$/

export function parseInviteLink(value: string): InviteReference | null {
  try {
    const link = new URL(value.trim())
    const callId = link.pathname.slice(1)
    const inviteSecret = link.searchParams.get('invite') ?? ''
    if (
      link.protocol !== 'plexocall:' ||
      link.hostname !== 'join' ||
      link.username ||
      link.password ||
      link.port ||
      link.hash ||
      link.searchParams.size !== 1 ||
      link.searchParams.getAll('invite').length !== 1 ||
      !CALL_ID.test(callId) ||
      !INVITE_SECRET.test(inviteSecret)
    ) {
      return null
    }
    return { callId, inviteSecret }
  } catch {
    return null
  }
}

export function serializeInviteLink(invite: InviteReference): string {
  const link = new URL(`plexocall://join/${encodeURIComponent(invite.callId)}`)
  link.searchParams.set('invite', invite.inviteSecret)
  return link.toString()
}
