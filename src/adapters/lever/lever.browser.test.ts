import { afterEach, describe, expect, it } from 'vitest';
import gitlabHtml from '../../../fixtures/greenhouse/gitlab-job.html?raw';
import spotifyExpect from '../../../fixtures/lever/spotify-ny.expect.json';
import spotifyHtml from '../../../fixtures/lever/spotify-ny.html?raw';
import zooxExpect from '../../../fixtures/lever/zoox-fostercity.expect.json';
import zooxHtml from '../../../fixtures/lever/zoox-fostercity.html?raw';
import trapHtml from '../../../fixtures/traps/01-white-on-white.html?raw';
import { assertNotSubmit, fill } from '../../dom/fillers';
import { loadFixture, logEvents, removeFixtures, untrustedViolations } from '../../dom/fixture.testkit';
import { CONTROL_SELECTOR } from '../../dom/kinds';
import { scan } from '../../dom/scan';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { awaitingScanner } from '../test/findings.testkit';
import { leverAdapter } from './index';

const SPOTIFY = readExpectation(spotifyExpect);
const ZOOX = readExpectation(zooxExpect);
const CASES = [
  { name: 'spotify-ny', html: spotifyHtml, expectation: SPOTIFY },
  { name: 'zoox-fostercity', html: zooxHtml, expectation: ZOOX },
] as const;

/** A stand-in for the golden resume, a PDF. */
function goldenResume(view: Window & typeof globalThis): File {
  return new view.File(['%PDF-1.7\n% Alex Rivera golden resume\n'], 'Alex Rivera - Resume.pdf', { type: 'application/pdf' });
}

async function loadLever(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = leverAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

describe('the Lever adapter: its hooks on the snapshots', () => {
  afterEach(() => removeFixtures(document));

  it("takes form#application-form as the form root, and finds none where Lever's questions are absent", async () => {
    for (const html of [spotifyHtml, zooxHtml]) {
      const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
      expect(leverAdapter.detect(fixture.doc)?.formRoot.id).toBe('application-form');
      removeFixtures(document);
    }
    // A trap page served on a Lever host, and Greenhouse's form (also form#application-form, but with no
    // .application-question), are left to other adapters.
    for (const html of [trapHtml, gitlabHtml]) {
      const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
      expect(leverAdapter.detect(fixture.doc)).toBeNull();
      removeFixtures(document);
    }
    const trap = await scanCase(document, trapHtml, 'https://jobs.lever.co/tailorit-fixture/trap-01/apply');
    expect(trap.adapter.id).toBe('generic');
  });

  it('names the parts of the form by their h4, and leaves hidden and unnamed parts to the scanner', async () => {
    const spotify = await loadLever(spotifyHtml);
    expect(leverAdapter.sections!(spotify.root).map((section) => section.label)).toEqual(['Submit your application',
      'Links', 'Previous Spotify Employment', 'Demographic Survey']);
    removeFixtures(document);
    const zoox = await loadLever(zooxHtml);
    expect(leverAdapter.sections!(zoox.root).map((section) => section.label)).toEqual(['Submit your application', 'Links',
      'A few more questions...',
      'U.S. Equal Employment Opportunity information (Completion is voluntary and will not subject you to adverse treatment)']);
  });

  it("labels a group of boxes and a custom question by the question's div.application-label, and nothing else", async () => {
    const { doc } = await loadLever(spotifyHtml);
    const pronoun = doc.querySelector('input[name="pronouns"][value="He/him"]')!;
    const pronouns = pronoun.closest('.application-question')!.querySelector('.application-label');
    expect(leverAdapter.labelFor!(pronoun)).toBe(pronouns);
    const spotifyBox = doc.querySelector('input[name="cards[92a51f92-d683-4f7b-be57-e25376f60abe][field0]"]')!;
    expect(leverAdapter.labelFor!(spotifyBox)?.textContent).toBe('Have you ever been previously employed by Spotify?\u{2731}');
    const resume = doc.getElementById('resume-upload-input')!;
    expect(leverAdapter.labelFor!(resume)?.textContent?.trim()).toBe('Resume/CV \u{2731}');
    // A standard question's own text box and select (its wrapping label names them) and the hidden custom-pronouns box
    // get nothing from the adapter.
    for (const other of [doc.querySelector('input[name="name"]')!, doc.getElementById('customPronounsTextField')!,
      doc.querySelector('select[data-qa="candidate-location-select"]')!]) {
      expect(leverAdapter.labelFor!(other)).toBeNull();
    }
    // An answer whose own label shows nothing is never named after its question.
    (pronoun.parentElement!.querySelector('.application-answer-alternative') as HTMLElement).style.display = 'none';
    expect(leverAdapter.labelFor!(pronoun)).toBeNull();
    removeFixtures(document);
    const zoox = await loadLever(zooxHtml);
    const textarea = zoox.doc.querySelector('textarea[name="cards[c62ec44a-0482-4f8f-9630-94a6aac1e3c3][field1]"]')!;
    expect(leverAdapter.labelFor!(textarea)?.textContent).toContain('Export Control and Compliance');
    const select = zoox.doc.querySelector('select[name="cards[c62ec44a-0482-4f8f-9630-94a6aac1e3c3][field2]"]')!;
    expect(leverAdapter.labelFor!(select)?.textContent).toContain('Sponsorship: Do you require sponsorship');
  });

  it('declares the ATTACH RESUME/CV link the upload widget of the resume input, and the resume goes in', async () => {
    const lever = await loadLever(zooxHtml);
    const [widget, ...others] = leverAdapter.uploadWidgets!(lever.root);
    expect(others).toEqual([]);
    expect(widget!.control.matches('a.visible-resume-upload')).toBe(true);
    expect(widget!.input.id).toBe('resume-upload-input');
    const result = scan(lever.root, leverAdapter, { platform: 'lever' });
    const resume = result.fields.find((field) => field.idAttr === 'resume-upload-input')!;
    expect(resume).toMatchObject({ kind: 'file', proxy: 'adapter', visibility: 'hidden-file-with-visible-control' });
    expect(result.target(resume.key)!.proxy).toBe(widget!.control);
    expect(result.unrecognisedUploads).toEqual([]);
    const log = logEvents(lever.doc);
    const file = goldenResume(lever.view);
    expect(fill(result.target(resume.key)!, { kind: 'file', ref: 'resume' }, { adapter: leverAdapter, root: lever.root, file }))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect((widget!.input.files![0]!).name).toBe(file.name);
    expect(log.events.filter((event) => event.type === 'click')).toEqual([]);
    expect(untrustedViolations(log.events)).toEqual([]);
  });

  it('declares the location search a remote typeahead, and no other control a widget', async () => {
    const { doc, root } = await loadLever(spotifyHtml);
    const location = doc.getElementById('location-input')!;
    // v4 (drop): with its results list (WidgetDecl.results, from the live capture fixtures/lever/location-open.html), the
    // key that starts its search and its loading row, so the widget helpers search it (was declared without them, so
    // it was widget-unsupported).
    expect(leverAdapter.widgetFor!(location)).toEqual({ kind: 'typeahead-remote', opener: location,
      snapshot: 'fixtures/lever/location-open.html', queryKey: 'Escape', busy: ['.dropdown-loading-results'],
      results: { list: location.closest('li')!.querySelector('.dropdown-results'), option: '.dropdown-location',
        choose: 'mousedown' } });
    const others = Array.from(root.querySelectorAll(CONTROL_SELECTOR)).filter((el) => el !== location);
    expect(others.length).toBeGreaterThan(50);
    expect(others.filter((el) => leverAdapter.widgetFor!(el) !== null)).toEqual([]);
  });

  it('identifies Submit so nothing may click it, and calls the one-step form final', async () => {
    const { doc, root } = await loadLever(zooxHtml);
    const submit = leverAdapter.submitButton!(root)!;
    expect(submit.id).toBe('btn-submit');
    expect(submit.getAttribute('type')).toBe('button');
    expect(assertNotSubmit(submit, { adapter: leverAdapter, root })).toEqual({ ok: false, refusal: 'adapter-submit' });
    expect(leverAdapter.isFinalStep!(doc)).toBe('final');
    submit.remove();
    expect(leverAdapter.isFinalStep!(doc)).toBe('unknown');
    removeFixtures(document);
    const trap = await loadFixture(document, trapHtml);
    expect(leverAdapter.isFinalStep!(trap.doc)).toBe('unknown');
  });

  it('reports the errors a person can see: Lever\'s message, and controls marked invalid', async () => {
    const { doc, root } = await loadLever(spotifyHtml);
    expect(leverAdapter.errors!(root)).toEqual([]);
    const oversize = doc.querySelector<HTMLElement>('.resume-upload-oversize')!;
    oversize.style.display = 'block';
    const email = doc.querySelector('input[name="email"]')!;
    email.setAttribute('aria-invalid', 'true');
    expect(leverAdapter.errors!(root).map((error) => error.el)).toEqual([oversize.querySelector('.error-message'), email]);
  });

  it('is busy while Lever reads an uploaded resume, and while its location search loads', async () => {
    const { doc } = await loadLever(spotifyHtml);
    expect(leverAdapter.isBusy!(doc)).toBe(false);
    const working = doc.querySelector<HTMLElement>('.resume-upload-working')!;
    working.style.display = 'block';
    expect(leverAdapter.isBusy!(doc)).toBe(true);
    working.style.display = '';
    const loading = doc.querySelector<HTMLElement>('.dropdown-loading-results')!;
    loading.style.display = 'block';
    loading.closest<HTMLElement>('.dropdown-container')!.style.display = 'block';
    expect(leverAdapter.isBusy!(doc)).toBe(true);
    removeFixtures(document);
    const trap = await loadFixture(document, trapHtml);
    expect(leverAdapter.isBusy!(trap.doc)).toBe(false);
  });

  it('needs no proxyFor: every box and radio a person can use is drawn, only the resume input stands behind a widget',
    async () => {
      for (const html of [spotifyHtml, zooxHtml]) {
        const lever = await loadLever(html);
        const fields = scan(lever.root, leverAdapter, { platform: 'lever' }).fields;
        expect(fields.filter((field) => field.kind === 'radio' || field.kind.startsWith('checkbox'))
          .every((field) => field.visibility === 'visible' && field.proxy === null)).toBe(true);
        expect(fields.filter((field) => field.proxy !== null).map((field) => [field.idAttr, field.proxy]))
          .toEqual([['resume-upload-input', 'adapter']]);
        expect(leverAdapter.proxyFor).toBeUndefined();
        removeFixtures(document);
      }
    });

  it('reads its addresses with url.ts', () => {
    const apply = new URL(SPOTIFY.source);
    expect(leverAdapter.matchesUrl(apply)).toBe(true);
    expect(leverAdapter.canonicalApplicationUrl(apply)).toBe(SPOTIFY.source);
    expect(leverAdapter.canonicalApplicationUrl(new URL(SPOTIFY.source.replace(/\/apply$/, '')))).toBeNull();
    expect(leverAdapter.matchesUrl(new URL('https://job-boards.greenhouse.io/gitlab/jobs/8857185002'))).toBe(false);
  });
});

describe('the Lever adapter against its snapshots', () => {
  afterEach(() => removeFixtures(document));

  // The differences left are the scanner findings in ../test/findings.testkit.ts, each waiting on a scanner change.
  it.each(CASES)('$name: the scan meets the hand-written expectations', async ({ html, expectation }) => {
    const scanned = await scanCase(document, html, expectation.source);
    expect(scanned.adapter).toBe(leverAdapter);
    expect(scanned.result.unrecognisedUploads).toEqual([]);
    expect(compareWithExpectation(scanned.doc, scanned.result, expectation)).toEqual(awaitingScanner(expectation));
  });
});
