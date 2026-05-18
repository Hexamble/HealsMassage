// heals-system-rebuild — Heals Thai Massage POS
// /auth/sign-out — clears the Supabase session cookies and redirects to the
// sign-in page. POST is the canonical method (used by sign-out forms /
// buttons); GET is supported as a convenience for user agents and bookmarks
// that cannot easily issue a POST.
//
// _Requirements: 1.1_

import { NextResponse, type NextRequest } from 'next/server'

import { createServerSupabaseClient } from '@/lib/supabase/server'

async function handle(req: NextRequest) {
  const sb = createServerSupabaseClient()
  await sb.auth.signOut()
  return NextResponse.redirect(new URL('/auth/sign-in', req.url), {
    status: 303,
  })
}

export { handle as GET, handle as POST }
