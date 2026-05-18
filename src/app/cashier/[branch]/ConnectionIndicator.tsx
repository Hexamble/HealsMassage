'use client'

/**
 * heals-system-rebuild — ConnectionIndicator (Task 8.4)
 *
 * Tiny dot+label showing the realtime channel state. Renders one of:
 *   - green "Live"        when `connectionState === 'connected'`
 *   - amber "Connecting…" when `connectionState === 'connecting'`
 *   - red   "Offline"     when `connectionState === 'disconnected'`
 *
 * The state itself comes from `useCashier().connectionState`, which
 * the CashierProvider binds to `subscribeCashier(branch).onStateChange`
 * (see `lib/realtime.ts`). Clicking the indicator forces an
 * offline-queue drain — handy when the cashier knows the network is
 * back but the badge hasn't refreshed yet.
 *
 * Validates: Requirements 8.4, 23.3 (visual indicator that the
 * realtime connection is active and monitoring for changes).
 */

import { useCashier } from './CashierContext'

const LABELS: Record<string, string> = {
  connected: 'Live',
  connecting: 'Connecting…',
  disconnected: 'Offline',
}

const DOT_CLASSES: Record<string, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-red-500',
}

export default function ConnectionIndicator({
  className,
}: {
  className?: string
}) {
  const { connectionState, drainOfflineNow } = useCashier()
  const label = LABELS[connectionState] ?? connectionState
  const dot = DOT_CLASSES[connectionState] ?? 'bg-zinc-400'

  return (
    <button
      type="button"
      onClick={() => void drainOfflineNow()}
      title={`Realtime: ${label}. Click to retry sync.`}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-700',
        'bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium',
        'hover:bg-zinc-50 dark:hover:bg-zinc-800',
        className ?? '',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${dot}`}
      />
      <span>{label}</span>
    </button>
  )
}
