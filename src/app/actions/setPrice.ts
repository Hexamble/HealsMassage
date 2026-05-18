'use server'

/**
 * heals-system-rebuild — `setPrice` server action.
 *
 * Owner-only mutation that upserts one row in the `prices` table — the
 * cell keyed by `(course, duration, branch)` that the cashier price
 * preview and the commission engine read via
 * `lookupCustomerPrice(...)` (Req 6.1). Bishop FR rows are seeded as
 * RM 2 less than Kimberry/Chulia (Req 2.7); the relationship is not
 * re-enforced here because the owner may also need to back-correct
 * historical rows individually.
 *
 * Pipeline:
 *   1. Resolve the current profile via `getCurrentProfile()`. Rejects
 *      anonymous (`UNAUTHENTICATED`) and non-owner (`NOT_OWNER`)
 *      callers before touching the database. RLS on `prices`
 *      (policy `prices_owner_all` in `003_rls_policies.sql`) is the
 *      ultimate gate; the application-level check returns a clearer
 *      error code so the owner-settings UI can surface a friendly
 *      message rather than a generic RLS denial.
 *   2. Validate input with `priceSchema` — `{course, duration,
 *      branch, price}` where `course/duration/branch` are the same
 *      enums used everywhere else and `price >= 0`. The DB CHECK
 *      constraint on `prices.price` is defence in depth.
 *   3. Upsert into `prices` with `onConflict: 'course,duration,branch'`
 *      — the unique index defined in `002_indexes.sql`. Covers both
 *      first-write-after-seed (UPDATE) and any future new-cell case
 *      (INSERT) without the caller having to know which one applies.
 *   4. Audit logging is handled automatically by the AFTER
 *      INSERT/UPDATE/DELETE trigger on `prices` (migration
 *      `004_audit_trigger.sql`); no application-side `audit_log`
 *      insert is needed here.
 *
 * `prices.price` is `numeric(10,2)`, which PostgREST returns as a
 * string. We coerce it to a JS number on the way out so callers see
 * the same type they sent in.
 *
 * Validates: Requirement 2.7  (Bishop FR price relationship — seeded),
 *            Requirement 6.1  (commission engine reads `prices`),
 *            Requirement 20.5 (unique `(course, duration, branch)`).
 *
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/design.md §"Server Actions"
 */

import { priceSchema } from '@/domain/validators'
import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Branch, Course, Duration } from '@/domain/types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SetPriceErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'INVALID_INPUT'
  | 'DB_ERROR'

export interface PersistedPrice {
  course: Course
  duration: Duration
  branch: Branch
  price: number
}

export type SetPriceResult =
  | { ok: true; row: PersistedPrice }
  | {
      ok: false
      code: SetPriceErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Internal row shape (snake_case as returned by PostgREST). `price` is a
// `numeric(10,2)` column so PostgREST returns it as a string — coerce on
// the way out.
// ---------------------------------------------------------------------------

interface PriceRow {
  course: Course
  duration: Duration
  branch: Branch
  price: string | number
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number.parseFloat(value)
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function setPrice(input: unknown): Promise<SetPriceResult> {
  // 1. Auth + role gate ---------------------------------------------------
  const profile = await getCurrentProfile()
  if (!profile) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Sign in required',
    }
  }
  if (profile.role !== 'owner') {
    return {
      ok: false,
      code: 'NOT_OWNER',
      message: 'Only owner accounts may change customer prices',
    }
  }

  // 2. Validate input -----------------------------------------------------
  const parsed = priceSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Price input failed validation',
      details: parsed.error.flatten(),
    }
  }
  const data = parsed.data

  // 3. Upsert into `prices` ----------------------------------------------
  const sb = createServerSupabaseClient()
  const { data: upserted, error: upsertError } = await sb
    .from('prices')
    .upsert(
      {
        course: data.course,
        duration: data.duration,
        branch: data.branch,
        price: data.price,
      },
      { onConflict: 'course,duration,branch' },
    )
    .select('course, duration, branch, price')
    .single<PriceRow>()

  if (upsertError || !upserted) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: upsertError?.message ?? 'Upsert returned no row',
      details: upsertError,
    }
  }

  const row: PersistedPrice = {
    course: upserted.course,
    duration: upserted.duration,
    branch: upserted.branch,
    price: toNumber(upserted.price),
  }

  return { ok: true, row }
}
