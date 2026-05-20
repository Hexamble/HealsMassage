'use client'

/**
 * heals-system-rebuild — RosterPanel
 *
 * Today's roster — toggle which home-branch staff are working today.
 * Inline form to add a brand-new staff member to the company roster.
 * Tap a chip to toggle the staff on/off for today. Save commits to
 * daily_roster via setBranchRoster.
 */

import { useMemo, useState } from 'react'

import { setBranchRoster } from '@/app/actions/setBranchRoster'
import { saveStaff } from '@/app/actions/saveStaff'
import type { StaffMember } from '@/domain/types'

import { useCashier } from './CashierContext'

const TOP_ROSTER_SIZE = 7

export default function RosterPanel() {
  const {
    transactions,
    roster: initialRoster,
    dailyRoster,
    branch,
    businessDate,
    readOnly,
    setDailyRoster,
  } = useCashier()

  // Local roster copy so newly-added staff appear without a page reload.
  const [roster, setRoster] = useState<StaffMember[]>(initialRoster)

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

  // New-staff inline form
  const [addingNew, setAddingNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addSaving, setAddSaving] = useState(false)

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
    setAddingNew(false)
    setNewName('')
    setAddError(null)
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

  async function addNewStaff() {
    const name = newName.trim()
    if (!name) return
    setAddSaving(true)
    setAddError(null)
    try {
      const result = await saveStaff({
        name,
        homeBranch: branch,
        isFreelance: false,
        isActive: true,
      })
      if (!result.ok) {
        setAddError(result.message)
        return
      }
      const newMember: StaffMember = {
        id: result.row.id,
        name: result.row.name,
        homeBranch: result.row.homeBranch,
        isFreelance: result.row.isFreelance,
        isActive: result.row.isActive,
      }
      setRoster((prev) =>
        prev.some((s) => s.id === newMember.id) ? prev : [...prev, newMember],
      )
      setPickedIds((prev) =>
        prev.includes(result.row.id) ? prev : [...prev, result.row.id],
      )
      setNewName('')
      setAddingNew(false)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddSaving(false)
    }
  }

  function togglePick(id: string) {
    setPickedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function deactivateStaff(id: string, name: string) {
    // Deactivate = set is_active=false. The staff disappears from all
    // dropdowns and rosters but their historical records remain.
    const confirmed = window.confirm(
      `Remove "${name}" from the company? Their past records stay, but they won't appear in any dropdown anymore.`,
    )
    if (!confirmed) return
    try {
      const result = await saveStaff({
        id,
        name,
        homeBranch: branch,
        isFreelance: false,
        isActive: false,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      // Remove from local roster state
      setRoster((prev) => prev.filter((s) => s.id !== id))
      // Remove from picked if they were selected
      setPickedIds((prev) => prev.filter((x) => x !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
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
              No roster set yet. Click{' '}
              <span className="font-semibold">Manage</span> to pick
              today&apos;s staff.
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
            Tap a name to toggle on/off. Coloured = working today.
          </p>

          <div className="flex flex-wrap gap-2">
            {roster
              .filter((s) => s.homeBranch === branch && !s.isFreelance && s.isActive)
              .map((s) => (
                <Chip
                  key={s.id}
                  label={s.name}
                  active={pickedIds.includes(s.id)}
                  onClick={() => togglePick(s.id)}
                  onDeactivate={() => void deactivateStaff(s.id, s.name)}
                />
              ))}
            {roster.filter(
              (s) => s.homeBranch === branch && !s.isFreelance && s.isActive,
            ).length === 0 && (
              <p className="text-xs italic text-zinc-500">
                No {branch} staff yet.
              </p>
            )}
          </div>

          {/* Inline add-new-staff */}
          {!addingNew ? (
            <button
              type="button"
              onClick={() => setAddingNew(true)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-400 dark:border-zinc-600 px-3 py-1 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              + Add new staff
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addNewStaff()
                  }
                  if (e.key === 'Escape') {
                    setAddingNew(false)
                    setNewName('')
                  }
                }}
                placeholder="New staff name"
                autoFocus
                className="flex-1 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
              />
              <button
                type="button"
                onClick={() => void addNewStaff()}
                disabled={addSaving || !newName.trim()}
                className="rounded-md bg-[var(--theme-primary)] text-[var(--theme-primary-foreground)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                {addSaving ? '…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddingNew(false)
                  setNewName('')
                  setAddError(null)
                }}
                className="rounded-md border border-zinc-300 dark:border-zinc-600 px-2 py-1.5 text-xs"
              >
                ✕
              </button>
            </div>
          )}
          {addError && (
            <p className="text-xs text-zinc-500">{addError}</p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
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

function Chip({
  label,
  active,
  onClick,
  onDeactivate,
}: {
  label: string
  active: boolean
  onClick: () => void
  onDeactivate?: () => void
}) {
  return (
    <span className="inline-flex items-center gap-0">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={[
          'rounded-l-full border px-3 py-1 text-sm transition-colors',
          active
            ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)] text-[var(--theme-primary-foreground)]'
            : 'border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700',
          onDeactivate ? 'rounded-r-none border-r-0' : 'rounded-r-full',
        ].join(' ')}
      >
        {label}
      </button>
      {onDeactivate && (
        <button
          type="button"
          onClick={onDeactivate}
          title={`Remove ${label} from company`}
          aria-label={`Remove ${label} from company`}
          className={[
            'rounded-r-full border border-l-0 px-1.5 py-1 text-xs transition-colors',
            active
              ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)] text-[var(--theme-primary-foreground)] hover:bg-red-600'
              : 'border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30',
          ].join(' ')}
        >
          ✕
        </button>
      )}
    </span>
  )
}
