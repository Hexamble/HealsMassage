// salary-system-rebuild — Heals Thai Massage POS
// Browser-side Supabase client for use inside Client Components.

'use client'

import { createBrowserClient as createSsrBrowserClient } from '@supabase/ssr'

export function createBrowserClient() {
  return createSsrBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
