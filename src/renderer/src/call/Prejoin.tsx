import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Camera, CameraOff, Headphones, Mic, MicOff, Video } from 'lucide-react'
import type { InviteReference, ServiceHealth } from '@shared/call-contract'

export interface MediaChoice {
  microphoneEnabled: boolean
  cameraEnabled: boolean
  microphoneDeviceId: string
  cameraDeviceId: string
}

export interface PrejoinProps {
  flow: 'create' | 'join'
  invite?: InviteReference
  displayName: string
  serviceHealth: ServiceHealth
  busy: boolean
  error: string | null
  onBack(): void
  onJoin(media: MediaChoice): void
}

function describeMediaError(error: unknown): string {
  if (!(error instanceof DOMException)) return 'Camera or microphone could not start. Check that Windows can access the device.'
  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera or microphone access is blocked. Allow access in Windows Settings, then try again.'
    case 'NotFoundError':
      return 'No matching camera or microphone was found. You can still join with both turned off.'
    case 'NotReadableError':
      return 'Another app may be using this device. Close it or choose a different device.'
    case 'OverconstrainedError':
      return 'That device is unavailable. Choose another camera or microphone.'
    default:
      return 'Camera or microphone could not start. Check device access and try again.'
  }
}

export function Prejoin({
  flow,
  displayName,
  serviceHealth,
  busy,
  error,
  onBack,
  onJoin
}: PrejoinProps): React.JSX.Element {
  const videoElement = useRef<HTMLVideoElement>(null)
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState('')
  const [cameraDeviceId, setCameraDeviceId] = useState('')
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null

    const refreshDevices = async (): Promise<void> => {
      if (!navigator.mediaDevices?.enumerateDevices) return
      const devices = await navigator.mediaDevices.enumerateDevices()
      if (cancelled) return
      setMicrophones(devices.filter((device) => device.kind === 'audioinput'))
      setCameras(devices.filter((device) => device.kind === 'videoinput'))
    }

    const openPreview = async (): Promise<void> => {
      if (!microphoneEnabled && !cameraEnabled) {
        setPreviewStream(null)
        setPreviewError(null)
        await refreshDevices().catch(() => undefined)
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setPreviewError('This Windows session does not expose camera and microphone capture.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: microphoneEnabled
            ? microphoneDeviceId
              ? { deviceId: { exact: microphoneDeviceId } }
              : true
            : false,
          video: cameraEnabled
            ? cameraDeviceId
              ? { deviceId: { exact: cameraDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
              : { width: { ideal: 1280 }, height: { ideal: 720 } }
            : false
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        setPreviewStream(stream)
        setPreviewError(null)
        await refreshDevices()
      } catch (captureError) {
        stream?.getTracks().forEach((track) => track.stop())
        stream = null
        if (!cancelled) {
          setPreviewStream(null)
          setPreviewError(describeMediaError(captureError))
          await refreshDevices().catch(() => undefined)
        }
      }
    }

    void openPreview()
    const onDevicesChanged = (): void => void refreshDevices().catch(() => undefined)
    navigator.mediaDevices?.addEventListener?.('devicechange', onDevicesChanged)

    return () => {
      cancelled = true
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDevicesChanged)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [cameraDeviceId, cameraEnabled, microphoneDeviceId, microphoneEnabled])

  useEffect(() => {
    const element = videoElement.current
    if (!element) return
    element.srcObject = previewStream
    if (previewStream) void element.play().catch(() => undefined)
    return () => {
      if (element.srcObject === previewStream) element.srcObject = null
    }
  }, [previewStream])

  const deviceLabel = (device: MediaDeviceInfo, index: number, fallback: string): string =>
    device.label || `${fallback} ${index + 1}`

  return (
    <main className="main-area">
      <div className="prejoin-wrap">
        <section className="prejoin-card" aria-labelledby="prejoin-title">
          <div className="prejoin-preview">
            {cameraEnabled && previewStream?.getVideoTracks().length ? (
              <video ref={videoElement} className="preview-video" autoPlay muted playsInline aria-label="Camera preview" />
            ) : (
              <div className="preview-placeholder" aria-label="Camera preview is off">
                {displayName.trim().slice(0, 1).toUpperCase() || 'P'}
              </div>
            )}
            <div className="preview-caption">
              <span>{displayName.trim() || 'You'}</span>
              <span>{cameraEnabled && previewStream?.getVideoTracks().length ? 'Preview only' : 'Camera off'}</span>
            </div>
          </div>

          <div className="prejoin-form">
            <button className="back-link" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" /> Back</button>
            <div>
              <p className="eyebrow"><span className="eyebrow-dot" /> {flow === 'create' ? 'New private room' : 'Invitation received'}</p>
              <h1 id="prejoin-title">Ready to join?</h1>
            </div>
            <p>Check your devices first. You can turn your camera or microphone off at any time.</p>

            <div className="permission-row">
              <button
                className={`permission-toggle ${microphoneEnabled ? 'selected' : ''}`}
                type="button"
                aria-pressed={microphoneEnabled}
                onClick={() => setMicrophoneEnabled((enabled) => !enabled)}
              >
                {microphoneEnabled ? <Mic /> : <MicOff />}
                Microphone {microphoneEnabled ? 'on' : 'off'}
              </button>
              <button
                className={`permission-toggle ${cameraEnabled ? 'selected' : ''}`}
                type="button"
                aria-pressed={cameraEnabled}
                onClick={() => setCameraEnabled((enabled) => !enabled)}
              >
                {cameraEnabled ? <Camera /> : <CameraOff />}
                Camera {cameraEnabled ? 'on' : 'off'}
              </button>
            </div>

            <label className="device-field">
              <span><Headphones size={13} aria-hidden="true" /> Microphone</span>
              <select className="select-input" value={microphoneDeviceId} onChange={(event) => setMicrophoneDeviceId(event.target.value)} disabled={!microphoneEnabled}>
                <option value="">Default microphone</option>
                {microphones.map((device, index) => <option key={device.deviceId || `mic-${index}`} value={device.deviceId}>{deviceLabel(device, index, 'Microphone')}</option>)}
              </select>
            </label>

            <label className="device-field">
              <span><Video size={13} aria-hidden="true" /> Camera</span>
              <select className="select-input" value={cameraDeviceId} onChange={(event) => setCameraDeviceId(event.target.value)} disabled={!cameraEnabled}>
                <option value="">Default camera</option>
                {cameras.map((device, index) => <option key={device.deviceId || `camera-${index}`} value={device.deviceId}>{deviceLabel(device, index, 'Camera')}</option>)}
              </select>
            </label>

            {(previewError || error || !serviceHealth.ready) && (
              <div className="inline-error" role="status">
                <CircleHelpIcon />
                {error ?? previewError ?? serviceHealth.message ?? 'Call service is offline.'}
              </div>
            )}

            <div className="prejoin-spacer" />
            <div className="prejoin-bottom">
              <button
                className="primary-button"
                type="button"
                onClick={() => onJoin({ microphoneEnabled, cameraEnabled, microphoneDeviceId, cameraDeviceId })}
                disabled={busy || !serviceHealth.ready}
              >
                {busy ? <span className="spinner" aria-hidden="true" /> : <Video aria-hidden="true" />}
                {busy ? 'Connecting…' : flow === 'create' ? 'Create room and join' : 'Join call'}
              </button>
              <p className="form-note">Your preview stays on this device until you join.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function CircleHelpIcon(): React.JSX.Element {
  return <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 14, height: 14, border: '1px solid currentColor', borderRadius: '50%', fontSize: 9, fontWeight: 700 }}>i</span>
}
