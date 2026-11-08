import { afterEach, describe, expect, it } from 'vitest';
import beyondtrustExpect from '../../../fixtures/greenhouse/beyondtrust-job.expect.json';
import beyondtrustHtml from '../../../fixtures/greenhouse/beyondtrust-job.html?raw';
import discordExpect from '../../../fixtures/greenhouse/discord-job.expect.json';
import discordHtml from '../../../fixtures/greenhouse/discord-job.html?raw';
import figmaExpect from '../../../fixtures/greenhouse/figma-legacy-host.expect.json';
import figmaHtml from '../../../fixtures/greenhouse/figma-legacy-host.html?raw';
import embedExpect from '../../../fixtures/greenhouse/gitlab-embed.expect.json';
import embedHtml from '../../../fixtures/greenhouse/gitlab-embed.html?raw';
import gitlabExpect from '../../../fixtures/greenhouse/gitlab-job.expect.json';
import gitlabHtml from '../../../fixtures/greenhouse/gitlab-job.html?raw';
import affirmExpect from '../../../fixtures/greenhouse/affirm-job.expect.json';
import affirmHtml from '../../../fixtures/greenhouse/affirm-job.html?raw';
import asanaExpect from '../../../fixtures/greenhouse/asana-embed.expect.json';
import asanaHtml from '../../../fixtures/greenhouse/asana-embed.html?raw';
import discordMlExpect from '../../../fixtures/greenhouse/discord-ml-job.expect.json';
import discordMlHtml from '../../../fixtures/greenhouse/discord-ml-job.html?raw';
import gustoExpect from '../../../fixtures/greenhouse/gusto-job.expect.json';
import gustoHtml from '../../../fixtures/greenhouse/gusto-job.html?raw';
import twilioExpect from '../../../fixtures/greenhouse/twilio-job.expect.json';
import twilioHtml from '../../../fixtures/greenhouse/twilio-job.html?raw';
import twitchExpect from '../../../fixtures/greenhouse/twitch-job.expect.json';
import twitchHtml from '../../../fixtures/greenhouse/twitch-job.html?raw';
import spotifyHtml from '../../../fixtures/lever/spotify-ny.html?raw';
import trapHtml from '../../../fixtures/traps/01-white-on-white.html?raw';
import { assertNotSubmit, fill } from '../../dom/fillers';
import { loadFixture, logEvents, removeFixtures, untrustedViolations } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { visibilityOf } from '../../dom/visibility';
import { readWidget } from '../../dom/widgets';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { awaitingScanner, DRAWN_BY_WRAPPER } from '../test/findings.testkit';
import { GREENHOUSE_WIDGET_SNAPSHOTS, greenhouseAdapter } from './index';

const GITLAB = readExpectation(gitlabExpect);

const CASES = [
  { name: 'gitlab-job', html: gitlabHtml, expectation: GITLAB },
  { name: 'discord-job', html: discordHtml, expectation: readExpectation(discordExpect) },
  { name: 'figma-legacy-host', html: figmaHtml, expectation: readExpectation(figmaExpect) },
  { name: 'gitlab-embed', html: embedHtml, expectation: readExpectation(embedExpect) },
  // The widget capture's closed forms (2026-11-01).
  { name: 'twitch-job', html: twitchHtml, expectation: readExpectation(twitchExpect) },
  { name: 'discord-ml-job', html: discordMlHtml, expectation: readExpectation(discordMlExpect) },
  { name: 'gusto-job', html: gustoHtml, expectation: readExpectation(gustoExpect) },
  { name: 'twilio-job', html: twilioHtml, expectation: readExpectation(twilioExpect) },
  { name: 'affirm-job', html: affirmHtml, expectation: readExpectation(affirmExpect) },
  { name: 'asana-embed', html: asanaHtml, expectation: readExpectation(asanaExpect) },
  // The live BeyondTrust form whose selects went unfilled (2026-11-01).
  { name: 'beyondtrust-job', html: beyondtrustHtml, expectation: readExpectation(beyondtrustExpect) },
] as const;

/** The width the live BeyondTrust form draws an empty react-select's text box: a space of Roboto at 16 px, a web font
 *  the fixture has not got (its fallback draws the box 4.45 px wide). */
const LIVE_TEXT_BOX_PX = 3.96875;

/** Draws every react-select's text box at the live page's width (react-select sizes the box by the grid column its
 *  container's ::after holds open with a space). */
function liveTextBoxes(doc: Document): void {
  const style = doc.createElement('style');
  style.textContent = `.select-shell .select__input-container { grid-template-columns: 0 ${LIVE_TEXT_BOX_PX}px; }`;
  doc.head.append(style);
}

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
    removeFixtures(document);
    // The education block by its own header, as an education section; a company's text with a nearer heading above
    // its questions (twilio-job.html) names its block by that heading.
    const twitch = await loadGreenhouse(twitchHtml);
    expect(greenhouseAdapter.sections!(twitch.root).map((section) => [section.label, section.kind])).toEqual([
      ['Apply for this job', undefined], ['Apply for this job', undefined], ['Education', 'education'],
      ['Voluntary Self-Identification', undefined]]);
    removeFixtures(document);
    const twilio = await loadGreenhouse(twilioHtml);
    expect(greenhouseAdapter.sections!(twilio.root).map((section) => section.label)).toEqual(['Apply for this job',
      'Apply for this job', 'Voluntary Self-Identification of Race & Ethnicity and Protected Veterans Status']);
  });

  it("labels an upload group's file input by the group's div#upload-label-*, and no other control", async () => {
    const { doc } = await loadGreenhouse(discordHtml);
    expect(greenhouseAdapter.labelFor!(doc.getElementById('resume')!)).toBe(doc.getElementById('upload-label-resume'));
    expect(greenhouseAdapter.labelFor!(doc.getElementById('cover_letter')!))
      .toBe(doc.getElementById('upload-label-cover_letter'));
    for (const id of ['first_name', 'question_38318888002', 'gdpr_demographic_data_consent_given_1']) {
      expect(greenhouseAdapter.labelFor!(doc.getElementById(id)!)).toBeNull();
    }
    // s2 lists: the phone's country is labelled by its own label first, "code" after it (decision 2).
    const country = doc.getElementById('country')!;
    expect(greenhouseAdapter.labelFor!(country)).toBe(country.closest('.select__container')!.querySelector('label[for="country"]'));
    expect([greenhouseAdapter.labelFirst!(country), greenhouseAdapter.labelSuffix!(country)]).toEqual([true, 'code']);
    expect([greenhouseAdapter.labelFirst!(doc.getElementById('first_name')!),
      greenhouseAdapter.labelSuffix!(doc.getElementById('first_name')!)]).toEqual([false, null]);
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

  it('declares every react-select input as its widget, and nothing else (the required shim, the hidden country search)', async () => {
    const gh = await loadGreenhouse(twitchHtml);
    const inputs = Array.from(gh.root.querySelectorAll<HTMLInputElement>('input.select__input[role="combobox"]'));
    expect(inputs).toHaveLength(25);
    for (const input of inputs) {
      const declared = greenhouseAdapter.widgetFor!(input)!;
      expect(declared, input.id).toMatchObject({ activation: ['mouseup'],
        busy: ['.select__menu-notice--loading', '.select__loading-indicator'], snapshot: GREENHOUSE_WIDGET_SNAPSHOTS[0] });
      expect(declared.opener === input && declared.expanded === input && declared.box === input.closest('.select__control'),
        input.id).toBe(true);
      const kind = /^(?:candidate-location|school--0)$/.test(input.id) ? 'typeahead-remote'
        : input.id === 'question_38697197002[]' ? 'multiselect' : 'combobox';
      expect(declared.kind, input.id).toBe(kind);
    }
    const others = Array.from(gh.root.querySelectorAll('input, textarea')).filter((el) => !inputs.includes(el as HTMLInputElement));
    expect(others.filter((el) => greenhouseAdapter.widgetFor!(el) !== null)).toEqual([]);
    expect(others.some((el) => el.id === 'iti-0__search-input')).toBe(true);
    expect(others.filter((el) => el.matches('input[aria-hidden="true"][tabindex="-1"]'))).toHaveLength(17);
  });

  it('opens a select on a page that never answers with a mouseup, and flags it needs-your-click: no click, no mousedown', async () => {
    const gh = await loadGreenhouse(discordHtml);
    const result = scan(gh.root, greenhouseAdapter, { platform: 'greenhouse' });
    const location = result.fields.find((field) => field.idAttr === 'candidate-location')!;
    expect(location).toMatchObject({ kind: 'typeahead-remote', options: 'lazy', label: 'Location (City)', required: true });
    const question = result.fields.find((field) => field.idAttr === 'question_38318892002')!;
    const log = logEvents(gh.doc);
    // The run's one wait for the page is spent: the page answers nothing, so the field is the person's.
    expect(await readWidget(result.target(question.key)!, { adapter: greenhouseAdapter, root: gh.root,
      readiness: { answered: false, waited: true } })).toEqual({ status: 'unread', reason: 'needs-your-click' });
    // (The browser's own trusted pointer boundary events, which a page changing under a still cursor causes, aside.)
    const ours = () => log.events.filter((event) => !event.trusted).map((event) => [event.target, event.type]);
    expect(ours()).toEqual([['question_38318892002', 'mouseup']]);
    expect(untrustedViolations(log.events)).toEqual([]);
    // The declared search is one without being opened: nothing is sent to it.
    expect(await readWidget(result.target(location.key)!, { adapter: greenhouseAdapter, root: gh.root }))
      .toEqual({ status: 'read', reading: { kind: 'remote' } });
    expect(ours()).toHaveLength(1);
  });

  it('keeps a select that shows an answer a field, its input drawn transparent; never a hidden one', async () => {
    const gh = await loadGreenhouse(twitchHtml);
    // twitch.yesno-chosen: the answer beside an emptied input react-select draws with opacity 0.
    const choose = (id: string, answer: (doc: Document) => Node[]) => {
      const input = gh.doc.getElementById(id) as HTMLInputElement;
      const values = input.closest('.select__value-container')!;
      values.classList.add('select__value-container--has-value');
      values.querySelector('.select__placeholder')?.remove();
      const shown = gh.doc.createElement('div');
      shown.className = 'select__single-value';
      shown.append(...answer(gh.doc));
      values.prepend(shown);
      input.style.opacity = '0';
      return input;
    };
    const fieldOf = (id: string) => scan(gh.root, greenhouseAdapter, { platform: 'greenhouse' }).fields
      .find((field) => field.idAttr === id);
    choose('question_38697188002', (doc) => [doc.createTextNode('No')]);
    expect(fieldOf('question_38697188002')).toMatchObject({ kind: 'combobox', current: { kind: 'selected', labels: ['No'] } });
    // twitch.phone-country-chosen: a flag and "+1" name "Canada +1", never "United States +1".
    const flag = (code: string) => (doc: Document) => {
      const el = doc.createElement('div');
      el.className = `iti__flag iti__${code}`;
      const dial = doc.createElement('span');
      dial.textContent = '+1';
      return [el, dial];
    };
    const country = choose('country', flag('ca'));
    expect(fieldOf('country')).toMatchObject({ current: { kind: 'selected', labels: ['Canada +1'] } });
    country.closest('.select__value-container')!.querySelector('.iti__flag')!.className = 'iti__flag iti__us';
    expect(fieldOf('country')).toMatchObject({ current: { kind: 'selected', labels: ['United States +1'] } });
    // Hidden any other way, or its box hidden, it is no field.
    const hidden = choose('question_38697189002', (doc) => [doc.createTextNode('Yes')]);
    hidden.style.display = 'none';
    expect(fieldOf('question_38697189002')).toBeUndefined();
    const boxed = choose('question_38697190002', (doc) => [doc.createTextNode('Yes')]);
    // (display, not visibility: the control's own transition keeps it visible for 100 ms after a visibility change.)
    (boxed.closest('.select__control') as HTMLElement).style.display = 'none';
    expect(fieldOf('question_38697190002')).toBeUndefined();
  });

  it('keeps a select whose empty text box is under 4 px wide a field, by its control (the live BeyondTrust form); never one hidden any other way', async () => {
    const gh = await loadGreenhouse(beyondtrustHtml);
    liveTextBoxes(gh.doc);
    // The live page's geometry: each select's text box 3.97 px wide inside its visible control, and nothing else
    // hiding it. The scanner took every one for a hidden control (hiddenControlsIgnored 14), so none was filled.
    const selects = ['country', 'candidate-location', 'question_70199749', 'question_70199751', 'question_70199752',
      '31771', '31772', '31774', '41756'];
    for (const id of selects) {
      const input = gh.doc.getElementById(id)!;
      expect(input.getBoundingClientRect().width, id).toBeCloseTo(LIVE_TEXT_BOX_PX, 3);
      expect(visibilityOf(input), id).toMatchObject({ visible: false, rule: 'box-size' });
      expect(visibilityOf(input.closest('.select__control')!), id).toMatchObject({ visible: true });
    }
    const result = scan(gh.root, greenhouseAdapter, { platform: 'greenhouse' });
    // Each select is the field its expectations name, of its declared kind; only the four required shims and the hidden
    // country search are hidden controls.
    expect(compareWithExpectation(gh.doc, result, readExpectation(beyondtrustExpect))).toEqual([]);
    expect(result.fields.filter((field) => selects.includes(field.idAttr)).map((field) => [field.idAttr, field.kind,
      field.visibility])).toEqual(selects.map((id) => [id, id === 'candidate-location' ? 'typeahead-remote' : 'combobox',
      'visible']));
    expect(result.counters.hiddenControlsIgnored).toBe(5);
    const fieldOf = (id: string) => scan(gh.root, greenhouseAdapter, { platform: 'greenhouse' }).fields
      .find((field) => field.idAttr === id);
    const input = (id: string) => gh.doc.getElementById(id) as HTMLInputElement;
    // Narrow and drawn outside its control (moved off the page), too short to see, aria-hidden, or inside a control
    // that is hidden: no field.
    input('question_70199749').style.position = 'relative';
    input('question_70199749').style.left = '-3000px';
    expect(visibilityOf(input('question_70199749')).rule).toBe('box-size');
    expect(fieldOf('question_70199749')).toBeUndefined();
    input('question_70199751').style.height = '2px';
    expect(fieldOf('question_70199751')).toBeUndefined();
    input('31771').setAttribute('aria-hidden', 'true');
    expect(fieldOf('31771')).toBeUndefined();
    (input('31772').closest('.select__control') as HTMLElement).style.display = 'none';
    expect(fieldOf('31772')).toBeUndefined();
    // The others stay fields.
    expect(['31774', '41756'].map((id) => fieldOf(id)?.kind)).toEqual(['combobox', 'combobox']);
  });

  it('names the buttons never pressed, and assertNotSubmit refuses them and anything inside them', async () => {
    const gh = await loadGreenhouse(twitchHtml);
    const never = greenhouseAdapter.neverPress!(gh.root);
    expect(never.map((el) => el.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Autofill my application', 'Locate me',
      'Dropbox', 'Google Drive', 'Enter manually', 'Dropbox', 'Google Drive', 'Enter manually']);
    const ctx = { adapter: greenhouseAdapter, root: gh.root };
    for (const el of never) {
      expect(assertNotSubmit(el, ctx)).toEqual({ ok: false, refusal: 'adapter-never-press' });
      for (const inner of Array.from(el.querySelectorAll('*'))) expect(assertNotSubmit(inner, ctx).ok).toBe(false);
    }
    // What the fillers do press stays pressable: a select's input, a checkbox, an upload group's Attach button.
    for (const selector of ['#question_38697188002', 'input[type="checkbox"]', '.file-upload button']) {
      expect(assertNotSubmit(gh.root.querySelector(selector)!, ctx), selector).toEqual({ ok: true });
    }
    // The other adapters name none.
    expect(assertNotSubmit(never[1]!, { adapter: null, root: gh.root })).toEqual({ ok: true });
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
