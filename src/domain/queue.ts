/**
 * Fair-rotation queue (Q system).
 *
 * Pure function: given a branch's roster, today's transactions, and
 * yesterday's transactions, produce the ordered queue for the next
 * walk-in. The fairness rules encoded here replace the paper-based queue
 * the boss currently maintains.
 *
 * Algorithm (per design.md §"buildQueue"):
 *
 *   1. Compute `todayEarned` per staff at this branch from `todayRows`,
 *      excluding Freelance rows and EXTRA rows. Only real (CASH/QR/CREDIT)
 *      rows count toward today's running total — EXTRA going OUT does not
 *      raise the originating cashier's number, and Freelance is paid
 *      separately.
 *   2. Compute `yesterdayEarned` per staff using the same rule against
 *      `yesterdayRows`.
 *   3. Detect busy staff: any row with `timeIn` set whose `timeOut` is
 *      null or strictly after `nowKL` marks the staff busy until
 *      `timeOut ?? estimateEnd(timeIn, duration)`.
 *   4. Track `lastEnd` per staff (max `timeOut` among today's rows). Used
 *      as a tie-break so the longest-waiting staff sorts higher.
 *   5. Build raw entries from `todayRoster`. `isNew = todayEarned === 0`.
 *   6. Honour `pinnedOrder` if supplied: pinned-first-in-pin-order,
 *      unpinned tail filled by fairness sort. Busy staff still get
 *      position 0 even when pinned.
 *   7. Assign positions: busy → 0 (held), free → sequential 1-based.
 *
 * Default `nowKL` is `'23:59'` so when no clock is supplied (snapshot
 * rendering, tests) every today row is past its end-time and no one
 * looks busy.
 *
 * Pure function — no I/O, no system clock reads. `nowKL` is always
 * passed in.
 *
 * Validates: Requirements 4.1 (display roster ordered by engine output),
 *            4.2 (lower today earner sorts higher),
 *            4.3 (zero-earner staff first),
 *            4.4 (yesterday tie-break),
 *            4.5 (lastEnd tie-break),
 *            4.6 (deterministic name tie-break),
 *            4.7 (busy → position 0),
 *            4.8 (free re-classify after timeOut),
 *            4.9 (real rows only),
 *            4.10 (pinned override),
 *            4.11 (referential transparency).
 *
 * Property tests (see queue.test.ts and design.md §"Correctness Properties"):
 *   Property 16 — Lower earner sorts higher
 *   Property 17 — New staff first
 *   Property 18 — Tie-break by yesterday
 *   Property 19 — Busy staff held at position 0
 *   Property 20 — Stability under identical input
 */

import type { Branch } from './row-id'
import { decodeExtraDestination } from './extra'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type QueueStatus = 'free' | 'busy' | 'off'

export interface QueueEntry {
  staff: string
  status: QueueStatus
  busyUntil?: string
  todayEarned: number
  yesterdayEarned: number
  isNew: boolean
  position: number
  lastEnd?: string
  /** Current session details (only when busy). */
  course?: string
  duration?: number
  timeIn?: string
}

export interface QueueRow {
  // Subset of TransactionRow needed by the queue engine.
  staff: string
  branch: Branch
  businessDate: string
  method: string
  commission: number
  timeIn: string | null
  timeOut: string | null
  duration: number
  course?: string
}

export interface QueueInput {
  branch: Branch
  businessDate: string
  todayRows: QueueRow[]
  yesterdayRows: QueueRow[]
  todayRoster: string[]
  pinnedOrder?: string[]
  /**
   * Current KL time as `HH:mm` or `HH:mm:ss`. Defaults to `'23:59'`
   * (so all today's rows count as past their end-time and no one looks
   * busy by default — useful for snapshot rendering or testing).
   */
  nowKL?: string
}

// ---------------------------------------------------------------------------
// Time helpers (private)
// ---------------------------------------------------------------------------

const DEFAULT_NOW_KL = '23:59'
const TIME_FALLBACK_END = '23:59'
const TIME_ZERO = '00:00'

/**
 * Coerce an `HH:mm` or `HH:mm:ss` string to its `HH:mm` head so lex
 * comparison is well-defined across mixed inputs.
 */
function toHHMM(time: string): string {
  return time.length >= 5 ? time.slice(0, 5) : time
}

/**
 * `HH:mm` lex comparison: zero-padded inputs make string comparison
 * equivalent to numeric clock comparison.
 */
function timeAfterOrEqual(a: string, b: string): boolean {
  return toHHMM(a) >= toHHMM(b)
}

/**
 * Returns the later of two `HH:mm` strings, treating `null` as
 * "no time yet". Returns `null` only when both inputs are `null`.
 */
function maxTime(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return timeAfterOrEqual(a, b) ? a : b
}

/**
 * `HH:mm + N minutes → HH:mm`. Clamps to `'23:59'` on overflow past
 * midnight (rare but possible) and to `'00:00'` on negative results.
 * Returns `'23:59'` if the input cannot be parsed.
 */
function addMinutes(timeStr: string, minutes: number): string {
  const head = toHHMM(timeStr)
  const parts = head.split(':')
  if (parts.length !== 2) return TIME_FALLBACK_END
  const hh = Number.parseInt(parts[0], 10)
  const mm = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return TIME_FALLBACK_END
  const total = hh * 60 + mm + (Number.isFinite(minutes) ? minutes : 0)
  if (total < 0) return TIME_ZERO
  if (total >= 24 * 60) return TIME_FALLBACK_END
  const newHH = Math.floor(total / 60)
  const newMM = total % 60
  return `${String(newHH).padStart(2, '0')}:${String(newMM).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Earnings filter
// ---------------------------------------------------------------------------

/**
 * Excludes Freelance and EXTRA rows from today/yesterday earnings.
 * EXTRA destination is decoded by `decodeExtraDestination` (handles
 * EXTRA KM / EXTRA-CL / extra bs / etc.). Freelance check is
 * case-insensitive and whitespace-tolerant to match cashier input.
 */
function isExcludedFromEarnings(method: string): boolean {
  const trimmed = String(method ?? '').trim()
  if (trimmed.toLowerCase() === 'freelance') return true
  if (decodeExtraDestination(trimmed) !== null) return true
  return false
}

// ---------------------------------------------------------------------------
// Fairness sort
// ---------------------------------------------------------------------------

interface RawEntry {
  staff: string
  staffLower: string
  status: QueueStatus
  busyUntil?: string
  todayEarned: number
  yesterdayEarned: number
  isNew: boolean
  lastEnd?: string
  course?: string
  duration?: number
  timeIn?: string
}

/**
 * Stable comparator implementing the fairness rules:
 *   1. isNew DESC          (new staff first)
 *   2. todayEarned ASC     (lowest earner next)
 *   3. yesterdayEarned ASC (worse yesterday goes up)
 *   4. lastEnd ASC         ('00:00' or null = waiting all day)
 *   5. lower(staff) ASC    (final deterministic tie-break)
 */
function compareFairness(a: RawEntry, b: RawEntry): number {
  if (a.isNew !== b.isNew) return a.isNew ? -1 : 1
  if (a.todayEarned !== b.todayEarned) return a.todayEarned - b.todayEarned
  if (a.yesterdayEarned !== b.yesterdayEarned) {
    return a.yesterdayEarned - b.yesterdayEarned
  }
  const aLast = a.lastEnd ?? TIME_ZERO
  const bLast = b.lastEnd ?? TIME_ZERO
  if (aLast !== bLast) return toHHMM(aLast) < toHHMM(bLast) ? -1 : 1
  if (a.staffLower < b.staffLower) return -1
  if (a.staffLower > b.staffLower) return 1
  return 0
}

// ---------------------------------------------------------------------------
// buildQueue
// ---------------------------------------------------------------------------

export function buildQueue(input: QueueInput): QueueEntry[] {
  const nowKL = toHHMM(input.nowKL ?? DEFAULT_NOW_KL)

  // 1 + 2. Earnings tallies (real rows only — exclude EXTRA and Freelance).
  const todayBy = new Map<string, number>()
  for (const row of input.todayRows) {
    if (isExcludedFromEarnings(row.method)) continue
    const key = row.staff.toLowerCase()
    todayBy.set(key, (todayBy.get(key) ?? 0) + row.commission)
  }

  const yesterdayBy = new Map<string, number>()
  for (const row of input.yesterdayRows) {
    if (isExcludedFromEarnings(row.method)) continue
    const key = row.staff.toLowerCase()
    yesterdayBy.set(key, (yesterdayBy.get(key) ?? 0) + row.commission)
  }

  // 3. Busy detection + 4. lastEnd tracking from today's rows.
  const busyUntilBy = new Map<string, string>()
  const busyCourseBy = new Map<string, string>()
  const busyDurationBy = new Map<string, number>()
  const busyTimeInBy = new Map<string, string>()
  const lastEndBy = new Map<string, string>()
  for (const row of input.todayRows) {
    const key = row.staff.toLowerCase()
    if (row.timeIn !== null) {
      const tOut = row.timeOut
      const stillOpen = tOut === null || toHHMM(tOut) > nowKL
      if (stillOpen) {
        const until = tOut ?? addMinutes(row.timeIn, row.duration)
        const existing = busyUntilBy.get(key)
        if (existing === undefined || timeAfterOrEqual(until, existing)) {
          busyUntilBy.set(key, until)
          busyCourseBy.set(key, (row as { course?: string }).course ?? '')
          busyDurationBy.set(key, row.duration)
          busyTimeInBy.set(key, row.timeIn)
        }
      }
    }
    if (row.timeOut !== null) {
      const next = maxTime(lastEndBy.get(key) ?? null, row.timeOut)
      if (next !== null) lastEndBy.set(key, next)
    }
  }

  // 5. Build raw entries from roster.
  const rawEntries: RawEntry[] = input.todayRoster.map((name) => {
    const staffLower = name.toLowerCase()
    const todayEarned = todayBy.get(staffLower) ?? 0
    const yesterdayEarned = yesterdayBy.get(staffLower) ?? 0
    const busyUntil = busyUntilBy.get(staffLower)
    const lastEnd = lastEndBy.get(staffLower)
    const status: QueueStatus = busyUntil !== undefined ? 'busy' : 'free'
    const entry: RawEntry = {
      staff: name,
      staffLower,
      status,
      todayEarned,
      yesterdayEarned,
      isNew: todayEarned === 0,
    }
    if (busyUntil !== undefined) {
      entry.busyUntil = busyUntil
      entry.course = busyCourseBy.get(staffLower)
      entry.duration = busyDurationBy.get(staffLower)
      entry.timeIn = busyTimeInBy.get(staffLower)
    }
    if (lastEnd !== undefined) entry.lastEnd = lastEnd
    return entry
  })

  // 6. Pin handling: pinned-first-in-pin-order, unpinned tail by fairness.
  let ordered: RawEntry[]
  if (input.pinnedOrder && input.pinnedOrder.length > 0) {
    const pinnedLowerSet = new Set<string>(
      input.pinnedOrder.map((n) => n.toLowerCase()),
    )
    const byLower = new Map<string, RawEntry>()
    for (const e of rawEntries) byLower.set(e.staffLower, e)

    const pinned: RawEntry[] = []
    const seen = new Set<string>()
    for (const name of input.pinnedOrder) {
      const lower = name.toLowerCase()
      if (seen.has(lower)) continue
      const entry = byLower.get(lower)
      if (entry !== undefined) {
        pinned.push(entry)
        seen.add(lower)
      }
    }
    const unpinned = rawEntries
      .filter((e) => !pinnedLowerSet.has(e.staffLower))
      .sort(compareFairness)
    ordered = [...pinned, ...unpinned]
  } else {
    ordered = [...rawEntries].sort(compareFairness)
  }

  // 7. Assign positions: busy → 0; free → sequential 1-based.
  let pos = 1
  const result: QueueEntry[] = []
  for (const e of ordered) {
    const isBusy = e.status === 'busy'
    const entry: QueueEntry = {
      staff: e.staff,
      status: e.status,
      todayEarned: e.todayEarned,
      yesterdayEarned: e.yesterdayEarned,
      isNew: e.isNew,
      position: isBusy ? 0 : pos,
    }
    if (e.busyUntil !== undefined) entry.busyUntil = e.busyUntil
    if (e.course !== undefined) entry.course = e.course
    if (e.duration !== undefined) entry.duration = e.duration
    if (e.timeIn !== undefined) entry.timeIn = e.timeIn
    if (e.lastEnd !== undefined) entry.lastEnd = e.lastEnd
    if (!isBusy) pos += 1
    result.push(entry)
  }

  return result
}

// ===========================================================================
// computeQueueBoard — live queue board (heals-system-rebuild Task 4.10)
// ===========================================================================
//
// `computeQueueBoard` is the per-staff live availability projection rendered
// by the cashier's QueueBoard widget (design.md §"Queue Board Computation").
// It is independent of `buildQueue` above (which solves a different problem,
// the fair-rotation queue). They share this file because both surfaces
// describe the same staff/session inputs.
//
// Algorithm (per task 4.10 / Requirements 16.1–16.4):
//
//   For each staff in `roster`:
//     1. Find that staff's most recent transaction (latest `timeIn`) where
//        BOTH `timeIn` and `timeOut` are set, AND the parsed `timeOut`
//        (`HH:mm` interpreted against `row.businessDate` in
//        Asia/Kuala_Lumpur) is strictly greater than `now`.
//     2. If found → status = 'busy',
//        minutesRemaining = floor((timeOut − now) / 60s),
//        currentCourse = row.course.
//     3. Else → status = 'free', minutesRemaining = null,
//        currentCourse = null.
//
// Status transitions are exact at `time_out`: when `now === time_out`
// (millisecond-equal), the staff is free with no tolerance window
// (Requirement 16.3). The strict `>` comparison enforces this.
//
// Pure function — no I/O, no system clock reads. `now` is always passed in.
// Same staff name matched case-insensitively against roster (consistent
// with the rest of the domain layer).
//
// Validates:
//   - Requirement 16.1 (per-rostered-staff status display)
//   - Requirement 16.2 (busy when timeIn set and timeOut in future)
//   - Requirement 16.3 (exact time_out transition, no tolerance)
//   - Requirement 16.4 (deterministic projection reflects current rows)

import { fromZonedTime } from 'date-fns-tz'
import type {
  StaffMember,
  StaffQueueStatus,
  TransactionRow,
} from './types'

const KL_TZ = 'Asia/Kuala_Lumpur'

/**
 * Parse an `HH:mm` (or `HH:mm:ss`) wall-clock time against a
 * `yyyy-MM-dd` business date in Asia/Kuala_Lumpur, returning the
 * absolute UTC instant. Used to compare row times to `now` in the
 * same time space.
 */
function parseTimeAgainstDateKL(businessDate: string, hhmm: string): Date {
  const head = hhmm.length >= 5 ? hhmm.slice(0, 5) : hhmm
  return fromZonedTime(`${businessDate} ${head}:00`, KL_TZ)
}

/**
 * Compute the live queue board for a branch.
 *
 * @param roster        Active rostered staff to project status for.
 * @param transactions  Candidate session rows (typically the day's rows
 *                      for the branch; rows for other staff are filtered
 *                      out by name).
 * @param now           Reference instant ("now") against which `timeOut`
 *                      is compared. Strictly `>` for busy status.
 * @returns             One `StaffQueueStatus` per roster entry, in
 *                      roster order. Staff with no matching active
 *                      session are returned as `'free'`.
 */
export function computeQueueBoard(
  roster: StaffMember[],
  transactions: TransactionRow[],
  now: Date,
): StaffQueueStatus[] {
  const nowMs = now.getTime()
  const results: StaffQueueStatus[] = []

  for (const staff of roster) {
    const staffLower = staff.name.toLowerCase()
    let bestRow: TransactionRow | null = null
    let bestTimeInMs = -Infinity
    let bestMinutesRemaining = 0

    for (const tx of transactions) {
      if (tx.staff.toLowerCase() !== staffLower) continue
      if (tx.timeIn === null || tx.timeOut === null) continue

      const timeOutMs = parseTimeAgainstDateKL(
        tx.businessDate,
        tx.timeOut,
      ).getTime()
      // Strict `>` — at exactly time_out, busy→free with no tolerance
      // (Requirement 16.3).
      if (timeOutMs <= nowMs) continue

      const timeInMs = parseTimeAgainstDateKL(
        tx.businessDate,
        tx.timeIn,
      ).getTime()

      // "Most recent" = latest timeIn among the still-active sessions.
      if (timeInMs > bestTimeInMs) {
        bestTimeInMs = timeInMs
        bestRow = tx
        bestMinutesRemaining = Math.floor((timeOutMs - nowMs) / 60_000)
      }
    }

    if (bestRow !== null) {
      results.push({
        staffName: staff.name,
        status: 'busy',
        minutesRemaining: bestMinutesRemaining,
        currentCourse: bestRow.course,
      })
    } else {
      results.push({
        staffName: staff.name,
        status: 'free',
        minutesRemaining: null,
        currentCourse: null,
      })
    }
  }

  return results
}
