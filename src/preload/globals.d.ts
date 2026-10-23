import type { PlexocallApi } from '@shared/call-contract'

declare global {
  interface Window {
    plexocall: PlexocallApi
  }
}

export {}
