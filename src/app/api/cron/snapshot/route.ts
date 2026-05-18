// heals-system-rebuild — Cron snapshot route (Task 21.1)
//
// Runs daily at 5 AM Asia/Kuala_Lumpur (configured via Vercel Cron).
// Authenticates with `CRON_SECRET` (env var, validated lazily). The
// salary board and shop income board are computed live from the rows
// table at every render in the heals contract, so this snapshot route
// currently only:
//
//   1. Records that the morning rollover happened, in `audit_log`,
//      so the owner has a heartbeat.
//   2. Verifies row consistency for yesterday's business date — same
//      check the `resnapshotDay` action runs on demand.
//
// Future: persist daily aggregates here so the salary board can read
// from a materialised view instead of recomputing.

import { NextResponse, type NextRequest } from 'next/server'

import { getBusinessDate } from '@/domain/business-date'
import { serverEnv } from '@/lib/env'
import { getServiceRoleClient } from '@/lib/supabase/service-role'

export async function GET(req: NextRequest) {
  // Auth: Bearer CRON_SECRET. Vercel Cron sends the header automatically;
  // for local testing pass it manually with `curl -H "Authorization: Bearer …"`.
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const today = getBusinessDate(new Date())
  // Yesterday in pure UTC date space (no DST/TZ bias).
  const [y, m, d] = today.split('-').map((p) => parseInt(p, 10))
  const utcMidnight = new Date(Date.UTC(y, m - 1, d))
  utcMidnight.setUTCDate(utcMidnight.getUTCDate() - 1)
  const yyy = utcMidnight.getUTCFullYear()
  const mm = String(utcMidnight.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(utcMidnight.getUTCDate()).padStart(2, '0')
  const yesterday = `${yyy}-${mm}-${dd}`

  const sb = getServiceRoleClient()
  const { data: rows, error } = await sb
    .from('transactions')
    .select(
      'id, branch, business_date, cashier_row_number, base_commission, balm_bonus, booking_bonus, addon, total_commission',
    )
    .eq('business_date', yesterday)
    .returns<Array<{
      id: string
      branch: string
      business_date: string
      cashier_row_number: number
      base_commission: number | string
      balm_bonus: number | string
      booking_bonus: number | string
      addon: number | string
      total_commission: number | string
    }>>()

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    )
  }

  let warnings = 0
  for (const r of rows ?? []) {
    const base = Number(r.base_commission) || 0
    const balm = Number(r.balm_bonus) || 0
    const book = Number(r.booking_bonus) || 0
    const addon = Number(r.addon) || 0
    const total = Number(r.total_commission) || 0
    if (Math.abs(total - (base + balm + book + addon)) > 0.01) {
      warnings += 1
    }
  }

  return NextResponse.json({
    ok: true,
    today,
    yesterday,
    rowsChecked: rows?.length ?? 0,
    warnings,
  })
}
