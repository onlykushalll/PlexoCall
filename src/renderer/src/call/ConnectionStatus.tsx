import { CircleAlert, LoaderCircle, Radio, Wifi } from 'lucide-react'
import { ConnectionState } from 'livekit-client'

export function ConnectionStatus({ state }: { state: ConnectionState }): React.JSX.Element {
  if (state === ConnectionState.Connected) {
    return <span className="connection-pill connected"><Wifi aria-hidden="true" /> Connected</span>
  }
  if (state === ConnectionState.Reconnecting) {
    return <span className="connection-pill reconnecting"><LoaderCircle aria-hidden="true" /> Reconnecting</span>
  }
  if (state === ConnectionState.Disconnected) {
    return <span className="connection-pill"><CircleAlert aria-hidden="true" /> Disconnected</span>
  }
  return <span className="connection-pill"><Radio aria-hidden="true" /> Connecting</span>
}
