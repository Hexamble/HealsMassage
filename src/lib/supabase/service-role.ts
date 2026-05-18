// heals-system-rebuild — Heals Thai Massage POS
// Service-role Supabase client. Server-only; bypasses RLS. Used for the
// automated EXTRA mirror writes performed by `writeTransaction` and for
// audit-log inserts where the calling user's JWT cannot satisfy RLS.
//
// The `server-only` import is a build-time guard: if this module is ever
// pulled into a client bundle, Next.js fails the build immediately rather
// than leaking the service-role key to the browser. `serverEnv` adds a
// runtime guard via its browser proxy, which throws on any property access
// outside Node.
//
// _Requirements: 1.4, 5.2, 5.3_

import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env'

let cached: ReturnType<typeof createClient> | null = null

export function getServiceRoleClient() {
  if (!cached) {
    cached = createClient(
      serverEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    )
  }
  return cached
}
