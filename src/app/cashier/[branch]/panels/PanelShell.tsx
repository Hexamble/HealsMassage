// heals-system-rebuild — Heals Thai Massage POS
//
// PanelShell — collapsible/expandable panel wrapper used by every
// summary panel on the cashier dashboard (Earnings, Queue, Summary,
// Expenses+Freelance, ...). Renders a rounded card with:
//
//   - a coloured header strip carrying the title (with optional
//     emoji icon) and an optional right-side `action` slot,
//   - a chevron that rotates on the open/close axis, and
//   - a body that expands/collapses with a smooth height transition.
//
// Heals visual style:
//
//   - The card carries a thin `--theme-primary` accent stripe on its
//     left edge so the cashier always sees a hint of branch identity
//     even on neutral panels.
//   - The chevron and focus ring use `--theme-primary` so each branch
//     (Kimberry/Bishop/Chulia) keeps a consistent theme look.
//   - When the caller does not pass `headerBgClass`, we fall back to
//     a tinted strip backed by `--theme-accent` so unstyled panels
//     still feel branded.
//
// API (per task 10.4):
//
//   - `title`        — visible header label (required).
//   - `children`     — body content (required).
//   - `defaultOpen?` — initial open state, default `true`.
//   - `action?`      — right-side header content (e.g. a status
//                      badge, button, or link). Click events on this
//                      slot are isolated from the toggle.
//
// Backward-compatible extras (used by panels migrated from the
// salary-system-rebuild spec):
//
//   - `collapsible` — default `true`. When `false` the header is a
//     plain `<header>` and the body is permanently visible.
//   - `icon`        — emoji prefix shown before the title.
//   - `headerBgClass` — Tailwind classes for the header strip.
//   - `headerRight` — legacy alias for `action`. `action` wins when
//     both are supplied.
//   - `className`   — extra classes appended to the outer card.
//
// Validates: Requirements 23.1, 23.2, 23.4.

'use client'

import { useState, type ReactNode } from 'react'

export interface PanelShellProps {
  /** Visible header label (e.g. 'Earnings'). */
  title: string
  /** Body content. Always rendered; the wrapper animates its height. */
  children: ReactNode
  /** Initial open state. Defaults to `true`. */
  defaultOpen?: boolean
  /**
   * Optional right-side header content (typically a `<StaleBadge />`,
   * a small action button, or a status pill). Click events on this
   * slot are isolated from the header toggle so the action stays
   * interactive without flipping the panel open/closed.
   */
  action?: ReactNode
  /**
   * Whether the header acts as a toggle. Defaults to `true`. When
   * `false`, the panel is permanently expanded and `defaultOpen`
   * is ignored.
   */
  collapsible?: boolean
  /** Optional emoji prefix shown before the title (e.g. '👤'). */
  icon?: string
  /**
   * Tailwind classes for the header strip background. Pass the
   * full light + dark pair so the purger keeps both, e.g.
   * `bg-emerald-100 dark:bg-emerald-900/40`. When omitted, a
   * theme-aware default tint backed by `--theme-accent` is used.
   */
  headerBgClass?: string
  /** @deprecated Prefer `action`. Kept for migration compatibility. */
  headerRight?: ReactNode
  /** Optional extra classes appended to the outer card. */
  className?: string
}

export default function PanelShell({
  title,
  children,
  defaultOpen = true,
  action,
  collapsible = true,
  icon,
  headerBgClass,
  headerRight,
  className,
}: PanelShellProps) {
  const [open, setOpen] = useState<boolean>(defaultOpen)

  // `action` is the canonical heals API; `headerRight` is the legacy
  // alias from the salary-system-rebuild spec. Prefer `action` when
  // both are set.
  const rightContent = action ?? headerRight

  const cardCls = [
    // The `border-l-4` + `border-l-[var(--theme-primary)]` pair
    // paints a thin accent stripe on the card edge so the panel
    // always carries a hint of branch identity (Req 23.1).
    'flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800',
    'border-l-4 border-l-[var(--theme-primary)]',
    'bg-white dark:bg-zinc-900 overflow-hidden',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  // Default header tint uses `--theme-accent` at low opacity. Tailwind
  // arbitrary-value `bg-[var(--theme-accent)]/15` resolves to a
  // semi-transparent layer on top of the card surface so each branch
  // gets a subtly different chrome without any extra config.
  const defaultHeaderBg = 'bg-[var(--theme-accent)]/15'
  const headerBaseCls =
    'flex w-full items-center justify-between gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800'
  const headerCls = [headerBaseCls, headerBgClass ?? defaultHeaderBg]
    .filter(Boolean)
    .join(' ')

  const titleNode = (
    <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-800 dark:text-zinc-100">
      {icon ? (
        <span aria-hidden className="mr-1.5">
          {icon}
        </span>
      ) : null}
      {title}
    </h3>
  )

  // Right-side cluster: action slot + (when collapsible) chevron.
  // The chevron uses `--theme-primary` so it tints to the active
  // branch; rotation gives the open/closed visual cue.
  const rightSlot = (
    <div className="flex items-center gap-2">
      {rightContent ? (
        <div
          className="flex items-center"
          onClick={(e) => e.stopPropagation()}
        >
          {rightContent}
        </div>
      ) : null}
      {collapsible ? (
        <span
          aria-hidden
          className={`inline-block text-[var(--theme-primary)] transition-transform duration-200 ease-out ${
            open ? 'rotate-90' : ''
          }`}
        >
          ▶
        </span>
      ) : null}
    </div>
  )

  // Body wrapper. The `grid grid-rows-[1fr|0fr]` trick gives a
  // smooth height transition without us having to measure the
  // intrinsic content height. `overflow-hidden` on the inner row
  // clips the children while collapsed; `flex-1` keeps the open
  // panel stretchy inside a CSS-grid layout so sibling panels
  // align at equal heights.
  const bodyOuterCls = [
    'grid transition-[grid-template-rows] duration-200 ease-out',
    open ? 'grid-rows-[1fr] flex-1' : 'grid-rows-[0fr]',
  ].join(' ')

  return (
    <section className={cardCls}>
      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`${headerCls} text-left cursor-pointer hover:brightness-95 dark:hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]`}
        >
          {titleNode}
          {rightSlot}
        </button>
      ) : (
        <header className={headerCls}>
          {titleNode}
          {rightContent ? (
            <div className="flex items-center">{rightContent}</div>
          ) : null}
        </header>
      )}
      <div className={bodyOuterCls} aria-hidden={!open}>
        <div className="overflow-hidden">
          <div className="p-3">{children}</div>
        </div>
      </div>
    </section>
  )
}
