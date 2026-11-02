/*
 * The live BeyondTrust form (fixtures/greenhouse/beyondtrust-job, captured 2026-11-01) planned by the real planFrame:
 * its scan, then the lists its two questions showed when opened (the capture's reading of 2026-11-01, copied below) as
 * the run's widget readings. The run of 2026-11-01 left three required questions for the person
 * there: the basis of the right to work (distinctive-token-mismatch), "Please review and acknowledge BeyondTrust's"
 * (llm-disabled-for-category) and the demographic consent box (consent-optional-unticked, required only once a
 * demographic answer is chosen). The first two are planned here; the third is the loop's (bookkeeping.ts 'required',
 * src/content/greenhouse-beyondtrust.browser.test.ts).
 */
import { afterEach, describe, expect, it } from 'vitest';
import beyondtrustHtml from '../../../fixtures/greenhouse/beyondtrust-job.html?raw';
import { planFrame } from '../../core/plan/frame';
import type { BaseKey, FieldSpec } from '../../core/types/field';
import type { Profile } from '../../core/types/profile';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import type { WidgetReading } from '../../dom/types';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { greenhouseAdapter } from './index';

const RIGHT_TO_WORK = 'question_70199751';
const ACKNOWLEDGE = 'question_70199752';
const CONSENT_BOX = 'gdpr_demographic_data_consent_given_1';
/** The lists the two questions showed when the capture opened them. */
const CAPTURED: Readonly<Record<string, readonly string[]>> = {
  [RIGHT_TO_WORK]: ['I have the right to work in the country of employment on a permanent basis',
    'I have or will obtain a work permit not requiring sponsorship/immigration support from BeyondTrust',
    'I will require sponsorship or other immigration support to obtain the right to work in the country of employment'],
  [ACKNOWLEDGE]: ['Acknowledge/Confirm'],
};

/** The golden profile, its US entry naming a citizen (authorized, no sponsorship now or later). */
function citizen(): Profile {
  const golden = goldenProfile();
  return { ...golden, workAuthorization: golden.workAuthorization.map((entry) => (entry.country === 'US'
    ? { ...entry, status: { kind: 'value', value: 'citizen' } } : entry)) };
}

/** The fixture scanned, the two questions' lists read (`read`: as the capture read them) or not. */
async function specsOf(read: boolean): Promise<FieldSpec[]> {
  const fixture = await loadFixture(document, beyondtrustHtml, SNAPSHOT_VIEWPORT);
  const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
  const first = scan(root, greenhouseAdapter, { platform: 'greenhouse' });
  if (!read) return first.fields.map(toFieldSpec);
  const readings = new Map<BaseKey, WidgetReading>();
  for (const [id, labels] of Object.entries(CAPTURED)) {
    const field = first.fields.find((candidate) => candidate.idAttr === id)!;
    readings.set(field.baseKey, { kind: 'options', multiselectable: false, complete: true,
      options: labels.map((label) => ({ label, disabled: false })) });
  }
  return scan(root, greenhouseAdapter, { platform: 'greenhouse', widgetReadings: readings }).fields.map(toFieldSpec);
}

function plan(specs: FieldSpec[], profile: Profile = citizen()) {
  return planFrame({ specs, canaries: [], profile, sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS,
    vocab: testVocab(), dryRun: false, now: NOW, posting: { company: 'BeyondTrust', location: 'Austin, TX, USA' } });
}

describe('the live BeyondTrust form planned', () => {
  afterEach(() => removeFixtures(document));

  it('reads the right to work and the acknowledgment once their lists are read, and waits for them until then', async () => {
    const lazy = await specsOf(false);
    const rowOf = (specs: FieldSpec[], out: ReturnType<typeof plan>, id: string) =>
      out.results.find((row) => row.key === specs.find((spec) => spec.idAttr === id)!.key)!;
    const before = plan(lazy);
    expect(rowOf(lazy, before, RIGHT_TO_WORK)).toMatchObject({ category: 'workAuth.authorized',
      reason: 'waiting-for-options' });
    // The acknowledgment, no longer screened from the LLM: a consent, read whole before it is decided.
    expect(rowOf(lazy, before, ACKNOWLEDGE)).toMatchObject({ category: 'consent.other', reason: 'waiting-for-options' });
    // The box, optional while nothing is answered: left unticked, decided.
    expect(rowOf(lazy, before, CONSENT_BOX)).toMatchObject({ category: 'consent.other', status: 'skipped',
      reason: 'consent-optional-unticked', required: false });

    const read = await specsOf(true);
    const after = plan(read);
    const writeOf = (id: string) => after.writes.find((write) => write.key === read.find((spec) => spec.idAttr === id)!.key);
    expect(writeOf(RIGHT_TO_WORK)).toMatchObject({ value: { kind: 'option', index: 0,
      cleanLabel: 'I have the right to work in the country of employment on a permanent basis' },
      origin: { provenance: 'profile', path: 'workAuthorization[0]', transform: 'legal.posting-country' } });
    expect(rowOf(read, after, RIGHT_TO_WORK)).toMatchObject({ category: 'workAuth.authorized', matcherStage: 'exact',
      reason: 'filled-low-confidence' });
    expect(writeOf(ACKNOWLEDGE)).toMatchObject({ value: { kind: 'option', index: 0, cleanLabel: 'Acknowledge/Confirm' },
      origin: { provenance: 'rule', ruleId: 'consent.required' } });
    expect(rowOf(read, after, ACKNOWLEDGE)).toMatchObject({ category: 'consent.other', status: 'verified', reason: 'ok' });
    // The box made required, as the page makes it once a demographic answer is chosen: ticked.
    const required = read.map((spec) => (spec.idAttr === CONSENT_BOX ? { ...spec, required: true } : spec));
    const ticked = plan(required);
    expect(ticked.writes.find((write) => write.key === required.find((spec) => spec.idAttr === CONSENT_BOX)!.key))
      .toMatchObject({ value: { kind: 'check' }, origin: { provenance: 'rule', ruleId: 'consent.required' } });
  });

  it('asks the all scope about the right to work, with all three sentences, when the profile does not settle it', async () => {
    const read = await specsOf(true);
    const out = plan(read, goldenProfile());
    const key = read.find((spec) => spec.idAttr === RIGHT_TO_WORK)!.key;
    expect(out.writes.some((write) => write.key === key)).toBe(false);
    expect(out.ask?.answers?.find((item) => item.key === key)).toMatchObject({ scope: 'all', shape: 'choice',
      options: [{ index: 0 }, { index: 1 }, { index: 2 }] });
  });
});
