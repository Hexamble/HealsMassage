'use client'

/**
 * heals-system-rebuild — PendingSyncBadge (Task 8.3)
 *
 * Reads `pendingSyncCount` and `showPendingBadge` from the cashier
 * context (which mirrors the offline-sync worker's status stream).
 * Renders an amber pill — "Pending sync (N)" — only when the worker
 * tells us to show it.
 *
 * Per Requirement 7.4, the badge is hidden IMMEDIATELY on the first
 * successful sync after a stretch of failures, even if more entries
 * remain pending. The offline-sync worker drives that boolean; this
 * component is just a view.
 *
 * Click to force a manual drain — useful when the cashier knows the
 * network is back but the heartbeat hasn't fired yet.
 */

import { useCashier } from './CashierContext'

export default function PendingSyncBadge({
  className,
}: {
  className?: string
}) {
  const { pendingSyncCount, showPendingBadge, lastSyncError, drainOfflineNow } =
    useCashier()
  if (!showPendingBadge || pendingSyncCount === 0) return null

  return (
    <button
      type="button"
      onClick={() => void drainOfflineNow()}
      title={
        lastSyncError
          ? `${pendingSyncCount} pending — last error: ${lastSyncError}`
          : `${pendingSyncCount} pending writes — click to retry`
      }
      className={[
        'inline-flex items-center gap-1.5 rounded-full border border-amber-300 dark:border-amber-700',
        'bg-amber-50 dark:bg-amber-950 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-200',
        'hover:bg-amber-100 dark:hover:bg-amber-900',
        className ?? '',
      ].join(' ')}
    >
      <span aria-hidden>⏳</span>
      <span>
        Pending sync ({pendingSyncCount})
      </span>
    </button>
  )
}
