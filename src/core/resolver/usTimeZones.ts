/*
 * jr6 RULES R3 (FIXPLAN §6.3 item 48: ICIMS-26, ARS's required "Time Zone"; JV-16, VHL's "Do you currently reside in a
 * state located within the Eastern US Time Zone?"): the US time zone of each state, public facts. A state that spans
 * two zones has its larger part's first and the other second (Texas: Central, El Paso's corner Mountain), so an answer
 * read from it is flagged. Pure data: nothing about the person is here.
 */

/** The US time zones a state's time is kept in. */
export const US_TIME_ZONES = ['eastern', 'central', 'mountain', 'pacific', 'alaska', 'hawaii'] as const;
export type UsTimeZone = (typeof US_TIME_ZONES)[number];

const E = 'eastern';
const C = 'central';
const M = 'mountain';
const P = 'pacific';

/** Each state's (and DC's) zones, by its USPS code: its larger part's first, a second for a state that spans two. */
const STATE_ZONES: Readonly<Record<string, readonly [UsTimeZone, UsTimeZone?]>> = {
  AL: [C], AK: ['alaska', 'hawaii'], AZ: [M], AR: [C], CA: [P], CO: [M], CT: [E], DE: [E], DC: [E], FL: [E, C],
  GA: [E], HI: ['hawaii'], ID: [M, P], IL: [C], IN: [E, C], IA: [C], KS: [C, M], KY: [E, C], LA: [C], ME: [E], MD: [E],
  MA: [E], MI: [E, C], MN: [C], MS: [C], MO: [C], MT: [M], NE: [C, M], NV: [P, M], NH: [E], NJ: [E], NM: [M], NY: [E],
  NC: [E], ND: [C, M], OH: [E], OK: [C], OR: [P, M], PA: [E], RI: [E], SC: [E], SD: [C, M], TN: [C, E], TX: [C, M],
  UT: [M], VT: [E], VA: [E], WA: [P], WV: [E], WI: [C], WY: [M],
};

/** A state's zones (its larger part's first), or null for a code that is no US state. */
export function zonesOfState(code: string): readonly UsTimeZone[] | null {
  const zones = STATE_ZONES[code.trim().toUpperCase()];
  return zones === undefined ? null : zones.filter((zone): zone is UsTimeZone => zone !== undefined);
}

/** How lists write each zone, the first the one a text box takes. */
export const ZONE_SPELLINGS: Readonly<Record<UsTimeZone, readonly [string, ...string[]]>> = {
  eastern: ['Eastern Time', 'Eastern', 'Eastern Time (ET)', 'Eastern Time (US & Canada)', 'Eastern Standard Time',
    'EST', 'ET', 'EST/EDT', 'US/Eastern', 'America/New_York'],
  central: ['Central Time', 'Central', 'Central Time (CT)', 'Central Time (US & Canada)', 'Central Standard Time',
    'CST', 'CT', 'CST/CDT', 'US/Central', 'America/Chicago'],
  mountain: ['Mountain Time', 'Mountain', 'Mountain Time (MT)', 'Mountain Time (US & Canada)',
    'Mountain Standard Time', 'MST', 'MT', 'MST/MDT', 'US/Mountain', 'America/Denver'],
  pacific: ['Pacific Time', 'Pacific', 'Pacific Time (PT)', 'Pacific Time (US & Canada)', 'Pacific Standard Time',
    'PST', 'PT', 'PST/PDT', 'US/Pacific', 'America/Los_Angeles'],
  alaska: ['Alaska Time', 'Alaska', 'Alaska Time (AKT)', 'Alaska Standard Time', 'AKST', 'US/Alaska',
    'America/Anchorage'],
  hawaii: ['Hawaii Time', 'Hawaii', 'Hawaii-Aleutian Time', 'Hawaii Standard Time', 'HST', 'US/Hawaii',
    'Pacific/Honolulu'],
};
