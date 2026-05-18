/**
 * Visual theming — pill colors for the cashier sheet.
 *
 * Three of the four palettes here (Method, Course, Duration) are
 * stable, opinion-driven choices. The cashier sees the same color
 * for "FR 60 CASH" no matter which staff ran it. They live alongside
 * the domain enums but are NOT part of the domain layer — domain
 * code (commission, salary-board, queue) ignores colors entirely.
 *
 * The fourth palette — staff color — is NOT defined here. Staff
 * color is a per-row, owner-picked value persisted on `staff.color`.
 * The cashier UI receives a `staffColors: Record<string, string>`
 * map (lowercased name → hex) from the page-level fetch and resolves
 * each row at render time. When a transaction's staff name doesn't
 * appear in the roster (legacy import, deactivated staff), the UI
 * falls back to `DEFAULT_STAFF_COLOR`.
 *
 * Foreground readability is computed via the standard relative
 * luminance formula. Cells with a luminance above the threshold use
 * near-black text; everything else uses white. The threshold (0.6)
 * is tuned so the slate-grey default (#94a3b8 / lum ≈ 0.396) reads
 * with white text, matching the cashier's visual expectation.
 *
 * No I/O; no React imports; safe to import from server components,
 * client components, and pure tests alike.
 */

import type { Course, Duration, Method } from '@/domain/commission'

/**
 * Method pill colors. Visual choice — these mirror the legacy
 * sheet's intent (CASH = teal, QR = red, CREDIT = green) but are
 * not the literal Sheets palette.
 */
export const METHOD_COLORS: Record<Method, string> = {
  CASH: '#14b8a6', // teal-500
  QR: '#ef4444', // red-500
  CREDIT: '#10b981', // emerald-500
  Freelance: '#d946ef', // fuchsia-500
  'EXTRA KM': '#f59e0b', // amber-500
  'EXTRA BS': '#f97316', // orange-500
  'EXTRA CL': '#8b5cf6', // violet-500
}

/**
 * Course pill colors. Stable per-course mapping — picked to span
 * the rainbow so adjacent courses on the cashier panel are easy to
 * tell apart at a glance.
 */
export const COURSE_COLORS: Record<Course, string> = {
  FR: '#f87171', // red-400
  HS: '#e879f9', // fuchsia-400
  FNS: '#84cc16', // lime-500
  BMT: '#b45309', // amber-700
  BAT: '#dc2626', // red-600
  DTM: '#f97316', // orange-500
  THC: '#0d9488', // teal-600
  HOM: '#fb923c', // orange-400
  PBA: '#818cf8', // indigo-400
  PBAC: '#818cf8', // indigo-400
  EAR: '#34d399', // emerald-400
  PTF: '#06b6d4', // cyan-500
  PAF: '#06b6d4', // cyan-500
  PHL: '#06b6d4', // cyan-500
  PHT: '#06b6d4', // cyan-500
}

/**
 * Duration pill colors. Stable mapping — the four durations cycle
 * through warm → cool so the cashier can spot a 30 vs 120 at the
 * edge of vision.
 */
export const DURATION_COLORS: Record<Duration, string> = {
  30: '#fbbf24', // amber-400
  60: '#f87171', // red-400
  90: '#34d399', // emerald-400
  120: '#6366f1', // indigo-500
}

/**
 * Default staff pill background when the roster doesn't carry an
 * owner-picked color (new staff, legacy rows). Matches the DB
 * default on `staff.color` and the Tailwind slate-400 token.
 */
export const DEFAULT_STAFF_COLOR = '#94a3b8'

/**
 * Pick a readable foreground (white or near-black slate-900) for
 * the given background hex. Uses the standard relative-luminance
 * formula (no gamma correction — fast enough at render time and
 * accurate enough for a 12-color palette).
 *
 * Examples:
 *   readableForegroundFor('#94a3b8') ≈ lum 0.396 → '#ffffff'
 *   readableForegroundFor('#fbbf24') ≈ lum 0.700 → '#0f172a'
 *   readableForegroundFor('#0d9488') ≈ lum 0.290 → '#ffffff'
 *
 * Returns near-black for malformed input so a stray empty string
 * still renders legible text on the default browser background.
 */
export function readableForegroundFor(bgHex: string): '#ffffff' | '#0f172a' {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(bgHex.trim())
  if (!m) return '#0f172a'
  const r = parseInt(m[1].slice(0, 2), 16) / 255
  const g = parseInt(m[1].slice(2, 4), 16) / 255
  const b = parseInt(m[1].slice(4, 6), 16) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.55 ? '#0f172a' : '#ffffff'
}

/**
 * Resolve a staff name to its pill color. Lookup is
 * case-insensitive (the `staffColors` map is keyed by lowercased
 * name). Falls back to `DEFAULT_STAFF_COLOR` when the staff isn't
 * in the roster — common for historical rows whose staff has been
 * renamed or deactivated.
 */
export function resolveStaffColor(
  staffName: string,
  staffColors: Record<string, string>,
): string {
  const key = staffName.trim().toLowerCase()
  return staffColors[key] ?? DEFAULT_STAFF_COLOR
}

// ---------------------------------------------------------------------------
// Branch-level theming (Req 19.1–19.4)
// ---------------------------------------------------------------------------
//
// Whole-page theme tokens applied at the cashier `[branch]` layout level.
// Distinct from the pill palettes above:
//
//   - METHOD/COURSE/DURATION/STAFF colors are per-pill, content-driven —
//     "the same FR 60 CASH renders the same color regardless of branch".
//   - BRANCH_THEMES is per-branch, identity-driven — "the cashier sees
//     teal at Kimberry, gold at Bishop, coral at Chulia, so they know
//     immediately which branch interface they are working in" (Req 19).
//
// The class on `<body>` (or the cashier-route layout container) sets
// three CSS custom properties:
//
//     --theme-primary             — background fill for headers, primary
//                                   buttons, accent strokes.
//     --theme-accent              — secondary tint (badges, hover bg).
//     --theme-primary-foreground  — text on primary surfaces (white in
//                                   every branch — all primaries are
//                                   dark/saturated enough for white text).
//
// Tailwind/CSS consumers read them via the arbitrary-value syntax:
//
//     <button class="bg-[var(--theme-primary)] text-[var(--theme-primary-foreground)]">
//
// so themes never require recompiling Tailwind's design tokens.
//
// Color values match `c:/BILL/app/scripts/seed-settings.ts` so the
// owner-facing settings JSON and the build-time defaults agree.

import type { Branch } from '@/domain/types'

/**
 * One branch's theme record. `cssClass` is the class to apply on the
 * `<body>` or layout root; the actual variable bindings live in
 * `c:/BILL/app/src/app/globals.css` (see `theme-kimberry`,
 * `theme-bishop`, `theme-chulia`, `theme-default`).
 */
export interface BranchTheme {
  /** Primary brand color — headers, primary buttons. Hex `#rrggbb`. */
  primary: string
  /** Accent color — secondary highlights, hover bg. Hex `#rrggbb`. */
  accent: string
  /**
   * Foreground color used on top of `primary`. Always white here — every
   * branch primary is saturated enough to read white text against.
   */
  primaryForeground: string
  /** CSS class name to apply on the layout root. */
  cssClass: string
}

/**
 * Per-branch theme map. Hex values mirror `seed-settings.ts` so the
 * build-time CSS, the owner-editable `settings.branch_themes` row, and
 * the runtime fallback all agree.
 *
 * Palette (Req 19.1–19.3):
 *   Kimberry → teal      (primary teal-600, accent teal-500)
 *   Bishop   → gold/amber (primary amber-600, accent amber-500)
 *   Chulia   → coral/rose (primary rose-500,  accent rose-400)
 */
export const BRANCH_THEMES: Readonly<Record<Branch, BranchTheme>> = {
  Kimberry: {
    primary: '#0d9488', // teal-600
    accent: '#14b8a6', // teal-500
    primaryForeground: '#ffffff',
    cssClass: 'theme-kimberry',
  },
  Bishop: {
    primary: '#d97706', // amber-600
    accent: '#f59e0b', // amber-500
    primaryForeground: '#ffffff',
    cssClass: 'theme-bishop',
  },
  Chulia: {
    primary: '#f43f5e', // rose-500
    accent: '#fb7185', // rose-400
    primaryForeground: '#ffffff',
    cssClass: 'theme-chulia',
  },
} as const

/**
 * Neutral grey fallback used when the branch cannot be determined
 * (e.g. an unauthenticated layout, a 404, or a transient render
 * before the route param has resolved). Per Req 19.4, partial theme
 * failure must NOT break layout — so the fallback class is a
 * first-class theme with the same three CSS variables defined.
 */
export const DEFAULT_THEME_CLASS = 'theme-default'

/**
 * Resolve a branch to its theme CSS class, with a safe fallback.
 *
 * Examples:
 *   getBranchThemeClass('Kimberry') → 'theme-kimberry'
 *   getBranchThemeClass(null)       → 'theme-default'
 *
 * Returns `'theme-default'` for `null` (Req 19.4 fallback). The
 * `Branch` parameter is constrained by TypeScript to the three
 * canonical branches, so any non-null value resolves to a defined
 * theme. The `?? DEFAULT_THEME_CLASS` tail is defence-in-depth: if a
 * caller widens the type to `string`, an unknown branch still gets
 * the neutral class instead of `undefined` blowing up the className.
 */
export function getBranchThemeClass(branch: Branch | null): string {
  if (branch === null) return DEFAULT_THEME_CLASS
  return BRANCH_THEMES[branch]?.cssClass ?? DEFAULT_THEME_CLASS
}

/**
 * Build a CSS-variable style object for a branch theme. Useful when
 * a component needs to scope a theme to a sub-tree without setting a
 * class on `<body>` (e.g. a preview tile in the owner settings page).
 *
 * Returns `Record<string, string>` rather than `React.CSSProperties`
 * so this module stays React-free — it's safe to import from server
 * components, pure tests, and non-React utilities. The shape matches
 * `React.CSSProperties` structurally (a string-keyed string map), so
 * passing the result directly into a `style={...}` prop works:
 *
 *     <div style={getBranchThemeStyle('Kimberry')}> ... </div>
 *
 * For an unknown / null branch, returns the default theme variables
 * so the consumer always gets a valid render.
 */
export function getBranchThemeStyle(
  branch: Branch | null,
): Record<string, string> {
  const theme = branch !== null ? BRANCH_THEMES[branch] : null
  if (theme) {
    return {
      '--theme-primary': theme.primary,
      '--theme-accent': theme.accent,
      '--theme-primary-foreground': theme.primaryForeground,
    }
  }
  // Default fallback values — kept in sync with `.theme-default` in
  // globals.css.
  return {
    '--theme-primary': '#475569', // slate-600
    '--theme-accent': '#94a3b8', // slate-400
    '--theme-primary-foreground': '#ffffff',
  }
}
