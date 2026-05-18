// salary-system-rebuild — Heals Thai Massage POS
// Reusable React hook around Supabase Realtime `postgres_changes` events.
//
// Goal: every cashier surface (TodaySessions, TodaySummary, QueueBoard,
// ExpenseBlock, …) currently spins up its own `supabase.channel(...).on(
// 'postgres_changes', …)` boilerplate and silently swallows connection
// errors. Replace that with a single hook that:
//
//   1. Subscribes inside `useEffect` and tears the channel down on cleanup.
//   2. Tracks connection status as `'connected' | 'reconnecting' |
//      'disconnected'`, mapping Supabase's raw subscribe statuses to
//      something the UI (e.g. a future `<StaleBadge />`) can render.
//   3. Calls the caller's `onChange` for every event, using a `useRef` to
//      keep a stable reference so identity changes in the parent don't
//      cause unnecessary re-subscriptions.
//   4. Recovers from the mobile-background trap: iOS Safari and Android
//      Chrome silently suspend the WebSocket when the tab is hidden, so
//      on `visibilitychange → visible` we tear down and resubscribe (Task
//      19.4). Consumers that already re-fetch on the
//      `(reconnecting → connected)` transition get a free refresh.
//
// Server-side filtering is via the standard PostgREST `filter` (e.g.
// `branch=eq.Kimberry`); `postgres_changes` only supports a single filter
// clause, so callers narrow further inside their `onChange` if needed —
// matches the existing convention in `TodaySessions.tsx` etc.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/browser'

export type RealtimeStatus = 'connected' | 'reconnecting' | 'disconnected'

export interface PostgresChangesPayload<T = Record<string, unknown>> {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  schema: string
  table: string
  new: T | Record<string, never>
  old: T | Record<string, never>
}

export interface UsePostgresChangesOptions {
  /** Unique Supabase channel name (e.g. `tx-Kimberry-2026-05-15`). */
  channel: string
  /** Postgres schema, defaults to `public`. */
  schema?: string
  /** Postgres table to listen on. */
  table: string
  /** Optional PostgREST filter, e.g. `branch=eq.Kimberry`. */
  filter?: string
  /** Optional event type filter; defaults to all events. */
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
}

/**
 * Subscribe to `postgres_changes` for one table and return a connection
 * status. The `onChange` callback fires for every event delivered by the
 * channel; consumers can apply additional client-side filtering inside it
 * (since `postgres_changes` only supports a single server-side filter).
 *
 * The hook only re-subscribes when the channel-shape options change
 * (`channel`, `schema`, `table`, `filter`, `event`). Changes to the
 * `onChange` function identity do NOT cause a re-subscribe — the latest
 * callback is always invoked via a ref.
 *
 * The hook also internally listens for `visibilitychange` and forces a
 * resubscribe when the page returns to the foreground. This catches the
 * mobile-Safari/Chrome behaviour of silently suspending the underlying
 * WebSocket while the tab is hidden — without this, the page could show
 * a stale "connected" status indefinitely after waking from background.
 */
export function usePostgresChanges<T = Record<string, unknown>>(
  opts: UsePostgresChangesOptions,
  onChange: (payload: PostgresChangesPayload<T>) => void,
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('disconnected')
  // Bumped by `forceReconnect` to make the subscribe effect re-run with a
  // fresh channel. `useState` (not a ref) so the effect dep array picks
  // up the change and React schedules the teardown/resubscribe.
  const [reconnectNonce, setReconnectNonce] = useState(0)

  // Latest-callback ref so consumers can pass a fresh closure every render
  // without forcing the channel to tear down and reconnect.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  /**
   * Drop the active channel and resubscribe. Optimistically flips the
   * exposed `status` to `'reconnecting'` so consumers that re-fetch on
   * the `(reconnecting → connected)` transition pick up the next
   * `SUBSCRIBED` callback. Safe to call repeatedly.
   *
   * Used internally by the `visibilitychange` listener; also a sensible
   * extension point for "Refresh" buttons in future UI work.
   */
  const forceReconnect = useCallback(() => {
    setStatus('reconnecting')
    setReconnectNonce((n) => n + 1)
  }, [])

  // Re-fetch on focus (Requirements 15.1, 15.2 / Task 19.4). Mobile
  // browsers throttle background tabs and may quietly drop the Realtime
  // WebSocket; without this listener, returning to the page from a 30s
  // background can show stale numbers indefinitely. Guarded against SSR
  // because this file is also imported by tests that may not have a DOM.
  useEffect(() => {
    if (typeof document === 'undefined') return
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        forceReconnect()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [forceReconnect])

  const {
    channel: channelName,
    schema = 'public',
    table,
    filter,
    event = '*',
  } = opts

  useEffect(() => {
    const sb = createBrowserClient()

    const filterConfig: {
      event: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
      schema: string
      table: string
      filter?: string
    } = { event, schema, table }
    if (filter) filterConfig.filter = filter

    const ch = sb
      .channel(channelName)
      .on(
        // @ts-expect-error — supabase-js typings for postgres_changes are loose
        'postgres_changes',
        filterConfig,
        (payload: PostgresChangesPayload<T>) => {
          onChangeRef.current(payload)
        },
      )
      .subscribe((subscribeStatus: string) => {
        switch (subscribeStatus) {
          case 'SUBSCRIBED':
            setStatus('connected')
            break
          case 'CHANNEL_ERROR':
          case 'TIMED_OUT':
            setStatus('reconnecting')
            break
          case 'CLOSED':
            setStatus('disconnected')
            break
          // Any other unexpected state is left as-is; we don't log on
          // disconnect — the UI surfaces that visibly via Task 7.2's
          // <StaleBadge />.
        }
      })

    return () => {
      sb.removeChannel(ch)
    }
  }, [channelName, schema, table, filter, event, reconnectNonce])

  return status
}


// ---------------------------------------------------------------------------
// Task 6.9 — channel-factory API
// ---------------------------------------------------------------------------
//
// Higher-level wrappers that build cashier and owner channels and manage
// reconnection internally. Unlike `usePostgresChanges` (which is bound to
// React component lifecycle), these factories return a plain
// `SubscriptionHandle` that owns its own state machine — useful for the
// `CashierContext` provider, server-action follow-ups, and any place where
// we want a single long-lived subscription per page rather than one per
// table-bound hook.
//
// Connection state machine:
//   - Initial state on `subscribeCashier`/`subscribeOwner` is `'connecting'`.
//   - When the underlying Supabase channel callback reports `'SUBSCRIBED'`
//     we transition to `'connected'`, reset the retry counter, and fire all
//     registered `onResync` callbacks so callers can pull a fresh snapshot
//     and reconcile any events missed while the WebSocket was down.
//   - When the callback reports `'CHANNEL_ERROR'`, `'TIMED_OUT'`, or
//     `'CLOSED'` we transition to `'disconnected'` and schedule a reconnect
//     with exponential backoff: 1s, 2s, 4s, 8s, then capped at 30s for
//     every subsequent attempt. Retry count is unbounded — Requirement 8.4
//     ("unlimited reconnection attempts").
//   - `unsubscribe()` cancels any pending reconnect, removes the active
//     channel, and clears listener sets. Subsequent state callbacks are
//     suppressed.

import type { Branch } from '@/domain/types'
import { createBrowserSupabaseClient } from './supabase/client'

export type ConnectionState = 'connected' | 'connecting' | 'disconnected'

/**
 * Realtime change event passed to the per-table handlers. Mirrors the
 * Supabase `postgres_changes` payload shape but uses the more idiomatic
 * `type` field to match Task 6.9's stated API.
 */
export interface RealtimeChangeEvent {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  new?: Record<string, unknown>
  old?: Record<string, unknown>
}

export interface SubscriptionHandle {
  /** Tear down the channel and cancel any pending reconnects. Idempotent. */
  unsubscribe(): void
  /** Current state of the underlying WebSocket subscription. */
  getConnectionState(): ConnectionState
  /** Register a state-change listener; returns an unregister function. */
  onStateChange(cb: (state: ConnectionState) => void): () => void
  /** Register a (re)connect resync callback; returns an unregister function. */
  onResync(cb: () => void): () => void
}

export interface CashierSubscriptionHandlers {
  onTransaction?: (event: RealtimeChangeEvent) => void
  onExpense?: (event: RealtimeChangeEvent) => void
  onResync?: () => void
}

export interface OwnerSubscriptionHandlers {
  onTransaction?: (event: RealtimeChangeEvent) => void
  onExpense?: (event: RealtimeChangeEvent) => void
  onRoster?: (event: RealtimeChangeEvent) => void
  onStaff?: (event: RealtimeChangeEvent) => void
  onResync?: () => void
}

interface TableListenerSpec {
  table: string
  /** Optional PostgREST filter (single clause, server-side). */
  filter?: string
  cb?: (event: RealtimeChangeEvent) => void
}

/**
 * Backoff schedule for unlimited reconnection attempts (Req 8.4).
 *
 * First four retries use 1s/2s/4s/8s; every attempt thereafter is capped
 * at 30s. There is no upper retry limit — the subscription will keep
 * trying until either it reconnects or the caller invokes `unsubscribe()`.
 */
const RECONNECT_BACKOFF_SCHEDULE_MS = [1000, 2000, 4000, 8000] as const
const RECONNECT_BACKOFF_MAX_MS = 30_000

function reconnectDelayMs(attempt: number): number {
  if (attempt < RECONNECT_BACKOFF_SCHEDULE_MS.length) {
    return RECONNECT_BACKOFF_SCHEDULE_MS[attempt]
  }
  return RECONNECT_BACKOFF_MAX_MS
}

/**
 * Build a long-lived subscription handle on top of a single Supabase
 * channel. The handle owns its own retry timer and channel reference;
 * callers interact only via the returned `SubscriptionHandle` interface.
 *
 * Each `connect()` cycle:
 *   1. Creates a fresh `supabase.channel(name)` (Realtime requires a new
 *      channel after a `removeChannel`/`CLOSED` cycle).
 *   2. Attaches one `postgres_changes` listener per spec, translating the
 *      raw `payload.eventType` into the public `RealtimeChangeEvent`
 *      shape.
 *   3. Calls `.subscribe(cb)` and dispatches state transitions inside the
 *      callback. Any non-terminal state (`'SUBSCRIBED'`) clears the retry
 *      counter; any terminal state (`'CHANNEL_ERROR' | 'TIMED_OUT' |
 *      'CLOSED'`) schedules another `connect()` after the next backoff.
 */
function createChannelSubscription(
  channelName: string,
  listenerSpecs: ReadonlyArray<TableListenerSpec>,
  initialOnResync: (() => void) | undefined,
): SubscriptionHandle {
  let state: ConnectionState = 'connecting'
  let attempt = 0
  let disposed = false
  let currentChannel: ReturnType<
    ReturnType<typeof createBrowserSupabaseClient>['channel']
  > | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const stateListeners = new Set<(s: ConnectionState) => void>()
  const resyncListeners = new Set<() => void>()
  if (initialOnResync) resyncListeners.add(initialOnResync)

  const sb = createBrowserSupabaseClient()

  function setState(next: ConnectionState) {
    if (disposed && next !== 'disconnected') return
    if (state === next) return
    state = next
    for (const cb of Array.from(stateListeners)) {
      try {
        cb(next)
      } catch {
        // Swallow listener errors so one bad consumer can't break the
        // state machine for others.
      }
    }
  }

  function fireResync() {
    for (const cb of Array.from(resyncListeners)) {
      try {
        cb()
      } catch {
        // Swallow; resync callbacks are best-effort and the next reconnect
        // will fire them again.
      }
    }
  }

  function teardownChannel() {
    if (currentChannel) {
      try {
        sb.removeChannel(currentChannel)
      } catch {
        // Channel may already be torn down server-side; ignore.
      }
      currentChannel = null
    }
  }

  function scheduleReconnect() {
    if (disposed) return
    if (reconnectTimer) return
    const delay = reconnectDelayMs(attempt)
    attempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function connect() {
    if (disposed) return
    teardownChannel()
    setState('connecting')

    let ch = sb.channel(channelName) as ReturnType<
      ReturnType<typeof createBrowserSupabaseClient>['channel']
    >
    for (const spec of listenerSpecs) {
      const filterConfig: {
        event: '*'
        schema: string
        table: string
        filter?: string
      } = { event: '*', schema: 'public', table: spec.table }
      if (spec.filter) filterConfig.filter = spec.filter
      // supabase-js's `.on('postgres_changes', …)` overload is loose at the
      // call site; we cast the bound channel to keep the chain typed.
      ch = (ch as unknown as {
        on: (
          event: 'postgres_changes',
          config: typeof filterConfig,
          cb: (payload: {
            eventType: 'INSERT' | 'UPDATE' | 'DELETE'
            new?: Record<string, unknown>
            old?: Record<string, unknown>
          }) => void,
        ) => typeof ch
      }).on(
        'postgres_changes',
        filterConfig,
        (payload: {
          eventType: 'INSERT' | 'UPDATE' | 'DELETE'
          new?: Record<string, unknown>
          old?: Record<string, unknown>
        }) => {
          if (disposed) return
          if (!spec.cb) return
          spec.cb({
            type: payload.eventType,
            new: payload.new,
            old: payload.old,
          })
        },
      )
    }
    currentChannel = ch
    ch.subscribe((status: string) => {
      if (disposed) return
      switch (status) {
        case 'SUBSCRIBED':
          attempt = 0
          setState('connected')
          // Full data refresh on every (re)connect so callers reconcile
          // anything that might have been missed while the socket was
          // disconnected (Req 8.4).
          fireResync()
          break
        case 'CHANNEL_ERROR':
        case 'TIMED_OUT':
        case 'CLOSED':
          setState('disconnected')
          scheduleReconnect()
          break
        // Any other status (e.g. transient internal Supabase states) is
        // ignored — we only react to terminal/success transitions.
      }
    })
  }

  connect()

  return {
    unsubscribe() {
      if (disposed) return
      disposed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      teardownChannel()
      // Snapshot listeners are cleared after we flip to disconnected so
      // any final state-change callback still fires.
      setState('disconnected')
      stateListeners.clear()
      resyncListeners.clear()
    },
    getConnectionState() {
      return state
    },
    onStateChange(cb) {
      if (disposed) return () => {}
      stateListeners.add(cb)
      return () => {
        stateListeners.delete(cb)
      }
    },
    onResync(cb) {
      if (disposed) return () => {}
      resyncListeners.add(cb)
      return () => {
        resyncListeners.delete(cb)
      }
    },
  }
}

/**
 * Subscribe a cashier client to live updates for its own branch.
 *
 * Channel topology:
 *   - `transactions` filtered by `branch=eq.{branch}`
 *   - `expenses`     filtered by `branch=eq.{branch}`
 *
 * Cashier surfaces (TodaySessions, SummaryPanel, EarningsPanel, …) call
 * the corresponding handlers to merge the optimistic UI with the
 * authoritative server payload. `onResync` is fired on every successful
 * (re)connect so the consumer can refetch a fresh snapshot and reconcile
 * anything dropped during a disconnection (Req 8.4).
 */
export function subscribeCashier(
  branch: Branch,
  handlers: CashierSubscriptionHandlers,
): SubscriptionHandle {
  const filter = `branch=eq.${branch}`
  const specs: TableListenerSpec[] = [
    { table: 'transactions', filter, cb: handlers.onTransaction },
    { table: 'expenses', filter, cb: handlers.onExpense },
  ]
  return createChannelSubscription(
    `cashier-${branch}`,
    specs,
    handlers.onResync,
  )
}

/**
 * Subscribe an owner client to live updates across every branch.
 *
 * Channel topology:
 *   - `transactions` (no filter)
 *   - `expenses`     (no filter)
 *   - `daily_roster` (no filter)
 *   - `staff`        (no filter)
 *
 * Owner dashboards (Command Center, Salary Board, Income, etc.) wire
 * these to incremental reducers; `onResync` is the canonical hook for
 * doing a "refetch everything" after a reconnect (Req 8.2, 8.4).
 */
export function subscribeOwner(
  handlers: OwnerSubscriptionHandlers,
): SubscriptionHandle {
  const specs: TableListenerSpec[] = [
    { table: 'transactions', cb: handlers.onTransaction },
    { table: 'expenses', cb: handlers.onExpense },
    { table: 'daily_roster', cb: handlers.onRoster },
    { table: 'staff', cb: handlers.onStaff },
  ]
  return createChannelSubscription('owner-all', specs, handlers.onResync)
}
