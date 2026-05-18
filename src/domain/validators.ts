/**
 * Zod validation schemas for the Heals system rebuild.
 *
 * Pure validation: no I/O, no Supabase. Server actions import these
 * schemas, parse the incoming payload at the trust boundary, and pass
 * the inferred types downstream to the domain layer.
 *
 * Schemas exported here:
 *
 *   - `transactionSchema`        — cashier session entry (Req 2.x)
 *   - `expenseSchema`            — branch expense entry (Req 17.x)
 *   - `payCycleStartDaySchema`   — owner pay-cycle setting (Req 10.x)
 *   - `commissionRateSchema`     — owner-edited commission rate (Req 6.7, 18.5)
 *   - `priceSchema`              — owner-edited customer price (Req 2.7, 6.1)
 *   - `staffSchema`              — owner-edited staff roster entry (Req 14.x)
 *   - `rosterSchema`             — cashier-edited daily roster (Req 15.x)
 *
 * Cross-field invariants enforced via `.superRefine`:
 *
 *   1. Payment-split balance — for CASH/QR/CREDIT real transactions,
 *      `cash + qr + credit === price` within a 0.01 RM epsilon to absorb
 *      floating-point noise (Req 2.4).
 *   2. EXTRA all-zero — for any decoded EXTRA method (`EXTRA KM`,
 *      `EXTRA BS`, `EXTRA CL`, plus minor case/whitespace variants the
 *      cashier may type), `cash`, `qr`, `credit`, AND `price` must all
 *      be zero. EXTRA rows are notes, not money (Req 2.5, 5.x).
 *   3. Staff normalisation — `staff` is trimmed and internal whitespace
 *      runs are collapsed to a single space; the post-normalisation
 *      value must be non-empty (Req 2.10, 2.11). For `Method=Freelance`
 *      with the freeform-staff path the validator simply accepts the
 *      typed name post-normalisation; roster-lookup enforcement for
 *      non-Freelance methods is the server action's concern (it needs
 *      DB context).
 *
 * The enums encoded here MUST stay in lockstep with:
 *   - The Postgres CHECK constraints in `001_init_schema.sql`
 *     (branch / course / duration enums).
 *   - The domain literal unions in `./types.ts` (`BRANCHES`, `COURSES`,
 *     `DURATIONS`, etc.).
 *
 * Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.10, 2.11, 17.1, 17.3,
 *            6.7, 10.1, 10.2, 10.4, 14.1, 14.2, 15.1, 18.5.
 *
 * See `c:/BILL/.kiro/specs/heals-system-rebuild/design.md`
 *     §"Validation Schemas".
 */

import { z } from 'zod'

import { BRANCHES, COURSES, DURATIONS } from './types'
import { isExtraMethod } from './extra'

// ---------------------------------------------------------------------------
// Shared atoms
// ---------------------------------------------------------------------------

/** `HH:mm` 24-hour time pattern. */
const HHMM_PATTERN = /^\d{2}:\d{2}$/

/** Floating-point tolerance for payment-split balance (1 sen). */
const PAYMENT_EPSILON = 0.01

/** The set of method strings that admit a real customer payment. */
const REAL_PAYMENT_METHODS = ['CASH', 'QR', 'CREDIT'] as const

/**
 * Normalise a staff name (Req 2.10):
 *   - trim leading and trailing whitespace
 *   - collapse internal whitespace runs to a single space
 *
 * Emptiness is enforced separately in the schema — this transform
 * preserves an empty string so the `.min(1)` check fires with the
 * canonical empty-staff error message.
 */
export function normaliseStaffName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

// ---------------------------------------------------------------------------
// Atom schemas — exported individually for reuse by server actions and tests
// ---------------------------------------------------------------------------

export const branchSchema = z.enum(BRANCHES)
export const courseSchema = z.enum(COURSES)
export const durationSchema = z.union([
  z.literal(DURATIONS[0]),
  z.literal(DURATIONS[1]),
  z.literal(DURATIONS[2]),
  z.literal(DURATIONS[3]),
])

/**
 * Staff field shared by `transactionSchema`, `staffSchema`, and
 * `rosterSchema`. Applies the Req 2.10 normalisation (trim + collapse)
 * and rejects values that are empty after normalisation (Req 2.11).
 */
export const staffNameSchema = z
  .string({ required_error: 'staff is required' })
  .transform(normaliseStaffName)
  .refine((s) => s.length > 0, { message: 'staff must not be empty' })

// ---------------------------------------------------------------------------
// transactionSchema
// ---------------------------------------------------------------------------

/**
 * Cashier-side input for `writeTransaction`.
 *
 * Numeric defaults: zod `.default(0)` applies before refinement, so the
 * `superRefine` below sees zero (never undefined) for any omitted
 * numeric field.
 *
 * Method is typed as a free `string` rather than a closed enum so that
 * cashier-typed EXTRA variants (`extra-cl`, `EXTRA  CHU`, …) flow
 * through to `isExtraMethod` for case/whitespace-tolerant decoding. The
 * server action canonicalises the method to one of the seven values in
 * `TRANSACTION_METHODS` before persisting.
 */
export const transactionSchema = z
  .object({
    branch: branchSchema,
    cashierRowNumber: z
      .number({ required_error: 'cashierRowNumber is required' })
      .int()
      .positive(),
    staff: staffNameSchema,
    course: courseSchema,
    duration: durationSchema,
    method: z
      .string({ required_error: 'method is required' })
      .min(1, { message: 'method must not be empty' }),

    timeIn: z.string().regex(HHMM_PATTERN).nullable().optional().default(null),
    timeOut: z.string().regex(HHMM_PATTERN).nullable().optional().default(null),

    cash: z.number().min(0).default(0),
    qr: z.number().min(0).default(0),
    credit: z.number().min(0).default(0),
    price: z.number().min(0).default(0),
    addon: z.number().min(0).default(0),

    staffBalm: z.boolean().default(false),
    customerBalm: z.boolean().default(false),
    booking: z.boolean().default(false),

    comment: z.string().default(''),
  })
  .superRefine((data, ctx) => {
    const isExtra = isExtraMethod(data.method)
    const isRealPayment =
      !isExtra &&
      (REAL_PAYMENT_METHODS as readonly string[]).includes(data.method)

    // Invariant 1: EXTRA rows must carry no money (Req 2.5, 5.x).
    if (isExtra) {
      if (
        data.cash !== 0 ||
        data.qr !== 0 ||
        data.credit !== 0 ||
        data.price !== 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['price'],
          message: 'EXTRA rows must have cash=qr=credit=price=0',
        })
      }
      return
    }

    // Invariant 2: real-payment methods balance to price (Req 2.4).
    if (isRealPayment) {
      const sum = data.cash + data.qr + data.credit
      if (Math.abs(sum - data.price) > PAYMENT_EPSILON) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['price'],
          message: `cash + qr + credit (${sum}) must equal price (${data.price})`,
        })
      }
    }
  })

export type TransactionInput = z.input<typeof transactionSchema>
export type TransactionParsed = z.output<typeof transactionSchema>

// ---------------------------------------------------------------------------
// expenseSchema
// ---------------------------------------------------------------------------

/**
 * Cashier or owner-side expense entry. Mirrors the `expenses` table in
 * the design schema. Item is trimmed; emptiness rejects (Req 17.3).
 * Amount must be strictly positive — zero or negative rejects (Req 17.3).
 */
export const expenseSchema = z.object({
  branch: branchSchema,
  item: z
    .string({ required_error: 'item is required' })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: 'item must not be empty' }),
  amount: z
    .number({ required_error: 'amount is required' })
    .positive({ message: 'amount must be greater than zero' }),
  method: z.enum(['CASH', 'QR', 'CREDIT', 'Other']),
  note: z.string().default(''),
})

export type ExpenseInput = z.input<typeof expenseSchema>
export type ExpenseParsed = z.output<typeof expenseSchema>

// ---------------------------------------------------------------------------
// payCycleStartDaySchema — Req 10.1, 10.2, 10.4
// ---------------------------------------------------------------------------

/**
 * Owner-set pay-cycle start day. Constrained to [1, 28] so every month
 * (including February) has the boundary date — see `cycleDates`.
 */
export const payCycleStartDaySchema = z
  .number({ required_error: 'payCycleStartDay is required' })
  .int()
  .min(1)
  .max(28)

// ---------------------------------------------------------------------------
// commissionRateSchema — Req 6.7, 18.5
// ---------------------------------------------------------------------------

/**
 * Owner-edited commission rate row. The branch_group field is kept as a
 * lowercase free string so seed scripts can introduce groupings such as
 * `"all"`, `"non-bishop"`, etc. without a schema migration. `effective_from`
 * is `yyyy-MM-dd`; defaulting to today is the server action's concern
 * (the validator only enforces shape).
 */
export const commissionRateSchema = z.object({
  course: courseSchema,
  duration: durationSchema,
  rateType: z.enum(['regular', 'freelance']),
  branchGroup: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: 'branchGroup must not be empty' })
    .default('all'),
  amount: z.number().nonnegative(),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveFrom must be yyyy-MM-dd')
    .optional(),
})

export type CommissionRateInput = z.input<typeof commissionRateSchema>
export type CommissionRateParsed = z.output<typeof commissionRateSchema>

// ---------------------------------------------------------------------------
// priceSchema — Req 2.7, 6.1
// ---------------------------------------------------------------------------

/**
 * Owner-edited customer price for one (course, duration, branch) cell.
 * Mirrors the `prices` PRIMARY KEY columns in the design schema. Bishop
 * FR rows are seeded as RM 2 less than Kimberry/Chulia (Req 2.7); that
 * relationship is enforced by the seed script, not the schema.
 */
export const priceSchema = z.object({
  course: courseSchema,
  duration: durationSchema,
  branch: branchSchema,
  price: z.number().nonnegative(),
})

export type PriceInput = z.input<typeof priceSchema>
export type PriceParsed = z.output<typeof priceSchema>

// ---------------------------------------------------------------------------
// staffSchema — Req 14.1, 14.2, 14.3, 14.5
// ---------------------------------------------------------------------------

/**
 * Owner-edited staff roster entry. `name` is normalised the same way
 * the cashier transaction `staff` field is, so the company-wide
 * uniqueness index on `lower(trim(name))` (design.md `staff` table)
 * matches what the validator stores.
 */
export const staffSchema = z.object({
  name: staffNameSchema,
  homeBranch: branchSchema,
  isFreelance: z.boolean().default(false),
  isActive: z.boolean().default(true),
})

export type StaffSchemaInput = z.input<typeof staffSchema>
export type StaffSchemaParsed = z.output<typeof staffSchema>

// ---------------------------------------------------------------------------
// rosterSchema — Req 15.1, 15.2
// ---------------------------------------------------------------------------

/**
 * Cashier-edited daily roster — replaces the `daily_roster` rows for
 * one (branch, business_date) atomically (delete + insert). `staffIds`
 * is a list of `staff.id` UUIDs; UUID format is intentionally NOT
 * enforced here so server actions can use this schema for both browser
 * and integration-test payloads.
 */
export const rosterSchema = z.object({
  branch: branchSchema,
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'businessDate must be yyyy-MM-dd'),
  staffIds: z.array(z.string().min(1)),
})

export type RosterInput = z.input<typeof rosterSchema>
export type RosterParsed = z.output<typeof rosterSchema>
