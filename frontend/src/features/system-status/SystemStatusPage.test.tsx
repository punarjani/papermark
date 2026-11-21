import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as healthApi from '../../api/health'
import { ApiError } from '../../lib/api'
import { SLOW_HINT_MS, SystemStatusPage } from './SystemStatusPage'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SystemStatusPage />
    </QueryClientProvider>,
  )
}

describe('SystemStatusPage', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('shows API online and database connected', async () => {
    vi.spyOn(healthApi, 'getHealth').mockResolvedValue({
      status: 'ok',
      service: 'papermark-api',
      version: '0.1.0',
    })
    vi.spyOn(healthApi, 'getReadiness').mockResolvedValue({
      status: 'ready',
      checks: { database: 'ok' },
    })
    renderPage()
    expect(await screen.findByText('Online (v0.1.0)')).toBeInTheDocument()
    expect(await screen.findByText('Connected')).toBeInTheDocument()
  })

  it('shows database not configured', async () => {
    vi.spyOn(healthApi, 'getHealth').mockResolvedValue({
      status: 'ok',
      service: 'papermark-api',
      version: '0.1.0',
    })
    vi.spyOn(healthApi, 'getReadiness').mockResolvedValue({
      status: 'not_ready',
      checks: { database: 'not_configured' },
    })
    renderPage()
    expect(await screen.findByText('Not configured')).toBeInTheDocument()
  })

  it('shows a network error when the API is unreachable', async () => {
    const err = new ApiError(null, 'NETWORK_ERROR', 'Cannot reach the PaperMark server.', null)
    vi.spyOn(healthApi, 'getHealth').mockRejectedValue(err)
    vi.spyOn(healthApi, 'getReadiness').mockRejectedValue(err)
    renderPage()
    expect(await screen.findByText('Cannot reach the PaperMark server.')).toBeInTheDocument()
    expect(await screen.findByText('Unknown')).toBeInTheDocument()
  })

  it('explains a cold-start timeout and retries on request', async () => {
    const err = new ApiError(null, 'TIMEOUT', 'The server took too long to respond.', null)
    vi.spyOn(healthApi, 'getHealth')
      .mockRejectedValueOnce(err)
      .mockResolvedValue({ status: 'ok', service: 'papermark-api', version: '0.1.0' })
    vi.spyOn(healthApi, 'getReadiness')
      .mockRejectedValueOnce(err)
      .mockResolvedValue({ status: 'ready', checks: { database: 'ok' } })
    renderPage()
    expect(await screen.findByText('The server took too long to respond.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/usually temporary/)

    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Online (v0.1.0)')).toBeInTheDocument()
    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('shows a waking-up hint while a request is slow', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      vi.spyOn(healthApi, 'getHealth').mockReturnValue(new Promise(() => {}))
      vi.spyOn(healthApi, 'getReadiness').mockReturnValue(new Promise(() => {}))
      renderPage()
      expect(screen.queryByText(/waking up/)).not.toBeInTheDocument()
      await act(() => vi.advanceTimersByTimeAsync(SLOW_HINT_MS + 100))
      expect(screen.getByRole('status')).toHaveTextContent(/waking up/)
    } finally {
      vi.useRealTimers()
    }
  })
})
