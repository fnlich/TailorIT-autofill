/*
 * "Posted N days ago" on the side panel's job card (JobCard.tsx). TailorIT keeps a posting date the source gave as a day
 * alone (a Workday start date, a CSV column of days) as exactly midnight UTC ("YYYY-MM-DDT00:00:00.000Z"), and its web
 * reads such a value as that calendar day (TailorIT's audit, D12). So does the card: a date at midnight UTC counts the
 * calendar days from that UTC date to the person's own local today, so a person west of UTC sees the same day count
 * all evening; any other moment counts whole days of time since it, as before.
 */

const DAY_MS = 86_400_000;

/** How many days ago a job was posted (`postedAt`, ms since the epoch), seen at `now`; never below 0. */
export function postedDaysAgo(postedAt: number, now: number): number {
  if (postedAt % DAY_MS === 0) {
    // A date-only posting: its calendar day, against the person's local calendar day.
    const today = new Date(now);
    const localToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.max(0, Math.round((localToday - postedAt) / DAY_MS));
  }
  return Math.max(0, Math.floor((now - postedAt) / DAY_MS));
}
