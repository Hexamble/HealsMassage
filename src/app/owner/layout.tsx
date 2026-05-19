// heals-system-rebuild — Owner dashboard layout (Task 13.1)
//
// Server Component:
//   - requires an authenticated owner via `getCurrentProfile()`
//   - cashier role → redirects to their assigned branch
//   - unauthenticated → redirects to sign-in with `?next=/owner`
//
// Renders a sidebar (desktop) + bottom-tab nav (mobile) shell around
// the page content.

import { redirect } from 'next/navigation'
import Link from 'next/link'

import { getCurrentProfile } from '@/lib/profile'
import ThemeToggle from '@/components/ThemeToggle'
import OwnerBottomNav from './OwnerBottomNav'
import OwnerSidebar from './OwnerSidebar'

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await getCurrentProfile()
  if (!profile) {
    redirect('/auth/sign-in?next=/owner')
  }
  if (profile.role !== 'owner') {
    // Cashier accidentally hit /owner — bounce them to their branch.
    if (profile.branch) {
      redirect(`/cashier/${profile.branch}`)
    }
    redirect('/auth/sign-in?next=/owner')
  }

  return (
    <div className="min-h-screen flex bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <OwnerSidebar userEmail={profile.displayName} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 sm:px-6 py-2 flex items-center justify-between gap-3">
          <h1 className="text-sm font-semibold">Heals — Boss HQ</h1>
          <div className="flex items-center gap-3">
            <Link
              href="/cashier/Kimberry"
              className="text-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-700"
              title="Open the cashier panel"
            >
              ↗ Cashier
            </Link>
            <ThemeToggle />
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-20 md:pb-8 overflow-auto">
          {children}
        </main>
      </div>
      <OwnerBottomNav />
    </div>
  )
}
