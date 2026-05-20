'use client'

/**
 * heals-system-rebuild — CashierContext (Task 8.2)
 *
 * Single source of truth for everything the cashier panel renders:
 * today's transactions, today's expenses, the active roster, the
 * lookup tables (prices + commission rates), the realtime connection
 * state, and the offline-sync badge state.
 *
 * The page (`page.tsx`) is a Server Component that fetches every
 * piece of state above with the SSR Supabase client and passes the
 * snapshots in via `<CashierProvider initial...>`. This component
 * then wires:
 *
 *   1. Optimistic mutators — `addOptimistic`, `replaceOptimistic`,
 *      `removeOptimistic` — that the SessionTable / ExpenseBlock /
 *      RosterPanel call BEFORE the server action runs so the cashier
 *      sees the row immediately.
 *
 *   2. Realtime subscription — opens a `subscribeCashier(branch)`
 *      channel and merges `INSERT`/`UPDATE`/`DELETE` payloads into
 *      `transactions` / `expenses` so the cashier sees writes from
 *      another device within ~2s. Updates `connectionState` on every
 *      transition; on every successful (re)connect, a full
 *      `refreshAll()` runs so any events missed during a drop are
 *      reconciled.
 *
 *   3. Offline-sync — starts the `startOfflineSync()` worker and
 *      mirrors its status into `pendingSyncCount` and
 *      `showPendingBadge`. The badge shows when there are pending
 *      writes AND the most recent attempt failed; it hides
 *      immediately on the FIRST success after a stretch of failures
 *      per Req 7.4.
 *
 *   4. Morning reset — polls `getBusinessDate(now)` every 30s; when
 *      the date crosses 5 AM Asia/Kuala_Lumpur the page refetches
 *      "today" so the table empties for the new business day
 *      (Req 21.1).
 *
 * Backwards-compat: keeps the legacy `useCashierContext()` hook +
 * `readOnly` flag the existing panels still import. New code should
 * prefer `useCashier()` which exposes the full context.
 *
 * Validates: Requirements 7.1, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 21.1,
 *            21.2, 21.3, 23.3.
 *
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/design.md
 *      §"Cashier Context Provider"
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { getBusinessDate } from '@/domain/business-date'
import type {
  Branch,
  ExpenseRow,
  StaffMember,
  TransactionRow,
} from '@/domain/types'
import type {
  FreelanceRateRow,
  PriceRow,
  RegularRateRow,
} from '@/domain/commission'
import {
  startOfflineSync,
  type OfflineSyncStatus,
} from '@/lib/offline-sync'
import {
  subscribeCashier,
  type ConnectionState,
  type RealtimeChangeEvent,
  type SubscriptionHandle,
} from '@/lib/realtime'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CashierContextValue {
  /** Branch this provider is scoped to. */
  branch: Branch
  /** Server-canonical business date at provider mount. Recomputed daily. */
  businessDate: string
  /** Today's transactions for `branch`, sorted by `cashierRowNumber`. */
  transactions: TransactionRow[]
  /** Today's expenses for `branch`. */
  expenses: ExpenseRow[]
  /**
   * Yesterday's transactions for `branch`. Used by the queue board's
   * tie-break rule: when two staff have the same today-earnings, the
   * one who earned LESS yesterday goes higher today (the "swap" rule).
   * Static after first paint — yesterday doesn't change unless the
   * owner backfills it via the Time Machine.
   */
  yesterdayTransactions: TransactionRow[]
  /** Active staff for the branch + freelancers across branches. */
  roster: StaffMember[]
  /**
   * Names of the staff saved in `daily_roster` for today (set via the
   * RosterPanel's "Manage roster" picker). The QueueBoard uses this
   * directly so the queue shows the moment the cashier saves the
   * roster — even before any session row has been typed.
   */
  dailyRoster: string[]
  /** Full price table (current + Bishop FR -2 already encoded). */
  prices: ReadonlyArray<PriceRow>
  /** Regular commission rates with effective_from versioning. */
  regularRates: ReadonlyArray<RegularRateRow>
  /** Freelance commission rates (Bishop FR floor applied at lookup). */
  freelanceRates: ReadonlyArray<FreelanceRateRow>

  /** Realtime channel state — used by the connection indicator. */
  connectionState: ConnectionState
  /** Offline queue depth (rows waiting to flush). */
  pendingSyncCount: number
  /** Badge visibility; hidden on first success after failures. */
  showPendingBadge: boolean
  /** ISO timestamp of the most recent successful background sync. */
  lastSyncAt: string | null
  /** Most recent offline-sync error message. */
  lastSyncError: string | null

  /** True for owner-readonly views; disables all edit affordances. */
  readOnly: boolean

  // -------- Optimistic-update helpers (called before server action) ---
  /** Add or replace a transaction in local state by row identity. */
  addOptimistic: (row: TransactionRow) => void
  /** Replace a transaction by id (post-server-confirm). */
  replaceOptimistic: (row: TransactionRow) => void
  /** Remove a transaction from local state. */
  removeOptimistic: (id: string) => void
  /** Optimistic add for an expense row. */
  addOptimisticExpense: (row: ExpenseRow) => void
  /** Replace expense by id. */
  replaceOptimisticExpense: (row: ExpenseRow) => void
  /** Remove expense by id. */
  removeOptimisticExpense: (id: string) => void

  /** Refetch transactions + expenses for the current business date. */
  refreshAll: () => Promise<void>
  /** Force the offline-sync worker to drain right now. */
  drainOfflineNow: () => Promise<void>
  /** Update the saved daily roster names locally (after picker save). */
  setDailyRoster: (names: string[]) => void
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map a snake_case `transactions` row from PostgREST into the
 * camelCase `TransactionRow` the domain layer consumes. Numeric
 * columns may arrive as strings depending on driver; coerce
 * defensively.
 */
function mapTxRow(row: Record<string, unknown>): TransactionRow {
  const n = (v: unknown): number => {
    if (typeof v === 'number') return v
    if (v == null) return 0
    const x = Number(v)
    return Number.isFinite(x) ? x : 0
  }
  const s = (v: unknown): string => (v == null ? '' : String(v))
  const sn = (v: unknown): string | null => (v == null ? null : String(v))
  return {
    id: s(row.id),
    branch: s(row.branch) as Branch,
    businessDate: s(row.business_date),
    cashierRowNumber: n(row.cashier_row_number),
    staff: s(row.staff),
    course: s(row.course) as TransactionRow['course'],
    duration: n(row.duration) as TransactionRow['duration'],
    timeIn: sn(row.time_in),
    timeOut: sn(row.time_out),
    method: s(row.method),
    addon: n(row.addon),
    baseCommission: n(row.base_commission),
    balmBonus: n(row.balm_bonus),
    bookingBonus: n(row.booking_bonus),
    totalCommission: n(row.total_commission),
    cash: n(row.cash),
    qr: n(row.qr),
    credit: n(row.credit),
    price: n(row.price),
    flags: s(row.flags),
    comment: s(row.comment),
    createdAt: s(row.created_at),
    updatedAt: s(row.updated_at),
    createdBy: sn(row.created_by),
  }
}

function mapExpenseRow(row: Record<string, unknown>): ExpenseRow {
  const n = (v: unknown): number => {
    if (typeof v === 'number') return v
    if (v == null) return 0
    const x = Number(v)
    return Number.isFinite(x) ? x : 0
  }
  const s = (v: unknown): string => (v == null ? '' : String(v))
  const sn = (v: unknown): string | null => (v == null ? null : String(v))
  return {
    id: s(row.id),
    branch: s(row.branch) as Branch,
    businessDate: s(row.business_date),
    item: s(row.item),
    amount: n(row.amount),
    method: s(row.method) as ExpenseRow['method'],
    note: s(row.note),
    source: s(row.source) as ExpenseRow['source'],
    createdAt: s(row.created_at),
    createdBy: sn(row.created_by),
  }
}

function sortByRowNum(a: TransactionRow, b: TransactionRow): number {
  return a.cashierRowNumber - b.cashierRowNumber
}

// ---------------------------------------------------------------------------
// Context object
// ---------------------------------------------------------------------------

const CashierCtx = createContext<CashierContextValue | null>(null)

export interface CashierProviderProps {
  branch: Branch
  businessDate: string
  initialTransactions: TransactionRow[]
  initialExpenses: ExpenseRow[]
  initialRoster: StaffMember[]
  initialPrices: ReadonlyArray<PriceRow>
  initialRegularRates: ReadonlyArray<RegularRateRow>
  initialFreelanceRates: ReadonlyArray<FreelanceRateRow>
  /** Optional yesterday transactions for queue tie-break. Default: `[]`. */
  initialYesterdayTransactions?: TransactionRow[]
  /** Optional saved daily roster names for today. Default: `[]`. */
  initialDailyRoster?: string[]
  readOnly?: boolean
  children: ReactNode
}

export function CashierProvider(props: CashierProviderProps) {
  const {
    branch,
    businessDate: initialBusinessDate,
    initialTransactions,
    initialExpenses,
    initialRoster,
    initialPrices,
    initialRegularRates,
    initialFreelanceRates,
    initialYesterdayTransactions = [],
    initialDailyRoster = [],
    readOnly = false,
    children,
  } = props

  const [businessDate, setBusinessDate] = useState(initialBusinessDate)
  const [transactions, setTransactions] = useState<TransactionRow[]>(
    () => [...initialTransactions].sort(sortByRowNum),
  )
  const [expenses, setExpenses] = useState<ExpenseRow[]>(initialExpenses)
  const [yesterdayTransactions] = useState<TransactionRow[]>(
    initialYesterdayTransactions,
  )
  const [roster] = useState(initialRoster)
  const [dailyRoster, setDailyRoster] = useState<string[]>(initialDailyRoster)
  const [prices] = useState(initialPrices)
  const [regularRates] = useState(initialRegularRates)
  const [freelanceRates] = useState(initialFreelanceRates)

  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting')
  const [pendingSyncCount, setPendingSyncCount] = useState(0)
  const [showPendingBadge, setShowPendingBadge] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [lastSyncError, setLastSyncError] = useState<string | null>(null)

  // Refs let event handlers read latest state without forcing a
  // re-subscribe every keystroke.
  const businessDateRef = useRef(businessDate)
  useEffect(() => {
    businessDateRef.current = businessDate
  }, [businessDate])

  // -- Optimistic mutators -------------------------------------------------
  const addOptimistic = useCallback((row: TransactionRow) => {
    setTransactions((prev) => {
      const idx = prev.findIndex(
        (r) =>
          r.branch === row.branch &&
          r.businessDate === row.businessDate &&
          r.cashierRowNumber === row.cashierRowNumber,
      )
      const next = idx >= 0 ? [...prev] : [...prev, row]
      if (idx >= 0) next[idx] = row
      next.sort(sortByRowNum)
      return next
    })
  }, [])

  const replaceOptimistic = useCallback((row: TransactionRow) => {
    setTransactions((prev) => {
      const idx = prev.findIndex((r) => r.id === row.id)
      if (idx < 0) {
        // Unknown id — fall back to row-number identity (server may
        // have just assigned an id we hadn't seen yet).
        return [...prev, row].sort(sortByRowNum)
      }
      const next = [...prev]
      next[idx] = row
      next.sort(sortByRowNum)
      return next
    })
  }, [])

  const removeOptimistic = useCallback((id: string) => {
    setTransactions((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const addOptimisticExpense = useCallback((row: ExpenseRow) => {
    setExpenses((prev) => {
      const idx = prev.findIndex((r) => r.id === row.id)
      if (idx < 0) return [...prev, row]
      const next = [...prev]
      next[idx] = row
      return next
    })
  }, [])

  const replaceOptimisticExpense = useCallback((row: ExpenseRow) => {
    setExpenses((prev) => {
      const idx = prev.findIndex((r) => r.id === row.id)
      if (idx < 0) return [...prev, row]
      const next = [...prev]
      next[idx] = row
      return next
    })
  }, [])

  const removeOptimisticExpense = useCallback((id: string) => {
    setExpenses((prev) => prev.filter((r) => r.id !== id))
  }, [])

  // -- Refresh from DB -----------------------------------------------------
  const refreshAll = useCallback(async () => {
    const date = businessDateRef.current
    const sb = createBrowserSupabaseClient()
    const [{ data: txs }, { data: exps }] = await Promise.all([
      sb
        .from('transactions')
        .select('*')
        .eq('branch', branch)
        .eq('business_date', date)
        .order('cashier_row_number', { ascending: true }),
      sb
        .from('expenses')
        .select('*')
        .eq('branch', branch)
        .eq('business_date', date),
    ])
    if (txs) {
      setTransactions(
        (txs as Record<string, unknown>[]).map(mapTxRow).sort(sortByRowNum),
      )
    }
    if (exps) {
      setExpenses((exps as Record<string, unknown>[]).map(mapExpenseRow))
    }
  }, [branch])

  // -- Realtime subscription ----------------------------------------------
  useEffect(() => {
    let handle: SubscriptionHandle | null = null
    handle = subscribeCashier(branch, {
      onTransaction: (event: RealtimeChangeEvent) => {
        if (!event.new && !event.old) return
        const date = businessDateRef.current
        // Only merge events for the current business date — we don't
        // render historical rows here.
        if (event.type === 'DELETE' && event.old) {
          if ((event.old as { business_date?: string }).business_date !== date)
            return
          const id = String((event.old as { id?: unknown }).id ?? '')
          if (id) {
            setTransactions((prev) => prev.filter((r) => r.id !== id))
          }
          return
        }
        const raw = event.new as Record<string, unknown> | undefined
        if (!raw) return
        if (String(raw.business_date ?? '') !== date) return
        const row = mapTxRow(raw)
        setTransactions((prev) => {
          const idx = prev.findIndex((r) => r.id === row.id)
          const next = idx >= 0 ? [...prev] : [...prev, row]
          if (idx >= 0) next[idx] = row
          next.sort(sortByRowNum)
          return next
        })
      },
      onExpense: (event: RealtimeChangeEvent) => {
        const date = businessDateRef.current
        if (event.type === 'DELETE' && event.old) {
          if ((event.old as { business_date?: string }).business_date !== date)
            return
          const id = String((event.old as { id?: unknown }).id ?? '')
          if (id) {
            setExpenses((prev) => prev.filter((r) => r.id !== id))
          }
          return
        }
        const raw = event.new as Record<string, unknown> | undefined
        if (!raw) return
        if (String(raw.business_date ?? '') !== date) return
        const row = mapExpenseRow(raw)
        setExpenses((prev) => {
          const idx = prev.findIndex((r) => r.id === row.id)
          if (idx < 0) return [...prev, row]
          const next = [...prev]
          next[idx] = row
          return next
        })
      },
      onResync: () => {
        // Full refetch on every (re)connect to reconcile any events
        // missed while the WebSocket was down (Req 8.4).
        void refreshAll()
      },
    })
    const offState = handle.onStateChange((s) => setConnectionState(s))
    setConnectionState(handle.getConnectionState())
    return () => {
      offState()
      handle?.unsubscribe()
    }
  }, [branch, refreshAll])

  // -- Offline sync worker ------------------------------------------------
  const offlineHandleRef = useRef<ReturnType<typeof startOfflineSync> | null>(
    null,
  )
  useEffect(() => {
    const handle = startOfflineSync()
    offlineHandleRef.current = handle
    const off = handle.onStatusChange((s: OfflineSyncStatus) => {
      setPendingSyncCount(s.pending)
      setShowPendingBadge(s.showBadge)
      setLastSyncAt(s.lastSyncAt)
      setLastSyncError(s.lastError)
    })
    return () => {
      off()
      handle.stop()
      offlineHandleRef.current = null
    }
  }, [])

  const drainOfflineNow = useCallback(async () => {
    await offlineHandleRef.current?.drainNow()
  }, [])

  // -- Focus-based refresh (picks up mirror rows from other branches) ----
  // When the cashier switches from the Bishop tab back to Kimberry,
  // the mirror EXTRA BS row that was created server-side won't appear
  // until the page re-renders. Refreshing on window focus fixes this
  // without polling and without WebSockets.
  useEffect(() => {
    function onFocus() {
      void refreshAll()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshAll])
  // Poll every 30s; when getBusinessDate(now) advances past the
  // currently-displayed date, the cashier table needs to clear and
  // refetch. The DB still holds yesterday's rows; only the view
  // changes (Req 21.1, 21.2, 21.3).
  useEffect(() => {
    function tick() {
      const next = getBusinessDate(new Date())
      if (next !== businessDateRef.current) {
        setBusinessDate(next)
        // Empty the local state immediately so the cashier doesn't see
        // yesterday's rows for even a millisecond, then refetch the
        // new (likely empty) business date in the background.
        setTransactions([])
        setExpenses([])
        void refreshAll()
      }
    }
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [refreshAll])

  // -- Memoised context value ---------------------------------------------
  const value = useMemo<CashierContextValue>(
    () => ({
      branch,
      businessDate,
      transactions,
      expenses,
      yesterdayTransactions,
      roster,
      dailyRoster,
      prices,
      regularRates,
      freelanceRates,
      connectionState,
      pendingSyncCount,
      showPendingBadge,
      lastSyncAt,
      lastSyncError,
      readOnly,
      addOptimistic,
      replaceOptimistic,
      removeOptimistic,
      addOptimisticExpense,
      replaceOptimisticExpense,
      removeOptimisticExpense,
      setDailyRoster,
      refreshAll,
      drainOfflineNow,
    }),
    [
      branch,
      businessDate,
      transactions,
      expenses,
      yesterdayTransactions,
      roster,
      dailyRoster,
      prices,
      regularRates,
      freelanceRates,
      connectionState,
      pendingSyncCount,
      showPendingBadge,
      lastSyncAt,
      lastSyncError,
      readOnly,
      addOptimistic,
      replaceOptimistic,
      removeOptimistic,
      addOptimisticExpense,
      replaceOptimisticExpense,
      removeOptimisticExpense,
      refreshAll,
      drainOfflineNow,
    ],
  )

  return <CashierCtx.Provider value={value}>{children}</CashierCtx.Provider>
}

/**
 * Strict hook — throws when called outside a `CashierProvider`. Used
 * by the new heals UI (SessionTable, panels, badges) which always
 * mounts inside the provider.
 */
export function useCashier(): CashierContextValue {
  const ctx = useContext(CashierCtx)
  if (!ctx) {
    throw new Error('useCashier() must be called within <CashierProvider>')
  }
  return ctx
}

/**
 * Backwards-compat shim. The legacy panels imported
 * `useCashierContext` and only used `readOnly`. New code should use
 * `useCashier()` instead. The shim returns a non-throwing default
 * when the provider is absent so any stray legacy caller still
 * renders.
 */
export function useCashierContext(): { readOnly: boolean } {
  const ctx = useContext(CashierCtx)
  return { readOnly: ctx?.readOnly ?? false }
}
