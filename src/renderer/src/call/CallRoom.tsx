import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  AlertCircle,
  Check,
  Copy,
  DoorOpen,
  LoaderCircle,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ShieldCheck,
  Users,
  Video,
  VideoOff
} from 'lucide-react'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useConnectionState,
  useParticipants,
  useRoomContext,
  useTrackToggle
} from '@livekit/components-react'
import { ConnectionState, Track } from 'livekit-client'
import type { CallCredentials } from '@shared/call-contract'
import type { MediaChoice } from './Prejoin'
import { ConnectionStatus } from './ConnectionStatus'
import { formatMetric, initials, NO_CALL_DIAGNOSTICS, readCallDiagnostics, type CallDiagnostics, type CounterSample } from './callState'
import { ParticipantGrid } from './ParticipantGrid'

export interface CallRoomProps {
  credentials: CallCredentials
  media: MediaChoice
  rejoining: boolean
  onLeave(): void
  onRejoin(): Promise<void>
}

export function CallRoom({ credentials, media, rejoining, onLeave, onRejoin }: CallRoomProps): React.JSX.Element {
  const [connectedAt, setConnectedAt] = useState<number | null>(null)
  const [callError, setCallError] = useState<string | null>(null)
  const audio = media.microphoneEnabled
    ? media.microphoneDeviceId
      ? { deviceId: media.microphoneDeviceId }
      : true
    : false
  const video = media.cameraEnabled
    ? media.cameraDeviceId
      ? { deviceId: media.cameraDeviceId, resolution: { width: 1280, height: 720 } }
      : { resolution: { width: 1280, height: 720 } }
    : false

  return (
    <main className="main-area">
      <LiveKitRoom
        serverUrl={credentials.serverUrl}
        token={credentials.participantToken}
        connect
        audio={audio}
        video={video}
        options={{ adaptiveStream: true, dynacast: true }}
        onConnected={() => {
          setConnectedAt((current) => current ?? Date.now())
          setCallError(null)
        }}
        onDisconnected={() => setCallError('The connection ended. Try again to rejoin the room.')}
        onError={() => setCallError('Could not connect to the media service. Check your network or try the invitation again.')}
        onMediaDeviceFailure={(_failure, kind) => {
          setCallError(kind === 'audioinput'
            ? 'The selected microphone is unavailable. Leave the room, then rejoin and choose another device.'
            : 'The selected camera is unavailable. Leave the room, then rejoin and choose another device.')
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <RoomExperience
          credentials={credentials}
          connectedAt={connectedAt}
          callError={callError}
          rejoining={rejoining}
          onClearError={() => setCallError(null)}
          onLeave={onLeave}
          onRejoin={onRejoin}
        />
      </LiveKitRoom>
    </main>
  )
}

function RoomExperience({
  credentials,
  connectedAt,
  callError,
  rejoining,
  onClearError,
  onLeave,
  onRejoin
}: {
  credentials: CallCredentials
  connectedAt: number | null
  callError: string | null
  rejoining: boolean
  onClearError(): void
  onLeave(): void
  onRejoin(): Promise<void>
}): React.JSX.Element {
  const room = useRoomContext()
  const connectionState = useConnectionState()
  const participants = useParticipants()
  const remoteParticipants = participants.filter((participant) => !participant.isLocal)
  const microphone = useTrackToggle({ source: Track.Source.Microphone })
  const camera = useTrackToggle({ source: Track.Source.Camera })
  const screen = useTrackToggle({ source: Track.Source.ScreenShare })
  const [diagnostics, setDiagnostics] = useState<CallDiagnostics>(NO_CALL_DIAGNOSTICS)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [ending, setEnding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const counterSample = useRef<CounterSample | null>(null)
  const isOwner = Boolean(credentials.ownerSessionId)

  useEffect(() => {
    if (!connectedAt) return
    const update = (): void => setElapsed(Math.max(0, Math.floor((Date.now() - connectedAt) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [connectedAt])

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) {
      counterSample.current = null
      setDiagnostics(NO_CALL_DIAGNOSTICS)
      return
    }
    let cancelled = false
    let sampling = false
    const sample = async (): Promise<void> => {
      if (sampling) return
      sampling = true
      try {
        const result = await readCallDiagnostics(room, counterSample.current)
        if (cancelled) return
        counterSample.current = result.counters
        setDiagnostics(result.diagnostics)
      } catch {
        if (!cancelled) setDiagnostics(NO_CALL_DIAGNOSTICS)
      } finally {
        sampling = false
      }
    }
    void sample()
    const timer = window.setInterval(() => void sample(), 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [connectionState, room])

  const leave = (): void => {
    room.disconnect()
    onLeave()
  }

  const endForEveryone = async (): Promise<void> => {
    if (!credentials.ownerSessionId) return leave()
    setEnding(true)
    setActionError(null)
    try {
      await window.plexocall.endCall(credentials.ownerSessionId)
      room.disconnect()
      onLeave()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The room could not be ended. Check the call service.')
      setEnding(false)
    }
  }

  const tryRejoin = async (): Promise<void> => {
    setActionError(null)
    try {
      await onRejoin()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The call could not be rejoined. Check the invitation and service.')
    }
  }

  const copyInvite = async (): Promise<void> => {
    if (!credentials.shareLink) return
    try {
      await navigator.clipboard.writeText(credentials.shareLink)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1800)
    } catch {
      setCopyState('failed')
      window.setTimeout(() => setCopyState('idle'), 2200)
    }
  }

  const duration = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const participantsLabel = `${participants.length} ${participants.length === 1 ? 'person' : 'people'}`

  return (
    <div className="call-shell">
      <header className="call-header">
        <div className="call-heading">
          <div className="call-mark"><Activity aria-hidden="true" /></div>
          <div className="call-title-group">
            <h1>Private call room</h1>
            <div className="call-subline"><span>{duration}</span><span className="separator">·</span><span>{participantsLabel}</span><span className="separator">·</span><span>Room {credentials.callId.slice(0, 8)}</span></div>
          </div>
        </div>
        <ConnectionStatus state={connectionState} />
      </header>

      <div className="call-body">
        <section className="stage" aria-label="Call stage">
          <div className="stage-topbar">
            <div className="stage-label"><Users aria-hidden="true" /> Conversation</div>
            <div className="stage-info">UP TO 8 PEOPLE · LIVE MEDIA</div>
          </div>
          {connectionState === ConnectionState.Connecting && (
            <div className="stage-loading"><span className="spinner" /><span>Connecting to the call service…</span></div>
          )}
          <ParticipantGrid localParticipant={room.localParticipant} remoteParticipants={remoteParticipants} />
          <RoomAudioRenderer />
          <StartAudio className="start-audio-button" label="Enable call audio">Enable call audio</StartAudio>
          <div className="control-row" aria-label="Call controls">
            <button
              type="button"
              {...microphone.buttonProps}
              className={`call-control ${microphone.enabled ? '' : 'off'}`}
              aria-label={microphone.enabled ? 'Mute microphone' : 'Unmute microphone'}
              title={microphone.enabled ? 'Mute microphone' : 'Unmute microphone'}
            >
              {microphone.enabled ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
              <span>{microphone.enabled ? 'Mute' : 'Unmute'}</span>
            </button>
            <button
              type="button"
              {...camera.buttonProps}
              className={`call-control ${camera.enabled ? '' : 'off'}`}
              aria-label={camera.enabled ? 'Turn camera off' : 'Turn camera on'}
              title={camera.enabled ? 'Turn camera off' : 'Turn camera on'}
            >
              {camera.enabled ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}
              <span>{camera.enabled ? 'Camera' : 'Camera off'}</span>
            </button>
            <button
              type="button"
              {...screen.buttonProps}
              className={`call-control ${screen.enabled ? 'share-active' : ''}`}
              aria-label={screen.enabled ? 'Stop sharing screen' : 'Share screen'}
              title={screen.enabled ? 'Stop sharing screen' : 'Share screen'}
            >
              {screen.enabled ? <MonitorUp aria-hidden="true" /> : <MonitorUp aria-hidden="true" />}
              <span>{screen.enabled ? 'Sharing' : 'Share screen'}</span>
            </button>
            <button className="call-control" type="button" onClick={leave}>
              <DoorOpen aria-hidden="true" /><span>Leave call</span>
            </button>
            {isOwner && (
              <button
                className="call-control leave"
                type="button"
                onClick={() => {
                  if (window.confirm('End this call for everyone in the room?')) void endForEveryone()
                }}
                disabled={ending}
              >
                {ending ? <LoaderCircle aria-hidden="true" /> : <PhoneOff aria-hidden="true" />}
                <span>{ending ? 'Ending…' : 'End for everyone'}</span>
              </button>
            )}
          </div>
        </section>

        <aside className="side-panels" aria-label="Call details">
          <section className="side-panel">
            <div className="side-panel-head"><h2>In this room</h2><span className="count-chip">{participants.length}</span></div>
            <div className="people-list">
              {participants.map((participant) => (
                <div className="person-row" key={participant.identity}>
                  <div className="person-avatar" aria-hidden="true">{initials(participant.name || participant.identity)}</div>
                  <div className="person-copy"><strong>{participant.name || participant.identity}{participant.isLocal ? ' · You' : ''}</strong><span>{participant.isLocal ? 'On this device' : 'Connected'}</span></div>
                  <span className="person-state" aria-hidden="true" />
                </div>
              ))}
            </div>
          </section>

          <section className="side-panel" aria-labelledby="diagnostics-title">
            <div className="side-panel-head"><h2 id="diagnostics-title">Connection details</h2><Activity size={14} color="#718096" aria-hidden="true" /></div>
            <div className="diagnostics">
              <Diagnostic label="Round-trip" value={formatMetric(diagnostics.roundTripMs, ' ms')} tone={diagnostics.roundTripMs === null ? undefined : diagnostics.roundTripMs > 250 ? 'warn' : 'good'} />
              <Diagnostic label="Jitter" value={formatMetric(diagnostics.jitterMs, ' ms', 1)} tone={diagnostics.jitterMs === null ? undefined : diagnostics.jitterMs > 30 ? 'warn' : 'good'} />
              <Diagnostic label="Packet loss" value={formatMetric(diagnostics.lossPercent, '%', 2)} tone={diagnostics.lossPercent === null ? undefined : diagnostics.lossPercent > 1 ? 'warn' : 'good'} />
              <Diagnostic label="Sending" value={formatRate(diagnostics.sendKbps)} />
              <Diagnostic label="Receiving" value={formatRate(diagnostics.receiveKbps)} />
              <Diagnostic label="ICE route" value={diagnostics.iceRoute ?? 'Unavailable'} />
            </div>
            <p className="diagnostic-foot">Live WebRTC estimates. Route labels hide IP addresses. Values may be unavailable on some devices.</p>
          </section>

          <section className="side-panel invite-panel">
            <h2>{credentials.shareLink ? 'Invite someone' : 'Call invitation'}</h2>
            <p>{credentials.shareLink ? 'Anyone with this link can join until it expires or you end the call.' : 'Ask the call creator to share the room invitation with you.'}</p>
            {credentials.shareLink && (
              <div className="invite-copy">
                <input className="text-input mono" readOnly value={credentials.shareLink} aria-label="Call invitation link" />
                <button type="button" onClick={() => void copyInvite()} aria-label="Copy call invitation">
                  {copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                </button>
              </div>
            )}
          </section>

          <div className="call-note"><ShieldCheck aria-hidden="true" /><span>Media is encrypted in transit. Your self-hosted media server relays the call and can access media unless app-level end-to-end encryption is added.</span></div>
          {(callError || actionError || connectionState === ConnectionState.Disconnected) && (
            <div className="inline-error" role="alert">
              <AlertCircle aria-hidden="true" />
              <span>{actionError ?? callError ?? 'The connection ended. Rejoin the room to continue.'}</span>
              {connectionState === ConnectionState.Disconnected && (
                <button className="secondary-button" type="button" onClick={() => void tryRejoin()} disabled={rejoining}>
                  {rejoining ? <LoaderCircle aria-hidden="true" /> : <Activity aria-hidden="true" />}
                  {rejoining ? 'Rejoining…' : 'Try again'}
                </button>
              )}
              {(actionError || callError) && (
                <button className="quiet-button" type="button" onClick={() => { setActionError(null); onClearError() }}>Dismiss</button>
              )}
            </div>
          )}
          {copyState === 'failed' && <p className="form-note" role="status">Clipboard access was blocked. Select and copy the invitation link.</p>}
        </aside>
      </div>
    </div>
  )
}

function Diagnostic({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }): React.JSX.Element {
  return <div className="diagnostic-row"><span>{label}</span><strong className={tone}>{value}</strong></div>
}

function formatRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable'
  return value >= 1000 ? `${(value / 1000).toFixed(1)} Mbps` : `${value.toFixed(0)} Kbps`
}
