import type { InviteReference } from '@shared/call-contract'
import { parseInviteLink } from '@shared/invites'

export function inviteFromArguments(arguments_: string[]): InviteReference | null {
  for (const argument of arguments_) {
    if (!argument.toLowerCase().startsWith('plexocall://')) continue
    const invite = parseInviteLink(argument)
    if (invite) return invite
  }
  return null
}
