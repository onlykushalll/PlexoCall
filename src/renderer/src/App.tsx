import { useCallback, useEffect, useRef, useState } from 'react'
import type { CallCredentials, InviteReference, ManagedCall, ServiceHealth, ServiceSettings } from '@shared/call-contract'
import { parseInviteLink, serializeInviteLink } from '@shared/invites'
import { CallHome } from './call/CallHome'
import { CallRoom } from './call/CallRoom'
import { Prejoin, type MediaChoice } from './call/Prejoin'

type ScreenState =
  | { kind: 'home' }
  | { kind: 'prejoin'; flow: 'create'; invite?: never }
  | { kind: 'prejoin'; flow: 'join'; invite: InviteReference }
  | { kind: 'call'; credentials: CallCredentials; media: MediaChoice; invite: InviteReference }

const FALLBACK_SETTINGS: ServiceSettings = { controlApiUrl: 'http://127.0.0.1:8787' }
const OFFLINE: ServiceHealth = { ready: false, message: 'Checking the call service…' }

function initialName(): string {
  try {
    return localStorage.getItem('plexocall:display-name') ?? ''
  } catch {
    return ''
  }
}

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<ScreenState>({ kind: 'home' })
  const [displayName, setDisplayName] = useState(initialName)
  const [settings, setSettings] = useState<ServiceSettings>(FALLBACK_SETTINGS)
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth>(OFFLINE)
  const [busy, setBusy] = useState(false)
  const [homeError, setHomeError] = useState<string | null>(null)
  const [prejoinError, setPrejoinError] = useState<string | null>(null)
  const [pendingInvite, setPendingInvite] = useState<InviteReference | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [managedCalls, setManagedCalls] = useState<ManagedCall[]>([])
  const operationGeneration = useRef(0)
  const pendingCallOperations = useRef(0)

  const beginCallOperation = (): void => {
    pendingCallOperations.current += 1
    setBusy(true)
  }

  const finishCallOperation = (): void => {
    pendingCallOperations.current = Math.max(0, pendingCallOperations.current - 1)
    setBusy(pendingCallOperations.current > 0)
  }

  const refreshService = useCallback(async (): Promise<void> => {
    const result = await window.plexocall.getServiceHealth()
    setServiceHealth(result)
  }, [])

  const refreshManagedCalls = useCallback(async (): Promise<void> => {
    const result = await window.plexocall.listManagedCalls().catch(() => [])
    setManagedCalls(result)
  }, [])

  useEffect(() => {
    let cancelled = false
    const initialise = async (): Promise<void> => {
      const [loadedSettings, health, calls] = await Promise.all([
        window.plexocall.getSettings().catch(() => FALLBACK_SETTINGS),
        window.plexocall.getServiceHealth().catch(() => OFFLINE),
        window.plexocall.listManagedCalls().catch(() => [])
      ])
      if (cancelled) return
      setSettings(loadedSettings)
      setServiceHealth(health)
      setManagedCalls(calls)
    }
    void initialise()
    const interval = window.setInterval(() => void refreshService(), 25_000)
    const removeInviteListener = window.plexocall.onInviteReceived((invite) => {
      setPendingInvite(invite)
      setToast('Invitation received.')
      window.setTimeout(() => setToast(null), 2600)
    })
    return () => {
      cancelled = true
      window.clearInterval(interval)
      removeInviteListener()
    }
  }, [refreshManagedCalls, refreshService])

  useEffect(() => {
    try {
      if (displayName.trim()) localStorage.setItem('plexocall:display-name', displayName.trim())
    } catch {
      // Display-name convenience storage is optional.
    }
  }, [displayName])

  useEffect(() => {
    if (screen.kind !== 'home' || !pendingInvite) return
    setScreen({ kind: 'prejoin', flow: 'join', invite: pendingInvite })
    setPendingInvite(null)
    setHomeError(null)
  }, [pendingInvite, screen.kind])

  const requireName = (): boolean => {
    if (displayName.trim()) return true
    const message = 'Enter the name you want people in the call to see.'
    setHomeError(message)
    setPrejoinError(message)
    return false
  }

  const openCreate = (): void => {
    if (!requireName()) return
    setHomeError(null)
    setPrejoinError(null)
    setScreen({ kind: 'prejoin', flow: 'create' })
  }

  const openJoin = (invite: InviteReference): void => {
    if (!requireName()) return
    setHomeError(null)
    setPrejoinError(null)
    setScreen({ kind: 'prejoin', flow: 'join', invite })
  }

  const connect = async (media: MediaChoice): Promise<void> => {
    if (screen.kind !== 'prejoin') return
    if (!requireName()) return
    const operation = ++operationGeneration.current
    beginCallOperation()
    setPrejoinError(null)
    try {
      let credentials: CallCredentials
      let invite: InviteReference
      if (screen.flow === 'create') {
        credentials = await window.plexocall.createCall(displayName.trim())
        const parsedInvite = parseInviteLink(credentials.shareLink ?? '')
        if (!parsedInvite) throw new Error('The call service returned an invalid invitation.')
        invite = parsedInvite
      } else {
        invite = screen.invite
        credentials = await window.plexocall.joinCall(invite, displayName.trim())
        credentials = { ...credentials, shareLink: serializeInviteLink(invite) }
      }
      if (operation !== operationGeneration.current) {
        if (credentials.ownerSessionId) {
          await window.plexocall.endCall(credentials.ownerSessionId).catch(() => undefined)
          await refreshManagedCalls()
        }
        return
      }
      setScreen({ kind: 'call', credentials, media, invite })
      void refreshManagedCalls()
    } catch (error) {
      if (operation === operationGeneration.current) {
        setPrejoinError(error instanceof Error ? error.message : 'Could not prepare the call. Check the service and try again.')
      }
    } finally {
      finishCallOperation()
    }
  }

  const rejoin = async (): Promise<void> => {
    if (screen.kind !== 'call') return
    const operation = ++operationGeneration.current
    beginCallOperation()
    try {
      const renewed = await window.plexocall.joinCall(screen.invite, displayName.trim())
      if (operation !== operationGeneration.current) return
      setScreen({
        ...screen,
        credentials: {
          ...renewed,
          shareLink: screen.credentials.shareLink,
          ownerSessionId: screen.credentials.ownerSessionId
        }
      })
    } finally {
      finishCallOperation()
    }
  }

  const resumeManagedCall = async (ownerSessionId: string): Promise<void> => {
    if (!requireName()) return
    const operation = ++operationGeneration.current
    beginCallOperation()
    setHomeError(null)
    try {
      const credentials = await window.plexocall.resumeManagedCall(ownerSessionId, displayName.trim())
      if (operation !== operationGeneration.current) return
      const invite = parseInviteLink(credentials.shareLink ?? '')
      if (!invite) throw new Error('The saved call invitation could not be restored.')
      setScreen({
        kind: 'call',
        credentials,
        invite,
        media: { microphoneEnabled: false, cameraEnabled: false, microphoneDeviceId: '', cameraDeviceId: '' }
      })
    } catch (error) {
      if (operation === operationGeneration.current) {
        setHomeError(error instanceof Error ? error.message : 'Could not reopen the saved call.')
      }
    } finally {
      finishCallOperation()
    }
  }

  const endManagedCall = async (ownerSessionId: string): Promise<void> => {
    setBusy(true)
    setHomeError(null)
    try {
      await window.plexocall.endCall(ownerSessionId)
      await refreshManagedCalls()
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : 'Could not end the saved call.')
    } finally {
      setBusy(false)
    }
  }

  const saveEndpoint = async (url: string): Promise<void> => {
    const updated = await window.plexocall.saveControlApiUrl(url)
    setSettings(updated)
    await refreshService()
  }

  const returnHome = (): void => {
    operationGeneration.current += 1
    setScreen({ kind: 'home' })
    setHomeError(null)
    setPrejoinError(null)
    void refreshService()
    void refreshManagedCalls()
  }

  if (screen.kind === 'prejoin') {
    return (
      <>
        <Prejoin
          flow={screen.flow}
          invite={screen.flow === 'join' ? screen.invite : undefined}
          displayName={displayName}
          serviceHealth={serviceHealth}
          busy={busy}
          error={prejoinError}
          onBack={returnHome}
          onJoin={(media) => void connect(media)}
        />
        {toast && <div className="app-toast" role="status">{toast}</div>}
      </>
    )
  }

  if (screen.kind === 'call') {
    return (
      <>
        <CallRoom
          key={screen.credentials.participantToken}
          credentials={screen.credentials}
          media={screen.media}
          rejoining={busy}
          onRejoin={rejoin}
          onLeave={returnHome}
        />
        {toast && <div className="app-toast" role="status">{toast}</div>}
      </>
    )
  }

  return (
    <>
      <CallHome
        displayName={displayName}
        onDisplayNameChange={(value) => {
          setDisplayName(value)
          setHomeError(null)
        }}
        controlApiUrl={settings.controlApiUrl}
        serviceHealth={serviceHealth}
        managedCalls={managedCalls}
        busy={busy}
        error={homeError}
        onCreateCall={openCreate}
        onJoinCall={openJoin}
        onResumeManagedCall={(ownerSessionId) => void resumeManagedCall(ownerSessionId)}
        onEndManagedCall={(ownerSessionId) => void endManagedCall(ownerSessionId)}
        onSaveControlApiUrl={saveEndpoint}
        onRefreshService={() => void refreshService()}
      />
      {toast && <div className="app-toast" role="status">{toast}</div>}
    </>
  )
}
