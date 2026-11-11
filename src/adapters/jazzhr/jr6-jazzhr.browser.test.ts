/*
 * jr6 (FIXPLAN 6.8): the JazzHR audit's harness (SP\jr6\audit\jazzhr.md §3) as asserts. JazzHR's pages as the owner
 * captured them (fixtures/jazzhr: the four 2026-11-06 Bootstrap cases and jr6-centroid-form, the 2026-11-10 capture in
 * the classic "resumator" layout), measured through the real registry, adapter, scan and planner: which adapter takes
 * the page, what it says of the step (final, Submit, busy, errors, posting text, the Human Check), and the writes the
 * golden synthetic profile (never the owner's data) gives with DEFAULT_SETTINGS, every one of the classic page's text
 * writes guarded, landed and read back as the runtime does them.
 * P1 asserts only what JazzHR's own rules decide. The questions RULES answers in jr6 (JZ-6 Race/Ethnicity, JZ-7 the
 * citizenship select, JZ-8 the Yes/No citizen question, JZ-9 the state question, JZ-11 the in-country questions) and
 * the résumé's reveal-and-upload on the classic page (ENGINE E2's reveal door, JZ-4) are P2's asserts
 * (SP\jr6\build\JAZZHR.md).
 */
import { afterEach, describe, expect, it } from 'vitest';
import centroidHtml from '../../../fixtures/jazzhr/jr6-centroid-form.html?raw';
import invaluableHtml from '../../../fixtures/jazzhr/invaluable-form.html?raw';
import nucleusHtml from '../../../fixtures/jazzhr/nucleussecurity-form.html?raw';
import panoptHtml from '../../../fixtures/jazzhr/panoptimization-form.html?raw';
import wellhiveHtml from '../../../fixtures/jazzhr/wellhive-submitting.html?raw';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { planFrame } from '../../core/plan/frame';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { fill } from '../../dom/fillers';
import { verifyAfterSettle } from '../../dom/fillers/verify';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { domGuardBeforeWrite } from '../../dom/guard';
import { detectPause, pageChallenged } from '../../dom/pause-detect';
import { scan, toFieldSpec } from '../../dom/scan';
import { platformOfUrl } from '../../shared/hosts';
import { adaptersFor, applicationOf } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { jazzhrAdapter } from './index';

/** What each capture's step says: [final, Submit (tag#id), busy, posting text's id, fields scanned]. */
const CASES = [
  { name: 'jr6-centroid-form', html: centroidHtml, step: ['final', 'input#resumator-submit-resume', false,
    'resumator-job-description', 9] },
  { name: 'invaluable-form', html: invaluableHtml, step: ['final', 'a#resumator-submit-resume', false, 'job-description', 15] },
  { name: 'nucleussecurity-form', html: nucleusHtml, step: ['final', 'a#resumator-submit-resume', false, 'job-description',
    15] },
  { name: 'panoptimization-form', html: panoptHtml, step: ['final', 'a#resumator-submit-resume', false, 'job-description',
    12] },
  // Captured after Submit was pressed: "Submitting...please wait...", Submit gone (correct for this state).
  { name: 'wellhive-submitting', html: wellhiveHtml, step: ['unknown', 'none', true, 'job-description', 12] },
] as const;

const sourceOf = (html: string) => /"source":"([^"]+)"/.exec(html)![1]!;
const nameOf = (el: Element | null | undefined) => (el == null ? 'none' : `${el.localName}${el.id ? `#${el.id}` : ''}`);

/** The page's plan with the golden profile. */
function planOf(fields: ReturnType<typeof scan>['fields']) {
  return planFrame({ specs: fields.map(toFieldSpec), canaries: [], profile: goldenProfile(), sensitiveState: 'loaded',
    savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company: 'Company', location: 'Austin, TX, USA' } });
}

/** The profile's writes every JazzHR page asks the same of (id → category), JazzHR's own fields: the names, email,
 *  phone, address and résumé. */
const CORE = [
  ['resumator-firstname-value', 'identity.firstName', 'text'],
  ['resumator-lastname-value', 'identity.lastName', 'text'],
  ['resumator-email-value', 'contact.email', 'text'],
  ['resumator-phone-value', 'contact.phone', 'text'],
  ['resumator-address-value', 'address.line1', 'text'],
  ['resumator-city-value', 'address.city', 'text'],
  ['resumator-state-value', 'address.region', 'text'],
  ['resumator-postal-value', 'address.postalCode', 'text'],
  ['resumator-resume-value', 'file.resume', 'file'],
] as const;

afterEach(() => removeFixtures(document));

describe('jr6 JazzHR: each capture through the registry, adapter, scan and plan', () => {
  it.each(CASES)('$name: JazzHR\'s adapter, its step, and the profile\'s writes of the core fields', async ({ html, step }) => {
    const url = new URL(sourceOf(html));
    const page = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
    expect(platformOfUrl(url.href)).toBe('jazzhr');
    expect(applicationOf(url)).toMatchObject({ platform: 'jazzhr', page: 'application' });
    const adapter = adaptersFor(url, page.doc).find((each) => each.detect(page.doc) !== null);
    expect(adapter?.id).toBe('jazzhr');
    const root = adapter!.detect(page.doc)!.formRoot;
    expect(root.matches('form#form_submit_new_resume')).toBe(true);
    const [final, submit, busy, posting, count] = step;
    expect([adapter!.isFinalStep?.(page.doc), nameOf(adapter!.submitButton?.(root)), adapter!.isBusy?.(page.doc),
      adapter!.postingText?.(page.doc)?.id, adapter!.nextButton, adapter!.entryControl?.(page.doc) ?? null,
      adapter!.errors?.(root)]).toEqual([final, submit, busy, posting, undefined, null, []]);
    // The Human Check is the person's: no pause, nothing challenged before a press (v5 PLAN decision 9).
    expect([detectPause(page.doc, root, adapter!), pageChallenged(page.doc)]).toEqual([null, false]);
    const scanned = scan(root, adapter!, { platform: 'jazzhr' });
    expect([scanned.fields.length, scanned.unrecognisedUploads.length, scanned.authFields]).toEqual([count, 0, 0]);
    const out = planOf(scanned.fields);
    const writes = CORE.map(([id]) => {
      const field = scanned.fields.find((each) => each.idAttr === id)!;
      const write = out.writes.find((each) => each.key === field.key);
      return [id, out.results.find((each) => each.key === field.key)?.category, write?.value.kind, write?.origin.provenance];
    });
    expect(writes).toEqual(CORE.map(([id, category, kind]) => [id, category, kind, 'profile']));
  });
});

describe('jr6 JazzHR: the classic layout\'s writes, guarded, landed and read back (JZ-1)', () => {
  it('jr6-centroid-form: every planned text write passes the DOM guard, lands and reads back; the résumé is planned',
    async () => {
      const page = await loadFixture(document, centroidHtml, SNAPSHOT_VIEWPORT);
      const root = jazzhrAdapter.detect(page.doc)!.formRoot;
      const first = scan(root, jazzhrAdapter, { platform: 'jazzhr' });
      const out = planOf(first.fields);
      // As the runtime keeps them (DOM-7): a placeholder our write hides still names its box.
      const held = new WeakMap<Element, string>();
      const rescan = () => scan(root, jazzhrAdapter, { platform: 'jazzhr', heldPlaceholders: held });
      const outcomes: Array<[string, string, string]> = [];
      for (const write of out.writes) {
        const field = first.fields.find((each) => each.key === write.key)!;
        // The résumé's upload on the classic page waits for ENGINE's reveal door (JZ-4): P2 measures it.
        if (write.value.kind === 'file') {
          expect([field.label, field.visibility]).toEqual(['Resume', 'hidden-file-with-visible-control']);
          continue;
        }
        const guard = domGuardBeforeWrite(first, { key: field.key, baseKey: field.baseKey, label: field.label,
          kind: field.kind });
        expect(guard.ok, field.label).toBe(true);
        if (!guard.ok) continue;
        if (field.labelSource === 'placeholder') held.set(guard.target.control, field.label);
        const outcome = fill(guard.target, write.value, { adapter: jazzhrAdapter, root });
        const verified = verifyAfterSettle(rescan(), field.key, write.value);
        outcomes.push([field.label, `${outcome.wrote}/${outcome.reason}`, `${verified.verification}/${verified.reason}`]);
      }
      expect(outcomes).toEqual(['First name', 'Last name', 'Email address', 'Address', 'City', 'State', 'Postal',
        'Phone number'].map((label) => [label, 'true/ok', 'verified/ok']));
      expect(out.writes).toHaveLength(9);
      expect(out.awaiting).toEqual([]);
    });
});

describe('jr6 JazzHR: facts the findings rest on (the classic layout)', () => {
  it('JZ-2, JZ-3, JZ-13: Submit is an input[type=button], the adapter\'s Submit; Cancel beside it is never pressed',
    async () => {
      const page = await loadFixture(document, centroidHtml, SNAPSHOT_VIEWPORT);
      const root = jazzhrAdapter.detect(page.doc)!.formRoot;
      const submit = page.doc.querySelector('input#resumator-submit-resume');
      expect(submit?.getAttribute('type')).toBe('button');
      expect(page.doc.querySelector('a#resumator-submit-resume')).toBeNull();
      expect(jazzhrAdapter.submitButton?.(root)).toBe(submit);
      const cancel = page.doc.querySelector('input#resumator-cancel-resume');
      expect(cancel?.getAttribute('type')).toBe('button');
      expect(jazzhrAdapter.neverPress?.(root)).toContain(cancel);
    });

  it('JZ-4: the classic layout hides the file input until "Attach resume", the upload\'s control, never pressed by a run',
    async () => {
      const page = await loadFixture(document, centroidHtml, SNAPSHOT_VIEWPORT);
      const root = jazzhrAdapter.detect(page.doc)!.formRoot;
      const wrapper = page.doc.querySelector('#resumator-resume-upload-wrapper')!;
      expect(wrapper.classList.contains('none')).toBe(true);
      expect(page.view.getComputedStyle(wrapper).display).toBe('none');
      const attach = page.doc.querySelector('#resumator-choose-upload')!;
      expect(jazzhrAdapter.neverPress?.(root)).toContain(attach);
      const fields = scan(root, jazzhrAdapter, { platform: 'jazzhr' }).fields.filter((field) => field.kind === 'file');
      expect(fields.map((field) => [field.label, field.required])).toEqual([['Resume', true]]);
    });
});
