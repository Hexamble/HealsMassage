/**
 * Tests for `cycle.ts` — pay-cycle date arithmetic.
 *
 * Convention reminder: `monthIdx` is the END month of the cycle (0-based).
 * `payCycleStartDay ∈ [1, 28]` so cycle boundaries always exist in every
 * month (no Feb-29 / Apr-31 edge cases).
 *
 * @see Requirements 10.1, 10.2, 10.3, 9.6 (heals-system-rebuild/requirements.md)
 * @see Property 7 — Pay cycle dates contiguous (heals-system-rebuild/design.md)
 */

import fc from 'fast-check';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { cycleDates } from './cycle';

describe('cycleDates — unit cases', () => {
  test('default N=21 February cycle (start 21 Jan, end 20 Feb)', () => {
    // Req 10.3: default pay cycle start day is 21. February cycle =
    // monthIdx 1 (cycle ENDS in Feb). Start = 21 Jan, End = 20 Feb.
    const cycle = cycleDates(1, 2026, 21);
    expect(cycle.startDate).toBe('2026-01-21');
    expect(cycle.endDate).toBe('2026-02-20');
    expect(cycle.days.length).toBe(31);
    expect(cycle.days[0]).toBe('2026-01-21');
    expect(cycle.days[cycle.days.length - 1]).toBe('2026-02-20');
  });

  test('May 2026 cycle, start day 21 (monthIdx=4)', () => {
    const cycle = cycleDates(4, 2026, 21);
    expect(cycle.startDate).toBe('2026-04-21');
    expect(cycle.endDate).toBe('2026-05-20');
    expect(cycle.days.length).toBe(30);
    expect(cycle.days[0]).toBe('2026-04-21');
    expect(cycle.days[cycle.days.length - 1]).toBe('2026-05-20');
  });

  test('January 2026 cycle, start day 21 — year rolls back to December 2025', () => {
    // Req 10.2 + year rollover: monthIdx=0 (Jan) → cycle starts in Dec
    // of previous calendar year.
    const cycle = cycleDates(0, 2026, 21);
    expect(cycle.startDate).toBe('2025-12-21');
    expect(cycle.endDate).toBe('2026-01-20');
    expect(cycle.days.length).toBe(31);
    expect(cycle.days[0]).toBe('2025-12-21');
    expect(cycle.days[cycle.days.length - 1]).toBe('2026-01-20');
  });

  test('December 2026 cycle, start day 21 — no year rollover at end', () => {
    const cycle = cycleDates(11, 2026, 21);
    expect(cycle.startDate).toBe('2026-11-21');
    expect(cycle.endDate).toBe('2026-12-20');
  });

  test('March 2024 cycle, start day 1 — leap-year February has 29 days', () => {
    const cycle = cycleDates(2, 2024, 1);
    expect(cycle.startDate).toBe('2024-02-01');
    expect(cycle.endDate).toBe('2024-02-29');
    expect(cycle.days.length).toBe(29);
  });

  test('February 2024 cycle includes leap day (start day 21)', () => {
    // Cycle ends 20 Feb 2024 (leap year); start 21 Jan 2024. Length 31.
    // Confirms the leap year doesn't perturb cycles whose endpoint isn't
    // 29 Feb itself.
    const cycle = cycleDates(1, 2024, 21);
    expect(cycle.startDate).toBe('2024-01-21');
    expect(cycle.endDate).toBe('2024-02-20');
    expect(cycle.days.length).toBe(31);
  });

  test('March 2024 cycle, start day 21 — leap-year cycle includes Feb 29', () => {
    // Cycle ends 20 Mar 2024; start 21 Feb 2024. The Feb 29 leap day must
    // appear exactly once in `days`.
    const cycle = cycleDates(2, 2024, 21);
    expect(cycle.startDate).toBe('2024-02-21');
    expect(cycle.endDate).toBe('2024-03-20');
    expect(cycle.days.length).toBe(29);
    expect(cycle.days).toContain('2024-02-29');
  });

  test('March 2025 cycle, start day 1 — non-leap February has 28 days', () => {
    const cycle = cycleDates(2, 2025, 1);
    expect(cycle.startDate).toBe('2025-02-01');
    expect(cycle.endDate).toBe('2025-02-28');
    expect(cycle.days.length).toBe(28);
  });

  test('August 2026 cycle, start day 28', () => {
    const cycle = cycleDates(7, 2026, 28);
    expect(cycle.startDate).toBe('2026-07-28');
    expect(cycle.endDate).toBe('2026-08-27');
  });
});

describe('cycleDates — payCycleStartDay range validation (Req 10.1)', () => {
  test('throws RangeError when payCycleStartDay is 0', () => {
    expect(() => cycleDates(4, 2026, 0)).toThrow(RangeError);
  });

  test('throws RangeError when payCycleStartDay is 29', () => {
    expect(() => cycleDates(4, 2026, 29)).toThrow(RangeError);
  });

  test('throws RangeError when payCycleStartDay is 30', () => {
    expect(() => cycleDates(4, 2026, 30)).toThrow(RangeError);
  });

  test('throws RangeError when payCycleStartDay is 31', () => {
    expect(() => cycleDates(4, 2026, 31)).toThrow(RangeError);
  });

  test('throws RangeError when payCycleStartDay is negative', () => {
    expect(() => cycleDates(4, 2026, -1)).toThrow(RangeError);
  });

  test('throws RangeError when payCycleStartDay is non-integer', () => {
    expect(() => cycleDates(4, 2026, 21.5)).toThrow(RangeError);
  });

  test('accepts 1 (minimum boundary)', () => {
    expect(() => cycleDates(4, 2026, 1)).not.toThrow();
  });

  test('accepts 28 (maximum boundary)', () => {
    expect(() => cycleDates(4, 2026, 28)).not.toThrow();
  });
});

describe('cycleDates — Property 7: Pay cycle dates contiguous', () => {
  // Validates: Requirements 10.1, 10.2, 9.6 (Property 7)
  test('contiguous, gap-free, duplicate-free day list anchored to startDate / endDate', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 2024, max: 2030 }),
        fc.integer({ min: 1, max: 28 }),
        (monthIdx, year, startDay) => {
          const cycle = cycleDates(monthIdx, year, startDay);

          // First / last day must equal startDate / endDate.
          expect(cycle.days[0]).toBe(cycle.startDate);
          expect(cycle.days[cycle.days.length - 1]).toBe(cycle.endDate);

          // Every contiguous month-length range across 2024–2030 falls in [28, 31].
          expect(cycle.days.length).toBeGreaterThanOrEqual(28);
          expect(cycle.days.length).toBeLessThanOrEqual(31);

          // No duplicates.
          expect(new Set(cycle.days).size).toBe(cycle.days.length);

          // Each consecutive pair differs by exactly one calendar day.
          for (let i = 1; i < cycle.days.length; i++) {
            const prev = parseISO(cycle.days[i - 1]);
            const curr = parseISO(cycle.days[i]);
            expect(differenceInCalendarDays(curr, prev)).toBe(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
