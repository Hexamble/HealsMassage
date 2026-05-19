// heals-system-rebuild — Heals Thai Massage POS
// /auth/sign-in — email + password sign-in.
//
// Single-file page composed of:
//   1. A Server Action `signIn` that calls `signInWithPassword` on the
//      cookie-bound SSR Supabase client, looks up the user's profile
//      row (role + branch), and redirects to the right post-login
//      destination.
//   2. A Server Component page that renders the form, hydrates any
//      `?next=...` redirect target as a hidden field, and surfaces
//      validation / auth errors via a `?error=...` query string.
//
// Redirect rules (Req 1.1, 1.2, 1.3):
//   - If a `?next=...` query param is present AND starts with `/`, use
//     it verbatim as the post-login destination. This is what middleware
//     uses to round-trip the user back to the page they originally
//     requested.
//   - Otherwise dispatch by role:
//       cashier → /cashier/{profile.branch}
//       owner   → /owner/command-center
//   - Any other role (or missing profile row) falls back to `/`.
//
// Wholesale replacement of the salary-system-rebuild sign-in page; the
// heals contract uses a server action instead of client-side
// `signInWithPassword`, and resolves the post-login route from the
// `profiles` table rather than `app_metadata`.
//
// _Requirements: 1.1, 1.2, 1.3_

import { redirect } from 'next/navigation'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/profile'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that an arbitrary string is safe to use as a same-origin
 * redirect target. We require a leading slash AND reject `//` (which a
 * browser interprets as a protocol-relative URL pointing at a different
 * host). Anything else falls back to `null` so the caller can apply the
 * role-based default.
 */
function safeNextPath(next: string | undefined | null): string | null {
  if (typeof next !== 'string') return null
  if (next.length === 0) return null
  if (!next.startsWith('/')) return null
  if (next.startsWith('//')) return null
  return next
}

/**
 * Resolve the destination for a successfully signed-in user. `next`
 * (when same-origin safe) wins over the role-based default.
 */
function destinationFor(
  role: 'owner' | 'cashier' | null,
  branch: string | null,
  next: string | null,
): string {
  if (next) return next
  if (role === 'cashier' && branch) return `/cashier/${branch}`
  if (role === 'owner') return '/owner'
  return '/'
}

// ---------------------------------------------------------------------------
// Server Action
// ---------------------------------------------------------------------------

async function signIn(formData: FormData): Promise<void> {
  'use server'

  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = safeNextPath(String(formData.get('next') ?? ''))

  // Build the back-to-form redirect target so the user keeps their `next`
  // query param across failed attempts.
  const formRedirect = (errorCode: string): string => {
    const params = new URLSearchParams()
    params.set('error', errorCode)
    if (next) params.set('next', next)
    return `/auth/sign-in?${params.toString()}`
  }

  if (!email || !password) {
    redirect(formRedirect('missing-credentials'))
  }

  const sb = createServerSupabaseClient()
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) {
    // We surface a single generic code to avoid leaking which factor
    // (email vs password) was wrong.
    redirect(formRedirect('invalid-credentials'))
  }

  // Look up the role + branch from the `profiles` table now that the
  // session cookie has been written.
  const profile = await getCurrentProfile()
  redirect(
    destinationFor(profile?.role ?? null, profile?.branch ?? null, next),
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  'missing-credentials': 'Enter both your email and password.',
  'invalid-credentials': 'Email or password is incorrect.',
}

interface SignInPageProps {
  searchParams?: { next?: string; error?: string }
}

export default function SignInPage({ searchParams }: SignInPageProps) {
  const next = safeNextPath(searchParams?.next) ?? ''
  const errorCode = searchParams?.error
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] : undefined

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-8 text-zinc-900 dark:text-zinc-100">
      <form
        action={signIn}
        className="w-full max-w-sm space-y-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6"
      >
        <h1 className="text-xl font-semibold">Sign in to Heals POS</h1>

        <input type="hidden" name="next" value={next} />

        <label className="block space-y-1">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@heals.example"
            className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-500"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Password
          </span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-500"
          />
        </label>

        <button
          type="submit"
          className="w-full rounded-lg bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900 py-2 font-medium hover:bg-zinc-800 dark:hover:bg-white"
        >
          Sign in
        </button>

        {errorMessage && (
          <p
            role="alert"
            className="text-sm text-red-600 dark:text-red-400"
          >
            {errorMessage}
          </p>
        )}
      </form>
    </div>
  )
}
