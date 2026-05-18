'use server'

/**
 * `deleteStaff` — owner-only server action that permanently deletes a
 * staff member from the database (hard delete).
 *
 * Use case: the owner wants to remove staff who quit permanently, not
 * just hide them via the active flag.
 */

import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function deleteStaff(
  name: string,
): Promise<{ ok: boolean; message?: string }> {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return { ok: false, message: 'Sign in required' }

  const role = user.app_metadata?.role ?? ''
  if (role !== 'owner') return { ok: false, message: 'Owner only' }

  const svc = createServiceClient()
  const { error } = await svc.from('staff').delete().ilike('name', name)
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
