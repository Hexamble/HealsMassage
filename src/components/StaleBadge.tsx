// salary-system-rebuild — Heals Thai Massage POS
// Stale-data badge — small inline pill that surfaces when the Realtime
// connection backing a cashier surface is unhealthy.
//
// Renders nothing while `status === 'connected'`, an amber "Reconnecting…"
// pill while the hook is mid-recovery, and a red "Disconnected — data may
// be stale" pill when the channel has fully closed. Tone classes use the
// same Tailwind dark-mode pattern as the rest of the cashier UI.
//
// Validates: Requirements 15.3, 15.4.

'use client'

import type { RealtimeStatus } from '@/lib/realtime'

export default function StaleBadge({ status }: { status: RealtimeStatus }) {
  if (status === 'connected') return null

  const label =
    status === 'reconnecting' ? 'Reconnecting…' : 'Disconnected — data may be stale'
  const tone =
    status === 'reconnecting'
      ? 'bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200'
      : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'

  return (
    <span
      role="status"
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  )
}
