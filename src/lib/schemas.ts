/**
 * staff_balm = +3 commission AND +10 price; customer_balm = +10 price
 * ONLY (no commission); both can stack.
 *
 * Zod schemas for every server-action input.
 *
 * Pure validation: no I/O, no Supabase. Server actions import these
 * schemas, parse the incoming payload at the trust boundary, and pass
 * the inferred types downstream to the domain layer.
 *
 * The enums encoded here MUST stay in lockstep with:
 *   - The Postgres `branch`, `course`, `method` enums in
 *     `supabase/migrations/20260101000000_init_schema.sql`
 *   - The `Branch`, `Course`, `Method`, `Duration` types in
 *     `src/domain/row-id.ts` and `src/domain/commission.ts`
 *
 * They are written out explicitly here (rather than imported as
 * `z.enum(BRANCHES as unknown as [...])`) for clarity to a non-developer
 * reader, and because zod's `z.enum` requires a non-empty tuple literal.
 *
 * `transactionInputSchema` enforces the EXTRA/real-payment-balance
 * invariants in the same `superRefine` that the Postgres CHECK
 * constraints (`extra_has_zero_price`, `real_payment_balances`) enforce.
 * That is intentional duplicate-defence: we want validation failures to
 * surface as a typed `ZodError` before any DB round-trip, and we want
 * the DB to reject the row if the application layer is ever bypassed.
 *
 * Validates: Requirements 2.1, 2.2, 2.3 (strict dropdowns and balanced
 *            payment),
 *            6.2 (expense input validation),
 *            12.3 (pay-cycle start day bounds),
 *            16.2 (server-canonical business date — no client date),
 *            17.1, 17.5 (deterministic row_id keying).
 *
 * See `c:/BILL/.kiro/specs/salary-system-rebuild/design.md`
 *     §"Server Actions" and §"Database schema".
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared enums — must match the Postgres enums and the domain-layer types.
// ---------------------------------------------------------------------------

const BRANCHES = ['Kimberry', 'Bishop', 'Chulia'] as const

const COURSES = [
  'FR',
  'HS',
  'FNS',
  'BMT',
  'BAT',
  'DTM',
  'THC',
  'HOM',
  'PBA',
  'PBAC',
  'EAR',
  'PTF',
  'PAF',
  'PHL',
  'PHT',
] as const

const METHODS = [
  'CASH',
  'QR',
  'CREDIT',
  'EXTRA KM',
  'EXTRA BS',
  'EXTRA CL',
] as const

const EXTRA_METHODS = ['EXTRA KM', 'EXTRA BS', 'EXTRA CL'] as const
const NON_BALANCING_METHODS = [...EXTRA_METHODS] as const

const HHMM_PATTERN = /^\d{2}:\d{2}$/
const YYYY_MM_DD_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const branchSchema = z.enum(BRANCHES)
export const courseSchema = z.enum(COURSES)
export const methodSchema = z.enum(METHODS)
export const durationSchema = z.union([
  z.literal(30),
  z.literal(60),
  z.literal(90),
  z.literal(120),
])

// ---------------------------------------------------------------------------
// transactionInputSchema
// ---------------------------------------------------------------------------

/**
 * Cashier-side input for `writeTransaction`.
 *
 * Numeric defaults: zod `.default(0)` applies before refinement, so the
 * `superRefine` below sees zero (never undefined) for any omitted
 * numeric field.
 *
 * String trimming: applied via `.transform((s) => s.trim())` on
 * free-text fields (`staff`, `note`) so downstream lookups see
 * canonical input.
 *
 * The two cross-field invariants enforced here mirror the database
 * CHECK constraints exactly:
 *   - `extra_has_zero_price`     (EXTRA rows carry no money)
 *   - `real_payment_balances`    (cash + qr + credit === price)
 */
export const transactionInputSchema = z
  .object({
    branch: branchSchema,
    rowNum: z.number().int().nonnegative(),
    staff: z
      .string()
      .min(1)
      .max(60)
      .transform((s) => s.trim()),
    course: courseSchema,
    duration: durationSchema,
    method: methodSchema,

    // Pricing fields — default to 0 when omitted.
    cash: z.number().nonnegative().default(0),
    qr: z.number().nonnegative().default(0),
    credit: z.number().nonnegative().default(0),
    price: z.number().nonnegative().default(0),

    // Commission inputs.
    staffBalm: z.boolean().default(false),
    booking: z.boolean().default(false),
    addon: z.number().nonnegative().default(0),

    /**
     * Customer balm modifier (task 21.2). Adds +10 to the customer
     * price ONLY — no commission bump (that's `staffBalm`'s job).
     * Persisted to the `transactions.customer_balm` column added in
     * migration `20260104000200_customer_balm.sql`.
     *
     * Mutually exclusive with `staffBalm` (task 22.3): one balm per
     * session. If both arrive true, the schema silently clears
     * `customerBalm` (staff wins). The cashier UI shouldn't allow
     * both, but this is defensive.
     */
    customerBalm: z.boolean().optional().default(false),

    // Times (HH:mm) optional and nullable.
    timeIn: z.string().regex(HHMM_PATTERN).nullable().optional(),
    timeOut: z.string().regex(HHMM_PATTERN).nullable().optional(),

    // Free-text note. The cashier UI exposes this; balm/booking flags
    // are NOT encoded here (they live in `staffBalm` / `booking`).
    note: z.string().max(500).default(''),

    // Manual commission override (task 17.2).
    //
    // Default behaviour: the server computes commission via
    // `computeCommission(...)` using the row's course/duration/method
    // and the looked-up staff's `is_freelance` flag. Both fields below
    // are omitted by callers in the common case.
    //
    // When the cashier types a custom value into the Commission input,
    // the form sets `commissionOverride: true` and supplies the typed
    // `commission` value. The server then trusts that value verbatim
    // and skips `computeCommission`. The DB persists both the value
    // and the flag so the diagnostics page (task 17.3) can list
    // outliers and so re-pushes don't silently revert the override.
    //
    // The `superRefine` below enforces: when `commissionOverride` is
    // true, `commission` must be a defined non-negative number.
    commission: z.number().nonnegative().optional(),
    commissionOverride: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    const isExtra = (EXTRA_METHODS as readonly string[]).includes(val.method)

    // Invariant 1: EXTRA rows must carry no money.
    if (isExtra) {
      if (val.price !== 0 || val.cash !== 0 || val.qr !== 0 || val.credit !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['price'],
          message: 'EXTRA rows must have price=cash=qr=credit=0',
        })
      }
      // Invariant 4 still applies — see commissionOverride check below.
    }

    // Invariant 4: when the cashier marks a row as a manual commission
    // override, they must supply the override value. The server will
    // skip `computeCommission` and trust the value verbatim. Without a
    // commission value to trust, the request is incoherent.
    if (val.commissionOverride === true) {
      if (typeof val.commission !== 'number') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['commission'],
          message: 'commission is required when commissionOverride is true',
        })
      }
    }

    if (isExtra) {
      return
    }

    // Invariant 2: real (non-EXTRA) rows are valid in any of three
    // states:
    //
    //   a) "empty"   — all four payment fields are zero (no price set yet).
    //   b) "pending" — price is set but payments are zero. This is the
    //      sit-down state: cashier saved Staff / Course / Duration and
    //      price auto-filled, but customer hasn't paid yet. Payment
    //      gets filled in later when the customer leaves.
    //   c) "paid"    — cash + qr + credit === price. The balanced state
    //      for a session that's already been paid.
    //
    // Any other state (partial payment that doesn't sum to price) is
    // rejected.
    const isNonBalancing = (NON_BALANCING_METHODS as readonly string[]).includes(
      val.method,
    )
    if (!isNonBalancing) {
      const paymentsZero =
        val.cash === 0 &&
        val.qr === 0 &&
        val.credit === 0
      const balanced = val.cash + val.qr + val.credit === val.price
      // Allow: all payments zero (pending — price may or may not be set)
      // Allow: payments sum to price (paid)
      // Reject: payments > 0 but don't sum to price
      if (!paymentsZero && !balanced) {
        const sum = val.cash + val.qr + val.credit
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['price'],
          message: `cash + qr + credit (${sum}) must equal price (${val.price}), or all four must be 0 (pending payment)`,
        })
      }
    }

    // Invariant 5 (task 22.3): Balm mutual exclusivity. staffBalm and
    // customerBalm are mutually exclusive — one balm per session. If
    // both arrive true, silently clear customerBalm (staff wins) so
    // the cashier isn't blocked by a validation error.
    if (val.staffBalm && val.customerBalm) {
      val.customerBalm = false
    }
  })

export type TransactionInput = z.infer<typeof transactionInputSchema>

// ---------------------------------------------------------------------------
// expenseInputSchema
// ---------------------------------------------------------------------------

export const expenseInputSchema = z.object({
  item: z
    .string()
    .min(1)
    .max(120)
    .transform((s) => s.trim()),
  amount: z.number().positive(),
  method: z
    .string()
    .min(1)
    .max(40)
    .transform((s) => s.trim()),
  note: z.string().max(500).default(''),
})

export type ExpenseInput = z.infer<typeof expenseInputSchema>

// ---------------------------------------------------------------------------
// staffInputSchema
// ---------------------------------------------------------------------------

export const staffInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(60)
    .transform((s) => s.trim()),
  homeBranch: branchSchema,
  isFreelance: z.boolean().default(false),
  active: z.boolean().default(true),
  /**
   * Owner-picked pill color for this staff (Tailwind-style hex
   * `#RRGGBB`). Optional on the wire — when omitted, the action
   * falls back to the slate-grey default `#94a3b8` matching the DB
   * column default. The regex mirrors the Postgres CHECK constraint
   * on `staff.color` (see migration 20260103000200_staff_color.sql).
   */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be #RRGGBB hex')
    .optional(),
})

export type StaffInput = z.infer<typeof staffInputSchema>

// ---------------------------------------------------------------------------
// branchRosterInputSchema — replace `branch_roster` rows for one (branch, day)
// ---------------------------------------------------------------------------

export const branchRosterInputSchema = z.object({
  branch: branchSchema,
  date: z.string().regex(YYYY_MM_DD_PATTERN),
  staff: z.array(
    z
      .string()
      .min(1)
      .max(60)
      .transform((s) => s.trim()),
  ),
})

export type BranchRosterInput = z.infer<typeof branchRosterInputSchema>

// ---------------------------------------------------------------------------
// payCycleStartDaySchema — owner sets day 1..28 (Feb-safe upper bound)
// ---------------------------------------------------------------------------

export const payCycleStartDaySchema = z.number().int().min(1).max(28)

// ---------------------------------------------------------------------------
// setPriceInputSchema — owner edits one (course, duration, branch) cell in
// the `prices` table.
//
// `course`, `duration`, and `branch` reuse the shared enums above so the
// schema stays in lockstep with the Postgres `prices` PRIMARY KEY columns
// (see migration 20260102000000_prices_table.sql). `price` mirrors the DB
// column constraint `price >= 0` (numeric(10,2)).
//
// Validates: Requirements 12.3 (owner-editable customer prices).
// ---------------------------------------------------------------------------

export const setPriceInputSchema = z.object({
  course: courseSchema,
  duration: durationSchema,
  branch: branchSchema,
  price: z.number().nonnegative(),
})

export type SetPriceInput = z.infer<typeof setPriceInputSchema>

// ---------------------------------------------------------------------------
// setFreelanceRateInputSchema — owner edits one (course, duration) cell in
// the `freelance_rates` table.
//
// `course` and `duration` reuse the shared enums above so the schema
// stays in lockstep with the Postgres `freelance_rates` PRIMARY KEY
// columns (see migration 20260104000300_freelance_rates.sql). `rate`
// mirrors the DB column constraint `rate >= 0` (numeric(10,2)).
//
// Validates: Requirements 13.x (owner-editable defaults),
//            18.x (commission rate tables — freelance branch).
// ---------------------------------------------------------------------------

export const setFreelanceRateInputSchema = z.object({
  course: courseSchema,
  duration: durationSchema,
  rate: z.number().nonnegative(),
  branch: branchSchema.optional().default('Kimberry'),
})

export type SetFreelanceRateInput = z.infer<typeof setFreelanceRateInputSchema>

// ---------------------------------------------------------------------------
// queuePinInputSchema — cashier drag-reorder override
// ---------------------------------------------------------------------------

export const queuePinInputSchema = z.object({
  branch: branchSchema,
  date: z.string().regex(YYYY_MM_DD_PATTERN),
  staffOrder: z.array(
    z
      .string()
      .min(1)
      .max(60)
      .transform((s) => s.trim()),
  ),
})

export type QueuePinInput = z.infer<typeof queuePinInputSchema>

// ---------------------------------------------------------------------------
// deleteTransactionInputSchema
// ---------------------------------------------------------------------------

export const deleteTransactionInputSchema = z.object({
  rowId: z.string().min(1),
})

export type DeleteTransactionInput = z.infer<typeof deleteTransactionInputSchema>

// ---------------------------------------------------------------------------
// themeSchema / setThemeInputSchema — per-user UI theme preference
//
// Mirrors the `theme` CHECK constraint on `user_preferences.theme`
// (migration 20260103000600_user_preferences.sql), which only accepts
// `'light' | 'dark' | 'system'`. The DB constraint and this schema
// must stay in lockstep.
//
// Validates: ergonomics — Epic 18 (theme toggle).
// ---------------------------------------------------------------------------

export const themeSchema = z.enum(['light', 'dark', 'system'])
export type Theme = z.infer<typeof themeSchema>

export const setThemeInputSchema = z.object({
  theme: themeSchema,
})

export type SetThemeInput = z.infer<typeof setThemeInputSchema>
