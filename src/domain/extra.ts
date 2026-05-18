/**
 * EXTRA method decoding and match-key construction.
 *
 * Pure functions, no I/O. Encodes the EXTRA branch-lending rules from
 * `c:/BILL/.kiro/specs/heals-system-rebuild/design.md` §"EXTRA Attribution"
 * and Requirements 5.1, 5.4, 5.5.
 *
 * The three exports work together:
 *
 *   - `isExtraMethod(method)` — recognises a method string as an EXTRA
 *     marker. Case-insensitive, whitespace-tolerant; `EXTRA` must appear
 *     as a whole word so `EXTRACT` does not match.
 *   - `decodeExtraDestination(method)` — resolves the destination branch
 *     from the suffix after `EXTRA` (KM/KIM → Kimberry, BS/BIS → Bishop,
 *     CL/CH/CHU → Chulia). Returns `null` when no destination is encoded
 *     (e.g. `'EXTRA'`, `'EXTRA QQ'`, `'CASH'`).
 *   - `buildExtraMatchKey({staff, businessDate, course, duration, branch})`
 *     — builds the canonical match key used to detect whether an EXTRA
 *     row is "covered" by a real row at the destination branch. The key
 *     is invariant under case, surrounding whitespace, and string-vs-number
 *     `duration`, so cashiers' minor formatting differences do not break
 *     reconciliation. Tuples that differ in any logical field
 *     (staff, date, course, duration, branch) produce different keys.
 *
 * Validates: Requirements 5.1, 5.4, 5.5 (heals-system-rebuild)
 *
 * Property tests live in `extra.test.ts`:
 *   - Property 3 — EXTRA destination decoding totality and case-insensitivity
 *   - Property 10 — Match-key normalisation invariance
 */

import type { Branch } from './types'

// ---------------------------------------------------------------------------
// isExtraMethod
// ---------------------------------------------------------------------------

/**
 * Returns true when `method` (trimmed, case-insensitive) starts with the
 * whole word `EXTRA` — that is, `EXTRA` followed by end-of-string,
 * whitespace, or a separator like `-` or `_`. `EXTRACT`, `EXTRA1`, etc.
 * do not match because the boundary character is alphanumeric.
 */
export function isExtraMethod(method: unknown): boolean {
  if (typeof method !== 'string') return false
  const trimmed = method.trim().toUpperCase()
  if (!trimmed.startsWith('EXTRA')) return false
  if (trimmed.length === 5) return true
  const next = trimmed.charAt(5)
  // A non-letter/non-digit boundary means EXTRA is a whole word.
  return !/[A-Z0-9]/.test(next)
}

// ---------------------------------------------------------------------------
// decodeExtraDestination
// ---------------------------------------------------------------------------

/**
 * Returns the destination branch encoded in an EXTRA method string, or
 * `null` when the method is not an EXTRA marker, has no suffix, or the
 * suffix does not match a known branch code.
 *
 * Recognised suffix prefixes (case-insensitive):
 *
 *   `KM`, `KIM`        → `Kimberry`
 *   `BS`, `BIS`        → `Bishop`
 *   `CL`, `CH`, `CHU`  → `Chulia`
 *
 * Whitespace and `-` / `_` separators between `EXTRA` and the suffix are
 * tolerated, e.g. `'EXTRA-BS'`, `'extra  cl'`, `'EXTRA_KM'`.
 */
export function decodeExtraDestination(method: unknown): Branch | null {
  if (!isExtraMethod(method)) return null
  const trimmed = (method as string).trim().toUpperCase()
  // Strip the `EXTRA` prefix and any leading whitespace/dash/underscore separators.
  const suffix = trimmed.slice(5).replace(/^[\s\-_]+/, '')
  // Order matters: `KIM` must be checked before `KM`, `BIS` before `BS`,
  // and `CHU` before `CH` so the longer canonical code wins.
  if (suffix.startsWith('KIM')) return 'Kimberry'
  if (suffix.startsWith('KM')) return 'Kimberry'
  if (suffix.startsWith('BIS')) return 'Bishop'
  if (suffix.startsWith('BS')) return 'Bishop'
  if (suffix.startsWith('CHU')) return 'Chulia'
  if (suffix.startsWith('CH')) return 'Chulia'
  if (suffix.startsWith('CL')) return 'Chulia'
  return null
}

// ---------------------------------------------------------------------------
// buildExtraMatchKey
// ---------------------------------------------------------------------------

/**
 * Inputs to `buildExtraMatchKey`. The shape is fixed so callers cannot
 * accidentally swap positional arguments.
 *
 * `duration` accepts `number | string` so a cashier-typed `'60'` and a
 * computed `60` produce the same key.
 */
export interface ExtraMatchKeyInput {
  staff: string
  businessDate: string
  course: string
  duration: number | string
  branch: Branch
}

/**
 * Builds the canonical match key used to decide whether an EXTRA row is
 * covered by a real row at the destination branch.
 *
 * Format: `${lower(trim(staff))}|${businessDate}|${upper(trim(course))}|${parseInt(duration)}|${branch}`
 *
 * Invariants:
 *   - Case-insensitive on `staff` and `course`.
 *   - Surrounding whitespace on `staff` and `course` is trimmed.
 *   - `duration` is normalised to an integer regardless of input type.
 *   - Tuples differing in any logical field produce different keys.
 *
 * `businessDate` and `branch` flow through verbatim: both are already
 * canonical (`yyyy-MM-dd` from `getBusinessDate`, branch literal from
 * the `Branch` enum).
 */
export function buildExtraMatchKey(input: ExtraMatchKeyInput): string {
  const staff = String(input.staff).trim().toLowerCase()
  const course = String(input.course).trim().toUpperCase()
  const duration = parseInt(String(input.duration), 10)
  return `${staff}|${input.businessDate}|${course}|${duration}|${input.branch}`
}
