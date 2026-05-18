// heals-system-rebuild — Heals Thai Massage POS
// Server-only profile helper.
//
// `getCurrentProfile()` resolves the authenticated Supabase user (via the
// SSR client wired up to the request's auth cookie) and joins it to the
// row in `profiles` that pins the user's role and home branch. Returns
// `null` whenever there is no authenticated user OR no matching profile
// row, so callers can treat both states identically (i.e. redirect to
// sign-in / render a 403).
//
// Used by:
//   - `middleware.ts` to gate every non-`/auth/*` route (Req 1.5).
//   - The cashier `[branch]/layout.tsx` to enforce per-branch RLS at the
//     UI layer (Req 1.3) — cashier role + matching `branch` required.
//   - The owner-only server actions to enforce role === 'owner' (Req 1.2)
//     before they touch the service-role client.
//   - `app/auth/sign-in/page.tsx` post-login redirect to route owners to
//     `/owner/command-center` and cashiers to `/cashier/{branch}`.
//
// `server-only` is a build-time guard: this module must never reach a
// client bundle (it would either no-op or leak the cookie store).
//
// _Requirements: 1.2, 1.3_

import 'server-only'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Branch } from '@/domain/types'

/**
 * Role assigned on a `profiles` row. The DB-level CHECK constraint
 * (see migration `001_init_schema.sql`) restricts the column to
 * exactly these two values.
 */
export type ProfileRole = 'owner' | 'cashier'

/**
 * Resolved current-user profile. `branch` is `null` for owners (they
 * are not pinned to a single branch); cashier rows always carry a
 * non-null `branch` per the schema.
 */
export interface CurrentProfile {
  /** Supabase auth user id (UUID). */
  userId: string
  role: ProfileRole
  /** Owner: `null`. Cashier: their assigned home branch. */
  branch: Branch | null
  displayName: string
}

/**
 * Read the current request's authenticated user and look up the
 * matching `profiles` row.
 *
 * Returns `null` when:
 *   - There is no Supabase session on the request (unauthenticated).
 *   - The auth user has no corresponding `profiles` row (orphan auth
 *     account; treat as logged-out).
 *
 * Both states surface as `null` so call sites (middleware, layouts,
 * server actions) only need to branch on a single condition before
 * redirecting / 403'ing.
 */
export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, branch, display_name')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile) return null

  return {
    userId: user.id,
    role: profile.role as ProfileRole,
    branch: (profile.branch ?? null) as Branch | null,
    displayName: profile.display_name as string,
  }
}
