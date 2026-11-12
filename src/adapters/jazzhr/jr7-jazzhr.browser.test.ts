/*
 * jr7 BOARDS-7 P1 (FIX7PLAN §6.13; SP\jr7\audit\boards.md J7-JZ-2 and J7-JZ-3, confirmed by boards-verify.md): JazzHR's
 * adapter on the owner's snapshot7 applytojob1 pages (fixtures/jazzhr/jr7-applytojob1-*), through the real registry,
 * adapter and scan:
 * - J7-JZ-3: the classic layout's checkbox question ("What AWS certifications do you currently hold?", nine boxes, each
 *   its own name) is one checkbox group of nine options, no longer nine lone consent boxes: 23 → 15 fields on both form
 *   captures, and no other JazzHR capture moves (the verifier's measure).
 * - J7-JZ-2: the page after submitting draws "We've received your application!" in section.submit_success, a second
 *   sign beside its address, read for an armed Submit of JazzHR's (code.successSigns); none before the press on every
 *   other JazzHR page, none for another platform's arm, none without its paragraph.
 * Nothing here reads or prints a value of the owner's (the pages' values are the converter's).
 */
import { afterEach, describe, expect, it } from 'vitest';
import centroidHtml from '../../../fixtures/jazzhr/jr6-centroid-form.html?raw';
import invaluableHtml from '../../../fixtures/jazzhr/invaluable-form.html?raw';
import confirmationHtml from '../../../fixtures/jazzhr/jr7-applytojob1-confirmation.html?raw';
import formBHtml from '../../../fixtures/jazzhr/jr7-applytojob1-form-b.html?raw';
import formHtml from '../../../fixtures/jazzhr/jr7-applytojob1-form.html?raw';
import nucleusHtml from '../../../fixtures/jazzhr/nucleussecurity-form.html?raw';
import panoptHtml from '../../../fixtures/jazzhr/panoptimization-form.html?raw';
import wellhiveHtml from '../../../fixtures/jazzhr/wellhive-submitting.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { applicationKey } from '../application-key';
import { adaptersFor, applicationOf } from '../index';
import { successSignsOf } from '../success';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { JAZZHR_CONFIG, JAZZHR_RECEIVED, JAZZHR_JR7_SNAPSHOTS } from './config';
import { jazzhrAdapter } from './index';

const sourceOf = (html: string): string => /"source":"([^"]+)"/.exec(html)![1]!;
const ARM = applicationKey('jazzhr', 'https://example.applytojob.com/apply/abcdefghij/synthetic-posting');
const QUESTION = 'What AWS certifications do you currently hold?';

afterEach(() => removeFixtures(document));

/** A JazzHR capture's scan through the registry's adapter for its own address. */
async function scanned(html: string) {
  const url = new URL(sourceOf(html));
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const adapter = adaptersFor(url, fixture.doc).find((each) => each.detect(fixture.doc) !== null)!;
  expect(adapter.id).toBe('jazzhr');
  const root = adapter.detect(fixture.doc)!.formRoot;
  return { fixture, result: scan(root, adapter, { platform: 'jazzhr' }) };
}

describe('jr7 JazzHR: the snapshot7 pages it reads', () => {
  it('names them, and reads each address as JazzHR\'s (the forms as the application, the last as its confirmation)', () => {
    expect([...JAZZHR_JR7_SNAPSHOTS]).toEqual(['jr7-applytojob1-form', 'jr7-applytojob1-form-b',
      'jr7-applytojob1-confirmation']);
    for (const name of JAZZHR_JR7_SNAPSHOTS) expect(JAZZHR_CONFIG.snapshots).toContain(name);
    expect([formHtml, formBHtml, confirmationHtml].map((html) => applicationOf(new URL(sourceOf(html)))?.page))
      .toEqual(['application', 'application', 'confirmation']);
  });
});

describe('J7-JZ-3: the classic layout\'s checkbox question is one group', () => {
  it.each([['jr7-applytojob1-form', formHtml], ['jr7-applytojob1-form-b', formBHtml]])(
    '%s: one checkbox group of nine options, 15 fields, no lone consent box from it', async (_name, html) => {
      const { result } = await scanned(html);
      expect(result.fields).toHaveLength(15);
      const group = result.fields.filter((field) => field.label === QUESTION);
      expect(group.map((field) => [field.kind, field.required, field.options === 'lazy' ? 'lazy' : field.options.length]))
        .toEqual([['checkbox-group', false, 9]]);
      // Every box of the question is the group's member, none a field of its own.
      const boxes = new Set(result.fields.flatMap((field) => {
        const target = result.target(field.key);
        return target === null ? [] : [target.control, ...target.members];
      }).filter((el) => el.matches('input.resumator-questionnaire-checkbox')));
      expect(boxes.size).toBe(9);
      const groupTarget = result.target(group[0]!.key)!;
      expect(new Set([groupTarget.control, ...groupTarget.members]).size).toBe(9);
      expect(result.fields.filter((field) => field.kind === 'checkbox')).toEqual([]);
    });

  it.each([
    ['jr6-centroid-form', centroidHtml, 9], ['invaluable-form', invaluableHtml, 15], ['nucleussecurity-form', nucleusHtml, 15],
    ['panoptimization-form', panoptHtml, 12], ['wellhive-submitting', wellhiveHtml, 12],
  ] as const)('%s: unmoved (%i fields)', async (_name, html, count) => {
    const { result } = await scanned(html);
    expect(result.fields).toHaveLength(count);
  });
});

describe('J7-JZ-2: the page after submitting draws a second sign', () => {
  it('jr7-applytojob1-confirmation: section.submit_success, for an arm of JazzHR\'s; Jobright\'s rule finds none there', async () => {
    const fixture = await loadFixture(document, confirmationHtml, SNAPSHOT_VIEWPORT);
    const section = fixture.doc.querySelector('body#resumator-jobboard-screen section.submit_success');
    expect(section).not.toBeNull();
    expect(jazzhrAdapter.successSigns!(fixture.doc, ARM)).toEqual([section]);
    expect(successSignsOf(fixture.doc, [JAZZHR_CONFIG.success!])).toEqual([]);
    expect(jazzhrAdapter.successSigns!(fixture.doc, applicationKey('smartrecruiters',
      'https://jobs.smartrecruiters.com/Company/1'))).toEqual([]);
  });

  it('reads none without the paragraph saying the application was received, nor hidden', async () => {
    const fixture = await loadFixture(document, confirmationHtml, SNAPSHOT_VIEWPORT);
    const section = fixture.doc.querySelector<HTMLElement>('section.submit_success')!;
    const words = section.querySelector('p')!;
    const said = words.textContent;
    words.textContent = 'Synthetic other words.';
    expect(successSignsOf(fixture.doc, [JAZZHR_RECEIVED])).toEqual([]);
    words.textContent = said;
    expect(successSignsOf(fixture.doc, [JAZZHR_RECEIVED])).toEqual([section]);
    section.style.display = 'none';
    expect(jazzhrAdapter.successSigns!(fixture.doc, ARM)).toEqual([]);
  });

  it.each([
    ['jr7-applytojob1-form', formHtml], ['jr7-applytojob1-form-b', formBHtml], ['jr6-centroid-form', centroidHtml],
    ['invaluable-form', invaluableHtml], ['nucleussecurity-form', nucleusHtml], ['panoptimization-form', panoptHtml],
    ['wellhive-submitting', wellhiveHtml],
  ])('%s: none before the press', async (_name, html) => {
    const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
    expect(jazzhrAdapter.successSigns!(fixture.doc, ARM)).toEqual([]);
  });
});
