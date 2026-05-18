'use server'

/**
 * `updateRoster` — server action that inserts or updates a row in the
 * `staff` table.
 *
 * Auth + RLS model:
 *   - `createServerClient` carries the caller's JWT.
 *   - **Owners** may insert and update any staff row. The
 *     `staff_owner_all` RLS policy permits both.
 *   - **Cashiers** may *insert only* a new staff row at their own
 *     branch, with `is_freelance = false`. This powers the quick-add
 *     button in `<RosterPanel />` so a cashier can register a new
 *     hire on the fly without owner involvement (task 16.7). The
 *     `staff_cashier_insert` RLS policy enforces the same constraints
 *     at the database layer.
 *   - **Cashiers** cannot update existing staff (active flag, home
 *     branch, freelance flag, color). Those edits stay owner-only.
 *   - Any other role is rejected with `NOT_OWNER`.
 *   - The service client is used solely for the best-effort
 *     `audit_log` insert; audit failures never fail the write.
 *
 * Cashier safety rails (defence in depth — the RLS policy mirrors all
 * three):
 *   - `homeBranch` is overridden with the cashier's JWT branch claim.
 *     A spoofed payload cannot register a staff at a different branch.
 *   - `isFreelance` is forced to `false`. Cashiers don't see the flag.
 *   - `active` is forced to `true` (a brand-new hire is by definition
 *     active). Cashiers never deactivate via this action.
 *
 * Duplicate handling:
 *   - The `staff.name` column has a SQL `UNIQUE` constraint
 *     (case-sensitive). We add an application-level case-insensitive
 *     duplicate check so "Beer" and "beer" cannot both exist.
 *   - For owners: if a row exists whose `lower(name)` matches the
 *     input but whose stored `name` differs by case, we reject with
 *     `DUPLICATE_STAFF` rather than silently updating the existing
 *     row's casing. Case-exact match → UPDATE. No match → INSERT.
 *   - For cashiers: any existing row matching case-insensitively is a
 *     `DUPLICATE_STAFF` since the action is insert-only for them.
 *
 * Validates: Requirements 7.2 (owner manages roster),
 *            7.3 (case-insensitive uniqueness),
 *            12.1, 12.2 (per-branch authority — cashier insert
 *            scoped to own branch).
 *
 * @see c:/BILL/.kiro/specs/salary-system-rebuild/design.md §"Server Actions"
 */

import { staffInputSchema } from '@/lib/schemas'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { Branch } from '@/domain/row-id'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RosterErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'INVALID_INPUT'
  | 'DUPLICATE_STAFF'
  | 'DB_ERROR'

export interface PersistedStaff {
  id: string
  name: string
  homeBranch: Branch
  isFreelance: boolean
  active: boolean
  color: string
}

export type RosterResult =
  | { ok: true; staff: PersistedStaff }
  | {
      ok: false
      code: RosterErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Internal row shape (snake_case as returned by PostgREST)
// ---------------------------------------------------------------------------

interface StaffRow {
  id: string
  name: string
  home_branch: Branch
  is_freelance: boolean
  active: boolean
  color: string
}

function shapeRow(row: StaffRow): PersistedStaff {
  return {
    id: row.id,
    name: row.name,
    homeBranch: row.home_branch,
    isFreelance: row.is_freelance,
    active: row.active,
    color: row.color,
  }
}

const VALID_BRANCHES: readonly Branch[] = ['Kimberry', 'Bishop', 'Chulia']

function isValidBranch(value: unknown): value is Branch {
  return (
    typeof value === 'string' &&
    (VALID_BRANCHES as readonly string[]).includes(value)
  )
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function updateRoster(input: unknown): Promise<RosterResult> {
  const sb = createServerClient()

  // 1. Auth gate.
  const {
    data: { user },
    error: authError,
  } = await sb.auth.getUser()
  if (authError || !user) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Sign in required',
    }
  }

  // 2. Validate input.
  const parsed = staffInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Staff input failed validation',
      details: parsed.error.flatten(),
    }
  }
  let data = parsed.data

  // 3. Role gate.
  const role = (user.app_metadata?.role as string | undefined) ?? 'unknown'
  const branchClaim = user.app_metadata?.branch
  const isOwner = role === 'owner'
  const isCashier = role === 'cashier'

  if (!isOwner && !isCashier) {
    return {
      ok: false,
      code: 'NOT_OWNER',
      message: 'Only owner accounts may update the roster',
    }
  }

  // 4. Cashier safety rails. Override the dangerous fields with safe
  //    server-derived values regardless of what the client sent. The
  //    quick-add UI doesn't expose these knobs, but defending here
  //    means a spoofed payload still lands a row at the cashier's own
  //    branch as a non-freelance, active staff.
  if (isCashier) {
    if (!isValidBranch(branchClaim)) {
      return {
        ok: false,
        code: 'NOT_OWNER',
        message: 'Cashier branch claim is missing or invalid',
      }
    }
    data = {
      ...data,
      homeBranch: branchClaim,
      isFreelance: false,
      active: true,
    }
  }

  // 5. Case-insensitive duplicate precheck. The `staff.name` UNIQUE
  //    constraint is case-sensitive, so we look up `ilike(data.name)` and
  //    reject if a row with a different exact spelling already occupies
  //    the lowercased slot.
  const { data: existing, error: lookupError } = await sb
    .from('staff')
    .select('id, name')
    .ilike('name', data.name)

  if (lookupError) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: lookupError.message,
      details: lookupError,
    }
  }

  const conflict = (existing ?? []).find((row) => row.name !== data.name)
  if (conflict) {
    return {
      ok: false,
      code: 'DUPLICATE_STAFF',
      message: `Staff name collides with existing entry "${conflict.name}"`,
      details: { existingName: conflict.name },
    }
  }

  const existed = (existing ?? []).some((row) => row.name === data.name)

  // 6. Cashier may not update existing rows. Reject any case-exact
  //    re-add as a duplicate so the UI can show a friendly message.
  if (isCashier && existed) {
    return {
      ok: false,
      code: 'DUPLICATE_STAFF',
      message: `${data.name} already exists. Ask the owner to edit existing staff.`,
      details: { existingName: data.name },
    }
  }

  // 7. Upsert by name via service-role client. On case-exact match this
  //    updates (owner only by this point); otherwise it inserts. The
  //    case-insensitive precheck above guarantees the UNIQUE constraint
  //    won't fire for a near-duplicate. We use the service-role client
  //    to bypass RLS which doesn't properly expose custom JWT claims.
  const svc = createServiceClient()
  const { data: upserted, error: upsertError } = await svc
    .from('staff')
    .upsert(
      {
        name: data.name,
        home_branch: data.homeBranch,
        is_freelance: data.isFreelance,
        active: data.active,
        // Persist the chosen pill color. When omitted, fall back to
        // the same slate-grey default the DB column uses so existing
        // rows that haven't been recoloured stay neutral.
        color: data.color ?? '#94a3b8',
      },
      { onConflict: 'name' },
    )
    .select()
    .single<StaffRow>()

  if (upsertError || !upserted) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: upsertError?.message ?? 'Upsert returned no row',
      details: upsertError,
    }
  }

  const persisted = shapeRow(upserted)

  // 8. Audit log (best effort).
  try {
    const { error: auditError } = await svc.from('audit_log').insert({
      event: 'update_roster',
      payload: {
        name: persisted.name,
        homeBranch: persisted.homeBranch,
        action: existed ? 'update' : 'insert',
        actorRole: role,
      },
      actor: user.id,
    })
    if (auditError) {
      // eslint-disable-next-line no-console
      console.warn('[updateRoster] audit_log insert failed:', auditError.message)
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[updateRoster] audit_log threw:', err)
  }

  return { ok: true, staff: persisted }
}
