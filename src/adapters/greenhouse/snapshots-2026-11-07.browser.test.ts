/*
 * The owner's Greenhouse and Lever captures of snapshot round 2 (2026-11-07, converted and redacted by
 * scripts/mhtml-to-fixture.mjs: fixtures/greenhouse/s2-*, fixtures/lever/s2-ahead-*), planned by the real planFrame (s2
 * core-gh: decisions 7 to 14 of the round's design). Each form is scanned, the lists its questions show when opened are
 * given as the run's widget readings (the captures' own option labels, or a Yes and a No for the Yes/No questions), and
 * the plan is read for the field the rule is about. The profile is the golden synthetic one, with the round's new
 * answers set per test: never the owner's data.
 */
import { afterEach, describe, expect, it } from 'vitest';
import horaceHtml from '../../../fixtures/greenhouse/s2-horacemann-certify-open.html?raw';
import onestreamHtml from '../../../fixtures/greenhouse/s2-onestream-related-open.html?raw';
import pieHtml from '../../../fixtures/greenhouse/s2-pie-cicd-open.html?raw';
import pieEeoHtml from '../../../fixtures/greenhouse/s2-pie-eeo-1.html?raw';
import ridgelineHtml from '../../../fixtures/greenhouse/s2-ridgeline-sponsorship-open.html?raw';
import robotsHtml from '../../../fixtures/greenhouse/s2-robotspencils-clear-id-open.html?raw';
import sandHtml from '../../../fixtures/greenhouse/s2-sandtech-salary-open.html?raw';
import tripledotHtml from '../../../fixtures/greenhouse/s2-tripledot-right-to-work-open.html?raw';
import virtruHtml from '../../../fixtures/greenhouse/s2-virtru-clearance-open.html?raw';
import aheadHtml from '../../../fixtures/lever/s2-ahead-0.html?raw';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import type { ClassifyVerdict } from '../../core/resolver/classify';
import { planFrame } from '../../core/plan/frame';
import type { PlanOutput } from '../../core/plan/types';
import type { BaseKey, FieldKey, FieldSpec } from '../../core/types/field';
import type { FillResult, PlannedWrite } from '../../core/types/fill';
import type { Profile } from '../../core/types/profile';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import type { WidgetReading } from '../../dom/types';
import { scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { greenhouseAdapter } from './index';

const YES_NO = ['Yes', 'No'];

/** The lists the captures show when their questions are opened (fixtures named above; option labels are page text). */
const PIE_RACE = ['Black or of African descent', 'East Asian', 'Hispanic, Latinx or of Spanish Origin',
  'Indigenous, American Indian or Alaska Native', 'Middle Eastern or North African', 'Native Hawaiian or Pacific Islander',
  'South Asian', 'Southeast Asian', 'White or European', 'I prefer to self-describe', "I don't wish to answer"];
const PIE_ORIENTATION = ['Asexual', 'Bisexual and/or pansexual', 'Gay', 'Heterosexual', 'Lesbian', 'Queer',
  'I prefer to self-describe', "I don't wish to answer"];
const PIE_TRANSGENDER = ['Yes', 'No', 'I prefer to self-describe', "I don't wish to answer"];
const PIE_VETERAN = ['Yes, I am a veteran or active member', 'No, I am not a veteran or active member',
  'I prefer to self-describe', "I don't wish to answer"];
const EEOC_GENDER = ['Male', 'Female', 'Decline To Self Identify'];
const TRIPLEDOT_RIGHT = ['I have the right to work', 'I require visa/sponsorship'];

interface Lists {
  /** Options by the field's id. */
  readonly [id: string]: readonly string[] | { multi: readonly string[] };
}

/** The fixture scanned with `lists` read as the run reads them (a Yes and a No for every other lazy combobox when
 *  `yesNo`), as FieldSpecs. */
async function specsOf(html: string, lists: Lists = {}, yesNo = true): Promise<FieldSpec[]> {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
  const first = scan(root, greenhouseAdapter, { platform: 'greenhouse' });
  const readings = new Map<BaseKey, WidgetReading>();
  for (const field of first.fields) {
    const listed = lists[field.idAttr];
    const labels = listed === undefined ? (yesNo && field.options === 'lazy' && field.kind === 'combobox' ? YES_NO : null)
      : 'multi' in listed ? listed.multi : listed;
    if (labels === null) continue;
    readings.set(field.baseKey, { kind: 'options', multiselectable: listed !== undefined && 'multi' in listed,
      complete: true, options: labels.map((label) => ({ label, disabled: false })) });
  }
  return scan(root, greenhouseAdapter, { platform: 'greenhouse', widgetReadings: readings }).fields.map(toFieldSpec);
}

interface Planned {
  out: PlanOutput;
  row(id: string): FillResult;
  write(id: string): PlannedWrite | undefined;
  key(id: string): FieldKey;
}

function plan(specs: FieldSpec[], profile: Profile, company: string, extra: { classifications?: Map<FieldKey,
  ClassifyVerdict> } = {}): Planned {
  const out = planFrame({ specs, canaries: [], profile, sensitiveState: 'loaded', savedAnswers: [],
    settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company, location: 'Austin, TX, USA' },
    ...(extra.classifications ? { ai: { verdicts: new Map(), classifications: extra.classifications, drafts: new Map(),
      answers: new Map() } } : {}) });
  const key = (id: string) => specs.find((spec) => spec.idAttr === id)!.key;
  return { out, key, row: (id) => out.results.find((row) => row.key === key(id))!,
    write: (id) => out.writes.find((write) => write.key === key(id)) };
}

/** The golden profile with the round's new answers (core/types/profile.ts), each test changing what it is about. */
function s2Profile(change: (profile: Profile) => Profile = (profile) => profile): Profile {
  const golden = goldenProfile();
  return change({ ...golden,
    links: { ...golden.links, x: 'https://x.com/rivera_dev', telegram: 'https://t.me/rivera_dev42' },
    screening: { ...golden.screening, restrictiveAgreement: { kind: 'value', value: false },
      governmentService: { kind: 'value', value: { military: false, government: false } },
      relativesAt: { kind: 'value', value: [] }, essentialFunctions: { kind: 'value', value: true },
      clearance: { kind: 'value', value: { level: 'none' } }, citizenships: { kind: 'value', value: ['US'] } },
    certifications: [{ name: 'AWS Certified Solutions Architect' }, { name: 'CKA' }],
    preferences: { ...golden.preferences, relocationPlaces: ['Denver, CO', 'Seattle, WA'] } });
}

const optionOf = (write: PlannedWrite | undefined) => (write?.value.kind === 'option' ? write.value.cleanLabel
  : undefined);
const textOf = (write: PlannedWrite | undefined) => (write?.value.kind === 'text' ? write.value.text : undefined);
const optionsOf = (write: PlannedWrite | undefined) => (write?.value.kind === 'options' ? write.value.cleanLabels
  : undefined);

afterEach(() => removeFixtures(document));

describe('decision 13: the wrong values first', () => {
  it('reads OneStream\'s "require OneStream to sponsor your … work authorization" as sponsorship: No, never Yes',
    async () => {
      const ran = plan(await specsOf(onestreamHtml), s2Profile(), 'OneStream');
      expect(ran.row('question_8152423009').category).toBe('workAuth.sponsorship');
      expect(optionOf(ran.write('question_8152423009'))).toBe('No');
      // Its neighbour is authorization still.
      expect(ran.row('question_8152424009').category).toBe('workAuth.authorized');
      expect(optionOf(ran.write('question_8152424009'))).toBe('Yes');
    });

  it('reads Ridgeline\'s question sentence alone: the requirement stated after it joins no second answer',
    async () => {
      const ran = plan(await specsOf(ridgelineHtml), s2Profile(), 'Ridgeline');
      expect(ran.row('question_32819764003')).toMatchObject({ category: 'workAuth.sponsorship', status: 'verified' });
      expect(optionOf(ran.write('question_32819764003'))).toBe('No');
    });

  it('never writes the profile\'s referral text into another person\'s name box or a follow-up, on an LLM\'s word',
    async () => {
      const specs = await specsOf(onestreamHtml);
      const sand = await (async () => {
        removeFixtures(document);
        return specsOf(sandHtml);
      })();
      const onestreamKey = specs.find((spec) => spec.idAttr === 'question_8152432009')!.key;
      const sandKey = sand.find((spec) => spec.idAttr === 'question_9736098101')!.key;
      const referral = (key: FieldKey): ClassifyVerdict => ({ key, category: 'referral_source', why: 'ok' });
      const ran = plan(specs, s2Profile(), 'OneStream',
        { classifications: new Map([[onestreamKey, referral(onestreamKey)]]) });
      expect(ran.write('question_8152432009')).toBeUndefined();
      expect(ran.row('question_8152432009').category).not.toBe('referral.source');
      const sandRan = plan(sand, s2Profile(), 'Sand', { classifications: new Map([[sandKey, referral(sandKey)]]) });
      expect(sandRan.write('question_9736098101')).toBeUndefined();
      expect(sandRan.row('question_9736098101').category).not.toBe('referral.source');
    });
});

describe('decision 9: social profiles and handles', () => {
  it('fills OneStream\'s "LinkedIn Profile" textarea with the LinkedIn link (screenshot 8), never an AI essay',
    async () => {
      const ran = plan(await specsOf(onestreamHtml), s2Profile(), 'OneStream');
      expect(ran.row('question_8152421009')).toMatchObject({ category: 'links.linkedin', status: 'verified' });
      expect(textOf(ran.write('question_8152421009'))).toBe(goldenProfile().links.linkedin);
      expect(ran.out.ask?.drafts?.some((item) => item.key === ran.key('question_8152421009')) ?? false).toBe(false);
    });

  it('gives an "X username" or "Telegram username" box the bare handle, "@handle" where it shows "@", a URL box the link',
    async () => {
      const specs = await specsOf(ridgelineHtml);
      const website = specs.find((spec) => spec.idAttr === 'question_32819486003')!;
      const as = (label: string, id: string): FieldSpec => ({ ...website, label, idAttr: id,
        key: `${website.key}-${id}` as FieldKey, baseKey: `${website.baseKey}-${id}` as BaseKey });
      const boxes = [as('X username (If you don\'t have a profile, please type N/A)', 'x'),
        as('Telegram username (If you don\'t have a profile, please type N/A)', 'tg'), as('X handle (@)', 'xat'),
        as('Twitter URL', 'xurl')];
      const ran = plan([...specs, ...boxes], s2Profile(), 'Ridgeline');
      expect(ran.row('x').category).toBe('links.twitter');
      expect(textOf(ran.write('x'))).toBe('rivera_dev');
      expect(ran.row('tg').category).toBe('links.telegram');
      expect(textOf(ran.write('tg'))).toBe('rivera_dev42');
      expect(textOf(ran.write('xat'))).toBe('@rivera_dev');
      expect(textOf(ran.write('xurl'))).toBe('https://x.com/rivera_dev');
    });
});

describe('decision 8: the N/A an instruction asks for', () => {
  it('types N/A into screenshot 7\'s required boxes when the profile holds no X or Telegram link', async () => {
    const specs = await specsOf(ridgelineHtml);
    const website = specs.find((spec) => spec.idAttr === 'question_32819486003')!;
    const as = (label: string, id: string, required = true): FieldSpec => ({ ...website, label, idAttr: id, required,
      key: `${website.key}-${id}` as FieldKey, baseKey: `${website.baseKey}-${id}` as BaseKey });
    const boxes = [as('X username (If you don\'t have a profile, please type N/A)', 'x'),
      as('Telegram username (If you don\'t have a profile, please type N/A)', 'tg'),
      as('Telegram handle (type None if you don\'t have one)', 'tgnone', false),
      as('Telegram username', 'plain', false), as('X username (if you do not have one, write "banana42")', 'odd')];
    const none = s2Profile((profile) => ({ ...profile, links: { ...profile.links, x: '', telegram: '' } }));
    const ran = plan([...specs, ...boxes], none, 'Ridgeline');
    expect(ran.write('x')).toMatchObject({ value: { kind: 'text', text: 'N/A' },
      origin: { provenance: 'rule', ruleId: 'placeholder.no-profile' } });
    expect(ran.row('x')).toMatchObject({ status: 'verified', provenance: 'rule' });
    expect(textOf(ran.write('tg'))).toBe('N/A');
    expect(textOf(ran.write('tgnone'))).toBe('None');
    // No instruction, or one that names no placeholder of ours: nothing typed.
    expect(ran.write('plain')).toBeUndefined();
    expect(ran.write('odd')).toBeUndefined();
  });
});

describe('decision 10: consents asked as Yes/No', () => {
  it('chooses Yes on the required "I certify …" questions of Horace Mann and OneStream, and Robots\' CLEAR ID check',
    async () => {
      const horace = plan(await specsOf(horaceHtml), s2Profile(), 'Horace Mann');
      expect(horace.row('question_20182386004').category).toBe('consent.certify');
      expect(optionOf(horace.write('question_20182386004'))).toBe('Yes');
      removeFixtures(document);
      const onestream = plan(await specsOf(onestreamHtml), s2Profile(), 'OneStream');
      expect(onestream.row('question_8152433009').category).toBe('consent.other');
      expect(optionOf(onestream.write('question_8152433009'))).toBe('Yes');
      removeFixtures(document);
      const robots = plan(await specsOf(robotsHtml), s2Profile(), 'Robots and Pencils');
      expect(robots.row('question_18795013008').category).toBe('consent.other');
      expect(optionOf(robots.write('question_18795013008'))).toBe('Yes');
    });

  it('waits for the Yes/No list of a consent before it decides it', async () => {
    // The capture shows the CLEAR ID list open; closed, the run has not read it yet.
    const specs = (await specsOf(robotsHtml)).map((spec) => (spec.idAttr === 'question_18795013008'
      ? { ...spec, options: 'lazy' as const, optionSetHash: 'lazy' as FieldSpec['optionSetHash'] } : spec));
    const lazy = plan(specs, s2Profile(), 'Robots and Pencils');
    expect(lazy.row('question_18795013008')).toMatchObject({ category: 'consent.other', reason: 'waiting-for-options' });
    expect(lazy.write('question_18795013008')).toBeUndefined();
  });

  it('leaves an optional certification asked as Yes/No unanswered under Consents: Required only', async () => {
    const specs = (await specsOf(onestreamHtml)).map((spec) => (spec.idAttr === 'question_8152433009'
      ? { ...spec, required: false } : spec));
    const out = planFrame({ specs, canaries: [], profile: s2Profile(), sensitiveState: 'loaded', savedAnswers: [],
      settings: { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, consents: 'required' } }, vocab: testVocab(),
      dryRun: false, now: NOW, posting: { company: 'OneStream' } });
    const key = specs.find((spec) => spec.idAttr === 'question_8152433009')!.key;
    expect(out.writes.some((write) => write.key === key)).toBe(false);
    expect(out.results.find((row) => row.key === key)).toMatchObject({ reason: 'consent-optional-unticked' });
  });
});

describe('decision 11: the website, legal answers in a text box, the country of origin', () => {
  it('fills Ridgeline\'s Website with the portfolio when the profile has no website, never GitHub or LinkedIn',
    async () => {
      const ran = plan(await specsOf(ridgelineHtml), s2Profile(), 'Ridgeline');
      expect(ran.write('question_32819486003')).toMatchObject({ value: { kind: 'text', text: goldenProfile().links.portfolio },
        origin: { provenance: 'profile', path: 'links.portfolio', transform: 'links.website-from-portfolio' } });
      removeFixtures(document);
      const bare = s2Profile((profile) => ({ ...profile, links: { ...profile.links, portfolio: '' } }));
      expect(plan(await specsOf(ridgelineHtml), bare, 'Ridgeline').write('question_32819486003')).toBeUndefined();
    });

  it('types "No" into Robots\' sponsorship text box from the profile\'s explicit answer', async () => {
    const ran = plan(await specsOf(robotsHtml), s2Profile(), 'Robots and Pencils');
    expect(ran.row('question_18670483008').category).toBe('workAuth.sponsorship');
    expect(textOf(ran.write('question_18670483008'))).toBe('No');
  });

  it('types the first citizenship\'s country into Sand\'s "Country of Origin"', async () => {
    const ran = plan(await specsOf(sandHtml), s2Profile(), 'Sand');
    expect(ran.row('question_9737048101').category).toBe('workAuth.citizenship');
    expect(textOf(ran.write('question_9737048101'))).toBe('United States');
  });
});

describe('decision 12: self-identification', () => {
  const eeoLists: Lists = { 4019927004: { multi: PIE_RACE }, 4019924004: { multi: PIE_ORIENTATION },
    4019923004: PIE_TRANSGENDER, 4019919004: PIE_VETERAN, gender: EEOC_GENDER };
  const answering = (eeo: Partial<Profile['eeo']>) => s2Profile((profile) => ({ ...profile, eeo: { ...profile.eeo,
    ...eeo } }));

  it('adds the Hispanic or Latino option to Pie\'s combined race list for a Hispanic person', async () => {
    const ran = plan(await specsOf(pieEeoHtml, eeoLists), answering({ hispanicLatino: { kind: 'value', value: true },
      race: { kind: 'value', value: ['white'] } }), 'Pie Insurance');
    expect(optionsOf(ran.write('4019927004'))).toEqual(['White or European', 'Hispanic, Latinx or of Spanish Origin']);
  });

  it('chooses an Asian person\'s subgroups on a list that splits Asian, and keeps the other answers without them',
    async () => {
      const specs = await specsOf(pieEeoHtml, eeoLists);
      const withSub = plan(specs, answering({ race: { kind: 'value', value: ['asian', 'white'] },
        raceSubgroups: ['east-asian'] }), 'Pie Insurance');
      expect(optionsOf(withSub.write('4019927004'))).toEqual(['East Asian', 'White or European']);
      const bare = plan(specs, answering({ race: { kind: 'value', value: ['asian', 'white'] } }), 'Pie Insurance');
      expect(optionsOf(bare.write('4019927004'))).toEqual(['White or European']);
    });

  it('answers sexual orientation and transgender identity from the profile', async () => {
    const ran = plan(await specsOf(pieEeoHtml, eeoLists), answering({
      sexualOrientation: { kind: 'value', value: { values: ['bisexual-pansexual', 'queer'] } },
      transgender: { kind: 'value', value: false } }), 'Pie Insurance');
    expect(optionsOf(ran.write('4019924004'))).toEqual(['Bisexual and/or pansexual', 'Queer']);
    expect(optionOf(ran.write('4019923004'))).toBe('No');
  });

  it('answers "veteran or active member" Yes for a person serving now', async () => {
    const ran = plan(await specsOf(pieEeoHtml, eeoLists), answering({ veteran: { kind: 'value',
      value: { veteran: false, protected: false, activeDuty: true } } }), 'Pie Insurance');
    expect(optionOf(ran.write('4019919004'))).toBe('Yes, I am a veteran or active member');
  });

  it('declines a gender the list does not offer (non-binary on Male / Female / Decline To Self Identify)', async () => {
    const ran = plan(await specsOf(pieEeoHtml, eeoLists), answering({ gender: { kind: 'value',
      value: { identity: 'non-binary' } } }), 'Pie Insurance');
    expect(ran.write('gender')).toMatchObject({ value: { kind: 'option', cleanLabel: 'Decline To Self Identify' },
      origin: { provenance: 'rule', ruleId: 'eeo.not-offered' } });
  });
});

describe('the gh study\'s other questions (§1, §3f)', () => {
  it('answers Horace Mann\'s employed-before and employed-now questions from the profile\'s employers', async () => {
    const specs = await specsOf(horaceHtml);
    const none = plan(specs, s2Profile(), 'Horace Mann');
    expect(none.row('question_20182379004').category).toBe('screening.previouslyEmployed');
    expect(optionOf(none.write('question_20182379004'))).toBe('No');
    expect(none.row('question_20182378004').category).toBe('screening.previouslyEmployed');
    expect(optionOf(none.write('question_20182378004'))).toBe('No');
    const formerly = s2Profile((profile) => ({ ...profile, experience: [...profile.experience,
      { ...profile.experience[0]!, company: 'Horace Mann', current: false } ] }));
    const before = plan(specs, formerly, 'Horace Mann');
    expect(optionOf(before.write('question_20182379004'))).toBe('Yes');
    expect(optionOf(before.write('question_20182378004'))).toBe('No');
  });

  it('writes the whole address into "What is your current address?"', async () => {
    const ran = plan(await specsOf(horaceHtml), s2Profile(), 'Horace Mann');
    expect(ran.row('question_20182381004').category).toBe('address.full');
    const text = textOf(ran.write('question_20182381004'))!;
    const address = goldenProfile().address!;
    expect(text.startsWith(address.line1!)).toBe(true);
    expect(text).toContain(address.city!);
  });

  it('answers the non-compete, relatives and government-service questions from the sensitive part', async () => {
    const specs = await specsOf(onestreamHtml);
    const ran = plan(specs, s2Profile(), 'OneStream');
    expect(ran.row('question_8152425009').category).toBe('screening.restrictiveAgreement');
    expect(optionOf(ran.write('question_8152425009'))).toBe('No');
    expect(ran.row('question_8152427009').category).toBe('screening.relatives');
    expect(optionOf(ran.write('question_8152427009'))).toBe('No');
    expect(ran.row('question_8152429009').category).toBe('screening.governmentService');
    expect(optionOf(ran.write('question_8152429009'))).toBe('No');
    const yes = plan(specs, s2Profile((profile) => ({ ...profile, screening: { ...profile.screening,
      restrictiveAgreement: { kind: 'value', value: true }, relativesAt: { kind: 'value', value: ['OneStream, Inc.'] },
      governmentService: { kind: 'value', value: { military: true, militaryEndYear: NOW.y - 2, government: false } } } })),
    'OneStream');
    expect(optionOf(yes.write('question_8152425009'))).toBe('Yes');
    expect(optionOf(yes.write('question_8152427009'))).toBe('Yes');
    expect(optionOf(yes.write('question_8152429009'))).toBe('Yes');
    // Service that ended before the last five years: No.
    const long = plan(specs, s2Profile((profile) => ({ ...profile, screening: { ...profile.screening,
      governmentService: { kind: 'value', value: { military: true, militaryEndYear: NOW.y - 9, government: false } } } })),
    'OneStream');
    expect(optionOf(long.write('question_8152429009'))).toBe('No');
    removeFixtures(document);
    const horace = plan(await specsOf(horaceHtml), s2Profile(), 'Horace Mann');
    expect(horace.row('question_20182385004').category).toBe('screening.restrictiveAgreement');
    expect(optionOf(horace.write('question_20182385004'))).toBe('No');
  });

  it('answers Virtru\'s "Do you hold an Active TS/SCI?" from the clearance', async () => {
    const specs = await specsOf(virtruHtml);
    expect(optionOf(plan(specs, s2Profile(), 'Virtru').write('question_9225664005'))).toBe('No');
    const held = s2Profile((profile) => ({ ...profile, screening: { ...profile.screening,
      clearance: { kind: 'value', value: { level: 'ts-sci', active: true } } } }));
    expect(optionOf(plan(specs, held, 'Virtru').write('question_9225664005'))).toBe('Yes');
    const lapsed = s2Profile((profile) => ({ ...profile, screening: { ...profile.screening,
      clearance: { kind: 'value', value: { level: 'ts-sci', active: false } } } }));
    expect(optionOf(plan(specs, lapsed, 'Virtru').write('question_9225664005'))).toBe('No');
  });

  it('chooses Tripledot\'s "I have the right to work" for a person authorized to work', async () => {
    const ran = plan(await specsOf(tripledotHtml, { question_9934444101: TRIPLEDOT_RIGHT }), s2Profile(), 'Tripledot');
    expect(optionOf(ran.write('question_9934444101'))).toBe('I have the right to work');
  });

  it('reads Pie\'s "Which of the following … tools have you used" checkbox group as the skills', async () => {
    const ran = plan(await specsOf(pieHtml), s2Profile(), 'Pie Insurance');
    expect(ran.row('question_20266022004[]').category).toBe('skills.list');
  });

  it('reads the city questions as the current location (Tripledot, Robots)', async () => {
    const tripledot = plan(await specsOf(tripledotHtml), s2Profile(), 'Tripledot');
    expect(tripledot.row('question_10000981101').category).toBe('location.current');
    removeFixtures(document);
    const robots = plan(await specsOf(robotsHtml), s2Profile(), 'Robots and Pencils');
    expect(robots.row('question_18670481008').category).toBe('location.current');
  });
});

describe('the eeo study\'s Lever questions (§2C): s2-ahead-0', () => {
  async function ahead(profile: Profile) {
    const scanned = await scanCase(document, aheadHtml, 'https://jobs.lever.co/tailoritfixture/0000/apply');
    const specs = scanned.result.fields.map(toFieldSpec);
    const out = planFrame({ specs, canaries: [], profile, sensitiveState: 'loaded', savedAnswers: [],
      settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW, posting: { company: 'AHEAD' } });
    const by = (start: string) => specs.find((spec) => spec.label.startsWith(start))!;
    return { row: (start: string) => out.results.find((row) => row.key === by(start).key)!,
      write: (start: string) => out.writes.find((write) => write.key === by(start).key) };
  }

  it('fills the residence, the address, the sponsorship text box, the duties, certifications, places and education',
    async () => {
      const ran = await ahead(s2Profile());
      expect(ran.row('Where do you currently reside').category).toBe('location.current');
      expect(ran.row('Primary Residence Address').category).toBe('address.full');
      expect(textOf(ran.write('Primary Residence Address'))).toContain(goldenProfile().address!.city!);
      expect(textOf(ran.write('Will you now or in the future require AHEAD'))).toBe('No');
      expect(ran.row('Confirm the ability to perform').category).toBe('screening.essentialFunctions');
      expect(optionOf(ran.write('Confirm the ability to perform'))).toBe('Yes');
      expect(ran.row('Do you hold any industry related certifications').category).toBe('skills.certifications');
      expect(textOf(ran.write('Do you hold any industry related certifications')))
        .toBe('AWS Certified Solutions Architect; CKA');
      expect(ran.row('If so, where would you be open to relocating').category).toBe('preferences.relocationPlaces');
      expect(ran.row('Provide All Post-Secondary Education').category).toBe('education.summary');
      const education = textOf(ran.write('Provide All Post-Secondary Education'))!;
      expect(education.split('\n')).toHaveLength(goldenProfile().education.length);
      expect(education).toContain('; ');
    });
});
