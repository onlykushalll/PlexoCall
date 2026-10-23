import { CameraOff, MicOff, MonitorUp } from 'lucide-react'
import { Track, type Participant } from 'livekit-client'
import { useTracks, VideoTrack, type TrackReference } from '@livekit/components-react'
import { initials } from './callState'

type MediaTrackRef = TrackReference

function ParticipantTile({ participant, track }: {
  participant: Participant
  track?: MediaTrackRef
}): React.JSX.Element {
  const mic = participant.getTrackPublication(Track.Source.Microphone)
  const camera = participant.getTrackPublication(Track.Source.Camera)
  const activeCamera = track?.source === Track.Source.Camera
  return (
    <article className="participant-tile" aria-label={`${participant.name || participant.identity}${participant.isLocal ? ', you' : ''}`}>
      {activeCamera ? <VideoTrack trackRef={track} className="participant-video" /> : (
        <div className={`participant-avatar ${participant.isLocal ? 'local' : ''}`} aria-hidden="true">
          {initials(participant.name || participant.identity)}
        </div>
      )}
      <div className="participant-bottom">
        <span className="participant-name">{participant.name || participant.identity}{participant.isLocal ? ' · You' : ''}</span>
        <span className="participant-badges" aria-label={`${mic && !mic.isMuted ? 'Microphone on' : 'Microphone off'}${camera && !camera.isMuted ? ', camera on' : ', camera off'}`}>
          {(!mic || mic.isMuted) && <MicOff aria-hidden="true" />}
          {(!camera || camera.isMuted) && <CameraOff aria-hidden="true" />}
        </span>
      </div>
    </article>
  )
}

export function ParticipantGrid({ localParticipant, remoteParticipants }: {
  localParticipant: Participant
  remoteParticipants: Participant[]
}): React.JSX.Element {
  const trackRefs = useTracks([Track.Source.Camera, Track.Source.ScreenShare])
  const participants = [localParticipant, ...remoteParticipants]
  const cameraTrack = (participant: Participant): MediaTrackRef | undefined =>
    trackRefs.find((reference) => reference.participant.identity === participant.identity && reference.source === Track.Source.Camera)
  const screenTracks = trackRefs.filter((reference) => reference.source === Track.Source.ScreenShare)

  return (
    <div className="participant-grid">
      {participants.map((participant) => (
        <ParticipantTile key={participant.identity} participant={participant} track={cameraTrack(participant)} />
      ))}
      {remoteParticipants.length === 0 && screenTracks.length === 0 && (
        <div className="waiting-card waiting-banner">
          <div className="waiting-orbit"><MonitorUp aria-hidden="true" /></div>
          <strong>Your room is ready</strong>
          <span>Share the invitation when you want someone to join.</span>
        </div>
      )}
      {screenTracks.map((trackRef) => (
        <article className="participant-tile" key={`screen-${trackRef.participant.identity}`}>
          <VideoTrack trackRef={trackRef} className="participant-video" />
          <div className="participant-bottom">
            <span className="participant-name">{trackRef.participant.name || trackRef.participant.identity} · screen</span>
            <span className="participant-badges"><MonitorUp aria-label="Screen is shared" /></span>
          </div>
        </article>
      ))}
      {remoteParticipants.length === 0 && <div className="sr-only">No other participants have joined yet.</div>}
    </div>
  )
}
