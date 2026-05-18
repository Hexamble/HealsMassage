/**
 * Pay-cycle date arithmetic.
 *
 * A pay cycle is a contiguous range of business dates that aggregate into a
 * single payout. The shop pays on a configurable start day (default 21 per
 * `settings.pay_cycle_start_day`); a "May cycle" with start day 21 covers
 * `2026-04-21` through `2026-05-20`.
 *
 * Convention — `monthIdx` is the month the cycle ENDS in.
 *
 * That is, `monthIdx` labels the cycle by the month its endpoint sits in,
 * NOT the month it starts in. So:
 *
 *   cycleDates(4, 2026, 21)  // monthIdx = 4 (May, 0-based)
 *     → startDate = '2026-04-21'   (cycle STARTS in April)
 *       endDate   = '2026-05-20'   (cycle ENDS in May, hence monthIdx=4)
 *       days.length = 30
 *
 *   cycleDates(0, 2026, 21)  // January cycle
 *     → startDate = '2025-12-21'   (year rollover going backwards)
 *       endDate   = '2026-01-20'
 *
 *   cycleDates(11, 2026, 21) // December cycle
 *     → startDate = '2026-11-21'
 *       endDate   = '2026-12-20'   (no rollover)
 *
 * Algorithm:
 *   1. Validate `payCycleStartDay ∈ [1, 28]`. Throw `RangeError` otherwise.
 *      Per Requirement 10.1 only this range is meaningful — any month has
 *      ≥28 days, so the cycle boundary always exists and we never need to
 *      special-case Feb-29 / Apr-31.
 *   2. End is `(year, monthIdx, payCycleStartDay - 1)` inclusive.
 *   3. Start is `(year, monthIdx - 1, payCycleStartDay)`, rolling back to
 *      December of `year - 1` when `monthIdx === 0`.
 *   4. `days` is the full contiguous list of `yyyy-MM-dd` strings between
 *      `startDate` and `endDate` inclusive — no gaps, no duplicates.
 *
 * Pure function: no side effects, no I/O. Uses `date-fns` for date
 * arithmetic and UTC `Date` objects throughout to avoid timezone or DST
 * bias on the calendar math.
 *
 * @see Requirements 10.1, 10.2, 10.3, 9.6 (heals-system-rebuild/requirements.md)
 * @see Property 7 — Pay cycle dates contiguous (heals-system-rebuild/design.md)
 */

import { addDays, subDays } from 'date-fns';
import type { Cycle } from './types';

export type { Cycle } from './types';

/**
 * Format a UTC `Date` as `yyyy-MM-dd`. Reads UTC fields so callers don't
 * have to care about the local timezone of the runtime.
 */
function formatUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Compute the pay cycle that ENDS in the given month/year.
 *
 * @param monthIdx          0-based month index of the cycle's END month
 *                          (January = 0, December = 11).
 * @param year              Calendar year of the cycle's END month.
 * @param payCycleStartDay  Day-of-month [1, 28] on which each cycle begins.
 *                          Throws `RangeError` if outside this range or
 *                          not an integer.
 * @returns                 A {@link Cycle} with start/end dates and the full
 *                          contiguous day list.
 */
export function cycleDates(
  monthIdx: number,
  year: number,
  payCycleStartDay: number,
): Cycle {
  // Per Req 10.1, payCycleStartDay must be an integer in [1, 28]. The
  // 28 ceiling is what makes the calendar math safe across all months
  // (any month has at least 28 days, so the boundary always exists).
  if (
    !Number.isInteger(payCycleStartDay) ||
    payCycleStartDay < 1 ||
    payCycleStartDay > 28
  ) {
    throw new RangeError(
      `payCycleStartDay must be an integer in [1, 28]; got ${payCycleStartDay}`,
    );
  }

  // The cycle starts in the month BEFORE monthIdx. Roll back across the
  // year boundary when monthIdx === 0 (January cycle starts in December
  // of the previous calendar year).
  const startMonth = monthIdx === 0 ? 11 : monthIdx - 1;
  const startYear = monthIdx === 0 ? year - 1 : year;

  const startObj = new Date(
    Date.UTC(startYear, startMonth, payCycleStartDay),
  );

  // End is one day before payCycleStartDay of (year, monthIdx). Building
  // the (year, monthIdx, payCycleStartDay) anchor and subtracting one day
  // handles month-length differences (28/29/30/31) without special cases.
  const endObj = subDays(
    new Date(Date.UTC(year, monthIdx, payCycleStartDay)),
    1,
  );

  const startDate = formatUTC(startObj);
  const endDate = formatUTC(endObj);

  // Walk the range one day at a time, inclusive on both ends.
  const days: string[] = [];
  let current = startObj;
  while (current.getTime() <= endObj.getTime()) {
    days.push(formatUTC(current));
    current = addDays(current, 1);
  }

  return { monthIdx, year, startDate, endDate, days };
}
