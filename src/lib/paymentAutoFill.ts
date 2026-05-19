/**
 * Payment auto-fill logic for the cashier POS.
 *
 * Computes payment column values (cash, qr, credit) based on the selected
 * payment method, respecting manual overrides and skipping auto-fill for
 * Freelance/EXTRA methods or zero/NaN prices.
 *
 * Feature: cashier-pos-polish
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import { isExtraMethod } from '@/domain/extra'

export interface PaymentOverrides {
  cash?: boolean
  qr?: boolean
  credit?: boolean
}

export interface PaymentValues {
  cash: string
  qr: string
  credit: string
}

export interface PaymentAutoFillInput {
  method: string
  price: string
  currentPayment: PaymentValues
  overrides: PaymentOverrides
}

export interface PaymentAutoFillResult {
  cash: string
  qr: string
  credit: string
  /** Which fields were changed by auto-fill (for UI feedback). */
  changed: { cash?: boolean; qr?: boolean; credit?: boolean }
}

/**
 * Compute payment column auto-fill based on selected method.
 *
 * Rules:
 * - CASH/QR/CREDIT: fill the matching column with price, zero the others
 * - Freelance or EXTRA methods: no auto-fill (return current values)
 * - Price is 0 or NaN: no auto-fill (return current values)
 * - Overridden columns are never modified
 */
export function computePaymentAutoFill(
  input: PaymentAutoFillInput,
): PaymentAutoFillResult {
  const { method, price, currentPayment, overrides } = input

  const noChange: PaymentAutoFillResult = {
    cash: currentPayment.cash,
    qr: currentPayment.qr,
    credit: currentPayment.credit,
    changed: {},
  }

  // Parse price — skip auto-fill if 0 or NaN
  const priceNum = Number(price)
  if (!Number.isFinite(priceNum) || priceNum === 0) {
    return noChange
  }

  // Normalise method for comparison
  const trimmedMethod = method.trim()
  const upperMethod = trimmedMethod.toUpperCase()

  // Freelance methods: no auto-fill
  if (trimmedMethod.toLowerCase() === 'freelance') {
    return noChange
  }

  // EXTRA methods: no auto-fill
  if (isExtraMethod(trimmedMethod)) {
    return noChange
  }

  // Determine which column should receive the price
  let targetColumn: 'cash' | 'qr' | 'credit' | null = null
  if (upperMethod === 'CASH') targetColumn = 'cash'
  else if (upperMethod === 'QR') targetColumn = 'qr'
  else if (upperMethod === 'CREDIT') targetColumn = 'credit'

  // If method is not one of the three auto-fill methods, no change
  if (!targetColumn) {
    return noChange
  }

  const priceStr = String(priceNum)
  const result: PaymentAutoFillResult = {
    cash: currentPayment.cash,
    qr: currentPayment.qr,
    credit: currentPayment.credit,
    changed: {},
  }

  const columns: Array<'cash' | 'qr' | 'credit'> = ['cash', 'qr', 'credit']

  for (const col of columns) {
    if (overrides[col]) {
      // Never modify overridden columns
      continue
    }

    if (col === targetColumn) {
      // Fill the target column with the price
      if (result[col] !== priceStr) {
        result[col] = priceStr
        result.changed[col] = true
      }
    } else {
      // Zero out non-target columns (only if not overridden)
      if (result[col] !== '0') {
        result[col] = '0'
        result.changed[col] = true
      }
    }
  }

  return result
}
