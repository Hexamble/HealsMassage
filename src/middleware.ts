// heals-system-rebuild — Heals Thai Massage POS
// Universal auth redirect middleware.
//
// Every request that is not under `/auth/*` and not a static/CRON asset must
// have a valid Supabase session. Unauthenticated requests are redirected to
// `/auth/sign-in`, preserving the originally requested path in the `next`
// query parameter so the sign-in page can return the user to where they
// started.
//
// This protects the cashier and owner trees as well as every API route except
// the cron snapshot endpoint, which authenticates with its own CRON_SECRET.
//
// Request handling notes:
//   - We construct `res = NextResponse.next({ request: req })` first so cookies
//     written by `@supabase/ssr` (e.g. refreshed access tokens) are returned
//     on the response sent downstream.
//   - We use `supabase.auth.getUser()` rather than `getSession()` because the
//     latter trusts the cookie payload as-is, while `getUser()` validates the
//     token against Supabase. This matches the pattern recommended by
//     `@supabase/ssr` for middleware auth checks.
//   - The `matcher` config excludes Next's static asset paths and the cron
//     route at the routing layer; the runtime check provides a second layer
//     covering anything the matcher lets through.
//
// _Requirements: 1.1, 1.5_

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

import { clientEnv } from '@/lib/env'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req })

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get: (name: string) => req.cookies.get(name)?.value,
        set: (name: string, value: string, options: CookieOptions) =>
          res.cookies.set({ name, value, ...options }),
        remove: (name: string, options: CookieOptions) =>
          res.cookies.set({ name, value: '', ...options }),
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = req.nextUrl.pathname
  const isAuthRoute = path.startsWith('/auth/')
  const isPublicAsset =
    path.startsWith('/_next') ||
    path.startsWith('/favicon') ||
    path.startsWith('/api/cron/')

  if (!user && !isAuthRoute && !isPublicAsset) {
    const url = req.nextUrl.clone()
    url.pathname = '/auth/sign-in'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  return res
}

export const config = {
  // Run on every request except Next's bundled assets and the cron endpoint.
  // The runtime check above repeats these exclusions to cover any path the
  // matcher allows through (e.g. arbitrary `/favicon.*` variants).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/cron/).*)'],
}
