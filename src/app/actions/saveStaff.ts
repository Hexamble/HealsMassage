'use server'

/**
 * `saveStaff` — owner-only server action that creates, updates, or
 * deactivates a row in the company-wide `staff` roster.
 *
 * Auth model:
 *   - `getCurrentProfile()` resolves the caller's `profiles` row. The
 *     action rejects every non-owner request with `NOT_OWNER` before
 *     touching the database — defence in depth on top of the
 *     `staff_owner_all` RLS policy in migration 003.
 *
 * Input shape (`SaveStaffInput`):
 *   - `id?: string`          — when present, the action UPDATEs the
 *                              existing row by primary key.
 *   - `name: string`         — required; trimmed and whitespace-collapsed
 *                              by `staffSchema`.
 *   - `homeBranch: Branch`   — required; one of Kimberry/Bishop/Chulia.
 *   - `isFreelance: boolean` — required.
 *   - `isActive: boolean`    — required. Setting to `false` is the
 *                              "deactivate" path — historical rows and
 *                              salary boards are preserved (Req 14.3).
 *
 * Validation:
 *   - The non-`id` fields are parsed by `staffSchema`. `id`, when
 *     supplied, is checked for non-empty string shape.
 *
 * Persistence:
 *   - WHEN `id` is present, UPDATE `staff` by `id` with the parsed
 *     fields. Returns `NOT_FOUND` if no row matches.
 *   - WHEN `id` is absent, attempt INSERT first. If the case-insensitive
 *     `staff_name_normalized_uidx` (UNIQUE on `lower(trim(name))` —
 *     migration 002) rejects the insert, fall back to a case-insensitive
 *     UPDATE on the existing row. Same idempotency pattern as the
 *     `seed-staff.ts` script — the JS client cannot target a functional
 *     unique index in `.upsert(... { onConflict })`, so application code
 *     emulates ON CONFLICT.
 *
 * Returns:
 *   - `{ ok: true, row: PersistedStaff }` — the canonical row as written.
 *   - `{ ok: false, code, message }` — discriminated error union.
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.5.
 *
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/design.md §"Staff Roster"
 */

import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { staffSchema } from '@/domain/validators'
import type { Branch } from '@/domain/types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SaveStaffErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'DB_ERROR'

export interface PersistedStaff {
  id: string
  name: string
  homeBranch: Branch
  isFreelance: boolean
  isActive: boolean
}

export interface SaveStaffInput {
  id?: string
  name: string
  homeBranch: Branch
  isFreelance: boolean
  isActive: boolean
}

export type SaveStaffResult =
  | { ok: true; row: PersistedStaff }
  | {
      ok: false
      code: SaveStaffErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Internal row shape (snake_case as returned by PostgREST).
// ---------------------------------------------------------------------------

interface StaffDbRow {
  id: string
  name: string
  home_branch: Branch
  is_freelance: boolean
  is_active: boolean
}

const STAFF_COLUMNS = 'id, name, home_branch, is_freelance, is_active'

function mapDbRow(row: StaffDbRow): PersistedStaff {
  return {
    id: row.id,
    name: row.name,
    homeBranch: row.home_branch,
    isFreelance: row.is_freelance,
    isActive: row.is_active,
  }
}

// Postgres unique-violation SQLSTATE.
const UNIQUE_VIOLATION = '23505'

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function saveStaff(
  input: SaveStaffInput,
): Promise<SaveStaffResult> {
  // 1. Auth gate.
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
      message: 'Only owner accounts may edit the staff roster',
    }
  }

  // 2. Validate the staff fields. `id` is checked separately because
  //    `staffSchema` only covers the editable columns.
  const parsed = staffSchema.safeParse({
    name: input?.name,
    homeBranch: input?.homeBranch,
    isFreelance: input?.isFreelance,
    isActive: input?.isActive,
  })
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Staff input failed validation',
      details: parsed.error.flatten(),
    }
  }
  const data = parsed.data

  const id = typeof input?.id === 'string' ? input.id.trim() : ''
  if (input?.id !== undefined && id.length === 0) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'id, when present, must be a non-empty string',
    }
  }

  const sb = createServerSupabaseClient()

  // 3a. UPDATE path — id present.
  if (id) {
    const { data: updated, error } = await sb
      .from('staff')
      .update({
        name: data.name,
        home_branch: data.homeBranch,
        is_freelance: data.isFreelance,
        is_active: data.isActive,
      })
      .eq('id', id)
      .select(STAFF_COLUMNS)
      .maybeSingle<StaffDbRow>()

    if (error) {
      return {
        ok: false,
        code: 'DB_ERROR',
        message: error.message,
        details: error,
      }
    }
    if (!updated) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `No staff row with id ${id}`,
      }
    }
    return { ok: true, row: mapDbRow(updated) }
  }

  // 3b. INSERT path — no id. Try INSERT first; if the case-insensitive
  //     unique index rejects, fall back to a case-insensitive UPDATE on
  //     the existing row. Same pattern as `seed-staff.ts` — the JS
  //     client cannot target a functional unique index via
  //     `.upsert(... { onConflict })`, so we emulate ON CONFLICT in
  //     application code.
  const { data: inserted, error: insertError } = await sb
    .from('staff')
    .insert({
      name: data.name,
      home_branch: data.homeBranch,
      is_freelance: data.isFreelance,
      is_active: data.isActive,
    })
    .select(STAFF_COLUMNS)
    .single<StaffDbRow>()

  if (!insertError && inserted) {
    return { ok: true, row: mapDbRow(inserted) }
  }

  // Detect the unique-violation SQLSTATE via the PostgREST error code.
  const isUniqueViolation =
    insertError != null &&
    ((insertError as { code?: string }).code === UNIQUE_VIOLATION)

  if (insertError && !isUniqueViolation) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: insertError.message,
      details: insertError,
    }
  }

  // INSERT lost the race against the unique index — UPDATE the existing
  // row by case-insensitive name match.
  const { data: existing, error: lookupError } = await sb
    .from('staff')
    .select('id')
    .ilike('name', data.name)
    .maybeSingle<{ id: string }>()

  if (lookupError) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: lookupError.message,
      details: lookupError,
    }
  }
  if (!existing) {
    // Should not happen — the unique index just rejected this name.
    return {
      ok: false,
      code: 'DB_ERROR',
      message: 'Unique-name conflict but no matching row found',
    }
  }

  const { data: updated, error: updateError } = await sb
    .from('staff')
    .update({
      name: data.name,
      home_branch: data.homeBranch,
      is_freelance: data.isFreelance,
      is_active: data.isActive,
    })
    .eq('id', existing.id)
    .select(STAFF_COLUMNS)
    .single<StaffDbRow>()

  if (updateError || !updated) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: updateError?.message ?? 'Update returned no row',
      details: updateError,
    }
  }

  return { ok: true, row: mapDbRow(updated) }
}
