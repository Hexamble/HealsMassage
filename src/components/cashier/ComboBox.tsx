'use client'

/**
 * heals-system-rebuild — Heals Thai Massage POS
 *
 * `ComboBox` — single-select dropdown that ALSO accepts free-text input.
 *
 * The cashier panel mimics the Google Sheet workflow the shop has used
 * for years: every column header is a dropdown, but cashiers can ALSO
 * type whatever they want in any cell. New staff, borrowed staff from
 * another branch, an unusual course code, a one-off comment — Sheets
 * never blocked them, and this component preserves that behaviour.
 *
 * Behaviour:
 *   - Tap / focus → dropdown opens with the full option list.
 *   - Typing filters the list by case-insensitive substring match.
 *   - Up/Down arrows highlight; Enter commits the highlighted option
 *     OR the typed text if no option is highlighted (and `freeText`
 *     is true, the default).
 *   - Esc cancels the in-flight edit and reverts to the last committed
 *     value.
 *   - Tab / blur commits the current text (free-text mode) or reverts
 *     when the typed text matches no option in strict-list mode.
 *
 * Options can be grouped via the `group` field; rendered with a small
 * group label between groups. Useful for "Branch staff" / "Freelance"
 * separation in the Staff column.
 *
 * Pure controlled component: parent owns `value`, listens for
 * `onChange` (every keystroke or option click) and `onCommit` (on
 * blur or Enter — the SessionTable uses `onCommit` to fire the
 * server action). When `freeText` is false, `onCommit` only fires
 * with values that match an option's `value`.
 *
 * Theme-aware via `var(--theme-primary)` / `var(--theme-accent)` from
 * `globals.css`, so each branch's chrome (Kimberry teal, Bishop gold,
 * Chulia coral) tints the focus outline + highlighted option without
 * any per-component branch logic.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'

export interface ComboBoxOption {
  /** Persisted token (what gets stored on the row). */
  value: string
  /** Optional display label; falls back to `value`. */
  label?: string
  /** Optional grouping bucket (rendered as a small heading). */
  group?: string
}

export interface ComboBoxProps {
  value: string
  onChange: (next: string) => void
  /** Called on Enter / blur. Receives the committed value. */
  onCommit?: (committed: string) => void
  options: ReadonlyArray<ComboBoxOption>
  placeholder?: string
  /** Default true. When false, only option values can be committed. */
  freeText?: boolean
  className?: string
  inputClassName?: string
  disabled?: boolean
  /** Optional explicit aria-label, e.g. "Staff" / "Course". */
  ariaLabel?: string
  /**
   * Optional ref handle for the underlying input — used by the
   * SessionTable to drive Tab navigation between cells.
   */
  inputRef?: React.RefObject<HTMLInputElement>
}

function labelOf(opt: ComboBoxOption): string {
  return opt.label ?? opt.value
}

function matches(opt: ComboBoxOption, q: string): boolean {
  if (!q) return true
  const lc = q.toLowerCase()
  return (
    opt.value.toLowerCase().includes(lc) ||
    labelOf(opt).toLowerCase().includes(lc)
  )
}

export default function ComboBox({
  value,
  onChange,
  onCommit,
  options,
  placeholder,
  freeText = true,
  className,
  inputClassName,
  disabled,
  ariaLabel,
  inputRef: externalRef,
}: ComboBoxProps) {
  const fallbackRef = useRef<HTMLInputElement>(null)
  const inputRef = externalRef ?? fallbackRef
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  // -1 = "no option highlighted; Enter commits the typed text".
  const [highlight, setHighlight] = useState<number>(-1)
  const [draft, setDraft] = useState<string>(value)

  // Re-sync the input when the parent-controlled `value` changes
  // outside the user's edit (e.g. another cashier typed a value over
  // realtime, or the row was re-fetched after server commit).
  useEffect(() => {
    setDraft(value)
  }, [value])

  const filtered = useMemo(() => {
    return options.filter((opt) => matches(opt, draft))
  }, [options, draft])

  // Close on outside click. We track a containerRef around input + list
  // so a click on a list item doesn't blur-close before the click fires.
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (containerRef.current.contains(e.target as Node)) return
      setOpen(false)
      setHighlight(-1)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  function commit(text: string) {
    if (!freeText) {
      const exact = options.find(
        (o) => o.value.toLowerCase() === text.toLowerCase(),
      )
      if (!exact) {
        // Revert to the last accepted value.
        setDraft(value)
        setOpen(false)
        setHighlight(-1)
        return
      }
      text = exact.value
    }
    setOpen(false)
    setHighlight(-1)
    if (text !== value) onChange(text)
    onCommit?.(text)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => Math.min(filtered.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(-1, h - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target =
        highlight >= 0 && highlight < filtered.length
          ? filtered[highlight].value
          : draft
      commit(target)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(value)
      setOpen(false)
      setHighlight(-1)
    } else if (e.key === 'Tab') {
      // Tab commits and lets the browser move focus naturally to the
      // next field. We do NOT preventDefault.
      const target =
        highlight >= 0 && highlight < filtered.length
          ? filtered[highlight].value
          : draft
      if (target !== value) commit(target)
      setOpen(false)
      setHighlight(-1)
    }
  }

  // Group rendering: walk filtered list and inject group headers when
  // the group label changes. Options without `group` render in a
  // single ungrouped block (no header shown).
  const grouped: Array<
    | { kind: 'header'; label: string }
    | { kind: 'option'; opt: ComboBoxOption; index: number }
  > = []
  let lastGroup: string | undefined = undefined
  filtered.forEach((opt, index) => {
    if (opt.group && opt.group !== lastGroup) {
      grouped.push({ kind: 'header', label: opt.group })
      lastGroup = opt.group
    } else if (!opt.group && lastGroup !== undefined) {
      // Switched from a grouped block back to ungrouped — reset so a
      // later grouped option re-emits its header.
      lastGroup = undefined
    }
    grouped.push({ kind: 'option', opt, index })
  })

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value)
          setOpen(true)
          setHighlight(-1)
          onChange(e.target.value)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Defer so a click on a list item registers before close.
          setTimeout(() => {
            if (open) commit(draft)
          }, 80)
        }}
        onKeyDown={handleKeyDown}
        className={[
          'w-full bg-transparent border-0 outline-0 px-2 py-1.5 text-sm',
          'focus:ring-2 focus:ring-[var(--theme-primary)] focus:rounded',
          inputClassName ?? '',
        ].join(' ')}
      />
      {open && filtered.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg text-sm"
        >
          {grouped.map((entry, i) => {
            if (entry.kind === 'header') {
              return (
                <li
                  key={`h-${i}`}
                  className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50"
                >
                  {entry.label}
                </li>
              )
            }
            const isActive = entry.index === highlight
            return (
              <li
                key={`o-${entry.opt.value}-${entry.index}`}
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setHighlight(entry.index)}
                onMouseDown={(e) => {
                  // mousedown (not click) so we fire before the input's blur.
                  e.preventDefault()
                  commit(entry.opt.value)
                }}
                className={[
                  'px-2 py-1.5 cursor-pointer',
                  isActive
                    ? 'bg-[var(--theme-accent)]/30 text-zinc-900 dark:text-zinc-50'
                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
                ].join(' ')}
              >
                {labelOf(entry.opt)}
              </li>
            )
          })}
          {freeText && draft && !filtered.some((o) => o.value === draft) && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault()
                commit(draft)
              }}
              className="px-2 py-1.5 cursor-pointer border-t border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 italic hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Use &quot;{draft}&quot;
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
