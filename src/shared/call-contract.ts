export interface ServiceSettings {
  controlApiUrl: string
}

export interface InviteReference {
  callId: string
  inviteSecret: string
}

export interface CallCredentials {
  callId: string
  displayName: string
  identity: string
  participantToken: string
  serverUrl: string
  expiresAt: string
  shareLink?: string
  ownerSessionId?: string
}

export interface ManagedCall {
  ownerSessionId: string
  callId: string
  expiresAt: string | null
  canRejoin: boolean
}

export interface ServiceHealth {
  ready: boolean
  message?: string
}

export interface PlexocallApi {
  getSettings(): Promise<ServiceSettings>
  saveControlApiUrl(url: string): Promise<ServiceSettings>
  getServiceHealth(): Promise<ServiceHealth>
  createCall(displayName: string): Promise<CallCredentials>
  joinCall(invite: InviteReference, displayName: string): Promise<CallCredentials>
  listManagedCalls(): Promise<ManagedCall[]>
  resumeManagedCall(ownerSessionId: string, displayName: string): Promise<CallCredentials>
  endCall(ownerSessionId: string): Promise<void>
  onInviteReceived(callback: (invite: InviteReference) => void): () => void
}

export const IPC_CHANNELS = {
  getSettings: 'settings:get',
  saveControlApiUrl: 'settings:save-control-api-url',
  getServiceHealth: 'service:health',
  createCall: 'calls:create',
  joinCall: 'calls:join',
  listManagedCalls: 'calls:list-managed',
  resumeManagedCall: 'calls:resume-managed',
  endCall: 'calls:end',
  inviteReceived: 'calls:invite-received'
} as const
