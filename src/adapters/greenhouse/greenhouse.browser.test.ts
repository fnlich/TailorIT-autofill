import { afterEach, describe, expect, it } from 'vitest';
import discordExpect from '../../../fixtures/greenhouse/discord-job.expect.json';
import discordHtml from '../../../fixtures/greenhouse/discord-job.html?raw';
import figmaExpect from '../../../fixtures/greenhouse/figma-legacy-host.expect.json';
import figmaHtml from '../../../fixtures/greenhouse/figma-legacy-host.html?raw';
import embedExpect from '../../../fixtures/greenhouse/gitlab-embed.expect.json';
import embedHtml from '../../../fixtures/greenhouse/gitlab-embed.html?raw';
import gitlabExpect from '../../../fixtures/greenhouse/gitlab-job.expect.json';
import gitlabHtml from '../../../fixtures/greenhouse/gitlab-job.html?raw';
import spotifyHtml from '../../../fixtures/lever/spotify-ny.html?raw';
import trapHtml from '../../../fixtures/traps/01-white-on-white.html?raw';
import { assertNotSubmit, fill } from '../../dom/fillers';
import { loadFixture, logEvents, removeFixtures, untrustedViolations } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { awaitingScanner, DRAWN_BY_WRAPPER } from '../test/findings.testkit';
import { greenhouseAdapter } from './index';

const GITLAB = readExpectation(gitlabExpect);

const CASES = [
  { name: 'gitlab-job', html: gitlabHtml, expectation: GITLAB },
  { name: 'discord-job', html: discordHtml, expectation: readExpectation(discordExpect) },
  { name: 'figma-legacy-host', html: figmaHtml, expectation: readExpectation(figmaExpect) },
  { name: 'gitlab-embed', html: embedHtml, expectation: readExpectation(embedExpect) },
] as const;

/** A stand-in for the golden resume, a PDF. */
function goldenResume(view: Window & typeof globalThis): File {
  return new view.File(['%PDF-1.7\n% Alex Rivera golden resume\n'], 'Alex Rivera - Resume.pdf', { type: 'application/pdf' });
}

async function loadGreenhouse(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

describe('the Greenhouse adapter: its hooks on the snapshots', () => {
  afterEach(() => removeFixtures(document));

  it('takes form#application-form.application--form as the form root, and finds none on other pages', async () => {
    for (const { html } of CASES) {
      const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
      expect(greenhouseAdapter.detect(fixture.doc)?.formRoot.matches('form#application-form.application--form')).toBe(true);
      removeFixtures(document);
    }
    // Lever's form is also form#application-form, without the class; a trap page has a plain form.
    for (const html of [spotifyHtml, trapHtml]) {
      const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
      expect(greenhouseAdapter.detect(fixture.doc)).toBeNull();
      removeFixtures(document);
    }
  });

  it('names the question blocks by the heading above the form, and the self-identification blocks by theirs', async () => {
    const gitlab = await loadGreenhouse(gitlabHtml);
    const blocks = greenhouseAdapter.sections!(gitlab.root);
    expect(blocks.map((section) => section.label)).toEqual(['Apply for this job', 'Apply for this job',
      'Voluntary Self-Identification']);
    expect(blocks.map((section) => section.el.className)).toEqual(['application--questions', 'application--questions',
      'eeoc__container body']);
    removeFixtures(document);
    const discord = await loadGreenhouse(discordHtml);
    expect(greenhouseAdapter.sections!(discord.root).map((section) => section.label)).toEqual(['Apply for this job',
      'Apply for this job', 'Voluntary Self Identification', 'Voluntary Self-Identification']);
  });

  it("labels an upload group's file input by the group's div#upload-label-*, and no other control", async () => {
    const { doc } = await loadGreenhouse(discordHtml);
    expect(greenhouseAdapter.labelFor!(doc.getElementById('resume')!)).toBe(doc.getElementById('upload-label-resume'));
    expect(greenhouseAdapter.labelFor!(doc.getElementById('cover_letter')!))
      .toBe(doc.getElementById('upload-label-cover_letter'));
    for (const id of ['first_name', 'country', 'question_38318888002', 'gdpr_demographic_data_consent_given_1']) {
      expect(greenhouseAdapter.labelFor!(doc.getElementById(id)!)).toBeNull();
    }
    // A group whose label is not its own names nothing.
    doc.getElementById('resume')!.closest('.file-upload')!.setAttribute('aria-labelledby', 'first_name-label');
    expect(greenhouseAdapter.labelFor!(doc.getElementById('resume')!)).toBeNull();
  });

  it('declares each Attach button the upload widget of the hidden input beside it, and the resume goes in', async () => {
    const gh = await loadGreenhouse(discordHtml);
    const widgets = greenhouseAdapter.uploadWidgets!(gh.root);
    expect(widgets.map((widget) => [widget.input.id, widget.control.textContent])).toEqual([['resume', 'Attach'],
      ['cover_letter', 'Attach']]);
    const result = scan(gh.root, greenhouseAdapter, { platform: 'greenhouse' });
    const resume = result.fields.find((field) => field.idAttr === 'resume')!;
    expect(resume).toMatchObject({ kind: 'file', label: 'Resume/CV', labelSource: 'adapter', required: true,
      proxy: 'adapter', visibility: 'hidden-file-with-visible-control' });
    expect(result.unrecognisedUploads).toEqual([]);
    const log = logEvents(gh.doc);
    const file = goldenResume(gh.view);
    expect(fill(result.target(resume.key)!, { kind: 'file', ref: 'resume' }, { adapter: greenhouseAdapter, root: gh.root, file }))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect((gh.doc.getElementById('resume') as HTMLInputElement).files![0]!.name).toBe(file.name);
    expect(log.events.filter((event) => event.type === 'click')).toEqual([]);
    expect(untrustedViolations(log.events)).toEqual([]);
    removeFixtures(document);
    const figma = await loadGreenhouse(figmaHtml);
    expect(greenhouseAdapter.uploadWidgets!(figma.root).map((widget) => widget.input.id)).toEqual(['resume']);
  });

  it('leaves the react-select widgets to Phase 4: scanned as lazy comboboxes that are not written', async () => {
    const gh = await loadGreenhouse(discordHtml);
    const result = scan(gh.root, greenhouseAdapter, { platform: 'greenhouse' });
    const location = result.fields.find((field) => field.idAttr === 'candidate-location')!;
    expect(location).toMatchObject({ kind: 'combobox', options: 'lazy', label: 'Location (City)', required: true });
    expect(greenhouseAdapter.widgetFor).toBeUndefined();
    const log = logEvents(gh.doc);
    expect(fill(result.target(location.key)!, { kind: 'text', text: 'Austin' }, { adapter: greenhouseAdapter, root: gh.root }))
      .toMatchObject({ wrote: false, reason: 'widget-unsupported' });
    expect(log.events).toEqual([]);
  });

  it('needs no proxyFor: the consent box is drawn, only the upload inputs stand behind widgets', async () => {
    const gh = await loadGreenhouse(discordHtml);
    const fields = scan(gh.root, greenhouseAdapter, { platform: 'greenhouse' }).fields;
    expect(fields.find((field) => field.idAttr === 'gdpr_demographic_data_consent_given_1'))
      .toMatchObject({ kind: 'checkbox', visibility: 'visible', proxy: null, camouflaged: false });
    expect(fields.filter((field) => field.proxy !== null).map((field) => [field.idAttr, field.proxy]))
      .toEqual([['resume', 'adapter'], ['cover_letter', 'adapter']]);
    expect(greenhouseAdapter.proxyFor).toBeUndefined();
  });

  it('identifies Submit so nothing may click it, and calls the one-step form final', async () => {
    const { doc, root } = await loadGreenhouse(gitlabHtml);
    const submit = greenhouseAdapter.submitButton!(root)!;
    expect(submit.textContent).toBe('Submit application');
    expect(assertNotSubmit(submit, { adapter: greenhouseAdapter, root })).toEqual({ ok: false, refusal: 'adapter-submit' });
    expect(greenhouseAdapter.isFinalStep!(doc)).toBe('final');
    submit.remove();
    expect(greenhouseAdapter.isFinalStep!(doc)).toBe('unknown');
  });

  it('reports the controls marked invalid that a person can see', async () => {
    const { doc, root } = await loadGreenhouse(gitlabHtml);
    expect(greenhouseAdapter.errors!(root)).toEqual([]);
    doc.getElementById('email')!.setAttribute('aria-invalid', 'true');
    expect(greenhouseAdapter.errors!(root).map((error) => error.el.id)).toEqual(['email']);
  });

  it('reads its addresses with url.ts: the job page and the embed share one application', () => {
    expect(greenhouseAdapter.matchesUrl(new URL(GITLAB.source))).toBe(true);
    expect(greenhouseAdapter.canonicalApplicationUrl(new URL('https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002')))
      .toBe(GITLAB.source);
    expect(greenhouseAdapter.matchesUrl(new URL('https://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b/apply')))
      .toBe(false);
  });
});

describe('the Greenhouse adapter against its snapshots', () => {
  afterEach(() => removeFixtures(document));

  // The differences left are the scanner findings in ../test/findings.testkit.ts, each waiting on a scanner change.
  it.each(CASES)('$name: the scan meets the hand-written expectations', async ({ html, expectation }) => {
    const scanned = await scanCase(document, html, expectation.source);
    expect(scanned.adapter).toBe(greenhouseAdapter);
    expect(scanned.result.unrecognisedUploads).toEqual([]);
    // Finding 3's controls are exactly the ones Greenhouse draws through a div.input-wrapper.
    const drawn = Array.from(scanned.root.querySelectorAll('.text-input-wrapper .input-wrapper .input'))
      .map((el) => `#${el.id}`);
    expect(drawn).toEqual(DRAWN_BY_WRAPPER[expectation.fixture]);
    expect(compareWithExpectation(scanned.doc, scanned.result, expectation)).toEqual(awaitingScanner(expectation));
  });
});
