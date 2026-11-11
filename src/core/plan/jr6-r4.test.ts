/*
 * jr6 RULES (FIXPLAN §6.3 R4, items 62 to 79): what the plan writes for each audit's field, with the golden synthetic
 * profile (fixtures/profiles/alex-rivera.*) or variants of it built here. Labels and option labels are the pages' own
 * text (questions and the forms' choices, as the audits quote them); no value of the owner's appears here.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { FieldSpec, SectionRef } from '../types/field';
import type { Profile } from '../types/profile';
import { fieldOf, goldenProfile, inOrder, planOf, settingsWith, specOf } from './plan.testkit';
import type { PlanInput } from './types';

const golden = goldenProfile();
const YES_NO = ['Yes', 'No'];
const SCHOOL: SectionRef = { id: 'education', block: 0 };
const JOB: SectionRef = { id: 'experience', block: 0 };

/** What the plan writes into one field, and its row. */
const planned = (specs: FieldSpec[], spec: FieldSpec, extra: Partial<PlanInput> = {}) => fieldOf(planOf(specs, extra),
  spec);
/** The option label a write chose, the labels it chose, the text it typed, or the kind of write. */
const written = (write: ReturnType<typeof fieldOf>['write']) => {
  const value = write?.value;
  if (value === undefined) return undefined;
  if (value.kind === 'option') return value.cleanLabel;
  if (value.kind === 'options') return value.cleanLabels;
  if (value.kind === 'text') return value.text;
  return value.kind;
};
/** The keys a plan asks a classification, a draft or an answer for. */
const asked = (specs: FieldSpec[], extra: Partial<PlanInput> = {}) => {
  const ask = planOf(specs, extra).ask;
  return { classify: (ask?.classify ?? []).map((item) => item.key), drafts: (ask?.drafts ?? []).map((item) => item.key),
    answers: (ask?.answers ?? []).map((item) => item.key) };
};
const nothingAsked = { classify: [], drafts: [], answers: [] };
/** The golden profile with an expected salary paid by this period. */
const paidBy = (period: 'year' | 'month' | 'hour'): Profile => ({ ...golden, preferences: { ...golden.preferences,
  expectedSalary: { kind: 'value', value: { min: 150_000, currency: 'CAD', period } } } });
const upload = settingsWith({ modes: { ...DEFAULT_SETTINGS.modes, resumeOnPage: 'upload' } });

describe('62 (WD-25): a prefix the profile never holds', () => {
  it('skips Workday’s Prefix, a salutation and a list of honorifics, and asks no AI', () => {
    const prefix = specOf('Prefix', 'combobox', { options: 'lazy' });
    const honorifics = specOf('Title', 'select', { optionLabels: ['Mr.', 'Mrs.', 'Ms.', 'Dr.'], ordinal: 1 });
    const specs = inOrder([prefix, honorifics]);
    expect(planned(specs, prefix)).toMatchObject({ write: undefined, row: { category: 'identity.prefix',
      status: 'skipped', reason: 'no-profile-value' } });
    expect(planned(specs, honorifics).row).toMatchObject({ category: 'identity.prefix', status: 'skipped' });
    expect(asked(specs)).toEqual(nothingAsked);
  });
});

describe('63 (WD-28): a yes or no question that names skills is no skills pick', () => {
  it('goes to the AI as an unknown question, never the skills list', () => {
    const spec = specOf('Have you ever, or are you currently participating in a student training program offered by '
      + 'Dana-Farber’s Office of Workforce Development (such as scientific skills training)?', 'radio', {
      optionLabels: YES_NO, required: true });
    expect(planned([spec], spec).row.category).not.toBe('skills.list');
    expect(asked([spec]).classify).toEqual([spec.key]);
  });
});

describe('64 (ICIMS-23): a held résumé behind a replace control', () => {
  const held = { kind: 'files' as const, count: 1, held: true as const };
  it('is the person’s under “Upload mine again” on iCIMS, never written', () => {
    const icims = specOf('Please upload your resume (Max size: 5 MB)', 'file', { platform: 'icims',
      visibility: 'hidden-file-with-visible-control', current: held, required: true });
    expect(planned([icims], icims, { settings: upload })).toMatchObject({ write: undefined,
      row: { status: 'flagged', reason: 'resume-held-no-input', needsUserAction: true } });
    // Keep it (the default): kept, as before.
    expect(planned([icims], icims).row).toMatchObject({ status: 'flagged', reason: 'prefill-kept' });
  });
  it('leaves Workday’s drop zone as it was: the résumé goes in beside the held file', () => {
    const workday = specOf('Resume/CV', 'file', { platform: 'workday', visibility: 'hidden-file-with-visible-control',
      current: held });
    expect(planned([workday], workday, { settings: upload }).write).toMatchObject({ value: { kind: 'file',
      ref: 'resume' } });
  });
});

describe('65 (ICIMS-24): the school list first, its companion box only when the school is not listed', () => {
  const companion = specOf('Enter school name if not in the list above', 'text', { section: SCHOOL, ordinal: 1 });
  const listOf = (labels: readonly string[] | 'lazy') => specOf('School', 'combobox', { section: SCHOOL, ordinal: 0,
    ...(labels === 'lazy' ? { options: 'lazy' as const } : { optionLabels: labels }) });
  it('chooses the listed school and leaves the box empty', () => {
    const list = listOf(['Rice University', 'The University of Texas at Austin', 'Other']);
    const specs = inOrder([list, companion]);
    expect(written(planned(specs, list).write)).toBe('The University of Texas at Austin');
    expect(planned(specs, companion)).toMatchObject({ write: undefined,
      row: { status: 'skipped', reason: 'conditional-question' } });
  });
  it('chooses Other and types the school into the box when the list lacks it', () => {
    const list = listOf(['Rice University', 'Baylor University', 'Other']);
    const specs = inOrder([list, companion]);
    expect(written(planned(specs, list).write)).toBe('Other');
    expect(written(planned(specs, companion).write)).toBe('The University of Texas at Austin');
  });
  it('waits with the box while the list waits for its options', () => {
    const specs = inOrder([listOf('lazy'), companion]);
    expect(planned(specs, companion)).toMatchObject({ write: undefined,
      row: { status: 'flagged', reason: 'waiting-for-options' } });
  });
});

describe('66 (ICIMS-25): “Did You Graduate?” from the entry', () => {
  const spec = specOf('Did You Graduate?', 'select', { optionLabels: YES_NO, section: SCHOOL, required: true });
  it('answers Yes for a degree that ended, No for one in progress', () => {
    expect(planned([spec], spec).write).toMatchObject({ value: { cleanLabel: 'Yes' },
      origin: { provenance: 'rule', ruleId: 'education.graduated', path: 'education[0]' } });
    const studying: Profile = { ...golden, education: [{ ...golden.education[0]!, inProgress: true,
      endDate: { y: 2027, m: 5 } }] };
    expect(written(planned([spec], spec, { profile: studying }).write)).toBe('No');
  });
});

describe('67 (ADP-14): “Address Line 3”', () => {
  it('is skipped, never asked of an AI', () => {
    const spec = specOf('Address Line 3', 'text');
    expect(planned([spec], spec)).toMatchObject({ write: undefined, row: { category: 'address.line3',
      status: 'skipped' } });
    expect(asked([spec])).toEqual(nothingAsked);
  });
});

describe('68 (ADP-16): the pay basis from the expected pay’s period', () => {
  const spec = specOf('What is your desired salary? pay basis', 'radio', { optionLabels: ['Annually', 'Hourly'] });
  it('chooses Annually for a yearly figure, Hourly for an hourly one, and leaves it without one', () => {
    expect(planned([spec], spec, { profile: paidBy('year') }).write).toMatchObject({ value: { cleanLabel: 'Annually' },
      origin: { provenance: 'profile', path: 'preferences.expectedSalary' } });
    expect(written(planned([spec], spec, { profile: paidBy('hour') }).write)).toBe('Hourly');
    expect(planned([spec], spec).write).toBeUndefined();
    expect(asked([spec]).answers).toEqual([]);
  });
});

describe('69 (ADP-18): the résumé is provided by upload', () => {
  const spec = specOf('How would you like to provide the candidate\'s resume?', 'radio', {
    optionLabels: ['Upload File', 'Enter Professional Details'], required: true });
  it('chooses Upload File for a run with a résumé, never Enter Professional Details', () => {
    expect(planned([spec], spec).write).toMatchObject({ value: { cleanLabel: 'Upload File' },
      origin: { provenance: 'rule', ruleId: 'resume.upload-method', path: 'resume' } });
    expect(planned([spec], spec, { profile: goldenProfile({ resume: false }) }).write).toBeUndefined();
  });
  it('keeps the choice the page made', () => {
    const chosen = specOf('How would you like to provide the candidate\'s resume?', 'radio', {
      optionLabels: ['*Upload File', 'Enter Professional Details'] });
    expect(planned([chosen], chosen)).toMatchObject({ write: undefined, row: { reason: 'prefill-kept' } });
  });
});

describe('70 (ADP-20): a high-school diploma from the education entries', () => {
  const spec = specOf('Are you a high school graduate or passed the GED?', 'radio', { optionLabels: YES_NO,
    required: true });
  it('answers Yes from a degree past high school, and asks the AI without any entry', () => {
    expect(planned([spec], spec).write).toMatchObject({ value: { cleanLabel: 'Yes' },
      origin: { provenance: 'rule', ruleId: 'education.high-school' } });
    const none: Profile = { ...golden, education: [] };
    expect(planned([spec], spec, { profile: none }).write).toBeUndefined();
    expect(asked([spec], { profile: none }).answers).toEqual([spec.key]);
  });

  // jr6 fix (RULES-R70): a question that asks for more than the diploma is no rule's: the AI's, as before.
  it('gives no rule answer to a question that asks for more than the diploma', () => {
    for (const label of ['Do you have a high school diploma and a valid driver’s license?',
      'Question 1: Do you have a minimum of a High School diploma or GED along with relevant/required work experience?',
      'Do you have a high school diploma and at least 2 years of experience in retail sales?',
      'Do you have a high school diploma or GED and are you able to lift 50 pounds?']) {
      const compound = specOf(label, 'radio', { optionLabels: YES_NO, required: true });
      const out = planned([compound], compound);
      expect(out.write, label).toBeUndefined();
      expect(out.row.category, label).not.toBe('education.highSchool');
    }
    for (const label of ['Do you have a high school diploma or equivalent?', 'Do you have a high school diploma or GED?',
      'Have you earned a high school diploma or its equivalent?']) {
      const alone = specOf(label, 'radio', { optionLabels: YES_NO, required: true });
      expect(planned([alone], alone).write, label).toMatchObject({ value: { cleanLabel: 'Yes' },
        origin: { provenance: 'rule', ruleId: 'education.high-school' } });
    }
  });
});

describe('71 (adp-new-3): “I have a preferred or chosen name”', () => {
  const box = specOf('I have a preferred or chosen name', 'checkbox');
  it('is ticked only for a preferred name that is not the first name', () => {
    expect(planned([box], box).write).toBeUndefined();
    const chosen: Profile = { ...golden, identity: { ...golden.identity, preferredName: 'Lex' } };
    expect(planned([box], box, { profile: chosen }).write).toMatchObject({ value: { kind: 'check' },
      origin: { provenance: 'profile', path: 'identity.preferredName' } });
  });
});

describe('72 (JV-19): a mailing address only where it differs', () => {
  it('is skipped while optional, flagged while required, and never drafted', () => {
    const optional = specOf('Mailing Address, if different from above', 'textarea');
    expect(planned([optional], optional).row).toMatchObject({ category: 'address.mailing', status: 'skipped' });
    expect(asked([optional])).toEqual(nothingAsked);
    const required = specOf('Mailing Address, if different from above', 'textarea', { required: true });
    expect(planned([required], required).row).toMatchObject({ status: 'flagged', reason: 'no-profile-value' });
    expect(asked([required])).toEqual(nothingAsked);
  });
});

describe('73 (jobvite-new-5): an optional follow-up after the opposite answer', () => {
  const above = (answer: string) => specOf('Are you subject to a non-compete agreement?', 'radio', {
    optionLabels: YES_NO, current: { kind: 'selected', labels: [answer] }, ordinal: 0 });
  const followUp = specOf('If yes, please describe the terms', 'text', { ordinal: 1 });
  it('is never classified while the answer above is No', () => {
    const specs = inOrder([above('No'), followUp]);
    expect(asked(specs).classify).not.toContain(followUp.key);
    expect(planned(specs, followUp).row).toMatchObject({ status: 'skipped', reason: 'conditional-question' });
  });
  it('is classified as before while the answer above is Yes', () => {
    expect(asked(inOrder([above('Yes'), followUp])).classify).toContain(followUp.key);
  });
});

describe('74 (SR-10): “Country/Region” is the country', () => {
  it('chooses the profile’s country', () => {
    const spec = specOf('Country/Region', 'select', { optionLabels: ['Canada', 'United States', 'Mexico'] });
    expect(written(planned([spec], spec).write)).toBe('United States');
  });
});

describe('75 (SR-13): “Facebook”', () => {
  const spec = specOf('Facebook', 'text');
  it('types the profile’s Facebook link, else is skipped with no AI', () => {
    expect(planned([spec], spec)).toMatchObject({ write: undefined, row: { category: 'links.facebook',
      status: 'skipped' } });
    expect(asked([spec])).toEqual(nothingAsked);
    const linked: Profile = { ...golden, links: { ...golden.links, other: [{ label: 'Blog', url: 'https://blog.example.com' },
      { label: 'Facebook', url: 'https://www.facebook.com/alex.rivera.example' }] } };
    expect(planned([spec], spec, { profile: linked }).write).toMatchObject({
      value: { text: 'https://www.facebook.com/alex.rivera.example' },
      origin: { provenance: 'profile', path: 'links.other[1].url' } });
  });
});

describe('76 (U-16): a secondary phone beside the primary', () => {
  const primary = specOf('Primary Phone', 'text', { ordinal: 0, nameAttr: 'Phone' });
  const secondary = specOf('Secondary Phone', 'text', { ordinal: 1, nameAttr: 'SecondaryPhone' });
  it('is left empty, the primary written', () => {
    const specs = inOrder([primary, secondary]);
    expect(written(planned(specs, primary).write)).toBe('+1 512 555 0147');
    expect(planned(specs, secondary)).toMatchObject({ write: undefined,
      row: { status: 'skipped', reason: 'no-profile-value' } });
  });
  it('takes the number when it is the frame’s only phone', () => {
    expect(written(planned([secondary], secondary).write)).toBe('+1 512 555 0147');
  });
});

describe('77 (U-17): a place too long for its box', () => {
  const far: Profile = { ...golden, experience: [{ ...golden.experience[0]!, location: { text: 'San Francisco, California',
    city: 'San Francisco', region: { code: 'CA', name: 'California' }, country: 'US' } }, ...golden.experience.slice(1)] };
  it('is written in its shorter form, never cut', () => {
    const spec = specOf('Location', 'text', { section: JOB, constraints: { maxLength: 20 } });
    expect(planned([spec], spec, { profile: far }).write).toMatchObject({ value: { text: 'San Francisco, CA' },
      origin: { provenance: 'profile', path: 'experience[0].location', transform: 'location.compose' } });
    const narrow = specOf('Location', 'text', { section: JOB, constraints: { maxLength: 14 } });
    expect(written(planned([narrow], narrow, { profile: far }).write)).toBe('San Francisco');
    const tiny = specOf('Location', 'text', { section: JOB, constraints: { maxLength: 5 } });
    expect(planned([tiny], tiny, { profile: far }).row.reason).toBe('maxlength-exceeded');
  });
});

describe('78 (O7): “Average Grade” is the GPA', () => {
  it('types the entry’s GPA', () => {
    const spec = specOf('Average Grade', 'text', { section: SCHOOL });
    expect(written(planned([spec], spec).write)).toBe('3.8');
  });
});

describe('79 (O13): Oracle’s numbered links', () => {
  it('gives LinkedIn, GitHub, then the website (else the portfolio), and nothing past them', () => {
    const links = [1, 2, 3, 4].map((number) => specOf(`Link ${number}`, 'text', { nameAttr: `siteLink-${number}`,
      ordinal: number - 1 }));
    const specs = inOrder(links);
    expect(links.map((spec) => written(planned(specs, spec).write))).toEqual(['https://www.linkedin.com/in/alex-rivera-f7q2',
      'https://github.com/alexrivera-f7q2', 'https://alexrivera-f7q2.example.com', undefined]);
    expect(planned(specs, links[0]!).write?.origin).toEqual({ provenance: 'profile', path: 'links.linkedin' });
    expect(asked(specs)).toEqual(nothingAsked);
  });
});
