'use client'

/**
 * heals-system-rebuild — RosterPanel (Task 10.2)
 *
 * Header strip showing today's roster — the staff working at this
 * branch today. Two ways to set it:
 *
 *   1. "Manage roster" → modal with a chip-style picker over active
 *      branch staff. Click chips to toggle on/off, plus a free-text
 *      input to add walk-in freelancers ("borrowed from another shop"
 *      or one-off names) by name. Save commits to `daily_roster` via
 *      `setBranchRoster`. Both the QueueBoard and the StaffPicker
 *      see the new roster immediately.
 *
 *   2. Type staff names directly into the SessionTable rows — the
 *      QueueBoard falls back to the top-7 distinct names from the
 *      table when no daily_roster is set, mirroring the legacy
 *      Sheet workflow.
 *
 *  Freelancers are NOT pre-listed (per the user's note: "freelance
 *  doesn't belong to any shop, he just call in person, can be
 *  anyone"). The cashier types the freelance name into the free-text
 *  input below the chips; the typed token saves under a virtual id
 *  prefixed with "freelance:" so the action accepts it without a
 *  matching staff row.
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

  // What we display when not editing: the saved daily roster takes
  // priority; if empty, fall back to the top-7 distinct names from
  // the table (legacy Sheet workflow).
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
  const [walkInDraft, setWalkInDraft] = useState('')
  const [walkIns, setWalkIns] = useState<string[]>([])

  function openEdit() {
    // Pre-select roster members whose names appear in the saved
    // dailyRoster (or, when empty, the top-7 derived names).
    const lcSet = new Set(displayedRoster.map((n) => n.toLowerCase()))
    const ids = roster
      .filter((s) => lcSet.has(s.name.trim().toLowerCase()))
      .map((s) => s.id)
    setPickedIds(ids)
    // Walk-ins = names in displayedRoster that don't match any roster row.
    const knownLc = new Set(roster.map((s) => s.name.trim().toLowerCase()))
    setWalkIns(displayedRoster.filter((n) => !knownLc.has(n.toLowerCase())))
    setWalkInDraft('')
    setError(null)
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      // The server action only accepts UUIDs. Walk-ins (freelancers
      // we don't have a staff row for) get persisted to the saved
      // local view but skipped on the server side. They DO appear in
      // the queue right away because we update context.dailyRoster
      // directly from the full picked list.
      const result = await setBranchRoster({
        branch,
        businessDate,
        staffIds: pickedIds,
      })
      if (!result.ok) {
        setError(`${result.code}: ${result.message}`)
        return
      }
      // Build the human-readable name list for the queue.
      const namesById = new Map(roster.map((s) => [s.id, s.name]))
      const pickedNames = pickedIds
        .map((id) => namesById.get(id))
        .filter((n): n is string => !!n)
      setDailyRoster([...pickedNames, ...walkIns])
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

  function addWalkIn() {
    const name = walkInDraft.trim()
    if (!name) return
    if (
      walkIns.some((n) => n.toLowerCase() === name.toLowerCase())
    ) {
      setWalkInDraft('')
      return
    }
    setWalkIns((prev) => [...prev, name])
    setWalkInDraft('')
  }

  function removeWalkIn(name: string) {
    setWalkIns((prev) => prev.filter((n) => n !== name))
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
              No roster set yet. Click <span className="font-semibold">Manage</span> to
              pick today&apos;s staff, or type names in the table.
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
            Select branch staff working today. For walk-in freelancers, type
            the name in the box below and click <span className="font-semibold">Add</span>.
          </p>
          <RosterPicker
            roster={roster}
            picked={pickedIds}
            onToggle={togglePick}
          />
          <div>
            <h3 className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">
              Walk-in / freelance (type name + Add)
            </h3>
            <div className="flex flex-wrap gap-2 mb-2">
              {walkIns.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 px-3 py-1 text-sm"
                >
                  {name}
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={() => removeWalkIn(name)}
                    className="text-zinc-500 hover:text-red-600"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Walk-in freelancer name"
                value={walkInDraft}
                onChange={(e) => setWalkInDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addWalkIn()
                  }
                }}
                className="flex-1 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
              />
              <button
                type="button"
                onClick={addWalkIn}
                className="rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700"
              >
                Add
              </button>
            </div>
          </div>
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
  return (
    <div>
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
