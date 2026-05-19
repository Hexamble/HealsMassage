// Universal auth redirect middleware.
//
// Lightweight cookie-presence check only — does NOT validate the token
// against Supabase here. Token validation happens server-side in the
// page/layout via getCurrentProfile(). Validating in middleware caused
// "ran out of available memory" errors on Vercel's Edge runtime
// because @supabase/ssr is heavy and middleware has a tight ~128MB
// memory limit per request.
//
// The cookie-presence check is sufficient for the middleware's job:
// redirect signed-out users to /auth/sign-in. Anyone with a fake/expired
// cookie still passes middleware but gets caught by getCurrentProfile()
// in the layout, which queries Supabase properly and returns null,
// triggering a redirect there instead.

import { NextResponse, type NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  const isAuthRoute = path.startsWith('/auth/')
  const isPublicAsset =
    path.startsWith('/_next') ||
    path.startsWith('/favicon') ||
    path.startsWith('/api/cron/') ||
    path === '/api/health'

  if (isAuthRoute || isPublicAsset) {
    return NextResponse.next()
  }

  // Look for any Supabase auth cookie. The cookie name is
  // `sb-{project-ref}-auth-token` for the access token (and may be
  // chunked into `sb-...-auth-token.0`, `.1` etc. for long tokens).
  // Just check if any auth-token cookie exists.
  const hasAuthCookie = req.cookies.getAll().some((c) => {
    const n = c.name
    return (
      n.startsWith('sb-') &&
      (n.endsWith('-auth-token') || n.includes('-auth-token.'))
    )
  })

  if (!hasAuthCookie) {
    const url = req.nextUrl.clone()
    url.pathname = '/auth/sign-in'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/cron/).*)'],
}
