/**
 * Google Sheets data fetcher for the Boss HQ dashboard.
 *
 * Reads transaction data directly from the Cashier_POS Google Sheet
 * using the Google Visualization API (no API key needed — sheet is
 * set to "Anyone with the link can view").
 *
 * The endpoint returns a JSONP-like response:
 *   google.visualization.Query.setResponse({...})
 * We strip the wrapper to get JSON with `table.rows[].c[].v` values.
 */

import 'server-only'

import { getBusinessDate } from '@/domain/business-date'
import type { Branch } from '@/domain/types'

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID ??
  '1Rdth2xUjwmchj7jYfYFaJYmzY1buoUTHHZcSd5RfkE8'

const BRANCHES_TABS: Branch[] = ['Kimberry', 'Bishop', 'Chulia']

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A parsed row from the Cashier_POS sheet.
 * Column layout (row 2 = header, data starts row 3):
 *   A=No, B=Price, C=Staff, D=Course, E=Dur, F=Time-in, G=Time-out,
 *   H=Add-on, I=Commission, J=Method, K=Cash, L=QR, M=Credit,
 *   N=Flags, O=Comment
 */
export interface CashierRow {
  rowNum: number
  price: number
  staff: string
  course: string
  duration: number
  timeIn: string
  timeOut: string
  addon: number
  commission: number
  method: string
  cash: number
  qr: number
  credit: number
  flags: string
  comment: string
  branch: Branch
  /** Business date derived from the sheet context (today by default). */
  businessDate: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Coerce a cell value to a finite number, defaulting to 0. */
function num(v: unknown): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Coerce a cell value to a string. */
function str(v: unknown): string {
  if (v == null) return ''
  return String(v)
}

/**
 * Fetch and parse a single branch tab from the Google Sheet.
 * Returns parsed rows for that branch.
 */
async function fetchTab(branch: Branch): Promise<CashierRow[]> {
  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}` +
    `/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(branch)}&range=A3:O200`

  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    console.error(`[sheets] Failed to fetch ${branch}: ${res.status}`)
    return []
  }

  const text = await res.text()

  // Strip the JSONP wrapper: google.visualization.Query.setResponse({...})
  const match = text.match(/google\.visualization\.Query\.setResponse\((.+)\);?\s*$/)
  if (!match) {
    console.error(`[sheets] Unexpected response format for ${branch}`)
    return []
  }

  let data: { table?: { rows?: Array<{ c?: Array<{ v?: unknown } | null> }> } }
  try {
    data = JSON.parse(match[1])
  } catch {
    console.error(`[sheets] JSON parse error for ${branch}`)
    return []
  }

  const rows = data?.table?.rows ?? []
  const today = getBusinessDate(new Date())
  const result: CashierRow[] = []

  for (const row of rows) {
    const cells = row.c ?? []
    const rowNum = num(cells[0]?.v)
    // Skip empty rows (no row number or no staff)
    if (!rowNum && !str(cells[2]?.v)) continue

    result.push({
      rowNum,
      price: num(cells[1]?.v),
      staff: str(cells[2]?.v),
      course: str(cells[3]?.v),
      duration: num(cells[4]?.v),
      timeIn: str(cells[5]?.v),
      timeOut: str(cells[6]?.v),
      addon: num(cells[7]?.v),
      commission: num(cells[8]?.v),
      method: str(cells[9]?.v),
      cash: num(cells[10]?.v),
      qr: num(cells[11]?.v),
      credit: num(cells[12]?.v),
      flags: str(cells[13]?.v),
      comment: str(cells[14]?.v),
      branch,
      businessDate: today,
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch all transaction data from all 3 branch tabs.
 * Returns a flat array of CashierRow from all branches.
 */
export async function fetchAllBranches(): Promise<CashierRow[]> {
  const results = await Promise.all(BRANCHES_TABS.map(fetchTab))
  return results.flat()
}

/**
 * Fetch transaction data for a single branch tab.
 */
export async function fetchBranchData(branch: Branch): Promise<CashierRow[]> {
  return fetchTab(branch)
}
