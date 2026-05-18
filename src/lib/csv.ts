// heals-system-rebuild — Heals Thai Massage POS
//
// RFC 4180 CSV serialization helpers (Task 4.15).
//
// Two functions only:
//   - toCSV(rows, columns)  — deterministic export with CRLF lines and
//                             minimal quoting (only quote when needed).
//   - parseCSV(text)        — round-trip safe parser keyed by header.
//
// Why we hand-roll `toCSV` instead of using papaparse's `unparse`:
//   1. We want guaranteed CRLF (`\r\n`) line endings per RFC 4180 §2.1
//      regardless of the host platform.
//   2. We want to *only* quote fields that strictly need it (contain
//      `,`, `"`, `\r`, or `\n`). Unparse defaults to quoting everything
//      or nothing, neither of which round-trips cleanly through
//      `parseCSV` for owner-readable exports.
//   3. We control the column order and the header row — `unparse`
//      derives both from the first row's keys, which loses ordering
//      guarantees.
//
// Parsing is delegated to papaparse with `header: true` and
// `skipEmptyLines: true`. Papa already handles RFC 4180 quoting in both
// directions, so the round-trip property (Property 20) holds: for any
// row set, `parseCSV(toCSV(rows, cols))` recovers each row's string
// representation under the declared column headers.
//
// Validates: Requirements 22.4 (CSV export for owner reports).

import Papa from 'papaparse'

/**
 * Column descriptor used by `toCSV`. The serializer emits one CSV
 * column per descriptor, in array order, using `header` for the header
 * row and `row[key]` for body cells.
 */
export interface CSVColumn<T> {
  key: keyof T
  header: string
}

/**
 * Coerce an arbitrary cell value into the canonical CSV string form.
 *
 *   - `null` / `undefined`  → `''` (empty field)
 *   - `Date`                → ISO 8601 (`toISOString()`)
 *   - everything else       → `String(value)`
 *
 * Booleans, numbers, and bigints round-trip through `String()` cleanly;
 * objects fall back to whatever their `toString()` produces, which the
 * caller is responsible for if they pass non-primitive cell values.
 */
function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/**
 * Quote a single field per RFC 4180 §2.6/§2.7:
 *   - If the field contains `,`, `"`, `\r`, or `\n`, wrap it in `"…"`.
 *   - Inside a quoted field, every `"` is escaped as `""`.
 *   - Otherwise emit the field verbatim.
 */
function quoteField(raw: string): string {
  // Fast path: no special characters → no quoting needed.
  if (!/[",\r\n]/.test(raw)) return raw
  return `"${raw.replace(/"/g, '""')}"`
}

/**
 * Serialize `rows` as RFC 4180 CSV text using the supplied `columns`.
 *
 * - The first line is the header row built from `columns[].header`.
 * - Each subsequent line is one row in the same column order.
 * - Lines are joined by CRLF (`\r\n`); the output ends with a trailing
 *   CRLF so appending more rows is straightforward and Excel imports
 *   without a "missing newline" warning.
 * - Cells are quoted only when they contain `,`, `"`, `\r`, or `\n`.
 *
 * The function is total: any row whose `key` is missing yields an
 * empty field rather than throwing, matching the parse side which
 * tolerates missing columns.
 */
export function toCSV<T>(rows: T[], columns: CSVColumn<T>[]): string {
  const headerLine = columns.map((c) => quoteField(c.header)).join(',')
  const bodyLines = rows.map((row) =>
    columns
      .map((col) => quoteField(stringifyCell(row[col.key])))
      .join(','),
  )
  return [headerLine, ...bodyLines].join('\r\n') + '\r\n'
}

/**
 * Parse RFC 4180 CSV text into an array of header-keyed records.
 *
 * Behaviour notes:
 *   - The first non-empty line is treated as the header row; subsequent
 *     lines populate `Record<header, cell>` objects.
 *   - Empty lines (including a trailing CRLF from `toCSV`) are skipped.
 *   - All cell values are returned as strings; numeric/boolean coercion
 *     is the caller's responsibility (the column descriptors at export
 *     time describe the intended type, but CSV is text-only on disk).
 *   - Papa's `dynamicTyping` is intentionally OFF so round-tripping
 *     `"42"` stays `"42"` and not `42`.
 */
export function parseCSV(text: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  })
  return result.data
}
