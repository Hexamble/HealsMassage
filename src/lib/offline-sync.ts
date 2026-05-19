'use client'

// Offline sync stub — no-op replacement.
// The original implementation caused memory leaks via unbounded retry loops.

export interface OfflineSyncStatus {
  pending: number
  showBadge: boolean
  lastSyncAt: string | null
  lastError: string | null
}

export interface OfflineSyncHandle {
  stop: () => void
  status: () => OfflineSyncStatus
  onStatusChange: (cb: (s: OfflineSyncStatus) => void) => () => void
  drainNow: () => Promise<void>
}

const EMPTY: OfflineSyncStatus = {
  pending: 0,
  showBadge: false,
  lastSyncAt: null,
  lastError: null,
}

export function startOfflineSync(): OfflineSyncHandle {
  return {
    stop: () => {},
    status: () => ({ ...EMPTY }),
    onStatusChange: (_cb) => () => {},
    drainNow: async () => {},
  }
}
