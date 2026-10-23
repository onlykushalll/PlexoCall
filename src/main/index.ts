import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  session,
  shell,
  type DesktopCapturerSource
} from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS, type InviteReference } from '@shared/call-contract'
import { parseInviteLink } from '@shared/invites'
import { inviteFromArguments } from './deepLinks.js'
import { isTrustedRendererUrl, registerIpcHandlers } from './ipc.js'

app.setName('Plexocall')

let mainWindow: BrowserWindow | null = null
let pendingInvite: InviteReference | null = inviteFromArguments(process.argv)

const ownsFrame = (candidate: Electron.WebContents): boolean =>
  candidate === mainWindow?.webContents && !candidate.isDestroyed()

function sendInvite(invite: InviteReference): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send(IPC_CHANNELS.inviteReceived, invite)
    pendingInvite = null
  } else {
    pendingInvite = invite
  }
}

function handleArguments(arguments_: string[]): void {
  const invite = inviteFromArguments(arguments_)
  if (invite) {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
    sendInvite(invite)
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, arguments_) => handleArguments(arguments_))
  app.on('open-url', (event, url) => {
    event.preventDefault()
    const invite = parseInviteLink(url)
    if (invite) sendInvite(invite)
  })

  app.whenReady().then(async () => {
    if (app.isPackaged) app.setAsDefaultProtocolClient('plexocall')

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
      const requestedMediaOnly = !mediaTypes || mediaTypes.every((kind) => kind === 'audio' || kind === 'video')
      callback(ownsFrame(webContents) && permission === 'media' && requestedMediaOnly)
    })
    session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
      Boolean(webContents && ownsFrame(webContents) && permission === 'media')
    )
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      if (!mainWindow || mainWindow.isDestroyed()) return callback({})
      let sources: DesktopCapturerSource[]
      try {
        sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 0, height: 0 }
        })
      } catch {
        return callback({})
      }
      if (!sources.length) return callback({})

      const buttons = [...sources.map((source) => source.name), 'Cancel']
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Choose what to share',
        message: 'Choose a screen or window for this call.',
        buttons,
        cancelId: buttons.length - 1,
        defaultId: 0,
        noLink: true
      })
      const selected = choice.response < sources.length ? sources[choice.response] : undefined
      callback(selected ? { video: selected } : {})
    })

    registerIpcHandlers(() => mainWindow)
    const createWindow = async (): Promise<void> => {
      mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 1040,
        minHeight: 700,
        show: false,
        autoHideMenuBar: true,
        title: 'Plexocall',
        backgroundColor: '#f2f5f9',
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true
        }
      })

      const window = mainWindow
      window.webContents.on('will-navigate', (event, url) => {
        if (!isTrustedRendererUrl(url)) event.preventDefault()
      })
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
        return { action: 'deny' }
      })
      window.once('ready-to-show', () => window.show())
      window.webContents.on('did-finish-load', () => {
        if (pendingInvite && mainWindow === window) {
          window.webContents.send(IPC_CHANNELS.inviteReceived, pendingInvite)
          pendingInvite = null
        }
      })
      window.on('closed', () => {
        if (mainWindow === window) mainWindow = null
      })

      if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
        await window.loadURL(process.env.ELECTRON_RENDERER_URL)
      } else {
        await window.loadFile(join(__dirname, '../renderer/index.html'))
      }
    }

    await createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
