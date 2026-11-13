/*
 * jr7 BOARDS-7 P2 (FIX7PLAN §6.13 "P2", §8): the shared outcomes on the owner's snapshot7 board captures that other
 * packages built, asserted on BOARDS-7's fixtures with the golden synthetic profile (never the owner's data):
 * - J7-GH-1 and J7-GH-2 (RULES-7) on jr7-greenhouse-form, its two lists stood in (the capture shows none open; synthetic
 *   options): the required sponsorship question whose sentence names the employer "Zip" is workAuth.sponsorship,
 *   answered "No", never a ZIP code; "What US state do you reside in?" is address.region, the profile's "Texas";
 * - J7-SR-2 (jr6 REVC-3, in jr6-done) on jr7-smartrecruiter1-oneclick-filled, captured in the manual location mode:
 *   its Country/Region search and its City box are the profile's (the search mode's REVC-3 test stays jr6's);
 * - the readiness table's sign evidence (§8): Greenhouse's and Ashby's pages after Submit show their platform's sign,
 *   and their form pages none before the press.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import ashbyApplicationHtml from '../../fixtures/ashby/jr7-ashby-application.html?raw';
import ashbySuccessHtml from '../../fixtures/ashby/jr7-ashby-success.html?raw';
import ghConfirmationHtml from '../../fixtures/greenhouse/jr7-greenhouse-confirmation.html?raw';
import ghFormHtml from '../../fixtures/greenhouse/jr7-greenhouse-form.html?raw';
import srOneClickHtml from '../../fixtures/smartrecruiters/jr7-smartrecruiter1-oneclick-filled.html?raw';
import { goldenProfile, NOW, testVocab } from '../content/content.testkit';
import { signsOf } from '../content/submitted';
import { planFrame } from '../core/plan/frame';
import type { BaseKey, FieldSpec } from '../core/types/field';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { scan, toFieldSpec } from '../dom/scan';
import type { WidgetReading } from '../dom/types';
import { greenhouseAdapter } from './greenhouse';
import { smartRecruitersAdapter } from './smartrecruiters';
import { SNAPSHOT_VIEWPORT } from './test/expectations.testkit';

const sourceOf = (html: string): string => /"source":"([^"]+)"/.exec(html)![1]!;

beforeAll(() => {
  testVocab();
});
afterEach(() => removeFixtures(document));

/** The plan of a scan's fields with the golden profile at a posting of `company`. */
function planned(specs: FieldSpec[], company: string) {
  return planFrame({ specs, canaries: [], profile: goldenProfile(), sensitiveState: 'loaded', savedAnswers: [],
    settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company, location: 'Austin, TX, USA' } });
}

/** A planned field's [category, status, reason, chosen option or text]. */
function outcomeOf(out: ReturnType<typeof planned>, spec: FieldSpec) {
  const row = out.results.find((each) => each.key === spec.key);
  const write = out.writes.find((each) => each.key === spec.key);
  const value = write === undefined ? null : write.value.kind === 'option' ? write.value.cleanLabel
    : write.value.kind === 'text' ? write.value.text : write.value.kind;
  return [row?.category, row?.status, row?.reason, value];
}

describe('J7-GH-1 and J7-GH-2 (RULES-7) on jr7-greenhouse-form', () => {
  /** The two react-select lists, stood in with synthetic options (the capture shows neither open). */
  const LISTS: Record<string, readonly string[]> = {
    question_8800326006: ['Yes', 'No'],
    question_8800325006: ['Alabama', 'Texas', 'Washington', 'I do not reside in the US'],
  };

  it('the sponsorship question naming "Zip": workAuth.sponsorship, "No"; the US state: address.region, "Texas"', async () => {
    const fixture = await loadFixture(document, ghFormHtml, SNAPSHOT_VIEWPORT);
    const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
    const first = scan(root, greenhouseAdapter, { platform: 'greenhouse' });
    const readings = new Map<BaseKey, WidgetReading>();
    for (const field of first.fields) {
      const list = LISTS[field.idAttr];
      if (list !== undefined) {
        readings.set(field.baseKey, { kind: 'options', multiselectable: false, complete: true,
          options: list.map((label) => ({ label, disabled: false })) });
      }
    }
    const specs = scan(root, greenhouseAdapter, { platform: 'greenhouse', widgetReadings: readings }).fields
      .map(toFieldSpec);
    const out = planned(specs, 'Zip Co Limited');
    const sponsorship = specs.find((spec) => spec.idAttr === 'question_8800326006')!;
    const state = specs.find((spec) => spec.idAttr === 'question_8800325006')!;
    // The capture's own questions (booleans only): the employer's name stands in the sponsorship sentence.
    expect([/\bzip\b/i.test(sponsorship.label), sponsorship.required, /what us state/i.test(state.label)])
      .toEqual([true, true, true]);
    expect(outcomeOf(out, sponsorship)).toEqual(['workAuth.sponsorship', 'verified', 'ok', 'No']);
    expect(outcomeOf(out, state).slice(0, 1)).toEqual(['address.region']);
    expect(outcomeOf(out, state)[3]).toBe('Texas');
  });
});

describe('J7-SR-2 (jr6 REVC-3) on jr7-smartrecruiter1-oneclick-filled (the manual location mode)', () => {
  it('its City box and Country/Region search are the profile\'s', async () => {
    const fixture = await loadFixture(document, srOneClickHtml, SNAPSHOT_VIEWPORT);
    const base = fixture.doc.createElement('base');
    base.href = sourceOf(srOneClickHtml);
    fixture.doc.head.prepend(base);
    const root = smartRecruitersAdapter.detect(fixture.doc)!.formRoot;
    const specs = scan(root, smartRecruitersAdapter, { platform: 'smartrecruiters' }).fields.map(toFieldSpec);
    const out = planned(specs, 'Company');
    const city = specs.find((spec) => spec.label === 'City')!;
    const country = specs.find((spec) => spec.label === 'Country/Region')!;
    expect([city.kind, country.kind]).toEqual(['text', 'combobox']);
    expect(outcomeOf(out, city)).toEqual(['address.city', 'verified', 'ok', 'Austin']);
    expect(outcomeOf(out, country)[0]).toBe('address.country');
  });
});

describe('the readiness table\'s sign evidence (FIX7PLAN §8) on the snapshot7 Greenhouse and Ashby captures', () => {
  it.each([
    ['jr7-greenhouse-confirmation', ghConfirmationHtml, 'greenhouse', 1],
    ['jr7-greenhouse-form', ghFormHtml, 'greenhouse', 0],
    ['jr7-ashby-success', ashbySuccessHtml, 'ashby', 1],
    ['jr7-ashby-application', ashbyApplicationHtml, 'ashby', 0],
  ] as const)('%s: %i sign(s) of its platform', async (_name, html, platform, count) => {
    const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
    expect(signsOf(fixture.doc, platform)).toHaveLength(count);
  });
});
