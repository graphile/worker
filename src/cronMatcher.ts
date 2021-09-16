import { ParsedCronItem, TimestampDigest } from "./interfaces";

/**
 * Returns true if the cronItem should fire for the given timestamp digest,
 * false otherwise.
 */
export function cronItemMatches(
  cronItem: ParsedCronItem,
  digest: TimestampDigest,
): boolean {
  const { min, hour, date, month, dow } = digest;

  if (
    // If minute, hour and month match
    cronItem.minutes.includes(min) &&
    cronItem.hours.includes(hour) &&
    cronItem.months.includes(month)
  ) {
    const dateIsExclusionary = cronItem.dates.length !== 31;
    const dowIsExclusionary = cronItem.dows.length !== 7;
    if (dateIsExclusionary && dowIsExclusionary) {
      // Cron has a special behaviour: if both date and day of week are
      // exclusionary (i.e. not "*") then a match for *either* passes.
      return cronItem.dates.includes(date) || cronItem.dows.includes(dow);
    } else if (dateIsExclusionary) {
      return cronItem.dates.includes(date);
    } else if (dowIsExclusionary) {
      return cronItem.dows.includes(dow);
    } else {
      return true;
    }
  }
  return false;
}
