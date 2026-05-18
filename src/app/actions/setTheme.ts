'use server'

/**
 * `setTheme` — per-user UI preference write.
 *
 * Persists the caller's theme choice to `user_preferences` so the
 * choice survives sign-out / sign-in across devices. Each row is
 * keyed by `user_id` (PRIMARY KEY) and the table's RLS policies
 * limit every authenticated user to their own row only — neither
 * the owner nor another cashier can read or write someone else's
 * preference (see migration 20260103000600_user_preferences.sql).
 *
 * Auth model:
 *   - The user-bound SSR client carries the caller's JWT. The
 *     `user_prefs_self_*` policies gate the upsert on
 *     `user_id = auth.uid()`. The action passes `user.id` from
 *     `sb.auth.getUser()` into the upsert payload, so the WITH
 *     CHECK clause matches.
 *   - No role gate: every signed-in user (cashier, owner,
 *     boss_view) may set their own theme.
 *
 * Validation:
 *   - `setThemeInputSchema` (zod) restricts theme to
 *     `'light' | 'dark' | 'system'` — the same set the DB CHECK
 *     constraint enforces.
 *
 * Persistence:
 *   - UPSERT with `onConflict: 'user_id'` covers both first-time
 *     write (INSERT) and the common case (UPDATE). `updated_at`
 *     is stamped server side so it tracks the actual write time.
 *
 * Audit log: not written. Theme changes are pure UI ergonomics
 * with no business impact, and the per-user row already records
 * `updated_at` if anyone needs to investigate.
 *
 * Validates: ergonomics — Epic 18 (theme toggle).
 *
 * @see c:/BILL/.kiro/specs/salary-system-rebuild/design.md
 *      §"Server Actions"
 */

import { setThemeInputSchema, type Theme } from '@/lib/schemas'
import { createServerClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SetThemeErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_INPUT'
  | 'DB_ERROR'

export type SetThemeResult =
  | { ok: true; theme: Theme }
  | {
      ok: false
      code: SetThemeErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Internal row shape (PostgREST snake_case projection).
// ---------------------------------------------------------------------------

interface UserPreferencesRow {
  user_id: string
  theme: Theme
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function setTheme(input: unknown): Promise<SetThemeResult> {
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
  const parsed = setThemeInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Theme must be one of light, dark, system',
      details: parsed.error.flatten(),
    }
  }
  const data = parsed.data

  // 3. Upsert into `user_preferences`. RLS ensures `user_id` matches
  //    the calling JWT's `auth.uid()`, so the policy WITH CHECK
  //    accepts the row.
  const { data: row, error } = await sb
    .from('user_preferences')
    .upsert(
      {
        user_id: user.id,
        theme: data.theme,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select('user_id, theme')
    .single<UserPreferencesRow>()

  if (error || !row) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: error?.message ?? 'Upsert returned no row',
      details: error,
    }
  }

  return { ok: true, theme: row.theme }
}
