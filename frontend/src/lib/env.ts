/**
 * Build-time configuration. Every VITE_* value is embedded in the public JavaScript bundle,
 * so only public values belong here. Never put the Supabase secret/service-role key in a
 * VITE_* variable.
 */

export interface AppEnv {
  apiBaseUrl: string
  supabaseUrl: string | null
  supabasePublishableKey: string | null
}

export function parseEnv(raw: Record<string, string | undefined>): AppEnv {
  const apiBaseUrl = raw.VITE_API_BASE_URL?.trim().replace(/\/+$/, '')
  if (!apiBaseUrl) {
    throw new Error('VITE_API_BASE_URL is not set. Copy frontend/.env.example to .env.local.')
  }
  if (!/^https?:\/\//.test(apiBaseUrl)) {
    throw new Error('VITE_API_BASE_URL must be an absolute http(s) URL.')
  }
  const supabaseKey = raw.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || null
  if (supabaseKey && /service_role|sb_secret_/.test(supabaseKey + atobSafe(supabaseKey))) {
    throw new Error('A Supabase SECRET key was supplied to the frontend. Use the publishable key.')
  }
  return {
    apiBaseUrl,
    supabaseUrl: raw.VITE_SUPABASE_URL?.trim() || null,
    supabasePublishableKey: supabaseKey,
  }
}

/** Decode the payload of a legacy JWT-style key so a service_role key can be detected. */
function atobSafe(key: string): string {
  try {
    const payload = key.split('.')[1]
    return payload ? atob(payload.replace(/-/g, '+').replace(/_/g, '/')) : ''
  } catch {
    return ''
  }
}

let cached: AppEnv | null = null

export function getEnv(): AppEnv {
  cached ??= parseEnv(import.meta.env as Record<string, string | undefined>)
  return cached
}
