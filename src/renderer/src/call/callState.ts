import type { Room, Track as LiveKitTrack } from 'livekit-client'

export interface CallDiagnostics {
  roundTripMs: number | null
  jitterMs: number | null
  lossPercent: number | null
  sendKbps: number | null
  receiveKbps: number | null
  iceRoute: string | null
  available: boolean
}

export interface CounterSample {
  at: number
  sentBytes: number
  receivedBytes: number
}

type StatRow = Record<string, unknown> & { id?: string; type?: string }

const emptyDiagnostics: CallDiagnostics = {
  roundTripMs: null,
  jitterMs: null,
  lossPercent: null,
  sendKbps: null,
  receiveKbps: null,
  iceRoute: null,
  available: false
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function allMediaTracks(room: Room): LiveKitTrack[] {
  const publications = [
    ...room.localParticipant.trackPublications.values(),
    ...Array.from(room.remoteParticipants.values()).flatMap((participant) => [
      ...participant.trackPublications.values()
    ])
  ]
  return publications.flatMap((publication) => (publication.track ? [publication.track] : []))
}

export async function readCallDiagnostics(
  room: Room,
  previous: CounterSample | null,
  at = Date.now()
): Promise<{ diagnostics: CallDiagnostics; counters: CounterSample | null }> {
  const tracks = allMediaTracks(room)
  if (tracks.length === 0) return { diagnostics: emptyDiagnostics, counters: previous }

  const rows = new Map<string, StatRow>()
  await Promise.all(
    tracks.map(async (track) => {
      try {
        const report = await track.getRTCStatsReport()
        report?.forEach((stat) => {
          const row = stat as unknown as StatRow
          if (typeof row.id === 'string' && typeof row.type === 'string') {
            rows.set(`${track.sid}:${row.id}`, row)
          }
        })
      } catch {
        // The SDK may not expose receiver stats for every browser or track type.
      }
    })
  )

  let sentBytes = 0
  let receivedBytes = 0
  let packetsReceived = 0
  let packetsLost = 0
  let jitterSeconds = 0
  let jitterSamples = 0
  let roundTripMs: number | null = null
  let iceRoute: string | null = null

  const rowsById = new Map<string, StatRow>()
  for (const row of rows.values()) {
    if (typeof row.id === 'string') rowsById.set(row.id, row)
    if (row.type === 'outbound-rtp' && !row.isRemote) {
      sentBytes += finiteNumber(row.bytesSent) ?? 0
    } else if (row.type === 'inbound-rtp' && !row.isRemote) {
      receivedBytes += finiteNumber(row.bytesReceived) ?? 0
      packetsReceived += finiteNumber(row.packetsReceived) ?? 0
      packetsLost += Math.max(0, finiteNumber(row.packetsLost) ?? 0)
      const jitter = finiteNumber(row.jitter)
      if (jitter !== null) {
        jitterSeconds += jitter
        jitterSamples += 1
      }
    }
  }

  let selectedPair: StatRow | undefined
  for (const row of rows.values()) {
    if (row.type === 'transport' && typeof row.selectedCandidatePairId === 'string') {
      selectedPair = rowsById.get(row.selectedCandidatePairId)
      if (selectedPair) break
    }
  }
  if (!selectedPair) {
    selectedPair = [...rows.values()].find(
      (row) => row.type === 'candidate-pair' && row.state === 'succeeded' && (row.selected === true || row.nominated === true)
    )
  }
  if (selectedPair) {
    const rttSeconds = finiteNumber(selectedPair.currentRoundTripTime)
    if (rttSeconds !== null) roundTripMs = rttSeconds * 1000
    const local = typeof selectedPair.localCandidateId === 'string' ? rowsById.get(selectedPair.localCandidateId) : undefined
    const remote = typeof selectedPair.remoteCandidateId === 'string' ? rowsById.get(selectedPair.remoteCandidateId) : undefined
    const isRelay = local?.candidateType === 'relay' || remote?.candidateType === 'relay'
    const protocol = typeof local?.protocol === 'string' ? local.protocol.toUpperCase() : ''
    iceRoute = isRelay ? 'TURN relay' : protocol ? `ICE · ${protocol}` : 'ICE selected'
  }

  const elapsedSeconds = previous ? (at - previous.at) / 1000 : 0
  const sendKbps = previous && elapsedSeconds > 0 && sentBytes >= previous.sentBytes
    ? ((sentBytes - previous.sentBytes) * 8) / elapsedSeconds / 1000
    : null
  const receiveKbps = previous && elapsedSeconds > 0 && receivedBytes >= previous.receivedBytes
    ? ((receivedBytes - previous.receivedBytes) * 8) / elapsedSeconds / 1000
    : null
  const lossPercent = packetsReceived + packetsLost > 0
    ? (packetsLost / (packetsReceived + packetsLost)) * 100
    : null

  return {
    diagnostics: {
      roundTripMs,
      jitterMs: jitterSamples ? (jitterSeconds / jitterSamples) * 1000 : null,
      lossPercent,
      sendKbps,
      receiveKbps,
      iceRoute,
      available: rows.size > 0
    },
    counters: rows.size > 0 ? { at, sentBytes, receivedBytes } : previous
  }
}

export const NO_CALL_DIAGNOSTICS = emptyDiagnostics

export function formatMetric(value: number | null, unit: string, decimals = 0): string {
  return value === null || !Number.isFinite(value) ? 'Unavailable' : `${value.toFixed(decimals)}${unit}`
}

export function initials(name: string): string {
  const pieces = name.trim().split(/\s+/).filter(Boolean)
  if (!pieces.length) return '?'
  return pieces.length === 1
    ? pieces[0].slice(0, 1).toUpperCase()
    : `${pieces[0].slice(0, 1)}${pieces[pieces.length - 1].slice(0, 1)}`.toUpperCase()
}
