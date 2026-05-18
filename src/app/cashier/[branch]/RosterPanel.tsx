'use client'

/**
 * heals-system-rebuild — RosterPanel (Task 10.2)
 *
 * Header strip showing the day's roster — the staff working at this
 * branch today. Same UX promise as the legacy Google Sheet: the
 * cashier types names into the top of the SessionTable each morning
 * to set the queue order. The Roster *Panel* shows that order at a
 * glance and lets the cashier formally save it via
 * `setBranchRoster` so the daily_roster table reflects who's
 * actually in.
 *
 * Editing semantics:
 *   - "Manage roster" opens a small picker dialog.
 *   - Pick from active branch staff + freelancers.
 *   - Save → setBranchRoster({branch, businessDate, staffIds}).
 *   - Closes; the roster reloads next time the page is fetched.
 *
 * The panel itself (closed) just displays the current top-7 staff
 * names from the SessionTable's first rows — those are what the
 * queue uses regardless of whether they're saved to daily_roster.
 */

import { useMemo, useState } from 'react'

import { setBranchRoster } from '@/app/actions/setBranchRoster'
import type { StaffMember } from '@/domain/types'

import { useCashier } from './CashierContext'

const TOP_ROSTER_SIZE = 7

export default function RosterPanel() {
  const { transactions, roster, branch, businessDate, readOnly } = useCashier()

  // Top-7 staff names from the day's table.
  const todayRosterFromTable = useMemo(() => {
    const seen = new Set<string>()
    const names: string[] = []
    const sorted = [...transactions].sort(
      (a, b) => a.cashierRowNumber - b.cashierRowNumber,
    )
    for (const tx of sorted) {
      const name = tx.staff.trim()
      if (!name) continue
      const lc = name.toLowerCase()
      if (seen.has(lc)) continue
      seen.add(lc)
      names.push(name)
      if (names.length >= TOP_ROSTER_SIZE) break
    }
    return names
  }, [transactions])

  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [picked, setPicked] = useState<string[]>([])

  function openEdit() {
    // Pre-select roster members whose names match what's already on
    // the table (case-insensitive) — that's the most common case.
    const lcSet = new Set(todayRosterFromTable.map((n) => n.toLowerCase()))
    const ids = roster
      .filter((s) => lcSet.has(s.name.trim().toLowerCase()))
      .map((s) => s.id)
    setPicked(ids)
    setError(null)
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const result = await setBranchRoster({
        branch,
        businessDate,
        staffIds: picked,
      })
      if (!result.ok) {
        setError(`${result.code}: ${result.message}`)
      } else {
        setEditing(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function togglePick(id: string) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <header className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Today&apos;s roster
        </h2>
        {!readOnly && !editing && (
          <button
            type="button"
            onClick={openEdit}
            className="rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700"
          >
            Manage
          </button>
        )}
      </header>

      {!editing && (
        <div className="px-4 py-3 flex flex-wrap gap-2">
          {todayRosterFromTable.length === 0 ? (
            <span className="text-sm text-zinc-500">
              Type staff names in the table to set today&apos;s queue.
            </span>
          ) : (
            todayRosterFromTable.map((name, idx) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--theme-primary)] bg-[var(--theme-accent)]/15 px-3 py-1 text-sm"
              >
                <span className="font-bold text-[var(--theme-primary)]">
                  {idx + 1}
                </span>
                {name}
              </span>
            ))
          )}
        </div>
      )}

      {editing && (
        <div className="px-4 py-3 space-y-3">
          <p className="text-xs text-zinc-500">
            Select who&apos;s working today. The order they appear on the
            session table sets the queue.
          </p>
          <RosterPicker roster={roster} picked={picked} onToggle={togglePick} />
          <div className="flex items-center justify-end gap-2">
            {error && (
              <span className="text-xs text-red-600 mr-auto">{error}</span>
            )}
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md bg-[var(--theme-primary)] text-[var(--theme-primary-foreground)] px-3 py-1 text-xs font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save roster'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function RosterPicker({
  roster,
  picked,
  onToggle,
}: {
  roster: StaffMember[]
  picked: string[]
  onToggle: (id: string) => void
}) {
  const branchStaff = roster.filter((s) => !s.isFreelance && s.isActive)
  const freelancers = roster.filter((s) => s.isFreelance && s.isActive)
  return (
    <div className="space-y-3">
      {branchStaff.length > 0 && (
        <div>
          <h3 className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">
            Branch staff
          </h3>
          <div className="flex flex-wrap gap-2">
            {branchStaff.map((s) => (
              <Chip
                key={s.id}
                label={s.name}
                active={picked.includes(s.id)}
                onClick={() => onToggle(s.id)}
              />
            ))}
          </div>
        </div>
      )}
      {freelancers.length > 0 && (
        <div>
          <h3 className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">
            Freelancers
          </h3>
          <div className="flex flex-wrap gap-2">
            {freelancers.map((s) => (
              <Chip
                key={s.id}
                label={s.name}
                active={picked.includes(s.id)}
                onClick={() => onToggle(s.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'rounded-full border px-3 py-1 text-sm transition-colors',
        active
          ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)] text-[var(--theme-primary-foreground)]'
          : 'border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700',
      ].join(' ')}
    >
      {label}
    </button>
  )
}
