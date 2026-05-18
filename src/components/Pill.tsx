// salary-system-rebuild — Heals Thai Massage POS
//
// Pill — small colored badge used in the cashier sheet for Staff,
// Course, Duration, and Method cells. Server-safe (no hooks, no
// directives) so it can be rendered from a Server Component or a
// Client Component interchangeably.
//
// Two coloring modes:
//
//   1. Inline `color` prop (hex `#RRGGBB`) — used for STAFF pills,
//      where the owner picks an arbitrary color per person via the
//      Roster Manager. Foreground (white vs. near-black) is
//      auto-derived via `readableTextColor` so the same pill reads
//      cleanly regardless of background luminance.
//
//   2. Tailwind `bgClass` + `textClass` props — used for COURSE,
//      METHOD, and DURATION pills, whose palette is fixed in
//      `domain/pill-colors.ts`. Pre-paired class strings keep the
//      Tailwind purge happy without a safelist entry.
//
// Behaviour:
//   - When `onClick` is supplied the pill becomes interactive —
//     hover ring + cursor-pointer — and the parent treats it as a
//     "row of pills" picker (see SessionForm). Without `onClick`
//     it's a static badge (TodaySessions).
//   - When `selected` is true the pill gets a darker zinc ring so
//     the picker UI can show which option is currently chosen.
//   - When `selected === false` (explicitly false, not undefined)
//     the pill is dimmed to 50% opacity so the picker can fade out
//     unselected siblings.
//
// The wrapper element is `<span>` for static badges and `<button>`
// for interactive pills so they sit cleanly inside <td> or a
// flex-row picker.

import type { ReactNode } from 'react'
import { readableTextColor } from '@/domain/pill-colors'

export interface PillProps {
  /** Visible label. */
  children: ReactNode
  /**
   * Hex `#RRGGBB` background — used for staff pills whose color
   * comes from the DB (`staff.color`). Mutually exclusive with
   * `bgClass`/`textClass`.
   */
  color?: string
  /** Tailwind background utility, e.g. `bg-teal-500`. */
  bgClass?: string
  /** Tailwind foreground utility, e.g. `text-white`. */
  textClass?: string
  /** When supplied, renders as `<button>` and signals interactivity. */
  onClick?: () => void
  /**
   * Tri-state:
   *   - `true`  → ring (selected option in a picker)
   *   - `false` → 50% opacity (unselected sibling in a picker)
   *   - undefined → static badge style (no ring, full opacity)
   */
  selected?: boolean
  /** Optional aria-label for picker pills. */
  'aria-label'?: string
  /** Optional title/tooltip — useful on truncated method codes. */
  title?: string
  /** Visual size variant. Defaults to `md`. */
  size?: 'sm' | 'md' | 'lg'
}

const SIZE_CLASSES: Record<NonNullable<PillProps['size']>, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-sm',
  lg: 'h-9 px-4 text-base',
}

const DEFAULT_BG_CLASS = 'bg-zinc-200 dark:bg-zinc-700'
const DEFAULT_TEXT_CLASS = 'text-zinc-900 dark:text-zinc-100'

export function Pill({
  children,
  color,
  bgClass,
  textClass,
  onClick,
  selected,
  title,
  'aria-label': ariaLabel,
  size = 'md',
}: PillProps) {
  // Resolve foreground / background. Inline `color` wins over
  // Tailwind classes; if neither is supplied we fall back to a
  // neutral zinc so the component never renders unstyled.
  //
  // When `color` is a hex string, we render a SOLID background fill
  // with auto-contrast text (white or near-black) via
  // `readableTextColor`. This matches the legacy Google Sheet
  // aesthetic where course/duration/method pills are clearly
  // colored blocks.
  const useInlineColor = typeof color === 'string' && color.length > 0
  const inlineFgClass = useInlineColor ? readableTextColor(color!) : ''
  const fgClass = useInlineColor
    ? inlineFgClass
    : (textClass ?? DEFAULT_TEXT_CLASS)
  const bgCls = useInlineColor ? '' : (bgClass ?? DEFAULT_BG_CLASS)
  // Compute inline foreground hex for the solid-fill mode so the
  // color is visible even without Tailwind CSS processing (tests, SSR).
  const inlineFgHex = useInlineColor
    ? computeInlineForeground(color!)
    : undefined
  const inlineStyle = useInlineColor
    ? { backgroundColor: color, color: inlineFgHex }
    : undefined
  const inlineBorderClass = ''

  const sizeClass = SIZE_CLASSES[size]
  const interactive = typeof onClick === 'function'
  const baseClasses =
    'inline-flex items-center justify-center rounded-full font-medium tabular-nums whitespace-nowrap'
  const interactiveClasses = interactive
    ? 'cursor-pointer hover:ring-2 hover:ring-zinc-400 transition-shadow'
    : ''
  const selectionClass =
    selected === true
      ? 'ring-2 ring-zinc-900 dark:ring-zinc-100'
      : selected === false
        ? 'opacity-50'
        : ''

  const className = [
    baseClasses,
    sizeClass,
    bgCls,
    fgClass,
    inlineBorderClass,
    interactiveClasses,
    selectionClass,
  ]
    .filter(Boolean)
    .join(' ')

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={ariaLabel}
        aria-pressed={selected ? true : undefined}
        className={className}
        style={inlineStyle}
      >
        {children}
      </button>
    )
  }

  return (
    <span
      title={title}
      aria-label={ariaLabel}
      className={className}
      style={inlineStyle}
    >
      {children}
    </span>
  )
}

export default Pill

/**
 * Compute an inline foreground hex color for a given background hex.
 * Uses the same luminance formula as `readableForegroundFor` in
 * `lib/theming.ts` but returns a hex string suitable for inline
 * `style.color`. Threshold is 0.55 to match `readableTextColor`.
 */
function computeInlineForeground(bgHex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(bgHex.trim())
  if (!m) return '#0f172a'
  const r = parseInt(m[1].slice(0, 2), 16) / 255
  const g = parseInt(m[1].slice(2, 4), 16) / 255
  const b = parseInt(m[1].slice(4, 6), 16) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.55 ? '#0f172a' : '#ffffff'
}
