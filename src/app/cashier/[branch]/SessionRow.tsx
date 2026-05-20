'use client'

/**
 * SessionRow — type exports and helpers only.
 *
 * The actual row rendering is now inline in SessionTable.tsx.
 * This file exists to export the DraftRow type and utility functions
 * that SessionTable and other modules import.
 */

import type { TransactionRow } from '@/domain/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DraftRow {
  id: string
  cashierRowNumber: number
  staff: string
  course: string
  duration: string
  method: string
  timeIn: string
  timeOut: string
  cash: string
  qr: string
  credit: string
  price: string
  addon: string
  flags: string
  baseCommission: string
  balmBonus: string
  bookingBonus: string
  totalCommission: string
  comment: string
  saving?: boolean
  saveError?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function rowToDraft(r: TransactionRow): DraftRow {
  return {
    id: r.id,
    cashierRowNumber: r.cashierRowNumber,
    staff: r.staff,
    course: r.course,
    duration: String(r.duration),
    method: r.method,
    timeIn: r.timeIn ?? '',
    timeOut: r.timeOut ?? '',
    cash: String(r.cash ?? 0),
    qr: String(r.qr ?? 0),
    credit: String(r.credit ?? 0),
    price: String(r.price ?? 0),
    addon: String(r.addon ?? 0),
    flags: r.flags ?? '',
    baseCommission: String(r.baseCommission ?? 0),
    balmBonus: String(r.balmBonus ?? 0),
    bookingBonus: String(r.bookingBonus ?? 0),
    totalCommission: String(r.totalCommission ?? 0),
    comment: r.comment ?? '',
  }
}

export function blankDraft(cashierRowNumber: number): DraftRow {
  return {
    id: '',
    cashierRowNumber,
    staff: '',
    course: '',
    duration: '',
    method: '',
    timeIn: '',
    timeOut: '',
    cash: '',
    qr: '',
    credit: '',
    price: '',
    addon: '',
    flags: '',
    baseCommission: '',
    balmBonus: '',
    bookingBonus: '',
    totalCommission: '',
    comment: '',
  }
}

export function isSaveable(d: DraftRow): boolean {
  return !!(
    d.staff.trim() &&
    d.course.trim() &&
    d.duration.trim() &&
    d.method.trim()
  )
}

// Default export kept for backwards compat with any dynamic import
// that expects a component — returns null (renders nothing).
export default function SessionRow() {
  return null
}
