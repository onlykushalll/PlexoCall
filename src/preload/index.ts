import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, type PlexocallApi } from '@shared/call-contract'

type InviteCallback = Parameters<PlexocallApi['onInviteReceived']>[0]
const inviteCallbacks = new Set<InviteCallback>()
let queuedInvite: Parameters<InviteCallback>[0] | null = null

ipcRenderer.on(IPC_CHANNELS.inviteReceived, (_event: IpcRendererEvent, invite: Parameters<InviteCallback>[0]) => {
  if (inviteCallbacks.size === 0) queuedInvite = invite
  for (const callback of inviteCallbacks) callback(invite)
})

const api: PlexocallApi = {
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  saveControlApiUrl: (url) => ipcRenderer.invoke(IPC_CHANNELS.saveControlApiUrl, url),
  getServiceHealth: () => ipcRenderer.invoke(IPC_CHANNELS.getServiceHealth),
  createCall: (displayName) => ipcRenderer.invoke(IPC_CHANNELS.createCall, displayName),
  joinCall: (invite, displayName) => ipcRenderer.invoke(IPC_CHANNELS.joinCall, invite, displayName),
  listManagedCalls: () => ipcRenderer.invoke(IPC_CHANNELS.listManagedCalls),
  resumeManagedCall: (ownerSessionId, displayName) =>
    ipcRenderer.invoke(IPC_CHANNELS.resumeManagedCall, ownerSessionId, displayName),
  endCall: (ownerSessionId) => ipcRenderer.invoke(IPC_CHANNELS.endCall, ownerSessionId),
  onInviteReceived: (callback) => {
    inviteCallbacks.add(callback)
    if (queuedInvite) {
      const invite = queuedInvite
      queuedInvite = null
      callback(invite)
    }
    return () => inviteCallbacks.delete(callback)
  }
}

contextBridge.exposeInMainWorld('plexocall', api)
