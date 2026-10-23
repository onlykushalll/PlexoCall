import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { IPC_CHANNELS } from '@shared/call-contract'
import { join } from 'node:path'
import { createCall, endCall, getHealth, joinCall, listManagedCalls, resumeManagedCall } from './apiClient.js'
import { normalizeControlApiUrl, loadSettings, saveControlApiUrl } from './settings.js'
import type { InviteReference } from '@shared/call-contract'

export function isTrustedRendererUrl(value: string): boolean {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    try {
      return new URL(value).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    } catch {
      return false
    }
  }
  return value === pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
}

function assertMainFrame(event: IpcMainInvokeEvent, window: BrowserWindow | null): void {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !isTrustedRendererUrl(event.senderFrame.url)
  ) {
    throw new Error('This request did not come from the app window.')
  }
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`Enter a valid ${label}.`)
  }
  return value.trim()
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  const handle = (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertMainFrame(event, getWindow())
      return handler(event, ...args)
    })
  }

  handle(IPC_CHANNELS.getSettings, async () => loadSettings())
  handle(IPC_CHANNELS.saveControlApiUrl, async (_event, value) =>
    saveControlApiUrl(normalizeControlApiUrl(text(value, 'control API URL', 500)))
  )
  handle(IPC_CHANNELS.getServiceHealth, async () => getHealth())
  handle(IPC_CHANNELS.createCall, async (_event, displayName) => createCall(text(displayName, 'name', 40)))
  handle(IPC_CHANNELS.joinCall, async (_event, inviteValue, displayName) => {
    if (
      typeof inviteValue !== 'object' ||
      inviteValue === null ||
      !('callId' in inviteValue) ||
      !('inviteSecret' in inviteValue)
    ) {
      throw new Error('The invitation link is invalid.')
    }
    const invite = inviteValue as InviteReference
    const callId = text(invite.callId, 'call ID', 64)
    const inviteSecret = text(invite.inviteSecret, 'invite code', 100)
    return joinCall({ callId, inviteSecret }, text(displayName, 'name', 40))
  })
  handle(IPC_CHANNELS.listManagedCalls, async () => listManagedCalls())
  handle(IPC_CHANNELS.resumeManagedCall, async (_event, sessionId, displayName) =>
    resumeManagedCall(text(sessionId, 'call session', 64), text(displayName, 'name', 40))
  )
  handle(IPC_CHANNELS.endCall, async (_event, sessionId) =>
    endCall(text(sessionId, 'call session', 64))
  )
}
