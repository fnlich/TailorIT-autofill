/*
 * postedDaysAgo (TailorIT's audit D12): a date-only posting, kept as midnight UTC, is its calendar day, counted to the
 * person's local today; any other moment counts whole days of time, as before. The time zone is pinned to Los Angeles,
 * west of UTC, where raw milliseconds were a day off every evening.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postedDaysAgo } from './posted';

let zone: string | undefined;
beforeAll(() => {
  zone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
});
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

describe('postedDaysAgo', () => {
  it('reads the time zone it is pinned to', () => {
    // 2026-11-06T01:30Z is 17:30 on 5 November in Los Angeles (PST, UTC-8).
    expect(new Date(Date.UTC(2026, 10, 6, 1, 30)).getDate()).toBe(5);
  });

  it('counts a date-only posting by calendar days to the person’s local today', () => {
    const posted = Date.parse('2026-11-02T00:00:00.000Z');
    // 5 November, 17:30 PST: three calendar days after 2 November (raw milliseconds said four).
    expect(postedDaysAgo(posted, Date.UTC(2026, 10, 6, 1, 30))).toBe(3);
    // The morning of the same local day, and the last minute of it, say the same.
    expect(postedDaysAgo(posted, Date.UTC(2026, 10, 5, 16, 0))).toBe(3);
    expect(postedDaysAgo(posted, Date.UTC(2026, 10, 6, 7, 59))).toBe(3);
    // Local midnight starts the next day.
    expect(postedDaysAgo(posted, Date.UTC(2026, 10, 6, 8, 0))).toBe(4);
    // Its own day, even the evening before it in Los Angeles: today, never a negative count.
    expect(postedDaysAgo(posted, Date.UTC(2026, 10, 2, 9, 0))).toBe(0);
    expect(postedDaysAgo(posted, Date.UTC(2026, 10, 2, 1, 0))).toBe(0);
  });

  it('keeps whole days of time for a posting with a time of day', () => {
    const posted = Date.parse('2026-11-02T15:45:00.000Z');
    expect(postedDaysAgo(posted, Date.UTC(2026, 10, 6, 1, 30))).toBe(3);
    expect(postedDaysAgo(posted, Date.UTC(2026, 10, 5, 15, 44))).toBe(2);
    expect(postedDaysAgo(posted, Date.UTC(2026, 10, 1))).toBe(0);
  });
});
