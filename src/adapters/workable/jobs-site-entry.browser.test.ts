/*
 * jr8 (the owner, 2026-11-13: "Currently `Apply Now` button is not working to show the form"; snapshot12): Workable's
 * job site, jobs.workable.com/view/<id>/<slug>, through the Workable adapter's entry (adapters/workable/index.ts
 * jobsSiteApply) and the entry door (content/press.ts pressEntry, dom/fillers/not-submit.ts clickAdapterEntry), on the
 * owner's capture of the posting before "Apply now" (fixtures/workable/jobs-tyk-posting.html, converted with the
 * owner's redaction list) and the capture of the dialog open (fixtures/workable/jobs-salvo-apply.html):
 * - the posting shows no form; its entry is "Apply now" (button[data-ui=overview-apply-now]), pressed once by the
 *   entry door, though it and the sticky bar's Apply now stay never pressed for every other door;
 * - with the application's dialog shown (its form drawn, or still loading), no entry is answered and nothing is pressed.
 * Clicks are recorded and held; markup names and counts only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import salvoHtml from '../../../fixtures/workable/jobs-salvo-apply.html?raw';
import tykHtml from '../../../fixtures/workable/jobs-tyk-posting.html?raw';
import tykRoutes from '../../../fixtures/workable/jobs-tyk-posting.routes.json';
import { pressEntry } from '../../content/press';
import { assertNotSubmit } from '../../dom/fillers';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { adaptersFor, applicationOf } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { workableAdapter } from './index';

afterEach(() => removeFixtures(document));

/** The capture loaded, every click on it recorded (by its data-ui) and held. */
async function open(html: string): Promise<{ doc: Document; clicks: string[] }> {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const clicks: string[] = [];
  fixture.doc.addEventListener('click', (event) => {
    const target = (event.target as Element).closest('[data-ui]') ?? (event.target as Element);
    clicks.push(target.getAttribute('data-ui') ?? target.localName);
    event.preventDefault();
  }, true);
  return { doc: fixture.doc, clicks };
}

describe("Workable's job site: its Apply now is the entry (jr8, snapshot12)", () => {
  it('the posting before Apply now: no form; the entry is its Apply now, pressed once by the entry door alone', async () => {
    const address = Object.keys(tykRoutes)[0]!;
    // The job site's address is Workable's and reads as the application, its own adapter first.
    expect(adaptersFor(new URL(address)).map((adapter) => adapter.id)).toEqual(['workable', 'generic']);
    expect(applicationOf(new URL(address))).toMatchObject({ platform: 'workable', page: 'application' });
    const { doc, clicks } = await open(tykHtml);
    expect(workableAdapter.detect(doc)).toBeNull();
    expect(doc.querySelector('dialog, [role="dialog"]')).toBeNull();
    const apply = doc.querySelector<HTMLElement>('button[data-ui="overview-apply-now"]')!;
    expect(workableAdapter.entryControl!(doc)).toBe(apply);
    // Both Apply now buttons stay never pressed for every other door (the entry door's exemption is that one element).
    const never = workableAdapter.neverPress!(doc.documentElement);
    for (const ui of ['overview-apply-now', 'sticky-apply-now', 'share-now', 'search-for-jobs-button']) {
      const button = doc.querySelector(`[data-ui="${ui}"]`);
      expect(button !== null && never.includes(button), ui).toBe(true);
    }
    expect(workableAdapter.entryNeverPressed).toBe(true);
    expect(assertNotSubmit(apply, { adapter: workableAdapter, root: doc.documentElement }).ok).toBe(false);
    // The entry door presses it once (nothing follows in a capture: the press is all this case reads).
    const answer = await pressEntry(doc, [workableAdapter], new AbortController().signal, 1_000, 300, undefined,
      { address: new URL(address) });
    expect(answer.outcome).toBe('pressed');
    expect(clicks).toEqual(['overview-apply-now']);
  });

  it('the dialog open (its form drawn): no entry, nothing pressed', async () => {
    const { doc, clicks } = await open(salvoHtml);
    expect(workableAdapter.detect(doc)).not.toBeNull();
    expect(doc.querySelector<HTMLElement>('button[data-ui="overview-apply-now"]')).not.toBeNull();
    expect(workableAdapter.entryControl!(doc)).toBeNull();
    expect(await pressEntry(doc, [workableAdapter], new AbortController().signal, 300, 300))
      .toEqual({ outcome: 'not-offered' });
    expect(clicks).toEqual([]);
  });

  it('the dialog open while its form loads (no form yet): no entry, nothing pressed', async () => {
    const { doc, clicks } = await open(tykHtml);
    // The dialog the press opens, as jobs-salvo-apply.html draws it, before its form (made-up words).
    const wrapper = doc.createElement('div');
    wrapper.setAttribute('data-role', 'modal-wrapper');
    const dialog = doc.createElement('dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('open', '');
    const title = doc.createElement('h2');
    title.setAttribute('data-ui', 'application-form-title');
    title.textContent = 'Apply for Site Reliability Engineer';
    const loading = doc.createElement('p');
    loading.textContent = 'Loading';
    dialog.append(title, loading);
    wrapper.append(dialog);
    doc.body.append(wrapper);
    expect(workableAdapter.detect(doc)).toBeNull();
    expect(workableAdapter.entryControl!(doc)).toBeNull();
    expect(await pressEntry(doc, [workableAdapter], new AbortController().signal, 300, 300))
      .toEqual({ outcome: 'not-offered' });
    expect(clicks).toEqual([]);
    // Closed again (the dialog's Cancel), the posting's Apply now is the entry once more.
    wrapper.remove();
    expect(workableAdapter.entryControl!(doc)).toBe(doc.querySelector('button[data-ui="overview-apply-now"]'));
  });
});
