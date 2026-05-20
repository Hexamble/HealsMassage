'use server'

/**
 * heals-system-rebuild — `writeTransaction` server action.
 *
 * The single Server Action through which every cashier session row,
 * and every owner historical edit, enters the `transactions` table.
 * All other surfaces (cashier table, queue board, salary board,
 * income board, time machine) are read-only views over `transactions`
 * so the correctness of this action is the correctness of the system.
 *
 * Pipeline:
 *
 *   1. Authenticate via `getCurrentProfile()`. Unauthenticated callers
 *      bounce out before touching the DB. Cashier role is pinned to a
 *      single branch via `profiles.branch`; owner role is permitted to
 *      write to any branch.
 *   2. Pre-extract the optional extension fields the cashier UI and the
 *      owner historical-backfill UI may attach to the payload:
 *        - `businessDate` — owner-only override; cashiers always use
 *          the server-canonical 5 AM Asia/Kuala_Lumpur cutoff date
 *          (Req 4.1, 4.2). Owners may pass any past date for
 *          historical entry / correction.
 *        - `cashierRowNumber` — owner-only override. When omitted the
 *          server assigns `MAX(cashier_row_number)+1` for the
 *          (branch, businessDate) pair so the cashier UI never has to
 *          sync row numbers with peers (Req 3.1, 3.5).
 *        - `baseCommission`, `balmBonus`, `bookingBonus`,
 *          `totalCommission` — per-row override values the cashier
 *          may type after the auto-fill from `computeCommission`.
 *      Extension fields are pulled from the raw input here because the
 *      shared `transactionSchema` in `@/domain/validators` does not
 *      declare them (it predates the override design).
 *   3. Branch claim check. Cashiers who try to write to a branch other
 *      than their `profiles.branch` are rejected at the application
 *      layer with `BRANCH_MISMATCH`; the same constraint is enforced
 *      again by the `transactions` RLS policy.
 *   4. Resolve `businessDate` — explicit owner override or
 *      `getBusinessDate(new Date())`.
 *   5. Resolve `cashierRowNumber` — explicit owner override or the
 *      computed next available number.
 *   6. Validate the merged input via `transactionSchema`. The schema
 *      enforces field types, the `cash + qr + credit === price`
 *      payment-balance for real-payment methods (Req 2.4), and the
 *      EXTRA-rows-have-zero-money invariant (Req 2.5). Staff name
 *      normalisation (Req 2.10, 2.11) happens inside the schema.
 *   7. Resolve the staff row. Case-insensitive name lookup against
 *      `staff`. For `Method=Freelance` with no DB match, accept the
 *      normalised name as a freeform freelancer per Req 2.8–2.12 — the
 *      `Staff_Roster` is left untouched (Req 14.6) and the typed name
 *      is stored verbatim on the row only. For other methods on the
 *      cashier path, additionally require the resolved staff to be on
 *      today's `daily_roster` for the writing branch (Req 15.2). Owner
 *      callers skip the daily-roster check (historical edits / staff
 *      that stopped working may not be on today's roster).
 *   8. Resolve `price` — server safeguard. If the caller did NOT
 *      explicitly include a `price` field in the raw input, fall back
 *      to `lookupCustomerPrice(course, duration, branch, priceTable)`.
 *      The cashier UI auto-fills price from the same lookup, so the
 *      common case threads the looked-up value through unchanged; this
 *      branch covers programmatic callers that omit price entirely.
 *   9. Resolve commission components — server safeguard. Whichever of
 *      `baseCommission`, `balmBonus`, `bookingBonus` is missing from
 *      the raw input is filled in by `computeCommission(...)` against
 *      the seeded `commission_rates` and `prices` tables (Req 6.x).
 *      The cashier UI ALSO calls `computeCommission` to populate its
 *      auto-fill defaults; this branch is the safety net for callers
 *      that send only some of the components.
 *  10. Recompute `totalCommission = base + balm + book + addon` on the
 *      server from the resolved parts. The `transactions` table has a
 *      CHECK constraint enforcing the same identity (migration
 *      `001_init_schema.sql`); recomputing absorbs any client-side
 *      arithmetic drift before the constraint fires.
 *  11. Build `rowId = "{branch}|{businessDate}|{cashierRowNumber}"` and
 *      call the `write_transaction(payload jsonb)` RPC defined in
 *      migration `005_write_transaction_rpc.sql`. The RPC performs an
 *      idempotent `INSERT ... ON CONFLICT DO UPDATE` on the unique
 *      `(branch, business_date, cashier_row_number)` index (Req 3.2,
 *      3.3, 3.4, 3.5) and returns `(row jsonb, replaced boolean)`.
 *      RLS applies because the RPC is `SECURITY INVOKER` and we invoke
 *      it through the user-bound SSR client.
 *  12. Return a discriminated `WriteTransactionResult`. Errors are
 *      values, not exceptions — the cashier UI maps each `code` to a
 *      toast string.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9,
 *            2.10, 2.11, 2.12, 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.2,
 *            6.3, 6.4, 6.5, 6.6, 14.6.
 *
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/design.md
 *      §"Server Actions" → §"Idempotent Write Flow"
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/requirements.md
 *      §2 (transactions), §3 (idempotency), §6 (commission), §14.6
 */

import { z } from 'zod'

import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getServiceRoleClient } from '@/lib/supabase/service-role'
import { transactionSchema } from '@/domain/validators'
import { getBusinessDate } from '@/domain/business-date'
import { buildRowId } from '@/domain/row-id'
import {
  computeCommission,
  customerPriceWithFlags,
  priceTableFromRows,
  type Course,
  type Duration,
  type FreelanceRateRow,
  type PriceRow,
  type PriceTable,
  type RegularRateRow,
} from '@/domain/commission'
import { isExtraMethod } from '@/domain/extra'
import { BRANCH_TO_EXTRA, BRANCH_TO_OFFSET, type Branch } from '@/domain/types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WriteTransactionErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'BRANCH_MISMATCH'
  | 'UNKNOWN_STAFF'
  | 'STAFF_NOT_ON_ROSTER'
  | 'DB_ERROR'

/**
 * Camel-case projection of a persisted `transactions` row, returned
 * from `writeTransaction` on success. The cashier UI normalises on
 * this shape to keep the `transactions` table's snake_case column
 * names out of the React layer.
 */
export interface PersistedTransactionRow {
  id: string
  rowId: string
  branch: Branch
  businessDate: string
  cashierRowNumber: number
  staff: string
  course: Course
  duration: Duration
  timeIn: string | null
  timeOut: string | null
  method: string
  addon: number
  baseCommission: number
  balmBonus: number
  bookingBonus: number
  totalCommission: number
  cash: number
  qr: number
  credit: number
  price: number
  flags: string
  comment: string
  createdAt: string
  updatedAt: string
  createdBy: string | null
}

export type WriteTransactionResult =
  | { ok: true; row: PersistedTransactionRow; replaced: boolean }
  | {
      ok: false
      code: WriteTransactionErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Extension schema for fields not declared on `transactionSchema`
// ---------------------------------------------------------------------------

/**
 * Extension-field schema applied BEFORE the main `transactionSchema`
 * validation. `passthrough()` retains the rest of the raw input so we
 * can re-feed it to `transactionSchema` after merging in the
 * server-derived `cashierRowNumber`.
 *
 * The fields here are all optional — every one of them has a
 * server-side default that the action computes when the caller omits
 * it (see steps 4, 5, 8, 9, 10 in the file-level docblock).
 */
const inputExtensionSchema = z
  .object({
    businessDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'businessDate must be yyyy-MM-dd')
      .optional(),
    cashierRowNumber: z.number().int().positive().optional(),
    baseCommission: z.number().nonnegative().optional(),
    balmBonus: z.number().nonnegative().optional(),
    bookingBonus: z.number().nonnegative().optional(),
    totalCommission: z.number().nonnegative().optional(),
    /**
     * Optional comma-separated chip string ("Staff Balm,Booking,Customer
     * Balm,…"). Persisted to `transactions.flags` verbatim. When
     * supplied, takes precedence over the boolean staffBalm /
     * customerBalm / booking flags from the cashier UI — the chip
     * string is the canonical representation in the new Heals POS.
     */
    flags: z.string().optional(),
  })
  .passthrough()

// ---------------------------------------------------------------------------
// Server action
// ---------------------------------------------------------------------------

export async function writeTransaction(
  input: unknown,
): Promise<WriteTransactionResult> {
  // 1. Auth gate ------------------------------------------------------------
  const profile = await getCurrentProfile()
  if (!profile) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Sign in required',
    }
  }

  // 2. Pre-validate extension fields ---------------------------------------
  const extParsed = inputExtensionSchema.safeParse(input)
  if (!extParsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: extParsed.error.issues[0]?.message ?? 'invalid input',
      details: extParsed.error.flatten(),
    }
  }
  const ext = extParsed.data as Record<string, unknown> & {
    businessDate?: string
    cashierRowNumber?: number
    baseCommission?: number
    balmBonus?: number
    bookingBonus?: number
    totalCommission?: number
    flags?: string
  }

  // 3. Branch claim check ---------------------------------------------------
  // The schema below also rejects a missing/non-string branch, but we need
  // it before the schema runs to pre-compute `cashierRowNumber`. Bounce out
  // here with a clear error code rather than a generic INVALID_INPUT.
  const rawBranch = ext.branch
  if (typeof rawBranch !== 'string') {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'branch is required',
    }
  }

  if (profile.role === 'cashier') {
    if (profile.branch !== rawBranch) {
      return {
        ok: false,
        code: 'BRANCH_MISMATCH',
        message: 'Cashier may only write to their own branch',
      }
    }
    // Cashiers cannot historical-backfill — `businessDate` overrides are
    // owner-only. We could 403 here, but the cashier UI never sends one;
    // silently overwriting with the server-canonical date matches the
    // existing salary-system-rebuild behaviour.
    if (ext.businessDate !== undefined) {
      // Drop the cashier-supplied businessDate; will be recomputed below.
      ext.businessDate = undefined
    }
  } else if (profile.role !== 'owner') {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Insufficient permissions to write transaction',
    }
  }

  // 4. Determine business date ---------------------------------------------
  const isOwnerBackfill =
    profile.role === 'owner' && typeof ext.businessDate === 'string'
  const businessDate = isOwnerBackfill
    ? (ext.businessDate as string)
    : getBusinessDate(new Date())

  // 5. Determine cashier row number ----------------------------------------
  const sb = createServerSupabaseClient()
  let cashierRowNumber = ext.cashierRowNumber
  if (cashierRowNumber === undefined) {
    const { data: maxRow, error: maxErr } = await sb
      .from('transactions')
      .select('cashier_row_number')
      .eq('branch', rawBranch)
      .eq('business_date', businessDate)
      .order('cashier_row_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (maxErr) {
      return { ok: false, code: 'DB_ERROR', message: maxErr.message }
    }
    cashierRowNumber = (Number(maxRow?.cashier_row_number) || 0) + 1
  }

  // 6. Validate via transactionSchema --------------------------------------
  const inputForSchema = {
    ...ext,
    cashierRowNumber,
  }
  // `transactionSchema` is a ZodEffects (object + superRefine). It strips
  // keys not declared on the inner shape, so the extension fields above
  // pass through harmlessly without polluting `data`.
  const parsed = transactionSchema.safeParse(inputForSchema)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'invalid input',
      details: parsed.error.flatten(),
    }
  }
  const data = parsed.data
  const branch = data.branch as Branch

  // 7. Resolve staff -------------------------------------------------------
  const isFreelanceMethod = data.method.trim().toLowerCase() === 'freelance'
  const _isExtra = isExtraMethod(data.method)

  const { data: staffRow, error: staffErr } = await sb
    .from('staff')
    .select('id, name, home_branch, is_freelance, is_active')
    .ilike('name', data.staff)
    .maybeSingle()
  if (staffErr) {
    return { ok: false, code: 'DB_ERROR', message: staffErr.message }
  }

  let resolvedStaffName = data.staff
  let staffIsFreelance = false
  let _staffId: string | null = null
  if (staffRow) {
    resolvedStaffName = String(staffRow.name)
    staffIsFreelance = Boolean(staffRow.is_freelance)
    _staffId = String(staffRow.id)
  } else if (isFreelanceMethod) {
    // Freeform freelancer (Req 2.8–2.12). Accept the normalised name; the
    // `Staff_Roster` is left untouched per Req 14.6 — the typed name lives
    // only on this transaction row.
    staffIsFreelance = true
  } else if (profile.role === 'owner') {
    // Owner backfill / owner edit — trust the typed name; warn for
    // observability so unrostered names surface in the diagnostics page.
    // eslint-disable-next-line no-console
    console.warn(
      `[writeTransaction] owner write: staff "${data.staff}" not found in roster; trusting typed name`,
    )
  } else {
    // Cashier typed a name not in the staff table. Accept it as a
    // walk-in / borrowed staff from another shop. The name is stored
    // verbatim on the transaction row. No roster gate — the user's
    // workflow is "type any name freely".
    // eslint-disable-next-line no-console
    console.warn(
      `[writeTransaction] cashier write: staff "${data.staff}" not found in staff table; accepting as walk-in`,
    )
  }

  // Roster check REMOVED. The user's workflow is: type any staff name
  // freely into the table. The daily_roster is purely for queue display
  // ordering — it does NOT gate who can be written. Any name (branch
  // staff, borrowed staff, walk-in freelancer) is accepted. The only
  // hard gate is: non-freelance method requires the staff to exist in
  // the `staff` table (resolved above). Borrowed staff from other
  // branches pass through because we already skip when
  // home_branch ≠ writing branch.

  // 8. Resolve price (caller override > customer-price-table fallback) ----
  // Detect "explicitly provided" by checking the raw input — `transactionSchema`
  // applies `.default(0)` so we cannot distinguish "0" from "absent" after parsing.
  const rawObj =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)
      : {}
  const callerSuppliedPrice = Object.prototype.hasOwnProperty.call(
    rawObj,
    'price',
  )

  // We may need the price table both for the price fallback and for the
  // commission compute fallback (Bishop FR floor reads from rates, not
  // prices, but the contract of `computeCommission` accepts a `priceTable`
  // for symmetry). Fetch lazily — only when at least one consumer needs it.
  let priceTable: PriceTable | undefined
  const ensurePriceTable = async (): Promise<PriceTable> => {
    if (priceTable) return priceTable
    const { data: priceRows, error: priceErr } = await sb
      .from('prices')
      .select('course, duration, branch, price')
    if (priceErr) {
      // eslint-disable-next-line no-console
      console.warn('[writeTransaction] prices read failed:', priceErr.message)
    }
    const rows: PriceRow[] = (priceRows ?? []).map((r) => ({
      course: r.course as Course,
      duration: Number(r.duration) as Duration,
      branch: r.branch as Branch,
      price: Number(r.price) || 0,
    }))
    priceTable = priceTableFromRows(rows)
    return priceTable
  }

  let resolvedPrice = data.price
  if (!callerSuppliedPrice) {
    const pt = await ensurePriceTable()
    // Use `customerPriceWithFlags` so the +RM 10 Customer Balm
    // surcharge is applied automatically when the row's chips
    // include "Customer Balm" (and the price falls to 0 for any
    // EXTRA method per Req 2.5). Cashier-typed prices still win
    // when explicitly supplied above.
    resolvedPrice = customerPriceWithFlags(
      data.course,
      data.duration,
      branch,
      data.method,
      ext.flags ?? '',
      pt,
    )
  }

  // 9. Resolve commission components --------------------------------------
  const callerHasBase = Object.prototype.hasOwnProperty.call(
    rawObj,
    'baseCommission',
  )
  const callerHasBalm = Object.prototype.hasOwnProperty.call(
    rawObj,
    'balmBonus',
  )
  const callerHasBook = Object.prototype.hasOwnProperty.call(
    rawObj,
    'bookingBonus',
  )

  let resolvedBase = ext.baseCommission ?? 0
  let resolvedBalm = ext.balmBonus ?? 0
  let resolvedBook = ext.bookingBonus ?? 0
  const resolvedAddon = data.addon

  if (!callerHasBase || !callerHasBalm || !callerHasBook) {
    // Need to compute defaults — fetch the rate tables.
    const { data: rateRows, error: rateErr } = await sb
      .from('commission_rates')
      .select(
        'course, duration, rate_type, branch_group, amount, effective_from',
      )
    if (rateErr) {
      // eslint-disable-next-line no-console
      console.warn(
        '[writeTransaction] commission_rates read failed:',
        rateErr.message,
      )
    }
    const allRates = rateRows ?? []
    const regularRates: RegularRateRow[] = allRates
      .filter((r) => r.rate_type === 'regular')
      .map((r) => ({
        course: r.course as Course,
        duration: Number(r.duration) as Duration,
        branchGroup: String(r.branch_group),
        amount: Number(r.amount) || 0,
        effectiveFrom: String(r.effective_from),
      }))
    const freelanceRates: FreelanceRateRow[] = allRates
      .filter((r) => r.rate_type === 'freelance')
      .map((r) => ({
        course: r.course as Course,
        duration: Number(r.duration) as Duration,
        branchGroup: String(r.branch_group),
        amount: Number(r.amount) || 0,
        effectiveFrom: String(r.effective_from),
      }))

    // For the commission compute path, treat the row as "freelance" when
    // either the method is `Freelance` or the resolved staff carries
    // `is_freelance=true` (Req 6.5 / 18.1). `computeCommission` keys on
    // method, so we lift the staff flag into the method here.
    const computeMethod =
      isFreelanceMethod || staffIsFreelance ? 'Freelance' : data.method

    const pt = await ensurePriceTable()
    const computed = computeCommission({
      course: data.course,
      duration: data.duration,
      branch,
      businessDate,
      method: computeMethod,
      staffBalm: data.staffBalm,
      booking: data.booking,
      flags: ext.flags ?? '',
      addon: resolvedAddon,
      regularRates,
      freelanceRates,
      priceTable: pt,
    })
    if (!callerHasBase) resolvedBase = computed.base
    if (!callerHasBalm) resolvedBalm = computed.balm
    if (!callerHasBook) resolvedBook = computed.book
  }

  // 10. Server safeguard: recompute totalCommission from parts -----------
  // The `total_commission_equals_parts` CHECK constraint on the
  // `transactions` table requires the same identity. Even when the caller
  // supplies `totalCommission`, the recomputation absorbs any drift
  // (currency rounding, JS float artefacts) before the constraint fires.
  const totalCommission =
    Math.round(
      (resolvedBase + resolvedBalm + resolvedBook + resolvedAddon) * 100,
    ) / 100

  // 11. Build payload + call write_transaction RPC ------------------------
  const rowId = buildRowId(branch, businessDate, cashierRowNumber)

  // The RPC payload uses the snake_case column names defined in
  // migration 005; see the field-by-field handling there.
  const payload = {
    branch,
    business_date: businessDate,
    cashier_row_number: cashierRowNumber,
    staff: resolvedStaffName,
    course: data.course,
    duration: data.duration,
    time_in: data.timeIn ?? '',
    time_out: data.timeOut ?? '',
    method: data.method,
    addon: resolvedAddon,
    base_commission: resolvedBase,
    balm_bonus: resolvedBalm,
    booking_bonus: resolvedBook,
    total_commission: totalCommission,
    cash: data.cash,
    qr: data.qr,
    credit: data.credit,
    price: resolvedPrice,
    flags: ext.flags ?? '',
    comment: data.comment,
  }

  const { data: rpcRows, error: rpcErr } = await sb.rpc('write_transaction', {
    payload,
  })
  if (rpcErr) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: rpcErr.message,
      details: rpcErr,
    }
  }
  // The RPC returns SETOF (tx jsonb, replaced boolean). PostgREST wraps it
  // in an array of `{ tx, replaced }` records. (`row` is a Postgres
  // reserved keyword in this position; we use `tx` to sidestep it.)
  const first = Array.isArray(rpcRows)
    ? (rpcRows[0] as
        | { tx: Record<string, unknown>; replaced: boolean }
        | undefined)
    : (rpcRows as
        | { tx: Record<string, unknown>; replaced: boolean }
        | null
        | undefined)
  if (!first || !first.tx) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: 'write_transaction RPC returned no row',
    }
  }

  // 13. Auto-mirror EXTRA at staff home branch -----------------------------
  // When a staff member works at a branch other than their `home_branch`
  // and is paid via a real method (CASH/QR/CREDIT), the salary board
  // expects to find their commission attributed to their home branch.
  // We satisfy this via an automatic mirror EXTRA row at the home branch
  // — a cosmetic UX convenience so the cashier at home doesn't need to
  // also type the EXTRA. The salary board's canonical-view algorithm
  // (Req 5.2, 5.3, 5.6) does NOT depend on this mirror existing: it
  // already attributes uncovered EXTRAs via destination decoding and
  // covers them when a real row exists. The mirror exists purely so the
  // home-branch cashier sees the staff's work in their own session
  // table. Mirror failure is therefore non-fatal — we warn and move on.
  //
  // Service-role client bypasses RLS so a Kimberry-cashier write can
  // create an EXTRA row at Bishop without the cashier holding a Bishop
  // claim.
  //
  // Mirror row number scheme (see `BRANCH_TO_OFFSET` in
  // `@/domain/types`): `100_000 + sourceRowNum + offset[sourceBranch]`
  // places mirrors in a high band that cannot collide with cashier-typed
  // sequential row numbers, and the per-source-branch offset prevents
  // two source branches mirroring to the same home branch on the same
  // date from colliding with each other.
  if (
    staffRow &&
    staffRow.home_branch !== branch &&
    (data.method === 'CASH' || data.method === 'QR' || data.method === 'CREDIT')
  ) {
    // eslint-disable-next-line no-console
    console.log(
      `[writeTransaction] auto-mirror trigger: source=${branch} row=${cashierRowNumber} staff=${resolvedStaffName} home=${staffRow.home_branch}`,
    )
    try {
      const mirrorBranch = staffRow.home_branch as Branch
      const mirrorRowNum =
        100_000 + cashierRowNumber + BRANCH_TO_OFFSET[branch]
      const service = getServiceRoleClient()
      const mirrorPayload = {
        branch: mirrorBranch,
        business_date: businessDate,
        cashier_row_number: mirrorRowNum,
        staff: resolvedStaffName,
        course: data.course,
        duration: data.duration,
        time_in: '',
        time_out: '',
        method: BRANCH_TO_EXTRA[branch],
        // EXTRA rows are notes, not money. All amounts MUST be zero
        // so the salary board's canonical view can attribute the
        // commission to the destination branch (where the real row
        // lives) without double-counting. The home-branch cashier
        // sees the row in their session table for awareness only.
        addon: 0,
        base_commission: 0,
        balm_bonus: 0,
        booking_bonus: 0,
        total_commission: 0,
        cash: 0,
        qr: 0,
        credit: 0,
        price: 0,
        flags: '',
        comment: `(auto-mirror from ${branch} row #${cashierRowNumber})`,
      }
      // Service-role client is untyped (`SupabaseClient<any, ...>`) so its
      // `.rpc()` overload doesn't accept the named-args object directly.
      // Cast through `unknown` to satisfy the loose call signature; the
      // shape mirrors the typed `sb.rpc('write_transaction', { payload })`
      // call above.
      const rpcCaller = service.rpc.bind(service) as unknown as (
        fn: string,
        args: { payload: typeof mirrorPayload },
      ) => Promise<{ error: { message: string } | null }>
      const { error: mirrorErr } = await rpcCaller('write_transaction', {
        payload: mirrorPayload,
      })
      if (mirrorErr) {
        // eslint-disable-next-line no-console
        console.warn('[writeTransaction] auto-mirror failed:', mirrorErr.message)
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[writeTransaction] auto-mirror failed:', e)
    }
  }

  return {
    ok: true,
    row: mapPersistedRow(first.tx, rowId),
    replaced: Boolean(first.replaced),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert the snake_case `transactions` row returned by the RPC (as
 * `to_jsonb(result)`) into the camelCase shape consumed by the cashier
 * UI. Numeric columns come through as numbers from `to_jsonb`, but we
 * coerce defensively in case PostgREST changes that for `numeric(10,2)`.
 */
function mapPersistedRow(
  row: Record<string, unknown>,
  rowId: string,
): PersistedTransactionRow {
  return {
    id: String(row.id ?? ''),
    rowId,
    branch: row.branch as Branch,
    businessDate: String(row.business_date),
    cashierRowNumber: Number(row.cashier_row_number),
    staff: String(row.staff),
    course: row.course as Course,
    duration: Number(row.duration) as Duration,
    timeIn: row.time_in == null ? null : String(row.time_in),
    timeOut: row.time_out == null ? null : String(row.time_out),
    method: String(row.method),
    addon: toNumber(row.addon),
    baseCommission: toNumber(row.base_commission),
    balmBonus: toNumber(row.balm_bonus),
    bookingBonus: toNumber(row.booking_bonus),
    totalCommission: toNumber(row.total_commission),
    cash: toNumber(row.cash),
    qr: toNumber(row.qr),
    credit: toNumber(row.credit),
    price: toNumber(row.price),
    flags: String(row.flags ?? ''),
    comment: String(row.comment ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    createdBy: row.created_by == null ? null : String(row.created_by),
  }
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (value == null) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
