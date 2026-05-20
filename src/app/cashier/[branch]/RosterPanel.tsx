'use client'

/**
 * heals-system-rebuild — RosterPanel
 *
 * Today's roster — toggle which home-branch staff are working today.
 * Walk-ins / freelancers don't go here: the cashier marks them by
 * choosing method=Freelance and typing the name in the Staff cell.
 * The roster panel stays narrow on purpose — fewer choices, fewer
 * mistakes.
 */

import { useMemo, useState } from 'react'

import { setBranchRoster } from '@/app/actions/setBranchRoster'
import type { StaffMember } from '@/domain/types'

import { useCashier } from './CashierContext'

const TOP_ROSTER_SIZE = 7

export default function RosterPanel() {
  const {
    transactions,
    roster,
    dailyRoster,
    branch,
    businessDate,
    readOnly,
    setDailyRoster,
  } = useCashier()

  const displayedRoster = useMemo(() => {
    if (dailyRoster.length > 0) return dailyRoster
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
  }, [dailyRoster, transactions])

  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pickedIds, setPickedIds] = useState<string[]>([])

  function openEdit() {
    const lcSet = new Set(displayedRoster.map((n) => n.toLowerCase()))
    const ids = roster
      .filter(
        (s) =>
          s.homeBranch === branch &&
          !s.isFreelance &&
          s.isActive &&
          lcSet.has(s.name.trim().toLowerCase()),
      )
      .map((s) => s.id)
    setPickedIds(ids)
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
        staffIds: pickedIds,
      })
      if (!result.ok) {
        setError(`${result.code}: ${result.message}`)
        return
      }
      const namesById = new Map(roster.map((s) => [s.id, s.name]))
      const pickedNames = pickedIds
        .map((id) => namesById.get(id))
        .filter((n): n is string => !!n)
      setDailyRoster(pickedNames)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function togglePick(id: string) {
    setPickedIds((prev) =>
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
          {displayedRoster.length === 0 ? (
            <span className="text-sm text-zinc-500">
              No roster set yet. Click <span className="font-semibold">Manage</span>{' '}
              to pick today&apos;s staff, or type names in the table.
            </span>
          ) : (
            displayedRoster.map((name, idx) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--theme-primary)] bg-[var(--theme-accent)]/15 text-zinc-900 dark:text-zinc-100 px-3 py-1 text-sm"
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
            Pick {branch} staff working today. For freelancers or visiting
            staff, choose method = Freelance (or any EXTRA) in the table and
            type the name there.
          </p>
          <RosterPicker
            roster={roster}
            picked={pickedIds}
            onToggle={togglePick}
            branch={branch}
          />
          <div className="flex items-center justify-end gap-2">
            {error && (
              <span className="text-xs text-zinc-600 dark:text-zinc-400 mr-auto">
                {error}
              </span>
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
  branch,
}: {
  roster: StaffMember[]
  picked: string[]
  onToggle: (id: string) => void
  branch: string
}) {
  const branchStaff = roster.filter(
    (s) => !s.isFreelance && s.isActive && s.homeBranch === branch,
  )
  if (branchStaff.length === 0) {
    return (
      <p className="text-xs italic text-zinc-500">
        No {branch} staff yet. Add them via Boss HQ → Roster.
      </p>
    )
  }
  return (
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
