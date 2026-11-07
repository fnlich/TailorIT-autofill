import { describe, expect, it } from 'vitest';
import { CAUTIOUS_SETTINGS, fieldOf, goldenProfile, planOf, settingsWith, specOf, vocab } from '../plan/plan.testkit';
import type { Explicit, Profile } from '../types/profile';
import { CONSENT_CATEGORIES } from '../enums';
import { DEFAULT_SETTINGS, type Settings } from '../types/settings';
import type { ValueResult } from './candidate';
import { classifyByRules } from './classifyRules';
import {
  combinedSponsorship, consentValue, countriesNamed, eeoValue, legalValue, placesNamed, postingCountryOf,
  SENSITIVE_PART_CATEGORIES,
  sensitiveGate,
} from './policy';

const yes: Explicit<boolean> = { kind: 'value', value: true };
const no: Explicit<boolean> = { kind: 'value', value: false };
const decline: Explicit<boolean> = { kind: 'decline' };
const candidate = (result: ValueResult) => (result.ok ? result.candidate : null);
const reason = (result: ValueResult) => (result.ok ? null : result.none.reason);

describe('the combined sponsorship rule (legal.sponsorship-combined)', () => {
  it.each<[Explicit<boolean> | undefined, Explicit<boolean> | undefined, Explicit<boolean> | undefined]>([
    [yes, no, yes], [no, yes, yes], [yes, undefined, yes], [yes, decline, yes],
    [no, no, no],
    [decline, no, decline], [no, decline, decline], [decline, undefined, decline],
    [no, undefined, undefined], [undefined, undefined, undefined],
  ])('now %j and in the future %j give %j', (now, future, combined) => {
    expect(combinedSponsorship(now, future)).toEqual(combined);
  });
});

describe('countriesNamed', () => {
  it('reads the countries a question names, a short spelling only in capitals', () => {
    expect(countriesNamed('Are you legally authorized to work in the United States?', vocab)).toEqual(['US']);
    expect(countriesNamed('Are you authorized to work in the U.S.?', vocab)).toEqual(['US']);
    expect(countriesNamed('Are you authorized to work in the US or Canada?', vocab).sort()).toEqual(['CA', 'US']);
    expect(countriesNamed('Are you authorized to work for us?', vocab)).toEqual([]);
    expect(countriesNamed('Are you legally authorized to work?', vocab)).toEqual([]);
  });

  // CORE-13 (Phase 2 review): a country's name inside a region's or a city's was read as the country ("New Mexico" as
  // Mexico, "New Jersey" and "Jersey City" as Jersey), and a name a country shares with a state ("Georgia") as the
  // country, so a legal question could be answered from the wrong country's entry.
  it('reads no country inside a region’s or a city’s name, and none from a name a region shares', () => {
    for (const text of ['Are you authorized to work in New Mexico?', 'Are you legally authorized to work in New Jersey?',
      'Can you legally work in Jersey City?']) {
      expect(placesNamed(text, vocab), text).toEqual({ countries: [], ambiguous: false });
    }
    expect(placesNamed('Are you authorized to work in Georgia?', vocab)).toEqual({ countries: [], ambiguous: true });
    expect(placesNamed('Are you authorized to work in the US or Georgia?', vocab))
      .toEqual({ countries: ['US'], ambiguous: true });
    // The opposites: the country itself, and a city inside it.
    expect(countriesNamed('Are you authorized to work in Mexico?', vocab)).toEqual(['MX']);
    expect(countriesNamed('Are you authorized to work in Mexico City?', vocab)).toEqual(['MX']);
    expect(countriesNamed('Are you authorized to work in Jersey?', vocab)).toEqual(['JE']);
    expect(countriesNamed('Are you authorized to work in New Zealand?', vocab)).toEqual(['NZ']);
  });

  it('never answers a question about a region from the entry of the country inside its name', () => {
    const profile = goldenProfile();
    const abroad: Profile = { ...profile, workAuthorization: [
      { country: 'US', authorized: { kind: 'value', value: false } },
      ...(['MX', 'JE', 'GE'] as const).map((country) => ({ country, authorized: yes })),
    ] };
    for (const label of ['Are you legally authorized to work in New Mexico?', 'Are you authorized to work in New Jersey?',
      'Are you legally authorized to work in Jersey City?', 'Are you legally authorized to work in Georgia?']) {
      const result = legalValue('workAuth.authorized', specOf(label, 'radio', { optionLabels: ['Yes', 'No'] }), abroad,
        vocab, { settings: DEFAULT_SETTINGS });
      expect(reason(result), label).toBe('work-auth-country-unknown');
    }
  });
});

describe('the sensitive part’s gate', () => {
  it('asks for the part, or leaves the field blank and flagged, until it is loaded', () => {
    expect(sensitiveGate('eeo.gender', 'loaded')).toBe('ready');
    expect(sensitiveGate('eeo.gender', 'not-loaded')).toBe('fetch');
    expect(reason(sensitiveGate('screening.over18', 'not-shared') as ValueResult)).toBe('sensitive-not-shared');
    expect(reason(sensitiveGate('identity.pronouns', 'unavailable') as ValueResult)).toBe('sensitive-unavailable');
    expect(sensitiveGate('identity.firstName', 'not-loaded')).toBe('ready');
    // Questions neither part answers never need it.
    for (const category of ['workAuth.visaType', 'eeo.sexualOrientation'] as const) {
      expect(SENSITIVE_PART_CATEGORIES.has(category), category).toBe(false);
    }
    // Criminal history is answered once in TailorIT's sensitive part since the owner's amendments.
    expect(SENSITIVE_PART_CATEGORIES.has('screening.criminalHistory')).toBe(true);
    expect(reason(sensitiveGate('screening.criminalHistory', 'not-shared') as ValueResult)).toBe('sensitive-not-shared');
  });
});

describe('legal values (§8.7)', () => {
  const profile = goldenProfile();
  // Interpretation 1 off: a question's own words name its country.
  const LEGAL = { settings: CAUTIOUS_SETTINGS };
  const radio = (label: string) => specOf(label, 'radio', { optionLabels: ['Yes', 'No'] });
  const legal = (category: Parameters<typeof legalValue>[0], label: string, of: Profile = profile,
    context: Parameters<typeof legalValue>[4] = LEGAL) => legalValue(category, radio(label), of, vocab, context);

  it('answers from the entry of the country the question names', () => {
    expect(candidate(legal('workAuth.authorized', 'Are you legally authorized to work in the United States?')))
      .toMatchObject({ origin: { provenance: 'profile', path: 'workAuthorization[0].authorized' },
        choice: { intended: { kind: 'boolean', value: true }, domain: 'polarity' }, check: true, confidence: 1 });
    expect(candidate(legal('workAuth.sponsorshipNow', 'Do you currently require sponsorship in the US?'))?.choice
      ?.intended).toEqual({ kind: 'boolean', value: false });
  });

  it('gives the combined question its rule as the transform', () => {
    expect(candidate(legal('workAuth.sponsorship', 'Will you now or in the future require sponsorship to work in the '
      + 'United States?'))).toMatchObject({ origin: { provenance: 'profile', path: 'workAuthorization[0]',
      transform: 'legal.sponsorship-combined' }, choice: { intended: { kind: 'boolean', value: false } } });
  });

  it('leaves a question that names no country, several, or one the profile lacks blank and flagged', () => {
    expect(reason(legal('workAuth.authorized', 'Are you legally authorized to work?'))).toBe('work-auth-country-unknown');
    expect(reason(legal('workAuth.authorized', 'Authorized to work in the US or Canada?')))
      .toBe('work-auth-country-unknown');
    expect(reason(legal('workAuth.authorized', 'Are you authorized to work in Canada?'))).toBe('legal-not-in-profile');
  });

  it('reads the posting’s country for a question naming none only under interpretation 1, flagged', () => {
    const on = { settings: settingsWith({ interpretations: { postingCountryForLegal: true, twoOrMoreRaces: false,
      eeoDeclineByDefault: false } }),
      postingCountry: 'US' };
    expect(reason(legal('workAuth.authorized', 'Are you legally authorized to work?', profile,
      { settings: CAUTIOUS_SETTINGS, postingCountry: 'US' }))).toBe('work-auth-country-unknown');
    expect(candidate(legal('workAuth.authorized', 'Are you legally authorized to work?', profile, on))).toMatchObject({
      origin: { path: 'workAuthorization[0].authorized', transform: 'legal.posting-country' }, confidence: 0.776,
      flag: 'filled-low-confidence', choice: { intended: { kind: 'boolean', value: true } } });
    // Never for a question that names countries itself.
    expect(reason(legal('workAuth.authorized', 'Authorized to work in the US or Canada?', profile, on)))
      .toBe('work-auth-country-unknown');
    expect(reason(legal('workAuth.authorized', 'Are you legally authorized to work?', profile, { ...on,
      postingCountry: 'FR' }))).toBe('legal-not-in-profile');
  });

  it('reads the profile’s only work-authorization country when the posting names none (on by default)', () => {
    expect(profile.workAuthorization.map((entry) => entry.country)).toEqual(['US']);
    expect(candidate(legal('workAuth.authorized', 'Are you legally authorized to work?', profile,
      { settings: DEFAULT_SETTINGS }))).toMatchObject({ origin: { path: 'workAuthorization[0].authorized',
      transform: 'legal.posting-country' }, flag: 'filled-low-confidence' });
    // With two entries, and no posting country, nothing says which.
    const two: Profile = { ...profile, workAuthorization: [...profile.workAuthorization,
      { country: 'CA', authorized: no }] };
    expect(reason(legal('workAuth.authorized', 'Are you legally authorized to work?', two,
      { settings: DEFAULT_SETTINGS }))).toBe('work-auth-country-unknown');
    expect(candidate(legal('workAuth.authorized', 'Are you legally authorized to work?', two,
      { settings: DEFAULT_SETTINGS, postingCountry: 'CA' }))?.choice?.intended).toEqual({ kind: 'boolean', value: false });
  });

  it('finds the posting’s country in the lookup’s location: a country, else the one country of its regions', () => {
    expect(postingCountryOf('London, United Kingdom', vocab)).toBe('GB');
    expect(postingCountryOf('San Francisco, CA', vocab)).toBe('US');
    expect(postingCountryOf('Toronto, ON, Canada', vocab)).toBe('CA');
    expect(postingCountryOf('Remote', vocab)).toBeUndefined();
    expect(postingCountryOf('New York, NY or Toronto, ON', vocab)).toBeUndefined();
    expect(postingCountryOf('Georgia', vocab)).toBeUndefined();
    // Several countries between the named ones and the regions' (the Phase E review, MINOR 1).
    expect(postingCountryOf('New York, NY; London, United Kingdom', vocab)).toBeUndefined();
    expect(postingCountryOf('San Francisco, CA or Toronto, Canada', vocab)).toBeUndefined();
    expect(postingCountryOf('Remote - US or London, UK', vocab)).toBeUndefined();
    expect(postingCountryOf('Austin, TX, United States', vocab)).toBe('US');
  });

  it('chooses the decline option for an explicit decline, and answers criminal history from the person’s own answer', () => {
    const declined: Profile = { ...profile, screening: { over18: { kind: 'decline' } } };
    expect(candidate(legal('screening.over18', 'Are you at least 18 years of age?', declined))).toMatchObject({
      origin: { provenance: 'rule', ruleId: 'legal.decline', path: 'screening.over18' },
      choice: { intended: { kind: 'decline', domain: 'polarity' } } });
    // No answer in TailorIT: blank and flagged (answer it once in Settings › Autofill).
    expect(legal('screening.criminalHistory', 'Have you been convicted of a felony?'))
      .toEqual({ ok: false, none: { reason: 'legal-not-in-profile', flagged: true } });
    // The owner's amendments: the sensitive part's criminalRecord, by its polarity alone; a declined one stays blank.
    const record = (answer: Explicit<boolean>): Profile => ({ ...profile, screening: { criminalRecord: answer } });
    expect(candidate(legal('screening.criminalHistory', 'Have you been convicted of a felony?', record(no))))
      .toMatchObject({ origin: { provenance: 'profile', path: 'screening.criminalRecord' },
        choice: { intended: { kind: 'boolean', value: false }, domain: 'polarity' }, check: false });
    expect(candidate(legal('screening.criminalHistory', 'Have you ever been convicted of a crime?', record(yes)))
      ?.choice?.intended).toEqual({ kind: 'boolean', value: true });
    expect(reason(legal('screening.criminalHistory', 'Have you been convicted of a felony?', record(decline))))
      .toBe('legal-not-in-profile');
  });

  it('answers only what the person’s one answer settles (the lead’s decision on the Phase E review, M4)', () => {
    const record = (answer: Explicit<boolean>): Profile => ({ ...profile, screening: { criminalRecord: answer } });
    const answered = (label: string, answer: Explicit<boolean>) => {
      const found = candidate(legal('screening.criminalHistory', label, record(answer)));
      return found === null ? reason(legal('screening.criminalHistory', label, record(answer)))
        : (found.choice?.intended as { value: boolean }).value;
    };
    // Generic conviction wording: the answer, either way.
    for (const label of ['Have you ever been convicted of a crime?', 'Do you have a criminal record?',
      'Have you ever been convicted of a criminal offense?', 'Criminal history']) {
      expect(answered(label, yes), label).toBe(true);
      expect(answered(label, no), label).toBe(false);
    }
    // Narrower conviction questions: No answers them, Yes says nothing of them.
    for (const label of ['Have you been convicted of a felony?', 'Have you been convicted of a misdemeanor?',
      'Have you been convicted of a crime in the last 7 years?', 'Do you have any unspent convictions?',
      'Have you ever been convicted of a crime (excluding minor traffic violations)?',
      'Have you been convicted of a felony in the past ten years?']) {
      expect(answered(label, no), label).toBe(false);
      expect(answered(label, yes), label).toBe('criminal-not-covered');
    }
    // Arrests, charges, pending charges, sex-offender registration: never from this answer.
    for (const label of ['Have you ever been arrested?', 'Have you ever been charged with a crime?',
      'Do you have any pending criminal charges?', 'Are you a registered sex offender?',
      'Have you been convicted of a crime or are any charges pending?']) {
      expect(answered(label, no), label).toBe('criminal-not-covered');
      expect(answered(label, yes), label).toBe('criminal-not-covered');
    }
  });
});

describe('EEO values (§8.7)', () => {
  const profile = goldenProfile();
  const withEeo = (eeo: Profile['eeo']): Profile => ({ ...profile, eeo });
  const field = (label: string, labels: string[], kind: 'radio' | 'checkbox-group' = 'radio') =>
    specOf(label, kind, { optionLabels: labels });

  it('chooses the decline option for an explicit decline', () => {
    expect(candidate(eeoValue('eeo.gender', field('Gender', ['Female', 'Male']), profile, DEFAULT_SETTINGS, vocab)))
      .toMatchObject({ origin: { provenance: 'rule', ruleId: 'eeo.decline', path: 'eeo.gender' },
        choice: { intended: { kind: 'decline', domain: 'eeo.gender' }, domain: 'eeo.gender' } });
  });

  it('leaves an unanswered question blank and flagged with the decline default off', () => {
    expect(eeoValue('eeo.gender', field('Gender', ['Female']), withEeo({}), CAUTIOUS_SETTINGS, vocab))
      .toEqual({ ok: false, none: { reason: 'eeo-not-in-profile', flagged: true } });
    expect(reason(eeoValue('eeo.sexualOrientation', field('Sexual orientation', ['Straight']), profile,
      CAUTIOUS_SETTINGS, vocab))).toBe('eeo-not-in-profile');
  });

  it('declines an unanswered question by default, by the rule eeo.decline-default (no guess, no path)', () => {
    const declined = { origin: { provenance: 'rule', ruleId: 'eeo.decline-default' }, note: 'eeo-decline-default' };
    expect(candidate(eeoValue('eeo.gender', field('Gender', ['Female', 'Decline to self-identify']), withEeo({}),
      DEFAULT_SETTINGS, vocab))).toMatchObject({ ...declined,
      choice: { intended: { kind: 'decline', domain: 'eeo.gender' }, domain: 'eeo.gender' } });
    expect(candidate(eeoValue('eeo.sexualOrientation', field('Sexual orientation', ['Straight', 'Prefer not to say']),
      profile, DEFAULT_SETTINGS, vocab))).toMatchObject({ ...declined,
      choice: { intended: { kind: 'decline', domain: 'generic' } } });
    expect(candidate(eeoValue('eeo.gender', field('Gender', ['Female']), withEeo({}), DEFAULT_SETTINGS, vocab))
      ?.origin).toEqual({ provenance: 'rule', ruleId: 'eeo.decline-default' });
    // Never a tick on a lone box.
    expect(reason(eeoValue('eeo.disability', specOf('I have a disability', 'checkbox'), withEeo({}), DEFAULT_SETTINGS,
      vocab))).toBe('format-unsupported');
  });

  it('chooses the self-describe option and carries the person’s own words, always flagged', () => {
    const own = withEeo({ gender: { kind: 'value', value: { identity: 'self-describe', selfDescribed: 'Genderqueer' } } });
    expect(candidate(eeoValue('eeo.gender', field('Gender', ['Man', 'Woman', 'I prefer to self-describe']), own,
      DEFAULT_SETTINGS, vocab))).toMatchObject({ origin: { transform: 'eeo.self-describe' },
      flag: 'other-option-with-free-text', choice: { freeText: 'Genderqueer' } });
  });

  it('leaves several races on a single-choice question blank unless interpretation 2 is on', () => {
    const races = withEeo({ race: { kind: 'value', value: ['asian', 'white'] }, hispanicLatino: { kind: 'value',
      value: false } });
    const single = field('Race', ['Asian', 'White', 'Two or More Races']);
    expect(reason(eeoValue('eeo.race', single, races, CAUTIOUS_SETTINGS, vocab))).toBe('ambiguous-options');
    const on = settingsWith({ interpretations: { postingCountryForLegal: false, twoOrMoreRaces: true,
      eeoDeclineByDefault: false } });
    expect(candidate(eeoValue('eeo.race', single, races, on, vocab))).toMatchObject({
      origin: { transform: 'eeo.two-or-more-races' }, confidence: 0.8,
      choice: { intended: { id: 'eeo.race:two-or-more-races' }, hispanicLatino: false } });
    const several = candidate(eeoValue('eeo.race', field('Race', ['Asian', 'White'], 'checkbox-group'), races,
      DEFAULT_SETTINGS, vocab));
    expect(several?.set?.map((choice) => [(choice.intended as { id: string }).id, choice.hispanicLatino])).toEqual([
      ['eeo.race:asian', false], ['eeo.race:white', false]]);
  });

  it('answers a veteran question by what it asks: service, or protected status', () => {
    const vevraa = field('Veteran status', ['I identify as one or more of the classifications of protected veteran',
      'I am not a protected veteran', 'I do not wish to self-identify']);
    const served = field('Are you a veteran?', ['Yes', 'No']);
    const id = (eeo: Profile['eeo'], spec: typeof served) =>
      (candidate(eeoValue('eeo.veteran', spec, withEeo(eeo), DEFAULT_SETTINGS, vocab))?.choice?.intended as { id: string })
        .id;
    const nonVeteran = { veteran: { kind: 'value' as const, value: { veteran: false, protected: false } } };
    const veteran = { veteran: { kind: 'value' as const, value: { veteran: true, protected: false } } };
    const protectedVeteran = { veteran: { kind: 'value' as const, value: { veteran: true, protected: true } } };
    expect(id(nonVeteran, vevraa)).toBe('eeo.veteran:not-protected-veteran');
    expect(id(nonVeteran, served)).toBe('eeo.veteran:not-veteran');
    expect(id(veteran, vevraa)).toBe('eeo.veteran:not-protected-veteran');
    expect(id(veteran, served)).toBe('eeo.veteran:veteran');
    expect(id(protectedVeteran, vevraa)).toBe('eeo.veteran:protected-veteran');
  });

  it('leaves a lone EEO checkbox to the person', () => {
    expect(reason(eeoValue('eeo.disability', specOf('I have a disability', 'checkbox'),
      withEeo({ disability: { kind: 'value', value: true } }), DEFAULT_SETTINGS, vocab))).toBe('format-unsupported');
  });
});

describe('consent values (§8.7; the owner\'s decisions of 2026-11-01)', () => {
  const profile = goldenProfile();
  /** An optional box, and one the form requires, in a run that used AI (the default) or none at all. */
  const optional = { required: false, aiFree: false };
  const required = { required: true, aiFree: false };
  /** Consents: Required only (v3 Phase 3), with the pre-approved kinds given. */
  const requiredOnly = (extra: Partial<Settings> = {}) => settingsWith({ ...extra,
    modes: { ...DEFAULT_SETTINGS.modes, consents: 'required' } });

  it('ticks every agreement box by default, Consents: All, marketing, text messages and future jobs included (v3 Phase 3)', () => {
    expect(DEFAULT_SETTINGS.modes.consents).toBe('all');
    for (const kind of CONSENT_CATEGORIES) {
      const category = `consent.${kind}` as const;
      const answer = candidate(consentValue(category, [category], profile, DEFAULT_SETTINGS, optional));
      expect(answer?.origin, kind).toMatchObject({ provenance: 'rule',
        ruleId: kind === 'signature' ? 'consent.signature-preapproved' : 'consent.preapproved' });
    }
    // Every kind a label names must be one the extension recognises: an unrecognised consent (a binding clause) is
    // ticked only when the form requires it.
    expect(reason(consentValue('consent.other', undefined, profile, DEFAULT_SETTINGS, optional)))
      .toBe('consent-optional-unticked');
    expect(reason(consentValue('consent.privacy', ['consent.privacy', 'consent.other'], profile, DEFAULT_SETTINGS,
      optional))).toBe('consent-optional-unticked');
    expect(candidate(consentValue('consent.other', undefined, profile, DEFAULT_SETTINGS, required))?.origin)
      .toEqual({ provenance: 'rule', ruleId: 'consent.required' });
    // Spotify's optional "contact me about future job opportunities" is ticked through the planner too.
    const spotify = specOf('Spotify has my consent to contact me about future job opportunities.', 'checkbox');
    expect(fieldOf(planOf([spotify]), spotify)).toMatchObject({ write: { value: { kind: 'check' } },
      row: { category: 'consent.marketing', needsUserAction: false } });
    const texts = specOf('I agree to receive text messages about my application.', 'checkbox');
    expect(fieldOf(planOf([texts]), texts).write?.value).toEqual({ kind: 'check' });
  });

  it('leaves Spotify\'s optional marketing consent unticked under Required only, as decided, but keeps the application on file (the Phase E review, B1)', () => {
    const settings = requiredOnly();
    const spotify = specOf('Spotify has my consent to contact me about future job opportunities.', 'checkbox');
    expect(fieldOf(planOf([spotify], { settings }), spotify)).toMatchObject({ write: undefined,
      row: { category: 'consent.marketing', reason: 'consent-optional-unticked', status: 'skipped',
        needsUserAction: false, wrote: false } });
    const onFile = specOf('Keep my information on file for future opportunities', 'checkbox');
    expect(fieldOf(planOf([onFile], { settings }), onFile).write?.value).toEqual({ kind: 'check' });
    // Ticked once the person pre-approves marketing themselves, and when the form requires it.
    const marketing = requiredOnly({ preapprovedConsent: [...DEFAULT_SETTINGS.preapprovedConsent, 'marketing'] });
    expect(fieldOf(planOf([spotify], { settings: marketing }), spotify).write?.value).toEqual({ kind: 'check' });
    const needed = { ...spotify, required: true };
    expect(fieldOf(planOf([needed], { settings }), needed).write?.origin)
      .toEqual({ provenance: 'rule', ruleId: 'consent.required' });
  });

  it('ticks an optional box under Required only when every consent kind its label names is pre-approved', () => {
    const settings = requiredOnly({ preapprovedConsent: ['privacy'] });
    expect(candidate(consentValue('consent.privacy', ['consent.privacy'], profile, settings, optional))).toMatchObject({
      origin: { provenance: 'rule', ruleId: 'consent.preapproved' }, confidence: 0.9, check: true });
    expect(consentValue('consent.privacy', ['consent.certify', 'consent.privacy'], profile, settings, optional))
      .toEqual({ ok: false, none: { reason: 'consent-optional-unticked', flagged: false } });
    expect(reason(consentValue('consent.privacy', ['consent.privacy'], profile, CAUTIOUS_SETTINGS, optional)))
      .toBe('consent-optional-unticked');
  });

  it('ticks a box the form requires whatever its kinds and the mode, binding clauses included (consent.required)', () => {
    for (const settings of [CAUTIOUS_SETTINGS, requiredOnly({ preapprovedConsent: [] })]) {
      for (const [category, kinds] of [['consent.privacy', ['consent.certify', 'consent.privacy']],
        ['consent.marketing', undefined], ['consent.sms', undefined], ['consent.other', undefined],
        ['consent.privacy', ['consent.privacy']]] as const) {
        expect(candidate(consentValue(category, kinds, profile, settings, required)), category).toMatchObject({
          origin: { provenance: 'rule', ruleId: 'consent.required' }, check: true });
      }
    }
    // A pre-approved kind keeps its own rule; unrecognised consent is never pre-approved.
    expect(candidate(consentValue('consent.privacy', ['consent.privacy'], profile, requiredOnly(), required))?.origin)
      .toEqual({ provenance: 'rule', ruleId: 'consent.preapproved' });
    expect(reason(consentValue('consent.other', undefined, profile, requiredOnly(), optional)))
      .toBe('consent-optional-unticked');
  });

  it('pre-approves the usual consents for Required only, never marketing or SMS (the owner’s amendments)', () => {
    const settings = requiredOnly();
    for (const kind of ['privacy', 'terms', 'dataRetention', 'certify', 'backgroundCheck'] as const) {
      const category = `consent.${kind}` as const;
      expect(candidate(consentValue(category, [category], profile, settings, optional))?.check, kind).toBe(true);
    }
    for (const kind of ['marketing', 'sms'] as const) {
      const category = `consent.${kind}` as const;
      expect(reason(consentValue(category, [category], profile, settings, optional)), kind)
        .toBe('consent-optional-unticked');
    }
    expect(candidate(consentValue('consent.signature', ['consent.signature'], profile, settings, optional))?.text)
      .toBe('Alex Rivera');
  });

  it('ticks an "I did not use AI" attestation only when the run used no AI at all, whatever the settings and the mode', () => {
    const everyKind = requiredOnly({ preapprovedConsent: ['privacy', 'terms', 'certify', 'dataRetention', 'marketing',
      'sms', 'backgroundCheck', 'signature'] });
    for (const settings of [everyKind, DEFAULT_SETTINGS]) {
      for (const consent of [optional, required]) {
        expect(consentValue('consent.aiAttestation', undefined, profile, settings, consent))
          .toEqual({ ok: false, none: { reason: 'ai-attestation-ai-used', flagged: true, needsUser: true } });
        // A box that also names AI among its kinds is the same statement.
        expect(reason(consentValue('consent.privacy', ['consent.privacy', 'consent.aiAttestation'], profile, settings,
          consent))).toBe('ai-attestation-ai-used');
      }
    }
    const free = { required: false, aiFree: true };
    expect(candidate(consentValue('consent.aiAttestation', undefined, profile, CAUTIOUS_SETTINGS, free))).toMatchObject({
      origin: { provenance: 'rule', ruleId: 'consent.no-ai-attestation' }, check: true });
    expect(candidate(consentValue('consent.privacy', ['consent.privacy', 'consent.aiAttestation'], profile,
      DEFAULT_SETTINGS, free))?.origin).toEqual({ provenance: 'rule', ruleId: 'consent.preapproved' });
  });

  it('types the full name for a pre-approved or required signature', () => {
    expect(candidate(consentValue('consent.signature', ['consent.signature'], profile,
      requiredOnly({ preapprovedConsent: ['signature'] }), optional))).toMatchObject({ text: 'Alex Rivera',
      origin: { provenance: 'rule', ruleId: 'consent.signature-preapproved', path: 'identity.fullName' } });
    expect(candidate(consentValue('consent.signature', ['consent.signature'], profile, CAUTIOUS_SETTINGS, required)))
      .toMatchObject({ text: 'Alex Rivera',
        origin: { provenance: 'rule', ruleId: 'consent.required', path: 'identity.fullName' } });
    expect(reason(consentValue('consent.signature', ['consent.signature'], profile, CAUTIOUS_SETTINGS, optional)))
      .toBe('consent-optional-unticked');
  });

  // The v4 review (security M3): a consent read from its help text alone was approved under All whatever it covered.
  it('decides a consent read from its help text alone by its kinds, as any consent: an optional binding one stays unticked under All', () => {
    const helpOnly = (description: string, required: boolean) =>
      specOf('Acknowledgement', 'checkbox', { description, required });
    const binding = 'By checking this box I agree to binding arbitration and waive my right to a jury trial';
    const sms = 'By checking this box I agree to receive text messages about my application';
    // Each is read from the help text alone (the rules once handed both to the person: description-only).
    for (const description of [binding, sms]) {
      expect(classifyByRules(helpOnly(description, false))).toMatchObject({ matchedOn: 'description',
        needsUser: 'description-only' });
    }
    expect(DEFAULT_SETTINGS.modes.consents).toBe('all');
    const optionalBinding = helpOnly(binding, false);
    expect(fieldOf(planOf([optionalBinding], { profile }), optionalBinding)).toMatchObject({ write: undefined,
      row: { category: 'consent.other', reason: 'consent-optional-unticked', wrote: false, needsUserAction: false } });
    // A kind the extension recognises (text messages) read there alone is approved under All, optional or not.
    const optionalSms = helpOnly(sms, false);
    expect(fieldOf(planOf([optionalSms], { profile }), optionalSms)).toMatchObject({ write: { value: { kind: 'check' },
      origin: { provenance: 'rule', ruleId: 'consent.preapproved' } }, row: { category: 'consent.sms' } });
    // And left unticked under Required only, where text messages are not pre-approved.
    expect(fieldOf(planOf([optionalSms], { profile, settings: requiredOnly() }), optionalSms).row.reason)
      .toBe('consent-optional-unticked');
    // A binding clause the form requires is ticked: it is needed to apply (consent.required).
    const requiredBinding = helpOnly(binding, true);
    expect(fieldOf(planOf([requiredBinding], { profile }), requiredBinding).write).toMatchObject({
      value: { kind: 'check' }, origin: { provenance: 'rule', ruleId: 'consent.required' } });
  });
});
