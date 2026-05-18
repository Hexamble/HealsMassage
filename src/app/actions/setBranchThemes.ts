'use server'

/**
 * heals-system-rebuild — `setBranchThemes` server action.
 *
 * Owner-only mutation that updates the `branch_themes` row in the
 * `settings` key/value table. Each branch (Kimberry, Bishop, Chulia)
 * carries a `{ primary, accent }` pair of `#rrggbb` hex strings; the
 * cashier `[branch]` layout reads them at render time via
 * `src/lib/theming.ts` to colour the page identity (Req 19.1–19.3).
 *
 * Note: this action is distinct from the legacy `setTheme.ts` carried
 * over from the salary-system spec, which writes a per-user
 * `light | dark | system` preference to `user_preferences`. That action
 * is kept untouched so the existing light/dark UI toggle continues to
 * work; this action governs the per-branch identity colour palette.
 *
 * Pipeline:
 *   1. Resolve the current profile via `getCurrentProfile()`. Reject
 *      anonymous (`UNAUTHENTICATED`) and non-owner (`NOT_OWNER`)
 *      callers before touching the database. RLS on `settings` (policy
 *      `settings_owner_all` in migration `003_rls_policies.sql`) is
 *      the ultimate gate, but the application-level check returns a
 *      clearer error code for the owner-settings UI.
 *   2. Validate input. Each branch must carry `primary` and `accent`
 *      strings matching `/^#[0-9a-fA-F]{6}$/` (six-digit hex with
 *      leading `#`). All three branches must be present so a partial
 *      update can never leave the JSON in an inconsistent shape.
 *   3. Upsert into `settings` keyed on `key = 'branch_themes'`. The
 *      `settings.value` column is `jsonb`, so the themes object is
 *      stored verbatim. The audit trigger on `settings`
 *      (migration `004_audit_trigger.sql`) automatically logs the
 *      change to `audit_log` — no separate audit insert needed.
 *
 * Validates: Requirement 19.1 (Kimberry teal), 19.2 (Bishop gold),
 *            19.3 (Chulia coral). The action does not enforce specific
 *            hue ranges — it accepts any well-formed hex so the owner
 *            can rebrand a branch — but the seeded defaults match the
 *            requirements exactly.
 *
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/design.md §"Server Actions"
 * @see c:/BILL/app/src/lib/theming.ts (consumer)
 * @see c:/BILL/app/scripts/seed-settings.ts (seeded defaults)
 */

import { z } from 'zod'

import { BRANCHES, type Branch, type BranchThemeSetting } from '@/domain/types'
import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Six-digit hex color with leading `#` (e.g. `#0d9488`). Three-digit
 * shorthand (`#abc`) is rejected so the persisted value is always a
 * full 7-character string the CSS variable consumers can use without
 * normalisation.
 */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

const branchThemeSettingSchema = z.object({
  primary: z.string().regex(HEX_COLOR_RE, 'primary must be #rrggbb hex'),
  accent: z.string().regex(HEX_COLOR_RE, 'accent must be #rrggbb hex'),
})

/**
 * Input schema. Requires every `Branch` to be present so the persisted
 * `branch_themes` row is always a complete map — no partial updates.
 * `BRANCHES` is the runtime tuple from `@/domain/types`; we collapse
 * it into a `Record<Branch, BranchThemeSetting>` zod object so the
 * inferred type lines up with the public `Settings.branchThemes`
 * shape.
 */
const branchThemesShape = BRANCHES.reduce(
  (acc, branch) => {
    acc[branch] = branchThemeSettingSchema
    return acc
  },
  {} as Record<Branch, typeof branchThemeSettingSchema>,
)

const setBranchThemesInputSchema = z.object({
  themes: z.object(branchThemesShape),
})

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SetBranchThemesErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'INVALID_INPUT'
  | 'DB_ERROR'

export type SetBranchThemesResult =
  | { ok: true; value: Record<Branch, BranchThemeSetting> }
  | {
      ok: false
      code: SetBranchThemesErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function setBranchThemes(
  input: unknown,
): Promise<SetBranchThemesResult> {
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
      message: 'Only owner accounts may change branch themes',
    }
  }

  // 2. Validate input ------------------------------------------------------
  const parsed = setBranchThemesInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message:
        'themes must include Kimberry, Bishop, and Chulia, each with #rrggbb primary and accent',
      details: parsed.error.flatten(),
    }
  }
  const themes = parsed.data.themes

  // 3. Upsert into `settings` ---------------------------------------------
  // `settings.value` is `jsonb`; supabase-js serialises the JS object
  // to a JSON object on the wire. The audit trigger on the table
  // records the write, so no separate audit_log insert is needed.
  const sb = createServerSupabaseClient()
  const { error: upsertError } = await sb
    .from('settings')
    .upsert(
      {
        key: 'branch_themes',
        value: themes,
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

  return { ok: true, value: themes }
}
