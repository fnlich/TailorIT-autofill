import { describe, expect, it } from 'vitest';
import { goldenProfile, settingsWith, specOf, vocab } from '../plan/plan.testkit';
import type { Explicit, Profile } from '../types/profile';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { ValueResult } from './candidate';
import {
  combinedSponsorship, consentValue, countriesNamed, eeoValue, legalValue, SENSITIVE_PART_CATEGORIES, sensitiveGate,
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
});

describe('the sensitive part’s gate', () => {
  it('asks for the part, or leaves the field blank and flagged, until it is loaded', () => {
    expect(sensitiveGate('eeo.gender', 'loaded')).toBe('ready');
    expect(sensitiveGate('eeo.gender', 'not-loaded')).toBe('fetch');
    expect(reason(sensitiveGate('screening.over18', 'not-shared') as ValueResult)).toBe('sensitive-not-shared');
    expect(reason(sensitiveGate('identity.pronouns', 'unavailable') as ValueResult)).toBe('sensitive-unavailable');
    expect(sensitiveGate('identity.firstName', 'not-loaded')).toBe('ready');
    // Questions neither part answers never need it.
    for (const category of ['workAuth.visaType', 'eeo.sexualOrientation', 'screening.criminalHistory'] as const) {
      expect(SENSITIVE_PART_CATEGORIES.has(category), category).toBe(false);
    }
  });
});

describe('legal values (§8.7)', () => {
  const profile = goldenProfile();
  const LEGAL = { settings: DEFAULT_SETTINGS };
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
    const on = { settings: settingsWith({ interpretations: { postingCountryForLegal: true, twoOrMoreRaces: false } }),
      postingCountry: 'US' };
    expect(reason(legal('workAuth.authorized', 'Are you legally authorized to work?', profile,
      { settings: DEFAULT_SETTINGS, postingCountry: 'US' }))).toBe('work-auth-country-unknown');
    expect(candidate(legal('workAuth.authorized', 'Are you legally authorized to work?', profile, on))).toMatchObject({
      origin: { path: 'workAuthorization[0].authorized', transform: 'legal.posting-country' }, confidence: 0.776,
      flag: 'filled-low-confidence', choice: { intended: { kind: 'boolean', value: true } } });
    // Never for a question that names countries itself.
    expect(reason(legal('workAuth.authorized', 'Authorized to work in the US or Canada?', profile, on)))
      .toBe('work-auth-country-unknown');
    expect(reason(legal('workAuth.authorized', 'Are you legally authorized to work?', profile, { ...on,
      postingCountry: 'FR' }))).toBe('legal-not-in-profile');
  });

  it('chooses the decline option for an explicit decline, and leaves criminal history to the person', () => {
    const declined: Profile = { ...profile, screening: { over18: { kind: 'decline' } } };
    expect(candidate(legal('screening.over18', 'Are you at least 18 years of age?', declined))).toMatchObject({
      origin: { provenance: 'rule', ruleId: 'legal.decline', path: 'screening.over18' },
      choice: { intended: { kind: 'decline', domain: 'polarity' } } });
    expect(legal('screening.criminalHistory', 'Have you been convicted of a felony?'))
      .toEqual({ ok: false, none: { reason: 'legal-not-in-profile', flagged: true, needsUser: true } });
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

  it('leaves an unanswered question blank and flagged', () => {
    expect(eeoValue('eeo.gender', field('Gender', ['Female']), withEeo({}), DEFAULT_SETTINGS, vocab))
      .toEqual({ ok: false, none: { reason: 'eeo-not-in-profile', flagged: true } });
    expect(reason(eeoValue('eeo.sexualOrientation', field('Sexual orientation', ['Straight']), profile,
      DEFAULT_SETTINGS, vocab))).toBe('eeo-not-in-profile');
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
    expect(reason(eeoValue('eeo.race', single, races, DEFAULT_SETTINGS, vocab))).toBe('ambiguous-options');
    const on = settingsWith({ interpretations: { postingCountryForLegal: false, twoOrMoreRaces: true } });
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

describe('consent values (§8.7)', () => {
  const profile = goldenProfile();

  it('ticks a box only when every consent kind its label names is pre-approved', () => {
    const settings = settingsWith({ preapprovedConsent: ['privacy'] });
    expect(candidate(consentValue('consent.privacy', ['consent.privacy'], profile, settings))).toMatchObject({
      origin: { provenance: 'rule', ruleId: 'consent.preapproved' }, confidence: 0.9, check: true });
    expect(consentValue('consent.privacy', ['consent.certify', 'consent.privacy'], profile, settings))
      .toEqual({ ok: false, none: { reason: 'consent-requires-user', flagged: true, needsUser: true } });
    expect(reason(consentValue('consent.privacy', ['consent.privacy'], profile, DEFAULT_SETTINGS)))
      .toBe('consent-requires-user');
  });

  it('never ticks an AI attestation or unrecognised consent, whatever the settings', () => {
    const all = settingsWith({ preapprovedConsent: ['privacy', 'terms', 'certify', 'dataRetention', 'marketing', 'sms',
      'backgroundCheck', 'signature'] });
    expect(reason(consentValue('consent.aiAttestation', undefined, profile, all))).toBe('consent-requires-user');
    expect(reason(consentValue('consent.other', undefined, profile, all))).toBe('consent-requires-user');
  });

  it('types the full name for a pre-approved signature', () => {
    expect(candidate(consentValue('consent.signature', ['consent.signature'], profile,
      settingsWith({ preapprovedConsent: ['signature'] })))).toMatchObject({ text: 'Alex Rivera',
      origin: { provenance: 'rule', ruleId: 'consent.signature-preapproved', path: 'identity.fullName' } });
  });
});
