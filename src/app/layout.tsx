// salary-system-rebuild — Heals Thai Massage POS
// Root layout. Two responsibilities beyond the usual Next.js boilerplate:
//
//   1. Resolve the user's theme server-side so the SSR HTML already
//      carries `class="dark"` on `<html>` when the saved preference is
//      `dark`. This eliminates the flash-of-light on first paint for
//      authenticated users.
//
//   2. Inject a small blocking inline script that runs before the body
//      paints. It handles the `'system'` branch (which depends on the
//      browser's `prefers-color-scheme` and therefore can't be resolved
//      on the server) and corrects the SSR-applied class if the cookie
//      session changed since the last render.
//
// The user-facing toggle (`<ThemeToggle />`) lives inside the cashier /
// owner layouts and updates `<html>` from the client; this root layout
// only handles initial paint.
//
// `getInitialTheme` is wrapped in try/catch because pages like
// `/auth/sign-in` render with no session and the Supabase call would
// otherwise reject. In that case we fall back to `'system'` and let
// the inline script honour the OS preference.

import type { Metadata } from 'next'
import localFont from 'next/font/local'

import { createServerClient } from '@/lib/supabase/server'
import type { Theme } from '@/lib/schemas'

import './globals.css'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
})

export const metadata: Metadata = {
  title: 'Heals POS',
  description: 'Cashier and owner dashboard for Heals Thai Massage',
}

const THEME_OPTIONS: readonly Theme[] = ['light', 'dark', 'system']

function isTheme(value: unknown): value is Theme {
  return (
    typeof value === 'string' &&
    (THEME_OPTIONS as readonly string[]).includes(value)
  )
}

/**
 * Best-effort server-side theme lookup. Returns `'system'` whenever the
 * user is not signed in or the DB read fails — neither case is fatal
 * because the inline script below picks up `prefers-color-scheme` for
 * `'system'`.
 */
async function getInitialTheme(): Promise<Theme> {
  try {
    const sb = createServerClient()
    const {
      data: { user },
    } = await sb.auth.getUser()
    if (!user) return 'system'

    const { data } = await sb
      .from('user_preferences')
      .select('theme')
      .eq('user_id', user.id)
      .maybeSingle()

    return isTheme(data?.theme) ? (data!.theme as Theme) : 'system'
  } catch {
    return 'system'
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const initialTheme = await getInitialTheme()

  // Pre-paint script: read the same theme value (serialised by the
  // server) and set/clear `class="dark"` on `<html>` before the body
  // renders. For `'system'`, defer to the OS via matchMedia. The
  // try/catch guarantees no exception escapes (which would block paint
  // and freeze the page).
  const themeInitScript = `(function(){try{var t=${JSON.stringify(
    initialTheme,
  )};var d=t==='dark'||(t==='system'&&typeof window!=='undefined'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var c=document.documentElement.classList;if(d){c.add('dark');}else{c.remove('dark');}}catch(e){}})();`

  // SSR snapshot: only emit `class="dark"` for an explicit `'dark'`
  // preference. For `'light'` and `'system'`, leave the class off and
  // let the inline script add it when the OS prefers dark.
  const htmlClassName = initialTheme === 'dark' ? 'dark' : undefined

  return (
    <html lang="en" className={htmlClassName}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100`}
      >
        {children}
      </body>
    </html>
  )
}
