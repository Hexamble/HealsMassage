'use server'

/**
 * heals-system-rebuild — `setBranchRoster` server action.
 *
 * Replace the `daily_roster` rows for a given `(branch, business_date)`
 * with the submitted list of staff UUIDs. The roster controls which
 * staff appear in the cashier's StaffPicker dropdown (Req 15.2) and
 * the live queue board, and which staff are eligible for salary
 * attribution at that branch on that day.
 *
 * Authority model (Req 15.1):
 *   - Cashier role: may only mutate their own branch's roster, and
 *     only for the current business date (today, after the 5 AM KL
 *     cutoff). Past-date or other-branch attempts are rejected at
 *     the application layer.
 *   - Owner role: may set the roster for any branch on any date.
 *     Used for back-correcting historical days from the owner roster
 *     page (task 11.x).
 *   - Any other role / unauthenticated: rejected.
 *
 * RLS (defence in depth):
 *   The `daily_roster` table has owner-full + cashier-branch-scoped
 *   policies (migration `003_rls_policies.sql`). The application
 *   checks above mirror those policies so cashier UIs see clear
 *   error codes instead of an opaque RLS rejection. The DB enforces
 *   the same constraint regardless.
 *
 * Atomic replace:
 *   We DELETE all rows for `(branch, business_date)` then INSERT the
 *   submitted set in two sequential statements. The unique index
 *   `(branch, business_date, staff_id)` (migration
 *   `002_indexes.sql`) prevents duplicate rows from accumulating.
 *   With one cashier per branch per shift, the window between the
 *   DELETE and the INSERT is not contended in practice. If a future
 *   workload demands true atomicity, replace the two statements with
 *   a `set_daily_roster(branch, business_date, staff_ids uuid[])`
 *   Postgres RPC.
 *
 * Audit:
 *   Inserts and deletes on `daily_roster` are captured by the
 *   AFTER-trigger defined in migration `004_audit_trigger.sql`, so
 *   no application-side audit_log write is needed here.
 *
 * Validates: Requirements 15.1, 15.2, 15.3.
 *
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/design.md §"Server Actions"
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/requirements.md §15
 */

import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { rosterSchema } from '@/domain/validators'
import { getBusinessDate } from '@/domain/business-date'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SetBranchRosterErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'BRANCH_MISMATCH'
  | 'DATE_NOT_TODAY'
  | 'DB_ERROR'

export type SetBranchRosterResult =
  | { ok: true; count: number }
  | {
      ok: false
      code: SetBranchRosterErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function setBranchRoster(
  input: unknown,
): Promise<SetBranchRosterResult> {
  // 1. Auth gate. -----------------------------------------------------------
  const profile = await getCurrentProfile()
  if (!profile) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Sign in required',
    }
  }

  // 2. Validate input. ------------------------------------------------------
  const parsed = rosterSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Roster input failed validation',
      details: parsed.error.flatten(),
    }
  }
  const { branch, businessDate, staffIds } = parsed.data

  // 3. Authority check (Req 15.1). -----------------------------------------
  if (profile.role === 'cashier') {
    if (profile.branch !== branch) {
      return {
        ok: false,
        code: 'BRANCH_MISMATCH',
        message: 'Cashier may only set the roster for their own branch',
      }
    }
    const today = getBusinessDate(new Date())
    if (businessDate !== today) {
      return {
        ok: false,
        code: 'DATE_NOT_TODAY',
        message:
          'Cashier may only set the roster for the current business date',
      }
    }
  } else if (profile.role !== 'owner') {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Insufficient permissions to set roster',
    }
  }

  // 4. De-duplicate staffIds. The unique index
  //    `(branch, business_date, staff_id)` would reject duplicates with
  //    a constraint violation; collapsing them client-side gives a
  //    cleaner error surface and avoids round-tripping a payload the
  //    DB will reject.
  const uniqueStaffIds = Array.from(new Set(staffIds))

  // 5. Replace rows: DELETE existing, then INSERT the submitted set.
  //    Both statements run through the user-bound SSR client so RLS
  //    applies as a second line of defence. For owner callers RLS is
  //    permissive (`roster_owner_all`); for cashiers RLS rechecks the
  //    branch claim against `profiles.branch`.
  const sb = createServerSupabaseClient()

  const { error: deleteError } = await sb
    .from('daily_roster')
    .delete()
    .eq('branch', branch)
    .eq('business_date', businessDate)

  if (deleteError) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: deleteError.message,
      details: deleteError,
    }
  }

  if (uniqueStaffIds.length > 0) {
    const rows = uniqueStaffIds.map((staffId) => ({
      branch,
      business_date: businessDate,
      staff_id: staffId,
    }))

    const { error: insertError } = await sb.from('daily_roster').insert(rows)

    if (insertError) {
      return {
        ok: false,
        code: 'DB_ERROR',
        message: insertError.message,
        details: insertError,
      }
    }
  }

  return { ok: true, count: uniqueStaffIds.length }
}
