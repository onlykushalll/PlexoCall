/// <reference types="vite/client" />

declare global {
  interface Window {
    plexocall: import('../../preload/globals').PlexocallApi
  }
}

export {}
