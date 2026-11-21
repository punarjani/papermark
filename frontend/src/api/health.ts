import { AxiosError } from 'axios'

import { api, toApiError } from '../lib/api'

export interface HealthResponse {
  status: 'ok'
  service: string
  version: string
}

export interface ReadinessResponse {
  status: 'ready' | 'not_ready'
  checks: Record<string, string>
}

export async function getHealth(): Promise<HealthResponse> {
  try {
    const { data } = await api().get<HealthResponse>('/health')
    return data
  } catch (err) {
    throw toApiError(err)
  }
}

/** 503 is an expected answer ("not ready"), not a failure of the request itself. */
export async function getReadiness(): Promise<ReadinessResponse> {
  try {
    const { data } = await api().get<ReadinessResponse>('/health/ready')
    return data
  } catch (err) {
    // Only our own JSON body counts; a proxy 503 (e.g. an HTML "starting" page) is an error.
    const body = err instanceof AxiosError ? (err.response?.data as unknown) : undefined
    if (
      err instanceof AxiosError &&
      err.response?.status === 503 &&
      typeof body === 'object' &&
      body !== null &&
      'checks' in body
    ) {
      return body as ReadinessResponse
    }
    throw toApiError(err)
  }
}
