/*
 * s2 core-wd: Workday's My Information and My Experience classified and planned on the owner's snapshots of
 * 2026-11-07 (the wd study §4-5; fixtures/workday/s2-*, converted and redacted): the real scan of each step, then the
 * real planFrame with the golden synthetic profile (never the owner's data). Each field below was "unknown", or read
 * as another field, before snapshot round 2: Country Phone Code (a prompt), Phone Device Type, Suffix, Phone
 * Extension, "I have a preferred name" (unrecognised consent), How Did You Hear About Us? (a prompt), Overall Result
 * (GPA), X, Role Description, and each job's Location (the person's current location in every block, an unlisted
 * parsed job's included). Prefix is the name's prefix, which the profile never holds: skipped, never asked of an AI
 * (Mr. or Ms. stands in for a gender; the wd study §5; jr6 RULES R4 item 62, WD-25).
 */
import { afterEach, describe, expect, it } from 'vitest';
import stateHtml from '../../../fixtures/workday/s2-exelixis-state-open.html?raw';
import infoHtml from '../../../fixtures/workday/s2-verily-my-information.html?raw';
import studyHtml from '../../../fixtures/workday/s2-verily-field-of-study-open.html?raw';
import experienceHtml from '../../../fixtures/workday/s2-exelixis-my-experience.html?raw';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { planFrame } from '../../core/plan/frame';
import type { FieldSpec } from '../../core/types/field';
import type { Profile } from '../../core/types/profile';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { removeFixtures } from '../../dom/fixture.testkit';
import { toFieldSpec } from '../../dom/scan';
import { scanCase } from '../test/expectations.testkit';

const EXELIXIS = 'https://exelixis.wd1.myworkdayjobs.com/en-US/exel/job/Alameda%2C-CA/Engineer-II---DevSecOps_JR7197/apply/autofillWithResume';
const VERILY = 'https://verily.wd1.myworkdayjobs.com/en-US/verily_careers/job/Dallas%2C-Texas/Security-Operations-Tech-Lead_REQ-966/apply';

afterEach(() => removeFixtures(document));

/** A step scanned and planned (the posting's company named, as the lookup names it). */
async function planned(html: string, address: string, profile: Profile = goldenProfile()) {
  const scanned = await scanCase(document, html, address);
  const specs = scanned.result.fields.map(toFieldSpec);
  const out = planFrame({ specs, canaries: [], profile, sensitiveState: 'loaded', savedAnswers: [],
    settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW });
  const all = (label: string) => specs.filter((spec) => spec.label === label);
  const of = (spec: FieldSpec) => ({ row: out.results.find((row) => row.key === spec.key)!,
    write: out.writes.find((write) => write.key === spec.key) });
  const one = (label: string) => {
    const found = all(label);
    expect(found, label).toHaveLength(1);
    return of(found[0]!);
  };
  return { all, of, one };
}

describe('s2 core-wd: My Information (exelixis, verily)', () => {
  it.each([['exelixis', stateHtml, EXELIXIS], ['verily', infoHtml, VERILY]] as const)(
    '%s: the phone code, device type, extension, preferred name and source are read as theirs', async (_, html, url) => {
      const step = await planned(html, url);
      expect(step.one('Country Phone Code').row).toMatchObject({ kind: 'typeahead-remote',
        category: 'contact.phoneCountry' });
      // Its prompt is searched by the phone's country, another spelling and the dial code, then the list's "Other".
      expect(step.one('Country Phone Code').write?.value).toEqual({ kind: 'query',
        queries: ['United States', 'USA', '+1'], other: true });
      // The number beside its own code control is typed without the code.
      const number = step.one('Phone Number').write?.value;
      expect(number?.kind === 'text' ? number.text.replace(/\D/g, '') : '').toBe('5125550147');
      expect(step.one('Phone Device Type').row).toMatchObject({ category: 'contact.phoneType',
        reason: 'waiting-for-options' });
      expect(step.one('Phone Extension').row).toMatchObject({ category: 'contact.phoneExtension', status: 'skipped',
        reason: 'no-profile-value' });
      expect(step.one('I have a preferred name').row).toMatchObject({ category: 'identity.hasPreferredName',
        status: 'skipped' });
      expect(step.one('How Did You Hear About Us?').row).toMatchObject({ kind: 'typeahead-remote',
        category: 'referral.source' });
      expect(step.one('How Did You Hear About Us?').write?.value).toMatchObject({ kind: 'query', other: true });
    });

  it('exelixis: Suffix is the name\'s suffix; Prefix is the name\'s prefix, skipped (jr6 WD-25)', async () => {
    const step = await planned(stateHtml, EXELIXIS);
    expect(step.one('Suffix').row).toMatchObject({ category: 'identity.suffix', status: 'skipped',
      reason: 'no-profile-value' });
    expect(step.one('Prefix').row).toMatchObject({ category: 'identity.prefix', status: 'skipped',
      reason: 'no-profile-value' });
  });

  it('exelixis: with a preferred name, an extension and a device type in the profile, each is answered', async () => {
    const golden = goldenProfile();
    const profile: Profile = { ...golden, identity: { ...golden.identity, preferredName: 'AJ', suffix: 'Jr.' },
      contact: { ...golden.contact, phone: { ...golden.contact.phone!, extension: '204', type: 'work' } } };
    const step = await planned(stateHtml, EXELIXIS, profile);
    expect(step.one('I have a preferred name').write?.value).toEqual({ kind: 'check' });
    expect(step.one('Phone Extension').write?.value).toEqual({ kind: 'text', text: '204' });
  });
});

describe('s2 core-wd: My Experience and Education (exelixis, verily)', () => {
  it('verily: "Overall Result (GPA)" is the GPA and "X" the X (Twitter) link', async () => {
    const step = await planned(studyHtml, VERILY);
    expect(step.one('Overall Result (GPA)').row.category).toBe('education.gpa');
    expect(step.one('X').row.category).toBe('links.twitter');
  });

  it("exelixis: each block's Location is that job's, and its Role Description the job's description", async () => {
    const step = await planned(experienceHtml, EXELIXIS);
    const locations = step.all('Location').map(step.of);
    expect(locations).toHaveLength(4);
    expect(locations.map((each) => each.row.category)).toEqual(Array(4).fill('experience.location'));
    // Never the person's current location: a write names its block's own entry, and a block with no entry of the
    // profile's (the resume parse's extra jobs) gets nothing.
    for (const each of locations) {
      if (each.write !== undefined) expect(each.write.origin).toMatchObject({ path: expect.stringMatching(/^experience\[\d+\]\.location$/) });
    }
    expect(locations.slice(2).map((each) => each.write)).toEqual([undefined, undefined]);
    const roles = step.all('Role Description').map(step.of);
    expect(roles.map((each) => each.row.category)).toEqual(Array(4).fill('experience.description'));
    expect(roles[0]!.write?.origin).toMatchObject({ path: 'experience[0].description' });
  });
});
