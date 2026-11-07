/*
 * ClearCompany's rules the behaviour review of 2026-11-06 found untested (FINDINGS.md minor 16: C3, C4, C9, C11),
 * pinned on the owner's snapshots (fixtures/clearcompany):
 * - C3, C4 (busy, atlas-uploads-saving): the page's "Creating your account, this could take up to 60 seconds." notice
 *   (div.loading) and its button's "Saving..." spinner each say the page is busy on their own, without the form's
 *   loading spinner;
 * - C9 (repeatables, ferrilli-page2): a repeated section whose heading names neither employment nor education is no
 *   repeatable;
 * - C11 (neverPress, vafb-page2): the breadcrumb's page links are never pressed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import savingHtml from '../../../fixtures/clearcompany/atlas-uploads-saving.html?raw';
import ferrilliHtml from '../../../fixtures/clearcompany/ferrilli-page2.html?raw';
import page2Html from '../../../fixtures/clearcompany/vafb-page2.html?raw';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { clearCompanyAdapter } from './index';

afterEach(() => removeFixtures(document));

const open = (html: string): Promise<Fixture> => loadFixture(document, html, SNAPSHOT_VIEWPORT);
const q = <T extends Element = HTMLElement>(fixture: Fixture, selector: string) => fixture.doc.querySelector<T>(selector)!;

/** atlas-uploads-saving without the form's loading spinner (its classes, not the form inside it). */
async function savingWithoutSpinner(): Promise<Fixture> {
  const fixture = await open(savingHtml);
  for (const spinner of Array.from(fixture.doc.querySelectorAll('div.loading-small.spinner'))) {
    spinner.classList.remove('spinner');
  }
  return fixture;
}

describe('ClearCompany: busy, repeatables and never-pressed controls', () => {
  it('C3: the "Creating your account" notice alone says the page is busy (atlas-uploads-saving)', async () => {
    const fixture = await savingWithoutSpinner();
    q(fixture, 'button.submit-button span.glyphicon-refresh-animate').remove();
    expect(q(fixture, 'form.section-form div.loading').isConnected).toBe(true);
    expect(clearCompanyAdapter.isBusy?.(fixture.doc)).toBe(true);
    q(fixture, 'form.section-form div.loading').style.display = 'none';
    expect(clearCompanyAdapter.isBusy?.(fixture.doc)).toBe(false);
  });

  it('C4: the button\'s "Saving..." spinner alone says the page is busy (atlas-uploads-saving)', async () => {
    const fixture = await savingWithoutSpinner();
    q(fixture, 'form.section-form div.loading').style.display = 'none';
    expect(q(fixture, 'button.submit-button span.glyphicon-refresh-animate').isConnected).toBe(true);
    expect(clearCompanyAdapter.isBusy?.(fixture.doc)).toBe(true);
  });

  it('C9: a repeated section whose heading names neither employment nor education is no repeatable (ferrilli-page2)',
    async () => {
      const fixture = await open(ferrilliHtml);
      const root = clearCompanyAdapter.detect(fixture.doc)!.formRoot;
      expect(clearCompanyAdapter.repeatables!(root).map((entry) => entry.kind)).toEqual(['experience', 'education']);
      const education = Array.from(fixture.doc.querySelectorAll('div.fieldItem > h3.control-label'))
        .find((heading) => heading.textContent?.trim() === 'EDUCATION')!;
      education.textContent = 'REFERENCES';
      expect(clearCompanyAdapter.repeatables!(root).map((entry) => entry.kind)).toEqual(['experience']);
    });

  it("C11: the breadcrumb's page links are never pressed (vafb-page2)", async () => {
    const fixture = await open(page2Html);
    const root = clearCompanyAdapter.detect(fixture.doc)!.formRoot;
    const links = Array.from(fixture.doc.querySelectorAll('li.breadcrumbs-page-link'));
    expect(links.length).toBeGreaterThan(0);
    const never = clearCompanyAdapter.neverPress!(root);
    for (const link of links) expect(never).toContain(link);
  });
});
