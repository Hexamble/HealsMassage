'use client'

/**
 * heals-system-rebuild — Offline sync worker (task 11.1).
 *
 * Background drainer for the IndexedDB pending-write queue maintained
 * by `@/lib/offline-queue`. The cashier UI optimistically renders
 * sessions and expenses the moment they are submitted; this worker is
 * the half that turns those optimistic rows into durable Supabase
 * writes once the network is reachable.
 *
 * Design contract (from `tasks.md` §11.1):
 *
 *   - Triggered by three signals: the browser `online` event, the
 *     `visibilitychange` event when the tab becomes visible, and a 30-
 *     second heartbeat. Any of them attempts a drain.
 *   - Drains the queue in FIFO order. Each entry is dispatched to
 *     either `writeTransaction` or `writeExpense` based on the `kind`
 *     discriminator; the same `id` (the transaction `row_id` / expense
 *     uuid) keys the server-side idempotent upsert so re-running a
 *     write that already landed is a safe no-op (Req 7.5).
 *   - Per-entry exponential backoff. After a retryable failure the
 *     entry is re-enqueued with `retries += 1`, `lastError`, and
 *     `nextRetryAt = now + delay(retries)` where delay is 1s, 2s, 4s,
 *     8s, 16s, 32s, capped at 60s. Subsequent drain cycles skip the
 *     entry until `nextRetryAt` elapses, so a single broken entry no
 *     longer blocks the rest of the queue (older versions stopped the
 *     entire pass on the first failure; this one continues, which is
 *     what Req 7.4's "first success after failures" semantics need).
 *   - On the FIRST success within a drain cycle (or any cycle that
 *     follows a stretch of failures), `showBadge` is set to `false`
 *     immediately and `lastSyncAt` is advanced — even if entries
 *     remain. That is exactly Req 7.4: "WHEN any sync attempt
 *     succeeds, hide the pending sync badge immediately." The badge
 *     re-appears only when a subsequent failure occurs.
 *   - Terminal validation codes (`UNKNOWN_STAFF`, `INVALID_INPUT`,
 *     `BRANCH_MISMATCH`, `STAFF_NOT_ON_ROSTER`, `NOT_AUTHORIZED`,
 *     `FORBIDDEN`) drop the entry with a console warning so a single
 *     malformed write can't poison the queue forever. Idempotency
 *     (Req 7.5) still holds because dropped entries never landed.
 *   - `stop()` removes the event listeners, clears the heartbeat
 *     interval, and cancels any pending backoff timer. Safe to call
 *     multiple times. Module-level singleton so multiple `start`
 *     calls reuse the same running worker.
 *
 * Validates: Requirements 7.1, 7.2, 7.4, 7.5.
 *
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/design.md
 *      §"Offline Support (Cashier Only)"
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/requirements.md §7
 */

import {
  dequeue,
  enqueue,
  getAll,
  type PendingWrite,
} from './offline-queue'
import { writeTransaction } from '@/app/actions/writeTransaction'
import { writeExpense } from '@/app/actions/writeExpense'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OfflineSyncStatus {
  /** Number of entries still waiting in the queue. */
  pending: number
  /**
   * Whether the pending-sync badge should be visible. Hidden
   * immediately on the first success after a stretch of failures
   * (Req 7.4); shown again the next time a failure happens.
   */
  showBadge: boolean
  /** ISO timestamp of the most recent successful sync, or null. */
  lastSyncAt: string | null
  /** Most recent error message from a failed write, or null. */
  lastError: string | null
}

export interface OfflineSyncHandle {
  /** Tear down listeners, heartbeat, and any pending backoff timer. */
  stop: () => void
  /** Snapshot of the current status. */
  status: () => OfflineSyncStatus
  /**
   * Subscribe to status changes; returns the unsubscribe function.
   * Multiple subscribers are supported.
   */
  onStatusChange: (cb: (s: OfflineSyncStatus) => void) => () => void
  /**
   * Force a drain pass right now. Useful for tests and for "Retry"
   * buttons in the UI. Resolves once the pass settles.
   */
  drainNow: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Heartbeat that re-checks the queue every 30 s (task 11.1). */
const HEARTBEAT_MS = 30_000

/** Backoff schedule: 1s, 2s, 4s, 8s, 16s, 32s, 60s (cap). */
const MAX_BACKOFF_MS = 60_000
const BASE_BACKOFF_MS = 1_000

/**
 * Server-action error codes that signal a permanent failure. The
 * payload is wrong (or the staff/branch claim is wrong) and retrying
 * with the same `id` will keep failing the same way. We drop the
 * entry rather than poison the queue.
 */
const TERMINAL_CODES = new Set<string>([
  'UNKNOWN_STAFF',
  'INVALID_INPUT',
  'BRANCH_MISMATCH',
  'STAFF_NOT_ON_ROSTER',
  'NOT_AUTHORIZED',
  'FORBIDDEN',
])

/**
 * Compute the backoff delay (ms) for a given retry counter. Retries
 * are 1-indexed: the first failure sets `retries = 1` → 1s. Capped at
 * `MAX_BACKOFF_MS`.
 */
function backoffMs(retries: number): number {
  if (retries < 1) return BASE_BACKOFF_MS
  // 2^(retries-1) blows up fast; cap exponent before the multiply
  // overflows for absurdly high retry counts.
  const exp = Math.min(retries - 1, 30)
  const delay = BASE_BACKOFF_MS * Math.pow(2, exp)
  return Math.min(MAX_BACKOFF_MS, delay)
}

// ---------------------------------------------------------------------------
// Module-level singleton state
//
// The cashier route mounts a single `<CashierPage>` that owns the
// connection to this worker; we singletonise so HMR reloads, double
// `start` calls, and child remounts all reuse the same drain loop and
// status stream rather than spawning competing workers.
// ---------------------------------------------------------------------------

interface WorkerState {
  stopped: boolean
  isDraining: boolean
  status: OfflineSyncStatus
  subscribers: Set<(s: OfflineSyncStatus) => void>
  backoffTimer: ReturnType<typeof setTimeout> | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  onlineHandler: (() => void) | null
  visibilityHandler: (() => void) | null
}

let worker: WorkerState | null = null

function emptyStatus(): OfflineSyncStatus {
  return {
    pending: 0,
    showBadge: false,
    lastSyncAt: null,
    lastError: null,
  }
}

function emit(state: WorkerState): void {
  if (state.stopped) return
  // Defensive copy so subscribers can't mutate the live status.
  const snapshot: OfflineSyncStatus = { ...state.status }
  // `forEach` keeps tsconfig downlevelIteration unnecessary; the Set
  // is owned by this module so the implicit ordering is fine.
  state.subscribers.forEach((cb) => {
    try {
      cb(snapshot)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[offline-sync] status subscriber threw:', err)
    }
  })
}

// ---------------------------------------------------------------------------
// startOfflineSync
// ---------------------------------------------------------------------------

/**
 * Kick off (or attach to) the background sync worker. Returns a
 * handle exposing `stop`, `status`, `onStatusChange`, and `drainNow`.
 *
 * The worker is module-level singleton: calling `startOfflineSync`
 * twice returns handles that share the same underlying state. The
 * first call wires up listeners + heartbeat; the second call simply
 * adds another subscriber. `stop()` unwires the listeners and clears
 * timers — the next `startOfflineSync()` will rewire from scratch.
 */
export function startOfflineSync(): OfflineSyncHandle {
  // SSR safety: the cashier route is a client component but tests can
  // import this module without a `window`. Return a no-op handle.
  if (typeof window === 'undefined') {
    return {
      stop: () => {},
      status: () => emptyStatus(),
      onStatusChange: () => () => {},
      drainNow: async () => {},
    }
  }

  // First caller initialises the singleton.
  if (worker === null || worker.stopped) {
    worker = {
      stopped: false,
      isDraining: false,
      status: emptyStatus(),
      subscribers: new Set(),
      backoffTimer: null,
      heartbeatTimer: null,
      onlineHandler: null,
      visibilityHandler: null,
    }
    wireListeners(worker)
    // Kick off an initial drain so the badge state is correct on mount.
    void drain(worker)
  }

  const state = worker

  return {
    stop(): void {
      tearDown(state)
    },
    status(): OfflineSyncStatus {
      return { ...state.status }
    },
    onStatusChange(cb: (s: OfflineSyncStatus) => void): () => void {
      state.subscribers.add(cb)
      // Push current status immediately so the subscriber doesn't have
      // to wait for the next state change to render.
      try {
        cb({ ...state.status })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[offline-sync] status subscriber threw on attach:', err)
      }
      return () => {
        state.subscribers.delete(cb)
      }
    },
    async drainNow(): Promise<void> {
      // Cancel any pending backoff so the manual call attempts now.
      clearBackoff(state)
      await drain(state)
    },
  }
}

// ---------------------------------------------------------------------------
// Listener wiring
// ---------------------------------------------------------------------------

function wireListeners(state: WorkerState): void {
  state.onlineHandler = () => {
    // Network is back — clear any pending backoff so we attempt now.
    clearBackoff(state)
    void drain(state)
  }
  state.visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      void drain(state)
    }
  }
  window.addEventListener('online', state.onlineHandler)
  document.addEventListener('visibilitychange', state.visibilityHandler)
  state.heartbeatTimer = setInterval(() => {
    void drain(state)
  }, HEARTBEAT_MS)
}

function tearDown(state: WorkerState): void {
  if (state.stopped) return
  state.stopped = true
  if (state.onlineHandler) {
    window.removeEventListener('online', state.onlineHandler)
    state.onlineHandler = null
  }
  if (state.visibilityHandler) {
    document.removeEventListener('visibilitychange', state.visibilityHandler)
    state.visibilityHandler = null
  }
  if (state.heartbeatTimer !== null) {
    clearInterval(state.heartbeatTimer)
    state.heartbeatTimer = null
  }
  clearBackoff(state)
  state.subscribers.clear()
  // Allow a fresh startOfflineSync() to rewire.
  if (worker === state) {
    worker = null
  }
}

function clearBackoff(state: WorkerState): void {
  if (state.backoffTimer !== null) {
    clearTimeout(state.backoffTimer)
    state.backoffTimer = null
  }
}

function scheduleBackoff(state: WorkerState, delayMs: number): void {
  clearBackoff(state)
  if (state.stopped) return
  state.backoffTimer = setTimeout(() => {
    state.backoffTimer = null
    void drain(state)
  }, delayMs)
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Send a single pending write to the matching server action. Returns
 * a uniform envelope so the drain loop can branch on `ok` / `code`
 * regardless of which action ran.
 */
async function dispatch(
  entry: PendingWrite,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    if (entry.kind === 'transaction') {
      const r = await writeTransaction(entry.payload)
      return r.ok
        ? { ok: true }
        : { ok: false, code: r.code, message: r.message }
    }
    if (entry.kind === 'expense') {
      const r = await writeExpense(entry.payload)
      return r.ok
        ? { ok: true }
        : { ok: false, code: r.code, message: r.message }
    }
    // Unknown kind → terminal: no action knows how to drain it.
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `unknown pending-write kind: ${String(
        (entry as PendingWrite).kind,
      )}`,
    }
  } catch (err) {
    // Network / fetch / RSC transport failure — retry next tick.
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

// ---------------------------------------------------------------------------
// Drain pass
// ---------------------------------------------------------------------------

/**
 * One drain pass over the queue. Re-entrant guard via `isDraining`
 * (concurrent triggers from `online` + heartbeat collapse to a single
 * pass). Reads a FIFO snapshot, attempts each entry whose
 * `nextRetryAt` cooldown has elapsed, and either dequeues (success /
 * terminal) or re-enqueues with a bumped retry counter (retryable
 * failure). Subsequent failures within the same pass do NOT halt the
 * loop — every entry is independently retry-tracked, and we want the
 * "first success" (Req 7.4) to be detectable even when other entries
 * are still failing.
 */
async function drain(state: WorkerState): Promise<void> {
  if (state.stopped) return
  if (state.isDraining) return
  state.isDraining = true

  try {
    let entries: PendingWrite[]
    try {
      entries = await getAll()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      state.status = {
        ...state.status,
        lastError: msg,
        // Reading the queue failed; we don't know the actual count.
      }
      emit(state)
      return
    }

    // Update the pending count immediately so any badge listener
    // renders the latest queue depth even if every entry is in
    // cooldown this pass.
    state.status = { ...state.status, pending: entries.length }
    emit(state)

    const now = Date.now()
    // Track the next-soonest cooldown so we can schedule a backoff
    // that wakes up exactly when the earliest entry becomes ready.
    let nearestCooldown: number | null = null
    // Did this pass already produce a success? Used to drive the
    // immediate badge-hide on the very first success (Req 7.4).
    let hadSuccessThisPass = false
    let lastFailureMsg: string | null = null

    for (const entry of entries) {
      if (state.stopped) return

      // Skip entries still cooling down.
      const readyAt = entry.nextRetryAt ?? 0
      if (readyAt > now) {
        if (nearestCooldown === null || readyAt < nearestCooldown) {
          nearestCooldown = readyAt
        }
        continue
      }

      const result = await dispatch(entry)

      if (result.ok) {
        // ---- Success path (Req 7.2, 7.4) -------------------------
        try {
          await dequeue(entry.id)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            '[offline-sync] dequeue failed after successful write:',
            err,
          )
          // Don't trust pending count here — bail and let the next
          // pass re-read. Idempotency guarantees no double-write.
          state.status = {
            ...state.status,
            lastError: err instanceof Error ? err.message : String(err),
          }
          emit(state)
          return
        }

        // First success within this pass → hide badge immediately,
        // even if more entries remain. The badge re-appears only on a
        // subsequent failure within this pass (or a future pass).
        if (!hadSuccessThisPass) {
          hadSuccessThisPass = true
          state.status = {
            ...state.status,
            showBadge: false,
            lastSyncAt: new Date().toISOString(),
            lastError: null,
            pending: Math.max(0, state.status.pending - 1),
          }
        } else {
          state.status = {
            ...state.status,
            pending: Math.max(0, state.status.pending - 1),
          }
        }
        emit(state)
        continue
      }

      // ---- Failure path -----------------------------------------
      if (TERMINAL_CODES.has(result.code)) {
        // Validation error — retrying won't help. Drop and move on.
        // eslint-disable-next-line no-console
        console.error(
          `[offline-sync] dropping ${entry.id} — terminal ${result.code}: ${result.message}`,
          entry.payload,
        )
        try {
          await dequeue(entry.id)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            '[offline-sync] dequeue failed for terminal entry:',
            err,
          )
        }
        const msg = `${result.code}: ${result.message}`
        lastFailureMsg = msg
        state.status = {
          ...state.status,
          pending: Math.max(0, state.status.pending - 1),
          lastError: msg,
          // Failure → badge visible (Req 7.4 inverse: badge shown
          // when failures happen). If a success preceded this one in
          // the same pass, that's fine — the most recent state wins,
          // which is "we're broken again".
          showBadge: true,
        }
        emit(state)
        continue
      }

      // Retryable failure — bump retries, set per-entry cooldown,
      // continue draining the rest of the queue. Per-entry backoff
      // means a single perpetually-failing entry can't starve the
      // pass; the rest of the queue still gets a chance.
      const nextRetries = (entry.retries ?? 0) + 1
      const delay = backoffMs(nextRetries)
      const cooldownUntil = now + delay
      const updated: PendingWrite = {
        ...entry,
        retries: nextRetries,
        lastError: `${result.code}: ${result.message}`,
        nextRetryAt: cooldownUntil,
      }
      try {
        await enqueue(updated)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[offline-sync] retry-enqueue failed:', err)
      }
      const msg = updated.lastError ?? null
      lastFailureMsg = msg
      state.status = {
        ...state.status,
        lastError: msg,
        showBadge: true,
      }
      emit(state)

      if (nearestCooldown === null || cooldownUntil < nearestCooldown) {
        nearestCooldown = cooldownUntil
      }
    }

    // End of pass — derive final state:
    //   - If any entries remain (active or cooling down) and we had
    //     no success this pass, keep showBadge=true.
    //   - If queue is empty, badge stays hidden.
    //   - If we had a success but later entries failed, the failure
    //     branch above already flipped showBadge back to true.
    const stillPending = state.status.pending
    if (stillPending === 0) {
      state.status = { ...state.status, showBadge: false }
    } else if (!hadSuccessThisPass && lastFailureMsg !== null) {
      // All attempted entries failed (or none were attempted because
      // every entry is in cooldown). The badge is already true if any
      // failure happened this pass; if every entry was cooling down,
      // honour the previous showBadge value (queue is non-empty so
      // typically true).
      state.status = { ...state.status, showBadge: true }
    }
    emit(state)

    // Schedule a wakeup for the earliest cooldown so the next attempt
    // happens at exactly the right time (or fall back to the heartbeat).
    if (nearestCooldown !== null && stillPending > 0) {
      const delay = Math.max(0, nearestCooldown - Date.now())
      scheduleBackoff(state, delay)
    }
  } finally {
    state.isDraining = false
  }
}
