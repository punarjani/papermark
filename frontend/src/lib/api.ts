import axios, { AxiosError, type AxiosInstance } from 'axios'

import { getEnv } from './env'

/** Error envelope returned by the PaperMark API (docs/03-api-specification.md §1). */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details: Array<Record<string, unknown>>
    request_id: string | null
  }
}

export class ApiError extends Error {
  readonly status: number | null
  readonly code: string
  readonly requestId: string | null

  constructor(status: number | null, code: string, message: string, requestId: string | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (err instanceof AxiosError) {
    const body = err.response?.data as Partial<ApiErrorBody> | undefined
    if (body?.error) {
      return new ApiError(
        err.response?.status ?? null,
        body.error.code,
        body.error.message,
        body.error.request_id,
      )
    }
    if (err.code === AxiosError.ECONNABORTED || err.code === AxiosError.ETIMEDOUT) {
      return new ApiError(null, 'TIMEOUT', TIMEOUT_MESSAGE, null)
    }
    if (!err.response) {
      return new ApiError(null, 'NETWORK_ERROR', 'Cannot reach the PaperMark server.', null)
    }
    // A 502/503/504 without our error envelope comes from the hosting proxy, typically while
    // a sleeping free-tier instance is starting.
    if ([502, 503, 504].includes(err.response.status)) {
      return new ApiError(err.response.status, 'SERVICE_UNAVAILABLE', UNAVAILABLE_MESSAGE, null)
    }
    return new ApiError(err.response.status, 'HTTP_ERROR', err.message, null)
  }
  return new ApiError(null, 'UNKNOWN', 'Unexpected error.', null)
}

const TIMEOUT_MESSAGE =
  'The server took too long to respond. It may be starting up after being idle. Please try again.'
const UNAVAILABLE_MESSAGE =
  'The server is starting up or temporarily unavailable. Please try again in a minute.'

/** True for errors that usually clear on their own once a sleeping server has started. */
export function isTransientError(err: ApiError): boolean {
  return ['TIMEOUT', 'NETWORK_ERROR', 'SERVICE_UNAVAILABLE'].includes(err.code)
}

/**
 * Request timeout. Render Free instances sleep when idle and can take up to about a minute
 * to start, so the first request must be allowed to wait that long.
 */
export const API_TIMEOUT_MS = 90_000

export function createApiClient(baseURL: string): AxiosInstance {
  // Phase 1 adds an interceptor that attaches the Supabase access token.
  return axios.create({ baseURL, timeout: API_TIMEOUT_MS, headers: { Accept: 'application/json' } })
}

let client: AxiosInstance | null = null

export function api(): AxiosInstance {
  client ??= createApiClient(getEnv().apiBaseUrl)
  return client
}
