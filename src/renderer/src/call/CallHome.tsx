import { useState } from 'react'
import {
  Activity,
  ArrowRight,
  AudioLines,
  ChevronRight,
  CircleHelp,
  Copy,
  Link2,
  LockKeyhole,
  PhoneOff,
  Plus,
  Radio,
  Settings2,
  ShieldCheck,
  Video
} from 'lucide-react'
import type { InviteReference, ManagedCall, ServiceHealth } from '@shared/call-contract'
import { parseInviteLink } from '@shared/invites'

interface CallHomeProps {
  displayName: string
  onDisplayNameChange(value: string): void
  controlApiUrl: string
  serviceHealth: ServiceHealth
  managedCalls: ManagedCall[]
  busy: boolean
  error: string | null
  onCreateCall(): void
  onJoinCall(invite: InviteReference): void
  onResumeManagedCall(ownerSessionId: string): void
  onEndManagedCall(ownerSessionId: string): void
  onSaveControlApiUrl(url: string): Promise<void>
  onRefreshService(): void
}

export function CallHome({
  displayName,
  onDisplayNameChange,
  controlApiUrl,
  serviceHealth,
  managedCalls,
  busy,
  error,
  onCreateCall,
  onJoinCall,
  onResumeManagedCall,
  onEndManagedCall,
  onSaveControlApiUrl,
  onRefreshService
}: CallHomeProps): React.JSX.Element {
  const [inviteText, setInviteText] = useState('')
  const [endpointDraft, setEndpointDraft] = useState(controlApiUrl)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [savingEndpoint, setSavingEndpoint] = useState(false)

  const startJoin = (): void => {
    const invite = parseInviteLink(inviteText)
    if (!invite) {
      setJoinError('Paste a complete Plexocall invitation link.')
      return
    }
    setJoinError(null)
    onJoinCall(invite)
  }

  const pasteInvite = async (): Promise<void> => {
    try {
      setInviteText(await navigator.clipboard.readText())
      setJoinError(null)
    } catch {
      setJoinError('Clipboard access was blocked. Paste the invitation into the field.')
    }
  }

  const saveEndpoint = async (): Promise<void> => {
    setSavingEndpoint(true)
    setSettingsMessage(null)
    try {
      await onSaveControlApiUrl(endpointDraft)
      setSettingsMessage('Service address saved.')
    } catch (saveError) {
      setSettingsMessage(saveError instanceof Error ? saveError.message : 'Could not save the service address.')
    } finally {
      setSavingEndpoint(false)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="Plexocall">
          <div className="brand-mark" aria-hidden="true" />
          <div className="brand-name">plexo<span>call</span></div>
        </div>

        <p className="sidebar-caption">Your calling space</p>
        <nav className="side-nav" aria-label="Main navigation">
          <button className="side-nav-item active" type="button" aria-current="page">
            <Video aria-hidden="true" /> Calls
          </button>
          <button className="side-nav-item" type="button" onClick={onRefreshService}>
            <Activity aria-hidden="true" /> Service status
          </button>
        </nav>

        <div className="sidebar-spacer" />
        <section className="sidebar-node" aria-label="Self-hosted call service">
          <div className="node-top">
            <span>Call service</span>
            <span className={`node-dot ${serviceHealth.ready ? 'ready' : 'down'}`} aria-hidden="true" />
          </div>
          <div className="node-address" title={controlApiUrl}>{controlApiUrl}</div>
          <button
            className="node-manage"
            type="button"
            onClick={() => {
              setEndpointDraft(controlApiUrl)
              setSettingsOpen((open) => !open)
            }}
            aria-expanded={settingsOpen}
          >
            <Settings2 aria-hidden="true" /> Configure service
          </button>
        </section>
        <p className="sidebar-foot">Windows preview · Calls stay on your chosen service</p>
      </aside>

      <main className="main-area">
        <div className="page-wrap">
          <header className="page-topline">
            <div>
              <p className="eyebrow"><span className="eyebrow-dot" /> Private rooms, direct invites</p>
              <h1 className="page-title">A little more room to talk.</h1>
              <p className="page-subtitle">Start a voice or video room, then invite people you trust. Your calls run through the service you choose.</p>
            </div>
            <div className="header-side">
              <label className="profile-field">
                <span>Your name in calls</span>
                <input
                  className="text-input"
                  value={displayName}
                  onChange={(event) => onDisplayNameChange(event.target.value)}
                  maxLength={40}
                  autoComplete="name"
                  placeholder="How people will see you"
                />
              </label>
              <div className="local-chip"><ShieldCheck aria-hidden="true" /> No account required</div>
            </div>
          </header>

          {error && <div className="inline-error home-error" role="alert"><CircleHelp aria-hidden="true" />{error}</div>}

          <section className="home-hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <div className="hero-kicker"><AudioLines aria-hidden="true" /> Your room. Your network.</div>
              <h2 id="hero-title" className="hero-title">Good calls start with a clear signal.</h2>
              <p>Bring people into one room for a focused conversation, a quick screen share, or a longer catch-up.</p>
              <button className="primary-button" type="button" onClick={onCreateCall} disabled={busy || !serviceHealth.ready}>
                {busy ? <span className="spinner" aria-hidden="true" /> : <Plus aria-hidden="true" />}
                {busy ? 'Preparing your room' : 'Start a new call'}
                {!busy && <ArrowRight aria-hidden="true" />}
              </button>
            </div>
            <div className="path-illustration" aria-hidden="true">
              <div className="path-card">
                <div className="path-endpoint"><AudioLines /></div>
                <div className="path-copy"><strong>Your device</strong><span>MIC · CAMERA · SCREEN</span></div>
                <div className="path-state"><span className={`node-dot ${serviceHealth.ready ? 'ready' : 'down'}`} />{serviceHealth.ready ? 'READY' : 'OFFLINE'}</div>
              </div>
              <div className="path-line" />
              <span className="path-pulse" />
              <div className="path-card" style={{ transform: 'translateY(57px)' }}>
                <div className="path-endpoint"><Radio /></div>
                <div className="path-copy"><strong>Private call room</strong><span>ENCRYPTED WEBRTC MEDIA</span></div>
                <div className="path-state"><span className={`node-dot ${serviceHealth.ready ? 'ready' : 'down'}`} />{serviceHealth.ready ? 'ONLINE' : 'WAITING'}</div>
              </div>
            </div>
          </section>

          {managedCalls.length > 0 && (
            <section className="panel managed-panel" aria-labelledby="managed-title">
              <div className="panel-heading">
                <div>
                  <h2 id="managed-title">Calls you manage</h2>
                  <p>Reopen a saved room or end it for everyone. Your camera and microphone start off when reopening.</p>
                </div>
                <ShieldCheck size={17} color="#718096" aria-hidden="true" />
              </div>
              <div className="managed-list">
                {managedCalls.map((call) => (
                  <div className="managed-row" key={call.ownerSessionId}>
                    <div className="managed-copy">
                      <strong>Room {call.callId.slice(0, 8)}</strong>
                      <span>{call.expiresAt ? `Expires ${new Date(call.expiresAt).toLocaleString()}` : 'Saved by an earlier app version'}</span>
                    </div>
                    <div className="managed-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busy || !serviceHealth.ready || !call.canRejoin}
                        title={call.canRejoin ? 'Reopen this room with camera and microphone off' : 'This saved control can end the room but cannot reopen it'}
                        onClick={() => onResumeManagedCall(call.ownerSessionId)}
                      >
                        <Video aria-hidden="true" /> Reopen
                      </button>
                      <button
                        className="quiet-button"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm('End this call for everyone in the room?')) onEndManagedCall(call.ownerSessionId)
                        }}
                      >
                        <PhoneOff aria-hidden="true" /> End
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="home-grid">
            <section className="panel" aria-labelledby="join-title">
              <div className="panel-heading">
                <div>
                  <h2 id="join-title">Join an existing call</h2>
                  <p>Paste the invite you received. Only people with the link can enter.</p>
                </div>
                <Link2 size={17} color="#718096" aria-hidden="true" />
              </div>
              <div className="join-form">
                <label className="field-label">
                  Invitation link
                  <input
                    className="text-input mono"
                    value={inviteText}
                    onChange={(event) => {
                      setInviteText(event.target.value)
                      setJoinError(null)
                    }}
                    placeholder="plexocall://join/…?invite=…"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') startJoin()
                    }}
                  />
                </label>
                {joinError && <div className="inline-error" role="alert"><CircleHelp aria-hidden="true" />{joinError}</div>}
                <div className="join-action-row">
                  <p className="form-note">Calls expire after 12 hours. Links can be revoked by their creator.</p>
                  <div style={{ display: 'flex', gap: 7 }}>
                    <button className="secondary-button" type="button" onClick={() => void pasteInvite()} aria-label="Paste invitation">
                      <Copy aria-hidden="true" /> Paste
                    </button>
                    <button className="primary-button" type="button" onClick={startJoin} disabled={busy || !serviceHealth.ready}>
                      Join <ChevronRight aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="panel service-card" aria-labelledby="service-title">
              <div className="service-card-head">
                <h2 id="service-title">Your call service</h2>
                <span className={`service-badge ${serviceHealth.ready ? 'ready' : 'down'}`}>
                  <span className={`node-dot ${serviceHealth.ready ? 'ready' : 'down'}`} />
                  {serviceHealth.ready ? 'Ready' : 'Offline'}
                </span>
              </div>
              <div className="service-details">
                <div className="service-row"><span>Control endpoint</span><strong title={controlApiUrl}>{controlApiUrl}</strong></div>
                <div className="service-row"><span>Media</span><strong>WebRTC · self-hosted</strong></div>
                <div className="service-row"><span>Accounts</span><strong>Not required</strong></div>
              </div>
              {settingsOpen ? (
                <div className="settings-form">
                  <label className="field-label">
                    Control service URL
                    <input
                      className="text-input mono"
                      value={endpointDraft}
                      onChange={(event) => setEndpointDraft(event.target.value)}
                      placeholder="https://calls.example.net"
                      autoCapitalize="off"
                      autoCorrect="off"
                    />
                  </label>
                  {settingsMessage && <p className="form-note" role="status">{settingsMessage}</p>}
                  <div className="settings-actions">
                    <button className="quiet-button" type="button" onClick={() => setSettingsOpen(false)}>Close</button>
                    <button className="secondary-button" type="button" onClick={() => void saveEndpoint()} disabled={savingEndpoint}>
                      {savingEndpoint ? 'Saving…' : 'Save address'}
                    </button>
                  </div>
                </div>
              ) : (
                <button className="settings-trigger" type="button" onClick={() => setSettingsOpen(true)}>
                  <Settings2 aria-hidden="true" /> Change service address <ChevronRight aria-hidden="true" />
                </button>
              )}
              <div className="service-actions">
                <button className="quiet-button" type="button" onClick={onRefreshService}><Activity aria-hidden="true" /> Check again</button>
              </div>
            </section>
          </div>

          <div className="privacy-note"><LockKeyhole aria-hidden="true" /><span><strong>Private by invitation.</strong> Calls use encrypted WebRTC media. The self-hosted media service relays your traffic; Plexocall does not record or transcribe calls.</span></div>
        </div>
      </main>
    </div>
  )
}
