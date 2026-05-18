// heals-system-rebuild — Heals Thai Massage POS
//
// Unit tests for the CSV helpers (Task 4.15).
//
// Coverage:
//   - Basic round-trip (no quoting needed)
//   - Fields containing commas (must be quoted)
//   - Fields containing double quotes (must escape `"` → `""`)
//   - Fields containing newlines (CR/LF inside a quoted field)
//   - Empty values (null, undefined, '')
//   - Reordered columns / partial header subsets
//   - CRLF line endings on output
//
// Property-based tests for the round-trip invariant live in task 4.16.
//
// Validates: Requirements 22.4 (CSV export round-trip safety).

import { toCSV, parseCSV, type CSVColumn } from './csv'

interface Row {
  staff: string
  amount: number | string | null | undefined
  note: string
}

const cols: CSVColumn<Row>[] = [
  { key: 'staff', header: 'Staff' },
  { key: 'amount', header: 'Amount' },
  { key: 'note', header: 'Note' },
]

describe('toCSV', () => {
  it('emits CRLF line endings and a trailing CRLF', () => {
    const csv = toCSV([{ staff: 'Ann', amount: 10, note: '' }], cols)
    expect(csv).toBe('Staff,Amount,Note\r\nAnn,10,\r\n')
  })

  it('does not quote plain fields', () => {
    const csv = toCSV([{ staff: 'Ann', amount: 10, note: 'hi' }], cols)
    expect(csv.split('\r\n')[1]).toBe('Ann,10,hi')
  })

  it('quotes fields containing a comma', () => {
    const csv = toCSV(
      [{ staff: 'Ann, Jr', amount: 10, note: 'plain' }],
      cols,
    )
    expect(csv.split('\r\n')[1]).toBe('"Ann, Jr",10,plain')
  })

  it('escapes embedded double quotes by doubling them', () => {
    const csv = toCSV(
      [{ staff: 'Ann "the boss"', amount: 10, note: 'x' }],
      cols,
    )
    expect(csv.split('\r\n')[1]).toBe('"Ann ""the boss""",10,x')
  })

  it('quotes fields containing newlines', () => {
    const csv = toCSV(
      [{ staff: 'Ann', amount: 10, note: 'line1\nline2' }],
      cols,
    )
    // The bare LF inside the quoted field is preserved literally; only
    // CRLF separates records, so splitting on \r\n keeps the whole
    // quoted body intact on one line of the split array.
    expect(csv.split('\r\n')[1]).toBe('Ann,10,"line1\nline2"')
    expect(csv).toContain('"line1\nline2"')
  })

  it('quotes fields containing CR', () => {
    const csv = toCSV([{ staff: 'Ann', amount: 1, note: 'a\rb' }], cols)
    expect(csv).toContain('"a\rb"')
  })

  it('emits empty fields for null and undefined values', () => {
    const csv = toCSV(
      [{ staff: '', amount: null, note: undefined as unknown as string }],
      cols,
    )
    expect(csv.split('\r\n')[1]).toBe(',,')
  })
})

describe('parseCSV', () => {
  it('parses a simple body into header-keyed records', () => {
    const csv = 'Staff,Amount,Note\r\nAnn,10,hi\r\nBob,20,ho\r\n'
    expect(parseCSV(csv)).toEqual([
      { Staff: 'Ann', Amount: '10', Note: 'hi' },
      { Staff: 'Bob', Amount: '20', Note: 'ho' },
    ])
  })

  it('skips a trailing CRLF / blank line', () => {
    const csv = 'Staff,Amount,Note\r\nAnn,10,hi\r\n\r\n'
    expect(parseCSV(csv)).toHaveLength(1)
  })

  it('keeps numeric strings as strings (no dynamic typing)', () => {
    const rows = parseCSV('A,B\r\n1,2\r\n')
    expect(rows[0]).toEqual({ A: '1', B: '2' })
    expect(typeof rows[0].A).toBe('string')
  })
})

describe('round-trip', () => {
  it('round-trips a basic row set', () => {
    const rows: Row[] = [
      { staff: 'Ann', amount: '10', note: 'hi' },
      { staff: 'Bob', amount: '20', note: 'ho' },
    ]
    const parsed = parseCSV(toCSV(rows, cols))
    expect(parsed).toEqual([
      { Staff: 'Ann', Amount: '10', Note: 'hi' },
      { Staff: 'Bob', Amount: '20', Note: 'ho' },
    ])
  })

  it('round-trips fields with commas, quotes, and newlines', () => {
    const rows: Row[] = [
      { staff: 'Ann, Jr', amount: '10', note: 'has "quotes"' },
      { staff: 'multi\nline', amount: '20', note: 'with\r\nCRLF' },
    ]
    const parsed = parseCSV(toCSV(rows, cols))
    expect(parsed).toEqual([
      { Staff: 'Ann, Jr', Amount: '10', Note: 'has "quotes"' },
      // Papa preserves embedded line endings inside a quoted field
      // verbatim, so the original CRLF survives the round trip.
      { Staff: 'multi\nline', Amount: '20', Note: 'with\r\nCRLF' },
    ])
  })

  it('round-trips empty values', () => {
    const rows: Row[] = [{ staff: '', amount: null, note: '' }]
    const parsed = parseCSV(toCSV(rows, cols))
    expect(parsed).toEqual([{ Staff: '', Amount: '', Note: '' }])
  })

  it('respects reordered columns', () => {
    const reordered: CSVColumn<Row>[] = [
      { key: 'note', header: 'Note' },
      { key: 'staff', header: 'Staff' },
      { key: 'amount', header: 'Amount' },
    ]
    const rows: Row[] = [{ staff: 'Ann', amount: '10', note: 'hi' }]
    const csv = toCSV(rows, reordered)
    expect(csv.split('\r\n')[0]).toBe('Note,Staff,Amount')
    expect(csv.split('\r\n')[1]).toBe('hi,Ann,10')
    expect(parseCSV(csv)).toEqual([
      { Note: 'hi', Staff: 'Ann', Amount: '10' },
    ])
  })

  it('emits a header subset when fewer columns are requested', () => {
    const justStaff: CSVColumn<Row>[] = [{ key: 'staff', header: 'Staff' }]
    const rows: Row[] = [
      { staff: 'Ann', amount: '10', note: 'hi' },
      { staff: 'Bob', amount: '20', note: 'ho' },
    ]
    const csv = toCSV(rows, justStaff)
    expect(csv).toBe('Staff\r\nAnn\r\nBob\r\n')
    expect(parseCSV(csv)).toEqual([{ Staff: 'Ann' }, { Staff: 'Bob' }])
  })
})
