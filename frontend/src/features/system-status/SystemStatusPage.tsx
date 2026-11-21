import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, Loader2, Server } from 'lucide-react'

import { getHealth, getReadiness } from '../../api/health'
import type { ApiError } from '../../lib/api'

type Tone = 'ok' | 'warn' | 'error' | 'loading'

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

/** Phase 0 page: shows live API liveness and readiness. Replaced by login in Phase 1. */
export function SystemStatusPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth })
  const ready = useQuery({ queryKey: ['health', 'ready'], queryFn: getReadiness })

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
      </div>
    </section>
  )
}
