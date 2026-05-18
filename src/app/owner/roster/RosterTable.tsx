// salary-system-rebuild — Heals Thai Massage POS
//
// Roster Manager table (client component).
//
// Holds the editable staff list in local state. Each row has its own
// inline form: name (read-only — name is the case-insensitive identity
// key; renames would orphan historical transactions), home_branch
// (select), is_freelance (checkbox), active (checkbox), and a Save
// button per row. An "Add staff" form at the bottom inserts a new row
// via the same `updateRoster` Server Action.
//
// Per-row errors render inline beneath the row (red text). The Add
// form's errors render beneath that form. Successful saves update
// local state so the table stays in sync without a page refresh.
//
// Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5.

'use client'

import { useState, useTransition } from 'react'
import { updateRoster } from '@/app/actions/updateRoster'
import { deleteStaff } from '@/app/actions/deleteStaff'
import type { Branch } from '@/domain/row-id'
import { DEFAULT_STAFF_COLOR } from '@/lib/theming'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by `select(...)` on the `staff` table (snake_case). */
export interface StaffRowDb {
  id: string
  name: string
  home_branch: Branch
  is_freelance: boolean
  active: boolean
  color: string
}

interface RosterTableProps {
  initialRows: StaffRowDb[]
  branchOptions: readonly Branch[]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RosterTable({
  initialRows,
  branchOptions,
}: RosterTableProps) {
  const [rows, setRows] = useState<StaffRowDb[]>(initialRows)
  const [rowErrors, setRowErrors] = useState<Record<string, string | null>>({})
  const [pendingRowId, setPendingRowId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // Add-staff form state.
  const [newName, setNewName] = useState('')
  const [newBranch, setNewBranch] = useState<Branch>(branchOptions[0])
  const [newFreelance, setNewFreelance] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addPending, setAddPending] = useState(false)

  // ---- Delete handler ----

  function handleDeleteStaff(row: StaffRowDb) {
    if (
      !window.confirm(
        `Delete ${row.name} permanently? This cannot be undone.`,
      )
    )
      return
    setPendingRowId(row.id)
    startTransition(async () => {
      const result = await deleteStaff(row.name)
      setPendingRowId(null)
      if (!result.ok) {
        setRowErrors((prev) => ({
          ...prev,
          [row.id]: result.message ?? 'Delete failed',
        }))
        return
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id))
    })
  }

  // ---- Row-level edit handlers ----

  function patchRow(id: string, patch: Partial<StaffRowDb>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    )
  }

  function saveRow(row: StaffRowDb) {
    setRowErrors((prev) => ({ ...prev, [row.id]: null }))
    setPendingRowId(row.id)
    startTransition(async () => {
      const result = await updateRoster({
        name: row.name,
        homeBranch: row.home_branch,
        isFreelance: row.is_freelance,
        active: row.active,
        color: row.color,
      })
      setPendingRowId(null)
      if (!result.ok) {
        setRowErrors((prev) => ({
          ...prev,
          [row.id]: `${result.code}: ${result.message}`,
        }))
        return
      }
      // Sync server-shaped truth back into local state.
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                id: result.staff.id,
                name: result.staff.name,
                home_branch: result.staff.homeBranch,
                is_freelance: result.staff.isFreelance,
                active: result.staff.active,
                color: result.staff.color,
              }
            : r,
        ),
      )
    })
  }

  // ---- Add-staff handler ----

  async function addStaff(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAddError(null)
    const trimmed = newName.trim()
    if (trimmed.length === 0) {
      setAddError('Name is required')
      return
    }
    setAddPending(true)
    try {
      const result = await updateRoster({
        name: trimmed,
        homeBranch: newBranch,
        isFreelance: newFreelance,
        active: true,
        color: DEFAULT_STAFF_COLOR,
      })
      if (!result.ok) {
        setAddError(`${result.code}: ${result.message}`)
        return
      }
      setRows((prev) => {
        // Replace if name already in list (shouldn't happen but defensive),
        // otherwise insert in alphabetical order.
        const next = prev.filter((r) => r.id !== result.staff.id)
        next.push({
          id: result.staff.id,
          name: result.staff.name,
          home_branch: result.staff.homeBranch,
          is_freelance: result.staff.isFreelance,
          active: result.staff.active,
          color: result.staff.color,
        })
        next.sort((a, b) => a.name.localeCompare(b.name))
        return next
      })
      setNewName('')
      setNewFreelance(false)
      setNewBranch(branchOptions[0])
    } finally {
      setAddPending(false)
    }
  }

  // ---- Render ----

  return (
    <div className="space-y-8">
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Color</th>
              <th className="px-3 py-2 font-medium">Home branch</th>
              <th className="px-3 py-2 font-medium">Freelance</th>
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2" aria-label="Save action" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-zinc-500 italic"
                >
                  No staff yet. Add one below.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const err = rowErrors[row.id]
              const isPending = pendingRowId === row.id
              return (
                <tr
                  key={row.id}
                  className="border-t border-zinc-200 dark:border-zinc-800 align-top"
                >
                  <td className="px-3 py-2 whitespace-nowrap">{row.name}</td>
                  <td className="px-3 py-2">
                    <label
                      className="inline-block size-8 rounded-full border border-zinc-300 dark:border-zinc-700 cursor-pointer overflow-hidden relative"
                      style={{ backgroundColor: row.color }}
                      title={`Pill color for ${row.name} (${row.color})`}
                    >
                      <input
                        type="color"
                        aria-label={`Pill color for ${row.name}`}
                        value={row.color}
                        onChange={(e) =>
                          patchRow(row.id, { color: e.target.value })
                        }
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                    </label>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={row.home_branch}
                      onChange={(e) =>
                        patchRow(row.id, {
                          home_branch: e.target.value as Branch,
                        })
                      }
                      aria-label={`Home branch for ${row.name}`}
                      className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 px-2 py-1 text-sm"
                    >
                      {branchOptions.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Freelance flag for ${row.name}`}
                      checked={row.is_freelance}
                      onChange={(e) =>
                        patchRow(row.id, { is_freelance: e.target.checked })
                      }
                      className="size-4"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Active flag for ${row.name}`}
                      checked={row.active}
                      onChange={(e) =>
                        patchRow(row.id, { active: e.target.checked })
                      }
                      className="size-4"
                    />
                  </td>
                  <td className="px-3 py-2 text-right space-x-2">
                    {row.active && (
                      <button
                        type="button"
                        onClick={() => {
                          patchRow(row.id, { active: false })
                          saveRow({ ...row, active: false })
                        }}
                        disabled={isPending}
                        className="rounded-lg bg-amber-500 text-white px-3 py-1 text-sm font-medium disabled:opacity-50 hover:bg-amber-600"
                        title="Deactivate this staff (hides from cashier dropdowns but keeps history)"
                      >
                        Deactivate
                      </button>
                    )}
                    {!row.active && (
                      <button
                        type="button"
                        onClick={() => {
                          patchRow(row.id, { active: true })
                          saveRow({ ...row, active: true })
                        }}
                        disabled={isPending}
                        className="rounded-lg bg-green-500 text-white px-3 py-1 text-sm font-medium disabled:opacity-50 hover:bg-green-600"
                        title="Reactivate this staff"
                      >
                        Activate
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => saveRow(row)}
                      disabled={isPending}
                      className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1 text-sm font-medium disabled:opacity-50"
                    >
                      {isPending ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteStaff(row)}
                      disabled={isPending}
                      className="rounded-lg bg-red-600 text-white px-3 py-1 text-sm font-medium disabled:opacity-50 hover:bg-red-700"
                      title="Permanently delete this staff member"
                    >
                      Delete
                    </button>
                    {err && (
                      <p className="mt-1 text-xs text-red-600">{err}</p>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={addStaff}
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3"
      >
        <h2 className="text-lg font-semibold">Add staff</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm space-y-1">
            <span className="block text-zinc-600 dark:text-zinc-400">Name</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              maxLength={60}
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 px-2 py-1.5"
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="block text-zinc-600 dark:text-zinc-400">
              Home branch
              {newFreelance && (
                <span className="text-xs text-zinc-400 ml-1">(placeholder — freelancers work all branches)</span>
              )}
            </span>
            <select
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value as Branch)}
              disabled={newFreelance}
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 px-2 py-1.5 disabled:opacity-50"
            >
              {branchOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm flex items-center gap-2 sm:pt-6">
            <input
              type="checkbox"
              checked={newFreelance}
              onChange={(e) => {
                setNewFreelance(e.target.checked)
                // Freelancers don't belong to any shop — default to Kimberry
                // as a placeholder. The is_freelance flag is what matters.
                if (e.target.checked) {
                  setNewBranch('Kimberry')
                }
              }}
              className="size-4"
            />
            <span>Freelance</span>
          </label>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500">
            New staff start active. Toggle off &apos;Active&apos; on a row to
            hide them from cashier dropdowns; their historical rows stay on
            past Salary Board cycles.
          </p>
          <button
            type="submit"
            disabled={addPending}
            className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {addPending ? 'Adding…' : 'Add staff'}
          </button>
        </div>
        {addError && <p className="text-sm text-red-600">{addError}</p>}
      </form>
    </div>
  )
}
