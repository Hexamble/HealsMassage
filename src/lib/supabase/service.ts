// salary-system-rebuild — Heals Thai Massage POS
// Service-role Supabase client. Server-only; bypasses RLS. Used by Server
// Actions for audit_log writes and by the legacy migration tool.
//
// The `server-only` import is a build-time guard that errors if this module
// is ever imported into a client bundle. The runtime check below is a
// defence-in-depth fallback in case the build guard is bypassed.

import 'server-only'
import { createClient } from '@supabase/supabase-js'

export function createServiceClient() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'createServiceClient must not be invoked in a browser context',
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Supabase service client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    )
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
