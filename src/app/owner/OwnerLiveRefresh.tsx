'use client'

/**
 * heals-system-rebuild — Owner-side realtime refresh helper.
 *
 * Subscribes to the owner-wide realtime channel (transactions,
 * expenses, daily_roster, staff). On any change OR on a successful
 * (re)connect, calls `router.refresh()` so the page's Server Component
 * re-runs the aggregation. Renders a small "Live" / "Connecting" /
 * "Offline" pill so the owner can see the realtime channel status.
 *
 * Validates: Requirements 8.1, 8.2, 8.4.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { subscribeOwner, type ConnectionState } from '@/lib/realtime'

const LABELS: Record<ConnectionState, string> = {
  connected: 'Live',
  connecting: 'Connecting…',
  disconnected: 'Offline',
}
const DOTS: Record<ConnectionState, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-red-500',
}

export default function OwnerLiveRefresh() {
  const router = useRouter()
  const [state, setState] = useState<ConnectionState>('connecting')

  useEffect(() => {
    const handle = subscribeOwner({
      onTransaction: () => router.refresh(),
      onExpense: () => router.refresh(),
      onRoster: () => router.refresh(),
      onStaff: () => router.refresh(),
      onResync: () => router.refresh(),
    })
    const off = handle.onStateChange((s) => setState(s))
    setState(handle.getConnectionState())
    return () => {
      off()
      handle.unsubscribe()
    }
  }, [router])

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium"
      title={`Realtime: ${LABELS[state]}`}
      aria-live="polite"
    >
      <span aria-hidden className={`h-2 w-2 rounded-full ${DOTS[state]}`} />
      <span>{LABELS[state]}</span>
    </span>
  )
}
