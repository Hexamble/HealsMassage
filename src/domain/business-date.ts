/**
 * Business-date computation with the 5 AM Asia/Kuala_Lumpur cutoff.
 *
 * Sessions that finish before 5 AM KL belong to the previous calendar day's books.
 * The same rule is applied identically on every read and every write (cashier push,
 * salary attribution, "today" dashboards), so a 02:30 AM Tuesday row lands on
 * Monday's business date everywhere consistently.
 *
 * Algorithm (from design.md `getBusinessDate` pseudocode):
 *   1. Format `now` in the target timezone to extract `yyyy-MM-dd` and `HH`.
 *   2. If the KL hour is >= 5, return the KL calendar date.
 *   3. Otherwise, return the previous calendar date.
 *
 * Day subtraction is done in pure UTC date-arithmetic space (treating `yyyy-MM-dd`
 * as a plain calendar date) so DST or timezone shifts can never bias the result.
 *
 * Pure function: no side effects, no I/O. Only depends on `date-fns` and
 * `date-fns-tz`.
 *
 * @see Requirements 4.1, 4.2, 4.3, 4.4, 4.5 (heals-system-rebuild/requirements.md)
 * @see Requirements 16.1, 16.2, 16.4 (salary-system-rebuild/requirements.md)
 * @see Property 1 — Business date 5 AM cutoff (heals-system-rebuild/design.md)
 */

import { subDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

const DEFAULT_TZ = 'Asia/Kuala_Lumpur';

/**
 * Compute the business date (yyyy-MM-dd) for a given moment, applying the
 * 5 AM Asia/Kuala_Lumpur cutoff rule.
 *
 * @param now The current moment as a `Date`.
 * @param tz  IANA timezone identifier. Defaults to `'Asia/Kuala_Lumpur'`.
 * @returns   Business date as a `yyyy-MM-dd` string (exactly 10 characters).
 */
export function getBusinessDate(now: Date, tz: string = DEFAULT_TZ): string {
  const klDate = formatInTimeZone(now, tz, 'yyyy-MM-dd');
  const klHour = parseInt(formatInTimeZone(now, tz, 'HH'), 10);

  if (klHour >= 5) {
    return klDate;
  }

  // Subtract one calendar day in pure UTC date space. Constructing a Date at
  // UTC midnight from the (already TZ-resolved) klDate parts means subDays
  // operates on a clean calendar day with no DST or TZ-shift risk.
  const [yearStr, monthStr, dayStr] = klDate.split('-');
  const utcMidnight = new Date(
    Date.UTC(
      parseInt(yearStr, 10),
      parseInt(monthStr, 10) - 1,
      parseInt(dayStr, 10),
    ),
  );
  const previous = subDays(utcMidnight, 1);

  const y = previous.getUTCFullYear();
  const m = String(previous.getUTCMonth() + 1).padStart(2, '0');
  const d = String(previous.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
