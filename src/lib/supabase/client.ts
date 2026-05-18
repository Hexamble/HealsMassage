// heals-system-rebuild — Heals Thai Massage POS
// Browser-side Supabase client (singleton).
//
// Returns a cached `@supabase/ssr` browser client so we don't re-instantiate
// the client (and its underlying realtime socket) on every render.
//
// _Requirements: 1.1, 8.1_

'use client'

import { createBrowserClient } from '@supabase/ssr'
import { clientEnv } from '@/lib/env'

let cached: ReturnType<typeof createBrowserClient> | null = null

/**
 * Returns the singleton browser Supabase client for the current page session.
 *
 * The client is created lazily on first call and reused thereafter so that
 * a single auth session, realtime socket, and cookie sync handler is shared
 * across every Client Component on the page.
 */
export function createBrowserSupabaseClient() {
  if (!cached) {
    cached = createBrowserClient(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    )
  }
  return cached
}
