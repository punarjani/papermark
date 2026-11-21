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
    if (!err.response) {
      return new ApiError(null, 'NETWORK_ERROR', 'Cannot reach the PaperMark server.', null)
    }
    return new ApiError(err.response.status, 'HTTP_ERROR', err.message, null)
  }
  return new ApiError(null, 'UNKNOWN', 'Unexpected error.', null)
}

export function createApiClient(baseURL: string): AxiosInstance {
  // Phase 1 adds an interceptor that attaches the Supabase access token.
  return axios.create({ baseURL, timeout: 20_000, headers: { Accept: 'application/json' } })
}

let client: AxiosInstance | null = null

export function api(): AxiosInstance {
  client ??= createApiClient(getEnv().apiBaseUrl)
  return client
}
