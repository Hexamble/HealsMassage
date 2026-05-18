// salary-system-rebuild — Heals Thai Massage POS
//
// <ThemeToggle /> — a tri-state segmented control that lets every
// authenticated user pick `light`, `dark`, or `system` themes. The
// choice is persisted via `setTheme` and applied immediately to
// `<html>` so dark variants in Tailwind respond without a reload.
//
// How it works:
//   - The parent layout fetches the user's preference server-side
//     (`user_preferences.theme`, defaulting to `'system'` when no
//     row exists) and passes it via `initialTheme`.
//   - Click handler updates local state optimistically, applies
//     the theme to `<html>` immediately, then calls `setTheme`.
//     On error the local state is reverted and an inline error
//     message appears next to the segmented control.
//   - The `'system'` branch reads
//     `window.matchMedia('(prefers-color-scheme: dark)')` to decide
//     whether to add or remove the `dark` class on `<html>`.
//
// Tailwind dark mode is class-based (see `tailwind.config.ts`) so
// adding/removing `class="dark"` on `<html>` is the only DOM
// manipulation required.
//
// Validates: ergonomics — Epic 18 (theme toggle).

'use client'

import { useEffect, useState, useTransition } from 'react'

import { setTheme as setThemeAction } from '@/app/actions/setTheme'
import type { Theme } from '@/lib/schemas'

// ---------------------------------------------------------------------------
// Public type alias — re-exported so server components can pass
// `Theme` through props without importing the zod schema module.
// ---------------------------------------------------------------------------

export type { Theme } from '@/lib/schemas'

// ---------------------------------------------------------------------------
// DOM helper: apply a theme to `<html>` by adding/removing the `dark`
// class. The function is exported for tests and for any code that
// needs to apply the theme at first paint (e.g. a future blocking
// inline script in the root layout).
// ---------------------------------------------------------------------------

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  let dark: boolean
  if (theme === 'dark') {
    dark = true
  } else if (theme === 'light') {
    dark = false
  } else {
    // 'system' — defer to the OS prefers-color-scheme.
    dark =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  if (dark) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

// ---------------------------------------------------------------------------
// Visual options for the segmented control.
// ---------------------------------------------------------------------------

interface Option {
  value: Theme
  label: string
  icon: string
}

const OPTIONS: readonly Option[] = [
  { value: 'light', label: 'Light', icon: '☀' },
  { value: 'dark', label: 'Dark', icon: '🌙' },
  { value: 'system', label: 'System', icon: '💻' },
] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ThemeToggleProps {
  /** Server-fetched starting value. Defaults to `'system'`. */
  initialTheme?: Theme
}

export default function ThemeToggle({
  initialTheme = 'system',
}: ThemeToggleProps) {
  const [theme, setLocalTheme] = useState<Theme>(initialTheme)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Apply the initial theme on mount (fallback in case the server
  // didn't inline a class on <html>). This is also the only spot
  // where the `system` branch hooks into `prefers-color-scheme`
  // for first paint.
  useEffect(() => {
    applyTheme(initialTheme)
    // We deliberately depend only on the initial mount — subsequent
    // changes are handled by the click handler below. Re-applying on
    // every initialTheme change would fight the click handler in the
    // (rare) case the parent re-renders with a different prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onPick(next: Theme): void {
    if (next === theme) return
    const previous = theme
    setError(null)
    setLocalTheme(next)
    applyTheme(next)
    startTransition(async () => {
      try {
        const result = await setThemeAction({ theme: next })
        if (!result.ok) {
          // Revert local state and DOM on failure.
          setLocalTheme(previous)
          applyTheme(previous)
          setError(result.message)
        }
      } catch (err) {
        setLocalTheme(previous)
        applyTheme(previous)
        setError(err instanceof Error ? err.message : 'Failed to save theme')
      }
    })
  }

  return (
    <div
      className="inline-flex items-center gap-2"
      role="group"
      aria-label="Theme"
    >
      <div className="inline-flex rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 p-0.5">
        {OPTIONS.map((opt) => {
          const selected = theme === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPick(opt.value)}
              disabled={isPending && selected}
              aria-pressed={selected}
              aria-label={opt.label}
              title={opt.label}
              className={[
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                selected
                  ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
              ].join(' ')}
            >
              <span aria-hidden="true">{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          )
        })}
      </div>
      {error ? (
        <span
          role="alert"
          className="text-xs text-rose-600 dark:text-rose-400"
        >
          {error}
        </span>
      ) : null}
    </div>
  )
}
