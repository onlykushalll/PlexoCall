import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(8787),
  DATABASE_URL: z.string().min(1),
  LIVEKIT_API_URL: z.string().url(),
  LIVEKIT_PUBLIC_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(8),
  LIVEKIT_API_SECRET: z.string().min(8),
  TRUST_PROXY: z.string().default('')
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  throw new Error(`Invalid control API configuration: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`)
}

const liveKitApiUrl = new URL(parsed.data.LIVEKIT_API_URL)
const liveKitPublicUrl = new URL(parsed.data.LIVEKIT_PUBLIC_URL)
if (!['http:', 'https:'].includes(liveKitApiUrl.protocol)) {
  throw new Error('LIVEKIT_API_URL must use HTTP or HTTPS.')
}
if (!['ws:', 'wss:'].includes(liveKitPublicUrl.protocol)) {
  throw new Error('LIVEKIT_PUBLIC_URL must use WS or WSS.')
}
if (
  liveKitApiUrl.username || liveKitApiUrl.password || liveKitApiUrl.search || liveKitApiUrl.hash || liveKitApiUrl.pathname !== '/' ||
  liveKitPublicUrl.username || liveKitPublicUrl.password || liveKitPublicUrl.search || liveKitPublicUrl.hash ||
  liveKitPublicUrl.pathname !== '/'
) {
  throw new Error('LiveKit URLs cannot contain credentials, a path, a query, or a fragment.')
}
if (parsed.data.NODE_ENV === 'production') {
  if (parsed.data.LIVEKIT_API_SECRET.length < 32 || parsed.data.LIVEKIT_API_KEY.length < 16) {
    throw new Error('Production LiveKit API credentials must use a key of at least 16 characters and a secret of at least 32 characters.')
  }
  if (liveKitPublicUrl.protocol !== 'wss:') {
    throw new Error('LIVEKIT_PUBLIC_URL must use WSS in production.')
  }
}

export const config = {
  ...parsed.data,
  LIVEKIT_API_URL: liveKitApiUrl.origin,
  LIVEKIT_PUBLIC_URL: liveKitPublicUrl.toString().replace(/\/$/, ''),
  trustedProxyAddresses: parsed.data.TRUST_PROXY.split(',').map((value) => value.trim()).filter(Boolean)
}
