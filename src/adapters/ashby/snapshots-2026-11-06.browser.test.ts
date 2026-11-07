/*
 * The Ashby adapter on the owner's capture of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): a form sending its application
 * (fixtures/ashby/rivian-submitting.html, from "[jobs.ashbyhq.com] Head of Technology Foundations @ Rivian and Volkswagen
 * Group Technologies.mht": Submit pressed, the resume uploaded, Ashby's own "Autofill from resume" done).
 */
import { afterEach, describe, expect, it } from 'vitest';
import openaiHtml from '../../../fixtures/ashby/openai-closed.html?raw';
import rivianHtml from '../../../fixtures/ashby/rivian-submitting.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { ashbyAdapter } from './index';

async function loadAshby(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = ashbyAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

describe('the Ashby adapter on the capture of 2026-11-06', () => {
  afterEach(() => removeFixtures(document));

  it('is busy while Ashby sends the application: Submit disabled, its spinner before its words', async () => {
    const ashby = await loadAshby(rivianHtml);
    const submit = ashbyAdapter.submitButton!(ashby.root)!;
    expect(submit.matches('button.ashby-application-form-submit-button[disabled]')).toBe(true);
    expect(ashbyAdapter.isBusy!(ashby.doc)).toBe(true);
    (submit.querySelector('svg.loadingSvg') as SVGElement).style.display = 'none';
    expect(ashbyAdapter.isBusy!(ashby.doc)).toBe(false);
    removeFixtures(document);
    const closed = await loadAshby(openaiHtml);
    expect(ashbyAdapter.isBusy!(closed.doc)).toBe(false);
  });

  it('writes nothing while it sends: every text box is disabled, and the scan says so', async () => {
    const ashby = await loadAshby(rivianHtml);
    const result = scan(ashby.root, ashbyAdapter, { platform: 'ashby' });
    const texts = result.fields.filter((field) => field.kind === 'text');
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((field) => field.disabled)).toBe(true);
  });

  it('reads an uploaded file as the live probe of 2026-11-02 had it: its name and "Delete file" in the question', async () => {
    const ashby = await loadAshby(rivianHtml);
    const input = ashby.doc.getElementById('_systemfield_resume') as HTMLInputElement;
    const item = input.closest('.ashby-application-form-input-file')!.querySelector('.ashby-application-form-input-file-item')!;
    // The capture's file name is redacted: a stand-in name is written where the page shows it.
    item.querySelector('.ashby-application-form-input-file-item-name span')!.textContent = 'Alex Rivera - Resume.pdf';
    expect(item.querySelector('button[title="Delete file"]')).not.toBeNull();
    expect(ashbyAdapter.uploadState!(input, 'Alex Rivera - Resume.pdf')).toBe('confirmed');
    expect(ashbyAdapter.uploadState!(input, 'Another file.pdf')).toBe('pending');
    // Ashby's own resume parse is done and its pane says so; the pane stays excluded, so nothing in it is a field.
    const alert = ashby.doc.querySelector('.ashby-application-form-autofill-input-form-alert')!;
    expect(alert.textContent).toContain('Autofill completed!');
    expect(ashbyAdapter.excluded!(ashby.root).some((part) => part.contains(alert))).toBe(true);
  });
});
