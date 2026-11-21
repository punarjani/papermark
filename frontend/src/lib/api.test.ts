import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import { describe, expect, it } from 'vitest'

import { API_TIMEOUT_MS, createApiClient, isTransientError, toApiError } from './api'

function response(status: number, data: unknown): AxiosResponse {
  const config = { headers: new AxiosHeaders() }
  return { status, statusText: '', data, headers: {}, config }
}

describe('toApiError', () => {
  it('maps a request timeout to TIMEOUT', () => {
    const err = toApiError(new AxiosError('timeout of 90000ms exceeded', AxiosError.ECONNABORTED))
    expect(err.code).toBe('TIMEOUT')
    expect(err.message).toMatch(/starting up/)
    expect(isTransientError(err)).toBe(true)
  })

  it('maps a proxy 503 without an error envelope to SERVICE_UNAVAILABLE', () => {
    const ax = new AxiosError('fail', 'ERR_BAD_RESPONSE', undefined, undefined, response(503, '<html>'))
    const err = toApiError(ax)
    expect(err.code).toBe('SERVICE_UNAVAILABLE')
    expect(err.status).toBe(503)
    expect(isTransientError(err)).toBe(true)
  })

  it('keeps the API error envelope when present', () => {
    const body = { error: { code: 'NOT_FOUND', message: 'Not found.', details: [], request_id: 'r1' } }
    const ax = new AxiosError('fail', 'ERR_BAD_REQUEST', undefined, undefined, response(404, body))
    const err = toApiError(ax)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.requestId).toBe('r1')
    expect(isTransientError(err)).toBe(false)
  })

  it('maps a missing response to NETWORK_ERROR', () => {
    expect(toApiError(new AxiosError('Network Error', 'ERR_NETWORK')).code).toBe('NETWORK_ERROR')
  })
})

describe('createApiClient', () => {
  it('allows 90 s for a cold start', () => {
    expect(API_TIMEOUT_MS).toBe(90_000)
    expect(createApiClient('https://api.example.edu/api/v1').defaults.timeout).toBe(90_000)
  })
})
