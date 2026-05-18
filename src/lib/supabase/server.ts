// heals-system-rebuild — Heals Thai Massage POS
// Server-side Supabase SSR client.
//
// `createServerSupabaseClient()` is the canonical factory for use inside
// Server Components, Server Actions, Route Handlers, and Middleware. It wires
// the auth session cookie via Next 14's `cookies()` helper so RLS policies
// see the authenticated user's JWT on every request.
//
// Configuration is sourced from `clientEnv` (the validated public-key bundle
// in `@/lib/env`). Both the URL and the anon key are public values, so reading
// them through `clientEnv` is safe in any server bundle.
//
// `createServerClient` is re-exported as a backward-compatible alias for the
// existing call sites carried over from the salary-system-rebuild spec.
//
// _Requirements: 1.1, 1.4_

import 'server-only'
import {
  createServerClient as createSsrServerClient,
  type CookieOptions,
} from '@supabase/ssr'
import { cookies } from 'next/headers'

import { clientEnv } from '@/lib/env'

export function createServerSupabaseClient() {
  const cookieStore = cookies()
  return createSsrServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options })
          } catch {
            // Server Components are read-only at the cookie layer; cookie
            // mutations are handled by Server Actions, Route Handlers, or
            // Middleware. Swallow the read-only error silently.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options })
          } catch {
            // See note above.
          }
        },
      },
    },
  )
}

// Backward-compatible alias for call sites established by the previous
// salary-system-rebuild spec. New code should prefer
// `createServerSupabaseClient`.
export const createServerClient = createServerSupabaseClient
