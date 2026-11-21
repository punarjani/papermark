import { describe, expect, it } from 'vitest'

import { parseEnv } from './env'

// Synthetic, low-entropy fake keys assembled at runtime. They only have the shape of real
// keys, and no key-like literal is committed (keeps secret scanners free of false positives).
const fakeKey = (prefix: string) => `${prefix}_${'x'.repeat(12)}`

describe('parseEnv', () => {
  it('requires VITE_API_BASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/VITE_API_BASE_URL is not set/)
  })

  it('rejects relative API URLs', () => {
    expect(() => parseEnv({ VITE_API_BASE_URL: '/api' })).toThrow(/absolute/)
  })

  it('strips trailing slashes', () => {
    expect(parseEnv({ VITE_API_BASE_URL: 'http://localhost:8000/api/v1/' }).apiBaseUrl).toBe(
      'http://localhost:8000/api/v1',
    )
  })

  it('refuses a new-style Supabase secret key', () => {
    expect(() =>
      parseEnv({
        VITE_API_BASE_URL: 'http://localhost:8000/api/v1',
        VITE_SUPABASE_PUBLISHABLE_KEY: fakeKey('sb_secret'),
      }),
    ).toThrow(/SECRET key/)
  })

  it('refuses a legacy service_role JWT key', () => {
    const payload = btoa(JSON.stringify({ role: 'service_role' }))
    expect(() =>
      parseEnv({
        VITE_API_BASE_URL: 'http://localhost:8000/api/v1',
        VITE_SUPABASE_PUBLISHABLE_KEY: `${btoa(JSON.stringify({ alg: 'none' }))}.${payload}.sig`,
      }),
    ).toThrow(/SECRET key/)
  })

  it('accepts a publishable key', () => {
    const env = parseEnv({
      VITE_API_BASE_URL: 'https://api.example.edu/api/v1',
      VITE_SUPABASE_PUBLISHABLE_KEY: fakeKey('sb_publishable'),
    })
    expect(env.supabasePublishableKey).toBe(fakeKey('sb_publishable'))
  })
})
