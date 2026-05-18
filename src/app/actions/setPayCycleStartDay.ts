'use server'

/**
 * heals-system-rebuild — `setPayCycleStartDay` server action.
 *
 * Owner-only mutation that updates the `pay_cycle_start_day` row in the
 * `settings` key/value table. The Salary Board reads this value when
 * computing cycle boundaries (via `cycleDates(...)`); changing it here
 * causes every subsequent board / report render to re-bucket days.
 *
 * Pipeline:
 *   1. Resolve the current profile via `getCurrentProfile()`. Rejects
 *      anonymous (`UNAUTHENTICATED`) and non-owner (`NOT_OWNER`) callers
 *      before touching the database. RLS on `settings` (policy
 *      `settings_owner_all` in migration `003_rls_policies.sql`) is the
 *      ultimate gate, but the application-level check returns a clearer
 *      error code for the owner-settings UI.
 *   2. Validate input with `payCycleStartDaySchema` — integer in
 *      `[1, 28]`. The 28 upper bound is intentional (Feb-safe) so every
 *      month has the boundary date — see `cycleDates(...)` in
 *      `src/domain/cycle.ts`.
 *   3. Upsert into `settings` keyed on `key = 'pay_cycle_start_day'`.
 *      The `settings.value` column is `jsonb`, so the day number is
 *      stored as a JSON number. The audit trigger on `settings`
 *      (migration `004_audit_trigger.sql`) automatically logs the
 *      change to `audit_log` — no separate audit insert needed.
 *
 * Validates: Requirement 10.1 (configurable 1..28),
 *            Requirement 10.2 (cycle boundary derivation),
 *            Requirement 10.4 (subsequent renders use the new value).
 *
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/design.md §"Server Actions"
 */

import { payCycleStartDaySchema } from '@/domain/validators'
import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SetPayCycleStartDayErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'INVALID_INPUT'
  | 'DB_ERROR'

export type SetPayCycleStartDayResult =
  | { ok: true; value: number }
  | {
      ok: false
      code: SetPayCycleStartDayErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function setPayCycleStartDay(
  input: unknown,
): Promise<SetPayCycleStartDayResult> {
  // 1. Auth + role gate ----------------------------------------------------
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
      message: 'Only owner accounts may change the pay cycle start day',
    }
  }

  // 2. Validate input ------------------------------------------------------
  const parsed = payCycleStartDaySchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Pay cycle start day must be an integer between 1 and 28',
      details: parsed.error.flatten(),
    }
  }
  const day = parsed.data

  // 3. Upsert into `settings` ---------------------------------------------
  // `settings.value` is `jsonb`; the supabase-js client serializes the
  // JS number to a JSON number on the wire. The audit trigger on the
  // table records the write; no separate audit_log insert is needed.
  const sb = createServerSupabaseClient()
  const { error: upsertError } = await sb
    .from('settings')
    .upsert(
      {
        key: 'pay_cycle_start_day',
        value: day,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )

  if (upsertError) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: upsertError.message,
      details: upsertError,
    }
  }

  return { ok: true, value: day }
}
