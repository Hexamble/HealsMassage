'use client'

/**
 * heals-system-rebuild — Heals Thai Massage POS
 *
 * `MultiCombo` — multi-select chip input with a free-text dropdown.
 *
 * Used by the Flags column on the cashier session table. The shop's
 * Google Sheet stores flag tokens as comma-separated text (e.g.
 * `"Staff Balm, Booking"`); the Apps Script formula then matches by
 * substring to apply price/commission bumps:
 *   - "Staff Balm"     → +RM 3 to commission
 *   - "Customer Balm"  → +RM 10 to customer price
 *   - "Booking"        → +RM 3 / 4.5 / 6 to commission (duration-keyed)
 *
 * This component preserves that storage shape — the on-the-wire
 * `value` is the same comma-joined string the sheet uses, parsed
 * downstream by `parseFlags(...)` in `@/domain/commission`. Cashiers
 * can freely add their own annotations ("Discount", "VIP") and the
 * server stores them verbatim while ignoring anything it doesn't
 * recognise.
 *
 * Behaviour:
 *   - The input shows the current chips. Click any × to remove.
 *   - Click the empty area to focus a hidden text input that opens a
 *     dropdown of suggested options (filtered by the typed text).
 *   - Enter or click a suggestion to add it as a chip; the typed
 *     text is also addable as a free-text chip.
 *   - Backspace on an empty input removes the last chip.
 *   - `value` and `onChange` use the canonical comma-separated form.
 *
 * The component is pure controlled: parent owns `value` and listens
 * to `onChange` for chip add/remove events; `onCommit` fires after
 * every change so SessionTable can autosave each edit.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type { ComboBoxOption } from './ComboBox'

export interface MultiComboProps {
  value: string
  onChange: (next: string) => void
  /** Called after every change (chip add/remove). */
  onCommit?: (committed: string) => void
  options: ReadonlyArray<ComboBoxOption>
  placeholder?: string
  freeText?: boolean
  className?: string
  inputClassName?: string
  disabled?: boolean
  ariaLabel?: string
}

/** Split the canonical comma-separated form into trimmed tokens. */
function parseTokens(s: string): string[] {
  if (!s) return []
  return s
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

/** Re-join tokens with a stable single-space-after-comma separator. */
function joinTokens(tokens: ReadonlyArray<string>): string {
  return tokens.join(', ')
}

function labelOf(opt: ComboBoxOption): string {
  return opt.label ?? opt.value
}

export default function MultiCombo({
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
}: MultiComboProps) {
  const tokens = useMemo(() => parseTokens(value), [value])
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  // Filter options by current draft, excluding tokens already chosen
  // (case-insensitive). Free-text "Use 'foo'" suggestion appears at
  // the bottom when the draft doesn't match any remaining option.
  const filtered = useMemo(() => {
    const lc = draft.toLowerCase()
    const chosenLc = new Set(tokens.map((t) => t.toLowerCase()))
    return options.filter((opt) => {
      if (chosenLc.has(opt.value.toLowerCase())) return false
      if (!lc) return true
      return (
        opt.value.toLowerCase().includes(lc) ||
        labelOf(opt).toLowerCase().includes(lc)
      )
    })
  }, [options, tokens, draft])

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

  function commitTokens(nextTokens: ReadonlyArray<string>) {
    const next = joinTokens(nextTokens)
    if (next !== value) onChange(next)
    onCommit?.(next)
  }

  function addToken(t: string) {
    const trimmed = t.trim()
    if (!trimmed) return
    if (
      tokens.some((x) => x.toLowerCase() === trimmed.toLowerCase())
    ) {
      // Already chosen — clear the draft and bail.
      setDraft('')
      setHighlight(-1)
      return
    }
    if (!freeText) {
      const exact = options.find(
        (o) => o.value.toLowerCase() === trimmed.toLowerCase(),
      )
      if (!exact) {
        setDraft('')
        setHighlight(-1)
        return
      }
      commitTokens([...tokens, exact.value])
    } else {
      commitTokens([...tokens, trimmed])
    }
    setDraft('')
    setHighlight(-1)
  }

  function removeToken(idx: number) {
    const next = tokens.filter((_, i) => i !== idx)
    commitTokens(next)
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
      addToken(target)
    } else if (e.key === 'Backspace' && draft === '' && tokens.length > 0) {
      e.preventDefault()
      removeToken(tokens.length - 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDraft('')
      setOpen(false)
      setHighlight(-1)
    } else if (e.key === ',' || e.key === 'Tab') {
      // Comma or Tab commits the typed text as a chip without losing
      // focus. Tab also moves to the next cell as usual.
      if (draft.trim()) {
        if (e.key === ',') e.preventDefault()
        addToken(draft)
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-wrap items-center gap-1 px-1 py-1 min-h-[34px] cursor-text ${
        className ?? ''
      }`}
      onClick={() => {
        if (!disabled) {
          inputRef.current?.focus()
          setOpen(true)
        }
      }}
    >
      {tokens.map((t, i) => (
        <span
          key={`${t}-${i}`}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs"
        >
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            disabled={disabled}
            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            onClick={(e) => {
              e.stopPropagation()
              removeToken(i)
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        value={draft}
        placeholder={tokens.length === 0 ? placeholder : ''}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value)
          setOpen(true)
          setHighlight(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className={[
          'flex-1 min-w-[6ch] bg-transparent border-0 outline-0 px-1 py-0.5 text-sm',
          inputClassName ?? '',
        ].join(' ')}
      />
      {open && (filtered.length > 0 || (freeText && draft.trim())) && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-30 left-0 right-0 top-full mt-1 max-h-60 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg text-sm"
        >
          {filtered.map((opt, index) => {
            const isActive = index === highlight
            return (
              <li
                key={`o-${opt.value}-${index}`}
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  addToken(opt.value)
                }}
                className={[
                  'px-2 py-1.5 cursor-pointer',
                  isActive
                    ? 'bg-[var(--theme-accent)]/30 text-zinc-900 dark:text-zinc-50'
                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
                ].join(' ')}
              >
                {labelOf(opt)}
              </li>
            )
          })}
          {freeText && draft.trim() && !filtered.some(
            (o) => o.value.toLowerCase() === draft.trim().toLowerCase(),
          ) && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault()
                addToken(draft)
              }}
              className="px-2 py-1.5 cursor-pointer border-t border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 italic hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Add &quot;{draft.trim()}&quot;
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
