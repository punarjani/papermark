import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, Loader2, RefreshCw, Server } from 'lucide-react'
import { useEffect, useState } from 'react'

import { getHealth, getReadiness } from '../../api/health'
import { isTransientError, type ApiError } from '../../lib/api'

type Tone = 'ok' | 'warn' | 'error' | 'loading'

/** After this long without an answer, explain that the server may be waking up. */
export const SLOW_HINT_MS = 5_000

function StatusRow({ label, tone, text }: { label: string; tone: Tone; text: string }) {
  const icon = {
    ok: <CheckCircle2 aria-hidden className="h-5 w-5 text-emerald-600" />,
    warn: <CircleAlert aria-hidden className="h-5 w-5 text-amber-600" />,
    error: <CircleAlert aria-hidden className="h-5 w-5 text-red-600" />,
    loading: <Loader2 aria-hidden className="h-5 w-5 animate-spin text-slate-400" />,
  }[tone]
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <span className="font-medium text-slate-700">{label}</span>
      <span className="flex items-center gap-2 text-sm text-slate-600">
        {icon}
        <span data-testid={`status-${label.toLowerCase().replace(/\s+/g, '-')}`}>{text}</span>
      </span>
    </li>
  )
}

function useSlowHint(active: boolean): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setSlow(true), SLOW_HINT_MS)
    return () => {
      clearTimeout(timer)
      setSlow(false)
    }
  }, [active])
  return active && slow
}

/** Phase 0 page: shows live API liveness and readiness. Replaced by login in Phase 1. */
export function SystemStatusPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth })
  const ready = useQuery({ queryKey: ['health', 'ready'], queryFn: getReadiness })

  const fetching = health.isFetching || ready.isFetching
  const slow = useSlowHint(fetching)
  const error = (health.error ?? ready.error) as ApiError | null
  const retry = () => {
    void health.refetch()
    void ready.refetch()
  }

  const apiRow: { tone: Tone; text: string } = health.isPending
    ? { tone: 'loading', text: 'Checking…' }
    : health.isError
      ? { tone: 'error', text: (health.error as ApiError).message }
      : { tone: 'ok', text: `Online (v${health.data.version})` }

  const dbStatus = ready.data?.checks.database
  const dbRow: { tone: Tone; text: string } = ready.isPending
    ? { tone: 'loading', text: 'Checking…' }
    : ready.isError
      ? { tone: 'error', text: 'Unknown' }
      : dbStatus === 'ok'
        ? { tone: 'ok', text: 'Connected' }
        : dbStatus === 'not_configured'
          ? { tone: 'warn', text: 'Not configured' }
          : { tone: 'error', text: 'Unavailable' }

  return (
    <section className="mx-auto w-full max-w-xl px-4 py-12">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <Server aria-hidden className="h-6 w-6 text-indigo-600" />
          <h1 className="text-lg font-semibold">System status</h1>
        </div>
        <ul className="divide-y divide-slate-100">
          <StatusRow label="API" {...apiRow} />
          <StatusRow label="Database" {...dbRow} />
        </ul>

        {fetching && slow && (
          <p role="status" className="mt-4 text-sm text-slate-600">
            The server is waking up. This can take up to a minute after a period of inactivity.
          </p>
        )}

        {!fetching && error && (
          <div className="mt-4 flex items-center justify-between gap-4">
            <p role="alert" className="text-sm text-slate-600">
              {isTransientError(error)
                ? 'This is usually temporary while the server starts.'
                : 'The status check failed.'}
            </p>
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw aria-hidden className="h-4 w-4" />
              Try again
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
