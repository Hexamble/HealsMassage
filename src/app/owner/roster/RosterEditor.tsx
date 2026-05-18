'use client'

/**
 * heals-system-rebuild — Roster editor (client component).
 *
 * Wraps the static staff list with inline edit controls + an
 * "Add staff" row. Each mutation calls the `saveStaff` server action
 * and updates local state on success.
 */

import { useState, useTransition } from 'react'

import { saveStaff } from '@/app/actions/saveStaff'
import { BRANCHES, type Branch, type StaffMember } from '@/domain/types'

export default function RosterEditor({
  initial,
}: {
  initial: StaffMember[]
}) {
  const [staff, setStaff] = useState<StaffMember[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function applyResult(updated: StaffMember) {
    setStaff((prev) => {
      const idx = prev.findIndex((s) => s.id === updated.id)
      if (idx < 0) return [...prev, updated]
      const next = [...prev]
      next[idx] = updated
      return next
    })
  }

  function save(s: StaffMember) {
    startTransition(async () => {
      setError(null)
      try {
        const result = await saveStaff({
          id: s.id || undefined,
          name: s.name,
          homeBranch: s.homeBranch,
          isFreelance: s.isFreelance,
          isActive: s.isActive,
        })
        if (!result.ok) {
          setError(`${result.code}: ${result.message}`)
        } else {
          applyResult(result.row)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  function patch(id: string, patch: Partial<StaffMember>) {
    setStaff((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    )
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Home branch</th>
              <th className="px-3 py-2 text-left">Freelance</th>
              <th className="px-3 py-2 text-left">Active</th>
              <th className="px-3 py-2"> </th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="px-3 py-1.5">
                  <input
                    type="text"
                    value={s.name}
                    onChange={(e) => patch(s.id, { name: e.target.value })}
                    onBlur={() => save(s)}
                    className="bg-transparent border-0 outline-0 px-2 py-1 text-sm focus:ring-2 focus:ring-[var(--theme-primary)] focus:rounded"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={s.homeBranch}
                    onChange={(e) => {
                      const next = { ...s, homeBranch: e.target.value as Branch }
                      patch(s.id, { homeBranch: next.homeBranch })
                      save(next)
                    }}
                    className="bg-transparent border-0 outline-0 px-2 py-1 text-sm"
                  >
                    {BRANCHES.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={s.isFreelance}
                    onChange={(e) => {
                      const next = { ...s, isFreelance: e.target.checked }
                      patch(s.id, { isFreelance: next.isFreelance })
                      save(next)
                    }}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={s.isActive}
                    onChange={(e) => {
                      const next = { ...s, isActive: e.target.checked }
                      patch(s.id, { isActive: next.isActive })
                      save(next)
                    }}
                  />
                </td>
                <td className="px-3 py-1.5 text-zinc-400 text-xs">
                  {pending ? '…' : ''}
                </td>
              </tr>
            ))}
            <AddRow
              disabled={pending}
              onAdd={(name, branch, freelance) => {
                save({
                  id: '',
                  name,
                  homeBranch: branch,
                  isFreelance: freelance,
                  isActive: true,
                })
              }}
            />
          </tbody>
        </table>
      </div>
      {error && (
        <div className="px-4 py-2 text-xs text-red-700 bg-red-50 dark:bg-red-950/30 border-t border-red-200 dark:border-red-900">
          {error}
        </div>
      )}
    </div>
  )
}

function AddRow({
  onAdd,
  disabled,
}: {
  onAdd: (name: string, branch: Branch, freelance: boolean) => void
  disabled: boolean
}) {
  const [name, setName] = useState('')
  const [branch, setBranch] = useState<Branch>('Kimberry')
  const [freelance, setFreelance] = useState(false)

  function commit() {
    if (!name.trim()) return
    onAdd(name.trim(), branch, freelance)
    setName('')
    setBranch('Kimberry')
    setFreelance(false)
  }

  return (
    <tr className="bg-zinc-50/50 dark:bg-zinc-800/30">
      <td className="px-3 py-1.5">
        <input
          type="text"
          placeholder="New staff name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-transparent border-0 outline-0 px-2 py-1 text-sm focus:ring-2 focus:ring-[var(--theme-primary)] focus:rounded"
        />
      </td>
      <td className="px-3 py-1.5">
        <select
          value={branch}
          onChange={(e) => setBranch(e.target.value as Branch)}
          className="bg-transparent border-0 outline-0 px-2 py-1 text-sm"
        >
          {BRANCHES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <input
          type="checkbox"
          checked={freelance}
          onChange={(e) => setFreelance(e.target.checked)}
        />
      </td>
      <td className="px-3 py-1.5 text-xs text-zinc-400">new</td>
      <td className="px-3 py-1.5 text-right">
        <button
          type="button"
          onClick={commit}
          disabled={disabled || !name.trim()}
          className="rounded-md bg-[var(--theme-primary)] text-[var(--theme-primary-foreground)] px-3 py-1 text-xs font-medium disabled:opacity-50"
        >
          Add
        </button>
      </td>
    </tr>
  )
}
