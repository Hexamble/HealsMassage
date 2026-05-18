// salary-system-rebuild — Heals Thai Massage POS
// Root page. Redirects based on the authenticated user's role:
//   - owner / boss_view → /owner
//   - cashier           → /cashier/<branch claim>
//   - unauthenticated   → /auth/sign-in

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()

  if (!user) {
    redirect('/auth/sign-in')
  }

  const role = (user.app_metadata?.role as string | undefined) ?? 'unknown'
  const branch = user.app_metadata?.branch as string | undefined

  if (role === 'owner' || role === 'boss_view') {
    redirect('/owner')
  }

  if (role === 'cashier' && branch) {
    redirect(`/cashier/${branch}`)
  }

  // Authenticated but with no recognised role/branch — show a small landing
  // page rather than a redirect loop.
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 p-8">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-2xl font-semibold">
          Signed in as {user.email}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Your account is missing a role claim. Ask the owner to set
          your role to <code>owner</code>, <code>cashier</code>, or{' '}
          <code>boss_view</code>.
        </p>
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
