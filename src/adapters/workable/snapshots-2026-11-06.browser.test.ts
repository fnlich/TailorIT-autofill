/*
 * The Workable adapter on the owner's captures of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): an application with its resume
 * uploaded (fixtures/workable/raydar-attached.html, from "[apply.workable.com] Infrastructure Engineer - Raydar -
 * Application.mht"), and the job-search site's posting page with the application form open in its dialog
 * (fixtures/workable/jobs-salvo-apply.html, from "[jobs.workable.com] Expert RAG Engineer - Salvo Software - Jobs by
 * Workable.mht").
 */
import { afterEach, describe, expect, it } from 'vitest';
import jobsExpect from '../../../fixtures/workable/jobs-salvo-apply.expect.json';
import jobsHtml from '../../../fixtures/workable/jobs-salvo-apply.html?raw';
import labellaHtml from '../../../fixtures/workable/labella-closed.html?raw';
import raydarHtml from '../../../fixtures/workable/raydar-attached.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { platformOfUrl } from '../../shared/hosts';
import { adaptersFor, applicationOf } from '../index';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { awaitingScanner } from '../test/findings.testkit';
import { workableAdapter } from './index';

const JOBS = readExpectation(jobsExpect);

async function loadWorkable(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = workableAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

describe('the Workable adapter on the captures of 2026-11-06', () => {
  afterEach(() => removeFixtures(document));

  it('reads an upload that worked as the page shows it: the name cut in two spans beside view and delete', async () => {
    const page = await loadWorkable(raydarHtml);
    const input = page.doc.querySelector<HTMLInputElement>('input[type="file"][data-ui="resume"]')!;
    const zone = input.closest('[data-role="dropzone"]')!;
    const shown = zone.querySelector('[data-id="filename"]')!;
    expect(shown.children).toHaveLength(2);
    expect(zone.querySelector('[role="menu"] button[data-action="delete"]')).not.toBeNull();
    expect(zone.querySelector('[role="menu"] a[data-action="view"]')).not.toBeNull();
    // The capture's name is redacted: a stand-in name is written as the page cuts it (its head, then its last ten
    // characters).
    const name = 'Alex_Rivera_Resume_2026.pdf';
    shown.children[0]!.textContent = name.slice(0, -10);
    shown.children[1]!.textContent = name.slice(-10);
    expect(workableAdapter.uploadState!(input, name)).toBe('confirmed');
    expect(workableAdapter.uploadState!(input, 'Another file.pdf')).toBe('pending');
    // The Photo's drop zone shows nothing uploaded.
    const photo = page.doc.querySelector<HTMLInputElement>('input[type="file"][data-ui="avatar"]')!;
    expect(workableAdapter.uploadState!(photo, name)).toBe('pending');
    // The view and delete controls sit in the drop zone, which is never pressed.
    const never = workableAdapter.neverPress!(page.root);
    expect(never.some((part) => part.contains(zone.querySelector('[data-action="delete"]')))).toBe(true);
  });

  it('jobs.workable.com/view/...: Workable\'s host and adapter, its posting read as the application', async () => {
    const url = new URL(JOBS.source);
    expect(platformOfUrl(url.href)).toBe('workable');
    expect(adaptersFor(url).map((adapter) => adapter.id)).toEqual(['workable', 'generic']);
    expect(applicationOf(url)).toMatchObject({ platform: 'workable', page: 'application',
      applicationUrl: 'https://jobs.workable.com/view/h3u3XDdUxbcDLb9v7mvmpN' });
    const page = await loadWorkable(jobsHtml);
    expect(page.root.matches('form[data-ui="application-form"]')).toBe(true);
    expect(page.root.closest('dialog[role="dialog"][aria-modal="true"]')).not.toBeNull();
  });

  // The fields below the dialog's fold were no fields until the core pass of 2026-11-06 (dom/visibility.ts rules 5 and
  // 6: the dialog's content region scrolls inside its fixed wrapper): awaitingScanner lists none for this case now.
  it('jobs.workable.com: the scan agrees with its expectations, the fields below the dialog\'s fold included', async () => {
    const scanned = await scanCase(document, jobsHtml, JOBS.source);
    expect(scanned.adapter.id).toBe('workable');
    expect(awaitingScanner(JOBS)).toEqual([]);
    expect(compareWithExpectation(scanned.doc, scanned.result, JOBS)).toEqual([]);
  });

  it('jobs.workable.com: Submit is the form\'s own; the dialog\'s Cancel and Submit and the page\'s buttons are never pressed', async () => {
    const page = await loadWorkable(jobsHtml);
    const submit = workableAdapter.submitButton!(page.root)!;
    expect(submit.matches('form[data-ui="application-form"] button[data-ui="apply-button"][type="submit"]')).toBe(true);
    expect(workableAdapter.isFinalStep!(page.doc)).toBe('final');
    const never = workableAdapter.neverPress!(page.root);
    for (const ui of ['application-form-cancel', 'application-form-submit', 'overview-apply-now', 'sticky-apply-now',
      'share-now', 'search-for-jobs-button']) {
      const button = page.doc.querySelector(`[data-ui="${ui}"]`);
      // (Elements are compared, never printed: a failure would print the page.)
      expect(button !== null && never.includes(button), ui).toBe(true);
    }
    expect(never.includes(submit)).toBe(false);
    // The autofill box (Import resume from) is excluded and never pressed, as on apply.workable.com.
    const autofill = page.doc.querySelector('[data-ui="autofill-button"]')!;
    expect(workableAdapter.excluded!(page.root).some((part) => part.contains(autofill))).toBe(true);
  });

  it('jobs.workable.com: the posting is its job breakdown, the description and the requirements together', async () => {
    const page = await loadWorkable(jobsHtml);
    const posting = workableAdapter.postingText!(page.doc)!;
    expect(posting.querySelector('[data-ui="job-breakdown-description-parsed-html"]')).not.toBeNull();
    expect(posting.querySelector('[data-ui="job-breakdown-requirements-parsed-html"]')).not.toBeNull();
    expect(posting.querySelector('form')).toBeNull();
    removeFixtures(document);
    // apply.workable.com's form page shows no posting, as before.
    const form = await loadWorkable(labellaHtml);
    expect(workableAdapter.postingText!(form.doc)).toBeNull();
  });
});
