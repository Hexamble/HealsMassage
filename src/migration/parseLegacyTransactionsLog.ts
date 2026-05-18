/**
 * Parse a legacy `Transactions_Log` CSV export (from the Boss_HQ
 * spreadsheet) into a normalised `LegacyRow[]`.
 *
 * The legacy log is a flat dump of one row per cashier transaction
 * with column names that drifted over the spreadsheet's lifetime
 * (e.g. "RowNum" vs "No", "Date" vs "Business Date", "Comment" vs
 * "Note"). We support both the canonical `bosshq.txt` header set and
 * the historical aliases via `HEADER_ALIASES`. Unknown columns are
 * dropped silently — the importer downstream cares only about the
 * `LegacyRow` shape.
 *
 * Strategy:
 *   1. Run `Papa.parse(csv, { header: true, skipEmptyLines: true })`.
 *   2. Normalise every header via `normaliseHeaderKey` (lowercase +
 *      strip non-alphanumerics) and look up the canonical
 *      `LegacyRow` field name.
 *   3. For each parsed row, project the recognised columns onto the
 *      `LegacyRow` shape, defaulting missing fields to `''`.
 *   4. A row is malformed when the seven required fields (`branch`,
 *      `date`, `rowNum`, `staff`, `course`, `duration`, `method`) are
 *      blank — surface those in `errors[]` with the original CSV
 *      line number so the migration UI / CLI can guide the operator
 *      to the offending row.
 *
 * Idempotency / determinism:
 *   The parser does not validate values (date format, enum membership,
 *   etc.) — that is `legacyRowToTransaction`'s job. It only ensures
 *   structural sanity so the next stage gets uniform inputs.
 *
 * Validates: Requirements 14.1, 14.3 (legacy CSV import resilient to
 *            malformed rows; reports errors instead of throwing).
 *
 * See `c:/BILL/.kiro/specs/salary-system-rebuild/design.md`
 *     §"Migration Tool".
 */

import Papa from 'papaparse'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One parsed legacy row in canonical field-name form. All values are
 * strings (raw CSV text) — coercion happens in
 * `legacyRowToTransaction`. Missing optional fields default to `''`.
 */
export interface LegacyRow {
  branch: string
  date: string
  rowNum: string
  staff: string
  course: string
  duration: string
  timeIn: string
  timeOut: string
  addon: string
  baseComm: string
  balmB: string
  bookB: string
  totalComm: string
  method: string
  cash: string
  qr: string
  credit: string
  price: string
  flags: string
  comment: string
}

export interface ParseError {
  /** 1-based source line number in the input CSV (excluding the
   *  header row). Set to `-1` when Papa.parse itself fails. */
  line: number
  reason: string
}

export interface ParseResult {
  rows: LegacyRow[]
  errors: ParseError[]
}

// ---------------------------------------------------------------------------
// Header alias map
// ---------------------------------------------------------------------------

/**
 * Canonical `LegacyRow` field name keyed by the normalised header
 * (lowercase, alphanumerics only). Each historical / variant header
 * lands here; unknown headers are dropped without error.
 */
const HEADER_ALIASES: Record<string, keyof LegacyRow> = {
  // branch
  branch: 'branch',
  branchname: 'branch',
  // date
  date: 'date',
  businessdate: 'date',
  // row number
  rownum: 'rowNum',
  rownumber: 'rowNum',
  no: 'rowNum',
  n: 'rowNum',
  // staff
  staff: 'staff',
  name: 'staff',
  staffname: 'staff',
  // course
  course: 'course',
  coursecode: 'course',
  // duration
  duration: 'duration',
  dur: 'duration',
  min: 'duration',
  mins: 'duration',
  minutes: 'duration',
  // time in / out
  timein: 'timeIn',
  start: 'timeIn',
  timeout: 'timeOut',
  end: 'timeOut',
  // addon
  addon: 'addon',
  // base commission
  basecomm: 'baseComm',
  base: 'baseComm',
  // balm bonus
  balmb: 'balmB',
  balm: 'balmB',
  staffbalm: 'balmB',
  // booking bonus
  bookb: 'bookB',
  book: 'bookB',
  booking: 'bookB',
  // total commission
  totalcomm: 'totalComm',
  total: 'totalComm',
  commission: 'totalComm',
  // method
  method: 'method',
  pay: 'method',
  payment: 'method',
  // payment splits
  cash: 'cash',
  qr: 'qr',
  epay: 'qr',
  credit: 'credit',
  card: 'credit',
  // price
  price: 'price',
  amount: 'price',
  // flags
  flags: 'flags',
  flag: 'flags',
  // comment
  comment: 'comment',
  note: 'comment',
  notes: 'comment',
}

const REQUIRED_FIELDS: readonly (keyof LegacyRow)[] = [
  'branch',
  'date',
  'rowNum',
  'staff',
  'course',
  'duration',
  'method',
] as const

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parse a legacy `Transactions_Log` CSV export.
 *
 * @param csv  Raw CSV text. Must include a header row.
 * @returns    `{ rows, errors }` where `errors[].line` is the 1-based
 *             source line number (header row is line 1, first data
 *             row is line 2, etc).
 */
export function parseLegacyTransactionsLog(csv: string): ParseResult {
  const result: ParseResult = { rows: [], errors: [] }

  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  })

  // Surface Papa.parse's own structural complaints. Field-mismatch
  // warnings on individual rows are still recoverable — keep going.
  for (const err of parsed.errors ?? []) {
    if (err.type === 'Delimiter' || err.type === 'Quotes') {
      result.errors.push({
        line: typeof err.row === 'number' ? err.row + 2 : -1,
        reason: `CSV_PARSE: ${err.message}`,
      })
    }
  }

  // Build the normalised → canonical header map for THIS file. We
  // can't use the alias map directly because different CSVs may use
  // different aliases (e.g. one has "No", another has "RowNum").
  const headers = parsed.meta.fields ?? []
  const headerToField: Record<string, keyof LegacyRow> = {}
  const claimedFields = new Set<keyof LegacyRow>()
  for (const header of headers) {
    const key = normaliseHeaderKey(header)
    const field = HEADER_ALIASES[key]
    if (field && !claimedFields.has(field)) {
      // First occurrence wins on duplicates — keeps behaviour
      // deterministic when a CSV happens to have both "No" and
      // "RowNum" (we honour whichever appeared first).
      headerToField[header] = field
      claimedFields.add(field)
    }
  }

  // Project each parsed row onto the LegacyRow shape.
  const data = parsed.data ?? []
  for (let i = 0; i < data.length; i++) {
    const raw = data[i]
    if (!raw || typeof raw !== 'object') continue

    const row = emptyLegacyRow()
    for (const header of Object.keys(headerToField)) {
      const field = headerToField[header]
      const value = raw[header]
      row[field] = value == null ? '' : String(value).trim()
    }

    // Required-field check. Header row counts as line 1 in the source
    // file, so the first data row is line 2.
    const sourceLine = i + 2
    const missing = REQUIRED_FIELDS.filter((f) => row[f] === '')
    if (missing.length > 0) {
      result.errors.push({
        line: sourceLine,
        reason: `MISSING_REQUIRED: ${missing.join(', ')}`,
      })
      continue
    }

    result.rows.push(row)
  }

  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a header by lowercasing and stripping every non-letter,
 * non-digit character. "Row Num" → "rownum", "Time-In" → "timein",
 * "Total_Comm" → "totalcomm". Keeps the alias map small.
 */
function normaliseHeaderKey(header: string): string {
  return String(header).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Construct an empty LegacyRow with every field defaulted to ''. */
function emptyLegacyRow(): LegacyRow {
  return {
    branch: '',
    date: '',
    rowNum: '',
    staff: '',
    course: '',
    duration: '',
    timeIn: '',
    timeOut: '',
    addon: '',
    baseComm: '',
    balmB: '',
    bookB: '',
    totalComm: '',
    method: '',
    cash: '',
    qr: '',
    credit: '',
    price: '',
    flags: '',
    comment: '',
  }
}
