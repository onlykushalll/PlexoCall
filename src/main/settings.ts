import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ServiceSettings } from '@shared/call-contract'

const SETTINGS_FILE = 'settings.json'
const DEFAULT_CONTROL_API_URL = 'http://127.0.0.1:8787'

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function normalizeControlApiUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error('Enter a valid control API URL.')
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('The control API URL cannot contain credentials, a query, or a fragment.')
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))) {
    throw new Error('Use HTTPS for a remote server. HTTP is allowed only for this PC.')
  }

  const path = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.origin}${path}`
}

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE)
}

export async function loadSettings(): Promise<ServiceSettings> {
  try {
    const value: unknown = JSON.parse(await readFile(settingsPath(), 'utf8'))
    if (typeof value === 'object' && value !== null && 'controlApiUrl' in value) {
      const controlApiUrl = normalizeControlApiUrl(String(value.controlApiUrl))
      return { controlApiUrl }
    }
  } catch {
    // A missing or malformed settings file uses the local development endpoint.
  }
  return { controlApiUrl: DEFAULT_CONTROL_API_URL }
}

export async function saveControlApiUrl(value: string): Promise<ServiceSettings> {
  const settings = { controlApiUrl: normalizeControlApiUrl(value) }
  const target = settingsPath()
  const temporary = `${target}.tmp`
  await mkdir(dirname(target), { recursive: true })
  await writeFile(temporary, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
  return settings
}
