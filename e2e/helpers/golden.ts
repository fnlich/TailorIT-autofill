/*
 * The golden "Alex Rivera" profile the mock serves (fixtures/profiles), as the specs check it: the values a fill
 * should write, and the free-text sentinels that must never reach a report, RunState, storage or a log. The sentinels
 * are read from the profile file itself, so they cannot drift from what the mock serves: names, contact, address,
 * links, institution, companies, titles, descriptions and skills, plus the golden resume's own marker and the start
 * of its bytes in base64 (a stored chunk would carry it).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AutofillProfile } from '../../src/contract/tailorit';
import { goldenResumeBytes } from '../mock-server/mock.mjs';

export const GOLDEN_PROFILE = JSON.parse(readFileSync(resolve('fixtures/profiles/alex-rivera.profile.json'), 'utf8')) as AutofillProfile;

/** What a fill writes from the golden profile, by the field it answers. */
export const GOLDEN = {
  first: GOLDEN_PROFILE.name.first,
  last: GOLDEN_PROFILE.name.last,
  full: `${GOLDEN_PROFILE.name.first} ${GOLDEN_PROFILE.name.last}`,
  email: GOLDEN_PROFILE.contact.email,
  phone: GOLDEN_PROFILE.contact.phone.number,
  /** The phone's digits, which is how a phone reads back. */
  phoneDigits: GOLDEN_PROFILE.contact.phone.number.replace(/\D/g, ''),
  city: GOLDEN_PROFILE.contact.address.city,
  skills: GOLDEN_PROFILE.skills,
  referral: GOLDEN_PROFILE.preferences.referralSource,
} as const;

/** The resume's marker: a stored or logged resume would carry it (e2e/mock-server/golden-resume.pdf). */
export const RESUME_MARKER = 'GOLDEN-RESUME-F7Q2';

/** Every free-text value of the golden profile that must stay out of reports, storage and logs. */
export function profileSentinels(): string[] {
  const p = GOLDEN_PROFILE;
  const values = [
    p.name.first, p.name.last, `${p.name.first} ${p.name.last}`,
    p.contact.email, p.contact.phone.number, GOLDEN.phoneDigits, GOLDEN.phoneDigits.slice(-7),
    p.contact.address.line1, p.contact.address.city, p.contact.address.postalCode,
    p.links.linkedin, p.links.github, p.links.portfolio,
    ...p.education.map((entry) => entry.institution.canonicalName),
    ...p.experience.flatMap((entry) => [entry.company, entry.title, entry.description]),
    ...p.skills,
    // The sentinel token every email, link and description of the profile carries.
    'f7q2',
    RESUME_MARKER,
    Buffer.from(goldenResumeBytes()).toString('base64').slice(0, 48),
  ];
  return [...new Set(values.filter((value) => value.trim().length >= 4))];
}
