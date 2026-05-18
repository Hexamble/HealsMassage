// heals-system-rebuild — Heals Thai Massage POS
// Cashier route layout (`/cashier/[branch]`).
//
// Task 8.1 scope (clean-break replacement of the salary-system-rebuild
// layout):
//
//   1. Branch param validation (Req 1.1) — anything outside the canonical
//      `BRANCHES` list (Kimberry / Bishop / Chulia) returns 404 via
//      `notFound()` so typo'd URLs do not reach `getCurrentProfile()` or
//      any DB query.
//
//   2. Auth guard via `getCurrentProfile()` (Req 1.1, 1.3, 1.5):
//        - No session / no profile row → redirect to `/auth/sign-in`
//          with `?next=<current path>` so the sign-in flow returns the
//          user to the page they originally requested.
//        - Owner role passes through unrestricted — owner can review or
//          operate any branch's cashier UI.
//        - Cashier whose `profile.branch` does not match the route →
//          treated as an access mismatch and redirected to sign-in
//          with `?next=<current path>` (chosen over a 403 page so the
//          flow is recoverable: signing in as the correct branch's
//          cashier lands them back here).
//
//   3. Branch theming (Req 19.1, 19.2, 19.3, 19.4) — apply
//      `theme-{branch}` on the layout root via `getBranchThemeClass`,
//      which falls back to `theme-default` if the branch cannot be
//      resolved so partial theme failure never breaks the layout.
//
//   4. `CashierContext` provider — the full heals context (today's
//      transactions, expenses, roster, realtime sync, morning reset)
//      is wired in Task 8.2. This layer only renders the themed
//      wrapper around `{children}`; child pages fetch their own data
//      until 8.2 lands.
//
// _Requirements: 1.1, 1.3, 1.5, 19.1, 19.2, 19.3, 19.4_

import { redirect, notFound } from 'next/navigation'

import { BRANCHES, type Branch } from '@/domain/types'
import { getCurrentProfile } from '@/lib/profile'
import { getBranchThemeClass } from '@/lib/theming'

export default async function CashierBranchLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { branch: string }
}) {
  // 1. Branch param validation. `BRANCHES` (in `domain/types.ts`) is the
  //    single source of truth; any other value 404s before we query
  //    Supabase or run any auth lookups.
  if (!(BRANCHES as readonly string[]).includes(params.branch)) {
    notFound()
  }
  const branch = params.branch as Branch

  // The post-sign-in destination sent through `?next=` on auth
  // redirects. The sign-in page (`app/auth/sign-in/page.tsx`) only
  // honors values that begin with `/`, so `/cashier/{branch}` is safe.
  const nextPath = `/cashier/${branch}`

  // 2. Auth guard. `getCurrentProfile()` returns null both for
  //    unauthenticated requests and for authenticated users without a
  //    matching `profiles` row, so a single redirect handles both states.
  const profile = await getCurrentProfile()
  if (!profile) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(nextPath)}`)
  }

  // Cashiers may only operate their own branch. Owner passes through
  // unrestricted (Req 1.2 — owner has full access to any branch UI).
  // Cross-branch cashier access is treated as a sign-in mismatch and
  // sent back through the auth flow with `?next=` preserved so signing
  // in as the correct identity lands the user back here.
  if (profile.role === 'cashier' && profile.branch !== branch) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(nextPath)}`)
  }

  // 3. Resolve the branch theme class. `getBranchThemeClass` itself
  //    falls back to `theme-default` if the branch cannot be matched,
  //    so partial theme failure never breaks the layout (Req 19.4).
  const themeClass = getBranchThemeClass(branch)

  // 4. Themed wrapper. `CashierProvider` is intentionally NOT mounted
  //    here — the full heals context lands in Task 8.2, at which point
  //    this return statement gains a `<CashierProvider>...</CashierProvider>`
  //    wrapper around `{children}`.
  return <div className={themeClass}>{children}</div>
}
