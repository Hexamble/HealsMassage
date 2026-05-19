/**
 * Time parsing/formatting utility for the cashier POS.
 *
 * Supports flexible time input: digits-only (1-4 chars), colon-separated
 * (H:mm / HH:mm), and am/pm suffixed variants. Normalises to HH:mm 24-hour
 * format on success.
 *
 * Feature: cashier-pos-polish
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

export type TimeParseResult =
  | { valid: true; formatted: string }
  | { valid: false; raw: string }

/**
 * Parse a flexible time input string into normalized HH:mm 24-hour format.
 *
 * Supported formats:
 *   - 1-2 digits without colon: treated as hours (e.g. "9" → "09:00", "14" → "14:00")
 *   - 3 digits without colon: H:mm (e.g. "130" → "01:30", "930" → "09:30")
 *   - 4 digits without colon: HH:mm (e.g. "1430" → "14:30", "0900" → "09:00")
 *   - H:mm or HH:mm with colon (e.g. "9:30" → "09:30", "14:30" → "14:30")
 *   - Any of the above with am/pm suffix, case-insensitive, optional space
 *     (e.g. "2pm" → "14:00", "230PM" → "14:30", "11 am" → "11:00")
 *
 * Returns `{ valid: true, formatted: "HH:mm" }` on success,
 * or `{ valid: false, raw: originalInput }` on failure.
 */
export function parseTimeInput(input: string): TimeParseResult {
  const raw = input
  const trimmed = input.trim()
  if (!trimmed) return { valid: false, raw }

  // Detect am/pm suffix (case-insensitive, optional space before suffix)
  const ampmMatch = trimmed.match(/^(.+?)\s*(am|pm)$/i)
  const core = ampmMatch ? ampmMatch[1].trim() : trimmed
  const period = ampmMatch ? ampmMatch[2].toLowerCase() : null

  let hours: number
  let minutes: number

  // Try colon format first: H:mm or HH:mm
  const colonMatch = core.match(/^(\d{1,2}):(\d{2})$/)
  if (colonMatch) {
    hours = parseInt(colonMatch[1], 10)
    minutes = parseInt(colonMatch[2], 10)
  } else if (/^\d{1,4}$/.test(core)) {
    // Pure digits (1-4)
    const len = core.length
    if (len <= 2) {
      // 1-2 digits: hours only
      hours = parseInt(core, 10)
      minutes = 0
    } else if (len === 3) {
      // 3 digits: first digit is hour, last two are minutes
      hours = parseInt(core.charAt(0), 10)
      minutes = parseInt(core.slice(1), 10)
    } else {
      // 4 digits: first two are hours, last two are minutes
      hours = parseInt(core.slice(0, 2), 10)
      minutes = parseInt(core.slice(2), 10)
    }
  } else {
    return { valid: false, raw }
  }

  // Apply am/pm conversion
  if (period) {
    // For am/pm, hours must be 1-12 (with 12 being special)
    if (hours < 1 || hours > 12) return { valid: false, raw }
    if (period === 'am') {
      if (hours === 12) hours = 0
    } else {
      // pm
      if (hours !== 12) hours += 12
    }
  }

  // Validate ranges
  if (hours < 0 || hours > 23) return { valid: false, raw }
  if (minutes < 0 || minutes > 59) return { valid: false, raw }

  const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  return { valid: true, formatted }
}
