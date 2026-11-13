/*
 * jr7 BOARDS-7 P1 (FIX7PLAN §6.13; J7V-JV-1, the boards verifier's missed finding in SP\jr7\audit\boards-verify.md):
 * Jobvite's step 1 on the owner's snapshot7 jobvite1 captures (fixtures/jobvite/jr7-jobvite1-step1, -step1-b,
 * -step1-filled), through the real adapter, scan and planner with the golden synthetic profile (never the owner's data).
 * While the person has the résumé's attachment popover open (step1-b: div#attachmentDropdown[role=dialog],
 * aria-hidden="false", beside "Add Resume"), the required résumé input read as an optional "File" of no category and
 * was never uploaded: its popover's own label[for] showed and was read first. The adapter now reads both file inputs by
 * their own question first (labelFirst), so step1-b reads as step1 does: "Add Resume" required, file.resume, planned;
 * "Add Cover Letter" optional.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import step1bHtml from '../../../fixtures/jobvite/jr7-jobvite1-step1-b.html?raw';
import filledHtml from '../../../fixtures/jobvite/jr7-jobvite1-step1-filled.html?raw';
import confirmationHtml from '../../../fixtures/jobvite/jr7-jobvite1-confirmation.html?raw';
import postingHtml from '../../../fixtures/jobvite/jr7-jobvite1-posting.html?raw';
import step2Html from '../../../fixtures/jobvite/jr7-jobvite1-step2-filled.html?raw';
import step1Html from '../../../fixtures/jobvite/jr7-jobvite1-step1.html?raw';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { signsOf } from '../../content/submitted';
import { planFrame } from '../../core/plan/frame';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import { isUserVisible } from '../../dom/visibility';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { jobviteAdapter } from './index';

beforeAll(() => {
  testVocab();
});
afterEach(() => removeFixtures(document));

/** step1-b with the cover letter's popover open instead of the résumé's (a DOM variant made here): the shown
 *  popover's marks (no ng-hide, jv-tooltip-top, aria-hidden "false", its place) moved to the other. */
function coverLetterOpen(doc: Document): void {
  const [resume, cover] = Array.from(doc.querySelectorAll<HTMLElement>('div.jv-add-attachment[role="dialog"]'));
  const place = resume!.getAttribute('style') ?? '';
  resume!.classList.add('ng-hide');
  resume!.classList.remove('jv-tooltip-top');
  resume!.setAttribute('aria-hidden', 'true');
  resume!.removeAttribute('style');
  cover!.classList.remove('ng-hide');
  cover!.classList.add('jv-tooltip-top');
  cover!.setAttribute('aria-hidden', 'false');
  cover!.setAttribute('style', place);
}

/** A step-1 capture's file fields, as [label, required, label source, category, planned value kind]. */
async function filesOf(html: string, variant: (doc: Document) => void = () => undefined) {
  const { doc } = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  variant(doc);
  const root = jobviteAdapter.detect(doc)!.formRoot;
  const result = scan(root, jobviteAdapter, { platform: 'jobvite' });
  const out = planFrame({ specs: result.fields.map(toFieldSpec), canaries: [], profile: goldenProfile(),
    sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company: 'Company', location: 'Austin, TX, USA' } });
  const popovers = Array.from(doc.querySelectorAll('div.jv-add-attachment[role="dialog"]'))
    .map((popover) => [popover.querySelector('#file-input-0') !== null, isUserVisible(popover)]);
  const files = result.fields.filter((field) => field.kind === 'file').map((field) => [field.label, field.required,
    field.labelSource, out.results.find((each) => each.key === field.key)?.category ?? null,
    out.writes.find((each) => each.key === field.key)?.value.kind ?? null]);
  return { count: result.fields.length, popovers, files };
}

const READ = [
  ['Add Resume', true, 'adapter', 'file.resume', 'file'],
  ['Add Cover Letter', false, 'adapter', 'file.coverLetter', 'file'],
];

describe('J7V-JV-1: the résumé read by its own question whatever its popover shows', () => {
  it('jr7-jobvite1-step1-b (the résumé\'s popover open): "Add Resume" required, file.resume, planned', async () => {
    const read = await filesOf(step1bHtml);
    // The capture's own state: the résumé's popover shown, the cover letter's closed.
    expect(read.popovers).toEqual([[true, true], [false, false]]);
    expect(read.count).toBe(20);
    expect(read.files[0]).toEqual(READ[0]);
    expect(read.files[1]!.slice(0, 3)).toEqual(READ[1]!.slice(0, 3));
  });

  it('step1-b with the cover letter\'s popover open instead (a DOM variant): "Add Cover Letter", the résumé as step1', async () => {
    const read = await filesOf(step1bHtml, coverLetterOpen);
    expect(read.popovers).toEqual([[true, false], [false, true]]);
    expect(read.count).toBe(20);
    expect(read.files.map((file) => file.slice(0, 3))).toEqual(READ.map((file) => file.slice(0, 3)));
  });

  // step1-filled shows a résumé already in (its file row): held, so nothing is planned for it.
  it.each([['jr7-jobvite1-step1', step1Html, 'file'], ['jr7-jobvite1-step1-filled', filledHtml, null]] as const)(
    '%s (both popovers closed): read as before', async (_name, html, planned) => {
      const read = await filesOf(html);
      expect(read.popovers).toEqual([[true, false], [false, false]]);
      expect(read.count).toBe(20);
      expect(read.files[0]).toEqual([...READ[0]!.slice(0, 4), planned]);
      expect(read.files[1]!.slice(0, 3)).toEqual(READ[1]!.slice(0, 3));
    });
});

describe('jr7 Jobvite (P2): the snapshot7 run\'s steps as the run reads them', () => {
  it('the posting\'s Apply, step 1 (Next), step 2 (Send Application, final), the confirmation\'s sign', async () => {
    const posting = await loadFixture(document, postingHtml, SNAPSHOT_VIEWPORT);
    expect(jobviteAdapter.detect(posting.doc)).toBeNull();
    expect(jobviteAdapter.entryControl!(posting.doc)?.matches('a.jv-button.jv-button-apply')).toBe(true);
    removeFixtures(document);
    const step1 = await loadFixture(document, step1Html, SNAPSHOT_VIEWPORT);
    const root1 = jobviteAdapter.detect(step1.doc)!.formRoot;
    expect([jobviteAdapter.isFinalStep!(step1.doc), jobviteAdapter.nextButton!(root1)?.getAttribute('aria-label')])
      .toEqual(['not-final', 'Next']);
    removeFixtures(document);
    const step2 = await loadFixture(document, step2Html, SNAPSHOT_VIEWPORT);
    const root2 = jobviteAdapter.detect(step2.doc)!.formRoot;
    expect([jobviteAdapter.isFinalStep!(step2.doc), jobviteAdapter.submitButton!(root2)?.getAttribute('aria-label')])
      .toEqual(['final', 'Send Application']);
    expect(signsOf(step2.doc, 'jobvite')).toEqual([]);
    removeFixtures(document);
    const done = await loadFixture(document, confirmationHtml, SNAPSHOT_VIEWPORT);
    expect(signsOf(done.doc, 'jobvite')).toHaveLength(1);
  });
});
