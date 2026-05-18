/**
 * Tests for `getBusinessDate` — the 5 AM Asia/Kuala_Lumpur business-date cutoff.
 *
 * Asia/Kuala_Lumpur is UTC+8 with NO daylight saving time, so a KL local time
 * `Y-M-D HH:MM:SS` corresponds exactly to UTC time `Y-M-D HH-8:MM:SS` (with
 * day rollback when HH < 8). All test instants below are constructed with
 * `Date.UTC(...)` to make the KL local time explicit.
 *
 * Validates:
 *   - Requirements 4.1, 4.2: 5 AM cutoff partitions the calendar day
 *   - Requirements 4.3: same rule applied across all surfaces (timezone-driven)
 *   - Requirements 4.4: 04:59 on 2026-05-27 → 2026-05-26
 *   - Requirements 4.5: 03:00 on 2026-03-01 → 2026-02-28 (month boundary)
 *   - Property 1: Business date 5 AM cutoff (heals-system-rebuild/design.md)
 */

import fc from 'fast-check';
import { formatInTimeZone } from 'date-fns-tz';
import { getBusinessDate } from './business-date';

/**
 * Build a UTC `Date` from the KL-local wall-clock time. KL is UTC+8 with no
 * DST, so we just subtract 8 from the hour. JS's `Date.UTC` handles negative
 * hours by rolling the date back, which is exactly what we want.
 */
function klDate(
  year: number,
  monthOneBased: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
): Date {
  return new Date(Date.UTC(year, monthOneBased - 1, day, hour - 8, minute, second));
}

/**
 * Compute the previous calendar date string in pure UTC date space — the same
 * algorithm the implementation uses, so the property test does not depend on
 * any timezone library for the expected value.
 */
function previousDay(yyyyMmDd: string): string {
  const [yStr, mStr, dStr] = yyyyMmDd.split('-');
  const utc = new Date(
    Date.UTC(parseInt(yStr, 10), parseInt(mStr, 10) - 1, parseInt(dStr, 10)),
  );
  utc.setUTCDate(utc.getUTCDate() - 1);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

describe('getBusinessDate — 5 AM Asia/Kuala_Lumpur cutoff', () => {
  it('returns previous day at 04:59:59 KL on 2026-05-27 (Req 4.4 example)', () => {
    // Requirement 4.4: 04:59 on 2026-05-27 → 2026-05-26
    expect(getBusinessDate(klDate(2026, 5, 27, 4, 59, 0))).toBe('2026-05-26');
    // Also covers the second-precision boundary just below 05:00:00.
    expect(getBusinessDate(klDate(2026, 5, 27, 4, 59, 59))).toBe('2026-05-26');
  });

  it('returns same day at 05:00:00 KL (exactly the cutoff)', () => {
    // 05:00:00 KL on 2026-05-27 → first moment of 2026-05-27's books
    expect(getBusinessDate(klDate(2026, 5, 27, 5, 0, 0))).toBe('2026-05-27');
  });

  it('returns same day at 23:59:59 KL (late-night, well after cutoff)', () => {
    expect(getBusinessDate(klDate(2026, 5, 26, 23, 59, 59))).toBe('2026-05-26');
  });

  it('rolls back across year boundary at midnight KL', () => {
    // 00:00:00 KL on 2026-01-01 → belongs to 2025-12-31
    expect(getBusinessDate(klDate(2026, 1, 1, 0, 0, 0))).toBe('2025-12-31');
  });

  it('rolls back across month boundary at 03:00 KL on 2026-03-01 (Req 4.5 example)', () => {
    // Requirement 4.5: 03:00 on 2026-03-01 → 2026-02-28 (non-leap year)
    expect(getBusinessDate(klDate(2026, 3, 1, 3, 0, 0))).toBe('2026-02-28');
  });

  it('rolls back across leap-year February → 2024-02-29', () => {
    // 04:30:00 KL on 2024-03-01 → 2024 IS a leap year, prev day is Feb 29
    expect(getBusinessDate(klDate(2024, 3, 1, 4, 30, 0))).toBe('2024-02-29');
  });

  it('is stable mid-day (12:00:00 KL → same day)', () => {
    expect(getBusinessDate(klDate(2026, 5, 15, 12, 0, 0))).toBe('2026-05-15');
  });

  it('honours an explicit non-MYT timezone argument (UTC)', () => {
    // 04:30:00 UTC on 2026-05-27 is 12:30:00 KL — but we explicitly ask for
    // UTC interpretation, so the cutoff is 05:00 UTC, meaning 04:30 UTC →
    // previous UTC day (2026-05-26). This proves the `tz` parameter is
    // actually consulted and the function isn't hard-coded to KL.
    const t = new Date(Date.UTC(2026, 4, 27, 4, 30, 0));
    expect(getBusinessDate(t, 'UTC')).toBe('2026-05-26');
    // Same instant interpreted in KL is 12:30 KL on 2026-05-27 → same day.
    expect(getBusinessDate(t, 'Asia/Kuala_Lumpur')).toBe('2026-05-27');
  });

  // Validates: Requirements 4.1, 4.2, 4.4, 4.5 (Property 1)
  it('Property 1: matches KL date when KL hour ≥ 5, else previous KL date', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date(Date.UTC(2024, 0, 1, 0, 0, 0)),
          max: new Date(Date.UTC(2030, 11, 31, 23, 59, 59)),
        }),
        (now) => {
          const klDateStr = formatInTimeZone(now, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
          const klHour = parseInt(
            formatInTimeZone(now, 'Asia/Kuala_Lumpur', 'HH'),
            10,
          );
          const expected = klHour >= 5 ? klDateStr : previousDay(klDateStr);
          expect(getBusinessDate(now)).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
