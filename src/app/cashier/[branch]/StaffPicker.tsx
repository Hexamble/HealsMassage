// salary-system-rebuild — Heals Thai Massage POS
//
// StaffPicker — popover used by the cashier sheet (task 21.4) for
// the Staff column. Presents three groups in a fixed order:
//
//   1. Staff       — home roster (homeBranch === branch, !isFreelance)
//   2. Other Shop  — visiting from another branch (!isFreelance), each
//                    pill annotated with a KM/BS/CL home-branch
//                    shortcode badge. Hidden when the section is empty.
//                    Expanded by default when the **Staff** section is
//                    empty (Bishop's home roster is sparse, so the
//                    cashier mostly logs visiting staff).
//   3. Freelance   — isFreelance === true. Visually distinguished with
//                    a dashed pill border so the cashier never
//                    confuses them with regular staff.
//
// Trigger choice (per implementation notes in tasks.md):
//   The component default-renders a simple "Pick staff" trigger
//   button. We chose this over a `{trigger}` prop slot because the
//   cashier sheet's Staff column always wants the same chevron-style
//   tap target (the container is a single grid cell with fixed
//   width); accepting a custom slot would force every call site to
//   ship an identical button and drift over time. Callers that need
//   a different trigger can wrap StaffPicker in their own component
//   and forward `defaultOpen` to control visibility.
//
// The popover is a plain absolutely-positioned div — no third-party
// popover lib. Selecting any pill calls `onSelect(staff)` with the
// full ActiveStaff object and closes the popover. The "+ add" rows
// (one per Staff group, one per Freelance group) only render when an
// `onAddStaff` handler is supplied; the Staff popover doesn't try to
// own a registration form, it just notifies the parent.

'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import type { Branch } from '@/domain/row-id'
import { readableTextColor } from '@/domain/pill-colors'
import { resolveStaffColor } from '@/lib/theming'

/** Threshold above which the search/filter input appears. */
const SEARCH_THRESHOLD = 8

export interface ActiveStaff {
  id: string
  name: string
  homeBranch: Branch
  isFreelance: boolean
  /** Optional owner-picked hex color (e.g. `#ef4444`). */
  color?: string
}

export interface StaffPickerProps {
  /** Branch this picker is scoped to — drives the Staff vs Other Shop split. */
  branch: Branch
  /** All active staff across all branches (regulars + freelancers). */
  staff: ActiveStaff[]
  /** Called with the full staff object on pill click; popover closes too. */
  onSelect: (staff: ActiveStaff) => void
  /**
   * Optional. When supplied, `+ add` buttons appear in the Staff and
   * Freelance sections. Receives the typed-in name and the
   * isFreelance flag matching the section the cashier added from.
   */
  onAddStaff?: (name: string, isFreelance: boolean) => void
  /** Open the popover on mount — handy for tests and Bishop sparse case. */
  defaultOpen?: boolean
  /**
   * Optional today-session-count map keyed by lowercased staff name.
   * When supplied, the **Staff** (home) group is sorted by count
   * descending, falling back to alphabetical for ties. Drives the
   * "busy staff at the top so the cashier picks them faster"
   * behaviour requested in task 21.4. Other Shop and Freelance
   * groups remain alphabetical regardless.
   */
  homeStaffSessionCount?: Record<string, number>
}

const BRANCH_SHORTCODE: Record<Branch, string> = {
  Kimberry: 'KM',
  Bishop: 'BS',
  Chulia: 'CL',
}

/** Stable alphabetical sort by lowercased name. */
function byName(a: ActiveStaff, b: ActiveStaff): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
}

export default function StaffPicker({
  branch,
  staff,
  onSelect,
  onAddStaff,
  defaultOpen,
  homeStaffSessionCount,
}: StaffPickerProps) {
  const [open, setOpen] = useState<boolean>(defaultOpen ?? false)
  const [searchQuery, setSearchQuery] = useState('')
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Close the popover on outside-click. We attach the listener only
  // while open so unmounted/closed pickers don't leak handlers.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const node = wrapperRef.current
      if (!node) return
      if (e.target instanceof Node && node.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Auto-focus search input when popover opens and search is visible.
  useEffect(() => {
    if (open && staff.length > SEARCH_THRESHOLD) {
      setTimeout(() => searchRef.current?.focus(), 0)
    }
    if (!open) setSearchQuery('')
  }, [open, staff.length])

  // Three-way partition. Each group is sorted alphabetically once
  // per render so the popover is stable across repaints. Home staff
  // gets a count-desc-then-alpha sort when `homeStaffSessionCount`
  // is supplied — busiest staff bubble to the front so the cashier
  // taps them faster (task 21.4).
  const { homeStaff, otherShop, freelancers } = useMemo(() => {
    const home: ActiveStaff[] = []
    const other: ActiveStaff[] = []
    const free: ActiveStaff[] = []
    for (const s of staff) {
      if (s.isFreelance) {
        free.push(s)
      } else if (s.homeBranch === branch) {
        home.push(s)
      } else {
        other.push(s)
      }
    }
    if (homeStaffSessionCount) {
      home.sort((a, b) => {
        const ca = homeStaffSessionCount[a.name.toLowerCase()] ?? 0
        const cb = homeStaffSessionCount[b.name.toLowerCase()] ?? 0
        if (ca !== cb) return cb - ca
        return byName(a, b)
      })
    } else {
      home.sort(byName)
    }
    other.sort(byName)
    free.sort(byName)
    return { homeStaff: home, otherShop: other, freelancers: free }
  }, [staff, branch, homeStaffSessionCount])

  // Filter groups by search query (case-insensitive substring match).
  const query = searchQuery.trim().toLowerCase()
  const filteredHome = query
    ? homeStaff.filter((s) => s.name.toLowerCase().includes(query))
    : homeStaff
  const filteredOther = query
    ? otherShop.filter((s) => s.name.toLowerCase().includes(query))
    : otherShop
  const filteredFree = query
    ? freelancers.filter((s) => s.name.toLowerCase().includes(query))
    : freelancers

  // Build a colors map keyed by lowercased name so resolveStaffColor
  // can look pills up case-insensitively and fall back to the
  // slate-grey default when staff.color is missing.
  const colorMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of staff) {
      if (typeof s.color === 'string' && s.color.length > 0) {
        map[s.name.trim().toLowerCase()] = s.color
      }
    }
    return map
  }, [staff])

  // Bishop case: when the home group is empty AND there are visiting
  // staff, the Other Shop section opens expanded so the cashier
  // doesn't have to drill in. When home is non-empty we still
  // default-expand Other Shop because the popover's container is
  // already small and a single-tap grid is faster than a click-to-
  // expand affordance.
  const otherShopExpandedDefault = otherShop.length > 0

  const handleSelect = (s: ActiveStaff) => {
    onSelect(s)
    setOpen(false)
  }

  const showSearch = staff.length > SEARCH_THRESHOLD

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="staff-picker-trigger"
        className="inline-flex items-center gap-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 min-h-[40px]"
      >
        <span>Pick staff</span>
        <span aria-hidden className="text-[10px] opacity-60">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Pick staff"
          data-testid="staff-picker-popover"
          className="absolute left-0 top-full z-50 mt-1 min-w-[320px] w-[360px] max-h-[400px] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-4 space-y-3"
        >
          {showSearch && (
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search staff…"
              aria-label="Filter staff"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
          )}

          <Section
            label={`Staff (${branch} — home)`}
            ariaLabel="Staff"
            empty={filteredHome.length === 0}
            emptyHint={query ? 'No matches.' : 'No home staff yet.'}
          >
            <div className="flex flex-wrap gap-1.5">
              {filteredHome.map((s) => (
                <StaffPill
                  key={s.id}
                  staff={s}
                  color={resolveStaffColor(s.name, colorMap)}
                  onClick={() => handleSelect(s)}
                />
              ))}
              {!query && onAddStaff && (
                <AddInlineButton
                  buttonLabel="+ add new staff"
                  formLabel="Add new staff"
                  inputLabel="New staff name"
                  onAdd={(name) => onAddStaff(name, false)}
                />
              )}
            </div>
          </Section>

          {filteredOther.length > 0 && (
            <Section
              label="Other Shop (visiting)"
              ariaLabel="Other Shop"
              defaultExpanded={
                homeStaff.length === 0 ? true : otherShopExpandedDefault
              }
            >
              <div className="flex flex-wrap gap-1.5">
                {filteredOther.map((s) => (
                  <StaffPill
                    key={s.id}
                    staff={s}
                    color={resolveStaffColor(s.name, colorMap)}
                    onClick={() => handleSelect(s)}
                    suffixBadge={BRANCH_SHORTCODE[s.homeBranch]}
                  />
                ))}
              </div>
            </Section>
          )}

          <Section
            label="Freelance"
            ariaLabel="Freelance"
            empty={filteredFree.length === 0}
            emptyHint={query ? 'No matches.' : 'No freelancers yet.'}
          >
            <div className="flex flex-wrap gap-1.5">
              {filteredFree.map((s) => (
                <StaffPill
                  key={s.id}
                  staff={s}
                  color={resolveStaffColor(s.name, colorMap)}
                  onClick={() => handleSelect(s)}
                  freelance
                />
              ))}
              {!query && onAddStaff && (
                <AddInlineButton
                  buttonLabel="+ add freelance"
                  formLabel="Add freelance"
                  inputLabel="New freelance name"
                  onAdd={(name) => onAddStaff(name, true)}
                />
              )}
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}

/**
 * Section — labelled subgroup inside the popover. Wraps the pill
 * grid in a `role="group"` for testability and tracks an
 * expand/collapse state. The Staff and Freelance sections are
 * always expanded; Other Shop honours `defaultExpanded` so Bishop's
 * empty home roster auto-expands the visiting list.
 */
function Section({
  label,
  ariaLabel,
  children,
  empty,
  emptyHint,
  defaultExpanded,
}: {
  label: string
  ariaLabel: string
  children: ReactNode
  empty?: boolean
  emptyHint?: string
  /** Only honoured when the parent renders this section (Other Shop). */
  defaultExpanded?: boolean
}) {
  const collapsible = typeof defaultExpanded === 'boolean'
  const [expanded, setExpanded] = useState<boolean>(
    collapsible ? defaultExpanded! : true,
  )
  const showBody = collapsible ? expanded : true

  return (
    <section
      role="group"
      aria-label={ariaLabel}
      data-section={ariaLabel}
      data-expanded={showBody ? 'true' : 'false'}
      className="space-y-2"
    >
      <header className="flex items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-700 pb-1.5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
          {label}
        </h4>
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? `Collapse ${ariaLabel}` : `Expand ${ariaLabel}`}
            className="text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            {expanded ? '▾' : '▸'}
          </button>
        )}
      </header>
      {showBody &&
        (empty ? (
          emptyHint ? (
            <p className="text-xs italic text-zinc-400">{emptyHint}</p>
          ) : null
        ) : (
          children
        ))}
    </section>
  )
}

/**
 * StaffPill — one tappable pill inside a section. Uses inline
 * background color so the cashier sees the same swatch they're used
 * to from the cashier sheet, and `readableTextColor` for legible
 * foreground regardless of brightness. The freelance variant gets
 * a dashed border so the cashier can tell freelancers apart at a
 * glance even when an owner picks the same color for both.
 */
function StaffPill({
  staff,
  color,
  onClick,
  suffixBadge,
  freelance,
}: {
  staff: ActiveStaff
  color: string
  onClick: () => void
  suffixBadge?: string
  freelance?: boolean
}) {
  const fgClass = readableTextColor(color)
  return (
    <button
      type="button"
      onClick={onClick}
      data-staff={staff.name}
      data-staff-id={staff.id}
      data-home-branch={staff.homeBranch}
      data-freelance={freelance ? 'true' : undefined}
      data-shortcode={suffixBadge}
      aria-label={`Pick ${staff.name}`}
      style={{ backgroundColor: color }}
      className={[
        'inline-flex items-center gap-1 rounded-full text-sm px-3 py-2 min-h-[40px] font-medium whitespace-nowrap',
        'transition-shadow hover:ring-2 hover:ring-zinc-400 cursor-pointer',
        freelance ? 'border border-dashed border-zinc-700/40' : '',
        fgClass,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span>{staff.name}</span>
      {suffixBadge && (
        <span
          aria-hidden
          className="ml-1 inline-flex items-center justify-center rounded bg-black/20 px-1 text-[10px] font-semibold leading-none py-0.5"
        >
          {suffixBadge}
        </span>
      )}
    </button>
  )
}

/**
 * AddInlineButton — collapsed by default to a small button. Tapping
 * expands it into a tiny inline name input + Save. Submitting calls
 * `onAdd(name)` and resets state. Empty names are silently ignored —
 * the parent handler is responsible for showing the error path
 * (e.g. duplicate staff) and re-opening the picker.
 */
function AddInlineButton({
  buttonLabel,
  formLabel,
  inputLabel,
  onAdd,
}: {
  /** Visible label and aria-label on the collapsed trigger. */
  buttonLabel: string
  /** aria-label on the form once expanded. */
  formLabel: string
  /** aria-label on the name input once expanded. */
  inputLabel: string
  onAdd: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing) {
      // Autofocus on next paint so the input has time to mount.
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [editing])

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    onAdd(trimmed)
    setName('')
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={buttonLabel}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-400 dark:border-zinc-600 px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
      >
        <span>{buttonLabel}</span>
      </button>
    )
  }

  return (
    <form
      onSubmit={submit}
      aria-label={formLabel}
      className="inline-flex items-center gap-1"
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        placeholder="Name"
        aria-label={inputLabel}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-zinc-900 dark:text-zinc-100"
      />
      <button
        type="submit"
        className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-2 py-1 text-xs"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          setEditing(false)
          setName('')
        }}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs"
      >
        Cancel
      </button>
    </form>
  )
}
