import { describe, expect, it } from 'vitest';
import { goldenProfile, NOW, specOf, vocab } from '../plan/plan.testkit';
import type { FieldKind } from '../enums';
import type { FieldSpec } from '../types/field';
import type { FieldCategory } from '../types/intent';
import type { ExperienceEntry, Profile } from '../types/profile';
import type { ValueResult } from './candidate';
import { ANSWERABLE_PROFILE_CATEGORIES } from './categories';
import { addWeeks, NO_VALUE_PLACEHOLDERS, placeholderAsked, profileValue, yearsOfExperience } from './values';

const profile = goldenProfile();
const valueOf = (category: FieldCategory, spec: FieldSpec, of: Profile = profile, separatePhoneCountry = false) =>
  profileValue(category, { spec, profile: of, vocab, now: NOW, separatePhoneCountry });
const candidate = (result: ValueResult) => {
  if (!result.ok) throw new Error(`no value: ${result.none.reason}`);
  return result.candidate;
};
const field = (label: string, kind: FieldKind = 'text', extra: Partial<FieldSpec> = {}) => specOf(label, kind, extra);

describe('identity and contact (§8.5)', () => {
  it('takes the names as given, a missing preferred name being the first name', () => {
    expect(candidate(valueOf('identity.firstName', field('First name')))).toMatchObject({ text: 'Alex', confidence: 1,
      origin: { provenance: 'profile', path: 'identity.firstName' } });
    expect(candidate(valueOf('identity.preferredName', field('Preferred name')))).toMatchObject({ text: 'Alex',
      origin: { path: 'identity.firstName' } });
    expect(valueOf('identity.middleName', field('Middle name'))).toEqual({ ok: false,
      none: { reason: 'no-profile-value', flagged: false } });
  });

  it('lays a phone number out for the field (phone.format), its digits unchanged', () => {
    expect(candidate(valueOf('contact.phone', field('Phone')))).toMatchObject({ text: '+1 512 555 0147', confidence: 1,
      origin: { path: 'contact.phone' } });
    expect(candidate(valueOf('contact.phone', field('Phone', 'text', { constraints: { pattern: '(###) ###-####' } }))))
      .toMatchObject({ text: '(512) 555-0147', confidence: 0.97, origin: { transform: 'phone.format' } });
    expect(candidate(valueOf('contact.phone', field('Phone'), profile, true))).toMatchObject({ text: '512 555 0147' });
    expect(candidate(valueOf('contact.phoneCountry', field('Country code', 'select')))).toMatchObject({ text: '+1',
      choice: { domain: 'country', intended: { id: 'iso:US' } } });
  });
});

describe('places', () => {
  it('composes "City, ST" for the current location (location.compose)', () => {
    expect(candidate(valueOf('location.current', field('Current location')))).toMatchObject({ text: 'Austin, TX',
      confidence: 0.97, origin: { provenance: 'profile', path: 'address', transform: 'location.compose' } });
  });

  it('gives a region and a country as text and as entities', () => {
    expect(candidate(valueOf('address.region', field('State')))).toMatchObject({ text: 'TX',
      choice: { domain: 'region', intended: { id: 'usps:TX' } } });
    expect(candidate(valueOf('address.country', field('Country')))).toMatchObject({ text: 'United States',
      choice: { domain: 'country', intended: { id: 'iso:US' } } });
  });
});

describe('education and work', () => {
  it('uses the block’s entry in a repeatable section, else the most recent', () => {
    expect(candidate(valueOf('education.school', field('School', 'select')))).toMatchObject({
      text: 'The University of Texas at Austin', origin: { path: 'education[0].institution' },
      choice: { domain: 'institution', intended: { id: 'ipeds:228778' } } });
    expect(valueOf('education.school', field('School', 'text', { section: { id: 'education', block: 1 } })).ok)
      .toBe(false);
    expect(candidate(valueOf('experience.company', field('Company', 'text', { section: { id: 'experience', block: 1 } }))))
      .toMatchObject({ text: 'Marrowgate Systems', origin: { path: 'experience[1].company' } });
  });

  it('gives the degree with its field of study, and the highest completed one (education.highest-completed)', () => {
    expect(candidate(valueOf('education.degree', field('Degree', 'select')))).toMatchObject({ text: 'Bachelor of Science',
      choice: { domain: 'degree', intended: { kind: 'degree', level: 'bachelor', type: 'BS' },
        degreeField: { cip: '11.0701' } } });
    expect(candidate(valueOf('education.highestLevel', field('Highest level of education', 'select')))).toMatchObject({
      confidence: 0.97, origin: { path: 'education[0].degree', transform: 'education.highest-completed' } });
    const studying: Profile = { ...profile, education: [{ ...profile.education[0]!, inProgress: true }] };
    expect(valueOf('education.highestLevel', field('Highest degree', 'select'), studying).ok).toBe(false);
  });

  it('takes the current job for the current employer, and never fills a current job’s end date', () => {
    expect(candidate(valueOf('experience.currentCompany', field('Current company')))).toMatchObject({
      text: 'Quillfeather Labs', origin: { path: 'experience[0].company' } });
    expect(valueOf('experience.endDate', field('End date', 'text', { section: { id: 'experience', block: 0 } })))
      .toEqual({ ok: false, none: { reason: 'end-date-not-applicable', flagged: false } });
    expect(candidate(valueOf('experience.endDate', field('End date', 'text', { section: { id: 'experience',
      block: 1 } })))).toMatchObject({ date: { y: 2021, m: 5 } });
  });

  it('ticks "I currently work here" only for a current entry (experience.current-checkbox)', () => {
    const box = (block: number) => field('I currently work here', 'checkbox', { section: { id: 'experience', block } });
    expect(candidate(valueOf('experience.current', box(0)))).toMatchObject({ check: true,
      origin: { provenance: 'rule', ruleId: 'experience.current-checkbox', path: 'experience[0].current' } });
    expect(candidate(valueOf('experience.current', box(1)))).toMatchObject({ check: false });
  });

  it('counts the years of experience from the entries, overlaps once (years.from-experience)', () => {
    expect(candidate(valueOf('experience.totalYears', field('Years of experience')))).toMatchObject({ text: '7',
      confidence: 0.85, origin: { provenance: 'rule', ruleId: 'years.from-experience', path: 'experience' },
      choice: { domain: 'number', intended: { kind: 'number', unit: 'years' } } });
    const job = (start: [number, number], end: [number, number] | null): ExperienceEntry => ({ company: 'c', title: 't',
      startDate: { y: start[0], m: start[1] }, ...(end ? { endDate: { y: end[0], m: end[1] } } : {}), current: end === null });
    expect(yearsOfExperience([job([2020, 1], [2022, 1]), job([2021, 1], [2023, 1])], NOW)).toBe(3);
    expect(yearsOfExperience([job([2026, 4], null)], NOW)).toBe(0.5);
    expect(yearsOfExperience([], NOW)).toBeNull();
  });
});

describe('sets', () => {
  it('gives several values as a set, joined for a text box, and one answer only when there is one', () => {
    const skills = candidate(valueOf('skills.list', field('Skills', 'checkbox-group')));
    expect(skills.set?.map((choice) => choice.intended)).toEqual([{ kind: 'text', text: 'TypeScript' },
      { kind: 'text', text: 'PostgreSQL' }, { kind: 'text', text: 'Kubernetes' }]);
    expect(candidate(valueOf('skills.list', field('Skills', 'textarea'))).text).toBe('TypeScript, PostgreSQL, Kubernetes');
    expect(valueOf('languages.language', field('Language', 'select'))).toEqual({ ok: false,
      none: { reason: 'ambiguous-options', flagged: true } });
    expect(candidate(valueOf('languages.language', field('Language', 'select', { section: { id: 'languages',
      block: 1 } })))).toMatchObject({ text: 'Spanish', choice: { domain: 'language', intended: { id: 'lang:es' } } });
  });

  it('reads the language a proficiency question names', () => {
    expect(candidate(valueOf('languages.proficiency', field('Spanish proficiency', 'select')))).toMatchObject({
      origin: { path: 'languages[1].proficiency' }, choice: { intended: { id: 'prof:professional-working' } } });
    expect(valueOf('languages.proficiency', field('Proficiency', 'select')).ok).toBe(false);
  });
});

describe('the rest of the table', () => {
  it('names the referral source by its vocabulary entity', () => {
    expect(candidate(valueOf('referral.source', field('How did you hear about us?', 'select')))).toMatchObject({
      text: 'LinkedIn', choice: { domain: 'referral', intended: { id: 'ref:linkedin' } } });
  });

  it('gives an upload the resume only when the profile has one', () => {
    expect(candidate(valueOf('file.resume', field('Resume', 'file')))).toMatchObject({ file: 'resume',
      origin: { provenance: 'profile', path: 'resume' } });
    expect(valueOf('file.resume', field('Resume', 'file'), goldenProfile({ resume: false })))
      .toEqual({ ok: false, none: { reason: 'resume-unavailable', flagged: true } });
    expect(valueOf('file.coverLetter', field('Cover letter', 'file')).ok).toBe(false);
  });

  it("gives a cover-letter upload the run's letter only once the worker attached it (Phase G), never the resume", () => {
    const withLetter: Profile = { ...profile, coverLetter: { aiWritten: true } };
    expect(candidate(valueOf('file.coverLetter', field('Cover letter', 'file'), withLetter))).toMatchObject({
      file: 'cover-letter', origin: { provenance: 'profile', path: 'coverLetter' } });
    expect(valueOf('file.coverLetter', field('Cover letter', 'file'), profile))
      .toEqual({ ok: false, none: { reason: 'no-profile-value', flagged: true } });
    expect(valueOf('file.other', field('Portfolio', 'file'), withLetter).ok).toBe(false);
  });

  it('dates a start from a notice period (availability.from-notice), and never converts pay between periods', () => {
    const notice: Profile = { ...profile, preferences: { startDate: { kind: 'notice', weeks: 2 } } };
    expect(candidate(valueOf('availability.startDate', field('When can you start?'), notice))).toMatchObject({
      date: { y: 2026, m: 11, d: 13 }, confidence: 0.85, origin: { ruleId: 'availability.from-notice' } });
    expect(addWeeks({ y: 2026, m: 12, d: 25 }, 2)).toEqual({ y: 2027, m: 1, d: 8 });
    expect(addWeeks({ y: 2028, m: 2, d: 22 }, 1)).toEqual({ y: 2028, m: 2, d: 29 });
    const pay: Profile = { ...profile, preferences: { expectedSalary: { kind: 'value', value: { min: 65,
      currency: 'USD', period: 'hour' } } } };
    expect(valueOf('salary.expected', field('Expected annual salary'), pay)).toEqual({ ok: false,
      none: { reason: 'format-unsupported', flagged: true } });
    expect(candidate(valueOf('salary.expected', field('Desired hourly rate'), pay))).toMatchObject({ text: '65',
      choice: { intended: { kind: 'number', value: 65, unit: 'currency-hour' } } });
  });

  // CORE-8 (Phase 2 review): pay was checked for its period only, so 120000 US dollars was written into a question
  // that asks in pounds, in euros or in thousands.
  it('never writes pay in a currency or a unit the question does not take', () => {
    const payIn = (currency: string): Profile => ({ ...profile, preferences: { expectedSalary: { kind: 'value',
      value: { min: 120000, currency, period: 'year' } } } });
    const unsupported = { ok: false, none: { reason: 'format-unsupported', flagged: true } };
    for (const label of ['Expected annual salary (GBP)', 'Expected salary in EUR', 'Desired salary (\u{00A3})',
      'Expected salary in \u{20AC}', 'Expected CTC (INR)', 'Expected salary (in thousands)', 'Expected salary (k)',
      'Salary expectations ($K)', 'Expected salary, e.g. 120k', 'Expected salary in lakhs', 'Expected salary (000s)',
      'Expected salary in Canadian dollars', 'Expected salary (C$)']) {
      expect(valueOf('salary.expected', field(label), payIn('USD')), label).toEqual(unsupported);
    }
    expect(valueOf('salary.expected', field('Expected salary', 'text', { description: 'Please answer in euros.' }),
      payIn('USD'))).toEqual(unsupported);
    expect(valueOf('salary.expected', field('Expected salary (USD)'), payIn('CAD'))).toEqual(unsupported);
    // The opposites: the currency the person stated, a sign several currencies share, no currency at all.
    for (const label of ['Expected annual salary (USD)', 'Expected salary in US dollars', 'Desired salary ($)',
      'Expected salary (US$)', 'Expected salary', 'Expected salary (USD or EUR)', 'Expected salary (excluding 401k)']) {
      expect(candidate(valueOf('salary.expected', field(label), payIn('USD'))), label).toMatchObject({ text: '120000' });
    }
    expect(candidate(valueOf('salary.expected', field('Desired salary ($)'), payIn('CAD')))).toMatchObject({
      text: '120000' });
    expect(candidate(valueOf('salary.expected', field('Expected salary (GBP)'), payIn('GBP')))).toMatchObject({
      text: '120000' });
  });
});

// ── s2 core-gh (snapshot round 2) ─────────────────────────────────────────────────────────────────────────────────
describe('s2 core-gh: the N/A an instruction asks for (decision 8)', () => {
  it.each<[string, string | null]>([
    // Screenshot 7 of 2026-11-07.
    ["X username (If you don't have a profile, please type N/A)", 'N/A'],
    ["Telegram username (If you don’t have a profile, please type “N/A”)", 'N/A'],
    ['Middle name (N/A if none)', 'N/A'],
    ['GitHub (type NA if not applicable)', 'NA'],
    ['Portfolio link (if none, write None)', 'None'],
    ["Twitter handle (if you do not have one, enter 'n/a')", 'N/A'],
    // No instruction, or one naming no placeholder of ours: the page's characters are never copied.
    ['Telegram username', null],
    ['X username (if you do not have one, write "banana42")', null],
    ['Website (N/A)', null],
  ])('%j asks for %j', (label, expected) => {
    expect(placeholderAsked({ label, description: '', labelVisible: true })).toBe(expected);
  });

  it('reads the help text, and never a label nobody sees', () => {
    expect(placeholderAsked({ label: 'Telegram', description: "If you don't have one, please type N/A.",
      labelVisible: true })).toBe('N/A');
    expect(placeholderAsked({ label: "Telegram (If you don't have one, type N/A)", description: '',
      labelVisible: false })).toBeNull();
  });

  it('chooses only from its own list', () => {
    expect(NO_VALUE_PLACEHOLDERS).toEqual(['N/A', 'NA', 'None']);
  });
});

describe('s2 core-gh: links (decisions 9 and 11)', () => {
  const linked: Profile = { ...profile, links: { ...profile.links, website: '', x: 'https://x.com/rivera_dev',
    telegram: '@rivera_dev42' } };
  it('gives a username box the handle, an "@" box "@handle", a URL box the link', () => {
    expect(candidate(valueOf('links.twitter', field('X username'), linked))).toMatchObject({ text: 'rivera_dev',
      origin: { path: 'links.x', transform: 'link.handle' } });
    expect(candidate(valueOf('links.twitter', field('X handle (@)'), linked)).text).toBe('@rivera_dev');
    expect(candidate(valueOf('links.twitter', field('Twitter URL'), linked)).text).toBe('https://x.com/rivera_dev');
    expect(candidate(valueOf('links.telegram', field('Telegram username'), linked)).text).toBe('rivera_dev42');
  });

  it('reads an X or Telegram link kept among the other links by its host', () => {
    const other: Profile = { ...profile, links: { ...profile.links, other: [{ label: 'Telegram', url: 'https://t.me/rivera_dev42' }] } };
    expect(candidate(valueOf('links.telegram', field('Telegram username'), other))).toMatchObject({ text: 'rivera_dev42',
      origin: { path: 'links.other[0].url' } });
    expect(valueOf('links.twitter', field('X username'), other)).toMatchObject({ ok: false });
  });

  it('fills a website with the portfolio, never GitHub or LinkedIn', () => {
    expect(candidate(valueOf('links.website', field('Website'), linked))).toMatchObject({ text: profile.links.portfolio,
      origin: { path: 'links.portfolio', transform: 'links.website-from-portfolio' } });
    const bare: Profile = { ...linked, links: { ...linked.links, portfolio: '' } };
    expect(valueOf('links.website', field('Website'), bare)).toMatchObject({ ok: false });
  });
});

// ── s2 core-gh review (C4, C6) ──
describe('s2 core-gh review (C4): certifications', () => {
  const certified: Profile = { ...profile, certifications: [{ name: 'AWS Certified Solutions Architect' },
    { name: 'PMP' }] };
  it('answers the generic question with every certification, one about a field only with those its words name', () => {
    expect(candidate(valueOf('skills.certifications', field('Do you hold any industry related certifications?'),
      certified)).text).toBe('AWS Certified Solutions Architect; PMP');
    expect(candidate(valueOf('skills.certifications', field('Do you hold any certifications in AWS?'), certified)).text)
      .toBe('AWS Certified Solutions Architect');
    // None matching, or none stored: no profile answer, for the AI to answer as before this round.
    expect(valueOf('skills.certifications', field('Do you have any certifications related to project management?'),
      certified)).toMatchObject({ ok: false, none: { reason: 'no-profile-value' } });
    expect(valueOf('skills.certifications', field('Do you hold any industry related certifications?'), profile))
      .toMatchObject({ ok: false, none: { reason: 'no-profile-value' } });
    expect(ANSWERABLE_PROFILE_CATEGORIES.has('skills.certifications')).toBe(true);
  });
});

describe('s2 core-gh review (C6): a box that names both Telegram and X', () => {
  const label = "Telegram/X username (If you don't have a profile, please type N/A)";
  it('takes Telegram, then X as a handle, and nothing with neither (the N/A follows: resolve.ts)', () => {
    const both: Profile = { ...profile, links: { ...profile.links, x: 'https://x.com/rivera_dev',
      telegram: 'https://t.me/rivera_dev42' } };
    const onlyX: Profile = { ...profile, links: { ...profile.links, x: 'https://x.com/rivera_dev' } };
    expect(candidate(valueOf('links.telegram', field(label), both)).text).toBe('rivera_dev42');
    expect(candidate(valueOf('links.telegram', field(label), onlyX))).toMatchObject({ text: 'rivera_dev',
      origin: { path: 'links.x', transform: 'link.handle' } });
    expect(valueOf('links.telegram', field(label), profile)).toMatchObject({ ok: false,
      none: { reason: 'no-profile-value' } });
  });
});
