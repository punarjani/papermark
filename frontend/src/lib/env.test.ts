import { describe, expect, it } from 'vitest'

import { parseEnv } from './env'

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
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc123',
      }),
    ).toThrow(/SECRET key/)
  })

  it('refuses a legacy service_role JWT key', () => {
    const payload = btoa(JSON.stringify({ role: 'service_role' }))
    expect(() =>
      parseEnv({
        VITE_API_BASE_URL: 'http://localhost:8000/api/v1',
        VITE_SUPABASE_PUBLISHABLE_KEY: `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`,
      }),
    ).toThrow(/SECRET key/)
  })

  it('accepts a publishable key', () => {
    const env = parseEnv({
      VITE_API_BASE_URL: 'https://api.example.edu/api/v1',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
    })
    expect(env.supabasePublishableKey).toBe('sb_publishable_abc123')
  })
})
