/**
 * heals-system-rebuild — Row default-fill helper (cashier UI).
 *
 * Pure function: given a partially-filled session row + the lookup
 * tables, return the auto-fill price + commission components the
 * cashier should see by default. Used by the SessionTable when a
 * cell change might invalidate the prior auto-fill.
 *
 * The cashier UI tracks per-cell `userOverridden` flags so a field
 * the cashier typed by hand is never clobbered by an auto-fill.
 * This helper produces the values; the table reconciles them with
 * the override flags.
 *
 * Mirrors the same algorithm `writeTransaction` runs on the server,
 * so the cashier preview matches what the DB ultimately stores when
 * the row is saved without overrides.
 */

import {
  bookingBonus,
  computeCommission,
  customerPriceWithFlags,
  parseFlags,
  priceTableFromRows,
  type Course,
  type Duration,
  type FreelanceRateRow,
  type PriceRow,
  type RegularRateRow,
} from '@/domain/commission'
import { isExtraMethod } from '@/domain/extra'
import type { Branch } from '@/domain/types'

export interface RowDefaultsInput {
  branch: Branch
  businessDate: string
  course?: Course
  duration?: Duration
  method?: string
  flags?: string
  /** Whether the current staff is freelance (drives rate table). */
  staffIsFreelance?: boolean
  prices: ReadonlyArray<PriceRow>
  regularRates: ReadonlyArray<RegularRateRow>
  freelanceRates: ReadonlyArray<FreelanceRateRow>
}

export interface RowDefaultsOutput {
  price: number
  baseCommission: number
  balmBonus: number
  bookingBonus: number
  totalCommission: number
}

export function computeRowDefaults(
  input: RowDefaultsInput,
): RowDefaultsOutput {
  const { branch, businessDate, course, duration, method, flags } = input

  // Without course + duration we can't lookup anything sensible.
  if (!course || !duration) {
    return {
      price: 0,
      baseCommission: 0,
      balmBonus: 0,
      bookingBonus: 0,
      totalCommission: 0,
    }
  }

  const methodStr = String(method ?? '').trim()
  const priceTable = priceTableFromRows(input.prices)

  const price = customerPriceWithFlags(
    course,
    duration,
    branch,
    methodStr,
    flags ?? '',
    priceTable,
  )

  // EXTRA short-circuits commission to all-zero (Req 5.x).
  if (isExtraMethod(methodStr)) {
    return {
      price: 0,
      baseCommission: 0,
      balmBonus: 0,
      bookingBonus: 0,
      totalCommission: 0,
    }
  }

  const isFreelanceMethod = methodStr.toLowerCase() === 'freelance'
  // The staff's roster `is_freelance` flag also routes to freelance
  // rates even when the method is CASH/QR/CREDIT (Req 6.5/6.6).
  const useFreelanceRates =
    isFreelanceMethod || Boolean(input.staffIsFreelance)

  const result = computeCommission({
    course,
    duration,
    branch,
    businessDate,
    method: useFreelanceRates ? 'Freelance' : methodStr || 'CASH',
    staffBalm: parseFlags(flags).staffBalm,
    booking: parseFlags(flags).booking,
    addon: 0,
    flags,
    regularRates: input.regularRates,
    freelanceRates: input.freelanceRates,
    priceTable,
  })

  return {
    price,
    baseCommission: result.base,
    balmBonus: result.balm,
    bookingBonus: result.book,
    totalCommission: result.total,
  }
}

/**
 * Quick helper exposed for the UI: given a duration, what booking
 * bonus would fire when the Booking flag is on? Used by the cell-
 * level live preview as the cashier flips chips.
 */
export function bookingBonusFor(duration: Duration | undefined): number {
  if (!duration) return 0
  return bookingBonus(duration)
}
