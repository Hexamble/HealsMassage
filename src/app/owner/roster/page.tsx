// heals-system-rebuild — Owner Roster page (Task 18.1)
//
// Server-rendered list of all staff. The client form below is a small
// in-page editor: add a new staff, toggle is_active, change home_branch
// or is_freelance flag. Each save calls the `saveStaff` server action.
//
// Validates: Requirements 14.1, 14.2, 14.3, 14.5.

import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { StaffMember, Branch } from '@/domain/types'

import RosterEditor from './RosterEditor'

export const dynamic = 'force-dynamic'

export default async function RosterPage() {
  const sb = createServerSupabaseClient()
  const { data } = await sb
    .from('staff')
    .select('id, name, home_branch, is_freelance, is_active')
    .order('name')

  const initial: StaffMember[] = ((data ?? []) as Record<string, unknown>[]).map(
    (r) => ({
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      homeBranch: String(r.home_branch) as Branch,
      isFreelance: Boolean(r.is_freelance),
      isActive: Boolean(r.is_active),
    }),
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-semibold">Roster</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Add, edit, or deactivate staff. Inactive staff stay on
          historical pay cycles but disappear from cashier dropdowns.
        </p>
      </header>
      <RosterEditor initial={initial} />
    </div>
  )
}
