/*
 * The Greenhouse adapter on the owner's captures of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06; the snapshots were converted and
 * redacted by scripts/mhtml-to-fixture.mjs): a form filled before Submit with its resume attached
 * (fixtures/greenhouse/axle-attached.html), the same form after Submit asking for its email code (axle-verification.html),
 * a react-select open (rushdown-country-open.html), and the Greenhouse frames of two company pages: one after a Submit
 * with a required answer missing (fixtures/sites/abclegal-greenhouse-embed.frame-1.html) and one sending
 * (seatgeek-greenhouse-embed.frame-1.html).
 */
import { afterEach, describe, expect, it } from 'vitest';
import attachedExpect from '../../../fixtures/greenhouse/axle-attached.expect.json';
import attachedHtml from '../../../fixtures/greenhouse/axle-attached.html?raw';
import verificationHtml from '../../../fixtures/greenhouse/axle-verification.html?raw';
import gitlabHtml from '../../../fixtures/greenhouse/gitlab-job.html?raw';
import openHtml from '../../../fixtures/greenhouse/rushdown-country-open.html?raw';
import abclegalFrameHtml from '../../../fixtures/sites/abclegal-greenhouse-embed.frame-1.html?raw';
import seatgeekFrameHtml from '../../../fixtures/sites/seatgeek-greenhouse-embed.frame-1.html?raw';
import { loadFixture, logEvents, removeFixtures, untrustedViolations } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan } from '../../dom/scan';
import { isUserVisible } from '../../dom/visibility';
import { readWidget } from '../../dom/widgets';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { awaitingScanner } from '../test/findings.testkit';
import { greenhouseAdapter } from './index';

const ATTACHED = readExpectation(attachedExpect);

async function loadGreenhouse(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

/** A file input standing for the one Greenhouse took out of the page once the file was in it (its id is the group's). */
function takenOut(doc: Document, id: string): HTMLInputElement {
  const input = doc.createElement('input');
  input.type = 'file';
  input.id = id;
  return input;
}

describe('the Greenhouse adapter on the captures of 2026-11-06', () => {
  afterEach(() => removeFixtures(document));

  it('axle-attached: the scan agrees with its expectations, the resume question holding no control once attached', async () => {
    const scanned = await scanCase(document, attachedHtml, ATTACHED.source);
    expect(scanned.adapter.id).toBe('greenhouse');
    expect(compareWithExpectation(scanned.doc, scanned.result, ATTACHED)).toEqual(awaitingScanner(ATTACHED));
    expect(scanned.doc.querySelector('input[type="file"]')).toBeNull();
    expect(scanned.result.fields.some((field) => field.kind === 'file')).toBe(false);
  });

  it('reads an attached file as Greenhouse shows it: its name beside "Remove file" in the group the input left', async () => {
    const gh = await loadGreenhouse(attachedHtml);
    // The capture's file name is redacted: a stand-in name is written where the page shows it.
    const shown = gh.doc.querySelector('[aria-labelledby="upload-label-resume"] .file-upload__filename p')!;
    shown.textContent = 'Alex Rivera - Resume.pdf';
    const input = takenOut(gh.doc, 'resume');
    expect(greenhouseAdapter.uploadState!(input, 'Alex Rivera - Resume.pdf')).toBe('confirmed');
    expect(greenhouseAdapter.uploadState!(input, 'Another file.pdf')).toBe('pending');
    // No "Remove file" beside the name: not shown done.
    gh.doc.querySelector('.file-upload__filename button[aria-label="Remove file"]')!.remove();
    expect(greenhouseAdapter.uploadState!(input, 'Alex Rivera - Resume.pdf')).toBe('pending');
    // An input no upload group names (the cover letter: this form asks for none) is no upload the adapter reads.
    expect(greenhouseAdapter.uploadState!(takenOut(gh.doc, 'cover_letter'), 'Alex Rivera - Resume.pdf')).toBeNull();
    removeFixtures(document);
    // A group still showing Attach (rushdown-country-open.html: the input in its group, nothing attached): pending.
    const open = await loadGreenhouse(openHtml);
    const resume = open.doc.getElementById('resume') as HTMLInputElement;
    expect(greenhouseAdapter.uploadState!(resume, 'Alex Rivera - Resume.pdf')).toBe('pending');
    expect(greenhouseAdapter.uploadState!(open.doc.getElementById('first_name') as HTMLInputElement, 'x.pdf')).toBeNull();
  });

  it('never presses an attached file\'s "Remove file", nor "Autofill my application" once MyGreenhouse filled the form', async () => {
    const gh = await loadGreenhouse(attachedHtml);
    const never = greenhouseAdapter.neverPress!(gh.root);
    const remove = gh.doc.querySelector('.file-upload__filename button[aria-label="Remove file"]')!;
    expect(never).toContain(remove);
    const autofill = gh.doc.querySelector('.autofill_button.autofill_button--filled button')!;
    expect(never).toContain(autofill);
  });

  it('axle-verification: the email code is the person\'s: no field in its block, and the step pauses as an email code', async () => {
    const gh = await loadGreenhouse(verificationHtml);
    const block = gh.doc.querySelector('div.email-verification')!;
    expect(block.querySelectorAll('input[id^="security-input-"]')).toHaveLength(8);
    expect(greenhouseAdapter.excluded!(gh.root)).toContain(block);
    const result = scan(gh.root, greenhouseAdapter, { platform: 'greenhouse' });
    const inBlock = result.fields.filter((field) => {
      const target = result.target(field.key);
      return target !== null && block.contains(target.control);
    });
    expect(inBlock).toEqual([]);
    // The block's legend names the person's email: no field takes it as its section either.
    expect(result.fields.some((field) => field.section.id.includes('verification-code'))).toBe(false);
    expect(greenhouseAdapter.authState!(gh.doc)).toBe('email-code');
    expect(detectPause(gh.doc, gh.root, greenhouseAdapter)).toEqual({ kind: 'email-code', evidence: 'adapter' });
    // Hidden, it asks nothing.
    (block as HTMLElement).style.display = 'none';
    expect(greenhouseAdapter.authState!(gh.doc)).toBeNull();
    removeFixtures(document);
    const before = await loadGreenhouse(attachedHtml);
    expect(greenhouseAdapter.authState!(before.doc)).toBeNull();
    expect(detectPause(before.doc, before.root, greenhouseAdapter)).toBeNull();
  });

  // The behaviour review of 2026-11-06 (minor 15): the email code reads only while its block and one of its boxes show.
  it('axle-verification: no email code while its boxes are hidden in a drawn block, or its block is hidden (G4, G5)',
    async () => {
      const gh = await loadGreenhouse(verificationHtml);
      const block = gh.doc.querySelector<HTMLElement>('fieldset#email-verification')!;
      const boxes = Array.from(block.querySelectorAll<HTMLElement>('input[id^="security-input-"]'));
      expect(greenhouseAdapter.authState!(gh.doc)).toBe('email-code');
      // Every box hidden, the block (its legend and label) still drawn (G4).
      for (const box of boxes) box.style.display = 'none';
      expect(greenhouseAdapter.authState!(gh.doc)).toBeNull();
      for (const box of boxes) box.style.display = '';
      // The block hidden, one box drawn through it (G5).
      block.style.visibility = 'hidden';
      boxes[0]!.style.visibility = 'visible';
      expect(isUserVisible(boxes[0]!)).toBe(true);
      expect(greenhouseAdapter.authState!(gh.doc)).toBeNull();
    });

  it('is busy while Greenhouse sends the application: its Submit shows the spinner in place of its words', async () => {
    const sending = await loadGreenhouse(seatgeekFrameHtml);
    const spinner = sending.doc.querySelector('.application--submit button[type="submit"] .loading-spinner')!;
    expect(greenhouseAdapter.isBusy!(sending.doc)).toBe(true);
    (spinner as HTMLElement).style.display = 'none';
    expect(greenhouseAdapter.isBusy!(sending.doc)).toBe(false);
    removeFixtures(document);
    for (const html of [attachedHtml, verificationHtml, gitlabHtml]) {
      const quiet = await loadGreenhouse(html);
      expect(greenhouseAdapter.isBusy!(quiet.doc)).toBe(false);
      removeFixtures(document);
    }
  });

  it('reads a required answer missing after Submit by the control marked invalid, its error text beside it', async () => {
    const gh = await loadGreenhouse(abclegalFrameHtml);
    const errors = greenhouseAdapter.errors!(gh.root).map((error) => error.el);
    const invalid = gh.doc.getElementById('question_33283075003')!;
    expect(errors).toEqual([invalid]);
    const message = gh.doc.getElementById(invalid.getAttribute('aria-errormessage')!)!;
    expect(message.matches('.helper-text.helper-text--error')).toBe(true);
    expect(message.textContent).toBe('This field is required.');
    // The same frame shows the email code after that Submit.
    expect(greenhouseAdapter.authState!(gh.doc)).toBe('email-code');
  });

  it('rushdown-country-open: an open react-select is read as it stands, its 244 countries, never opened again', async () => {
    const gh = await loadGreenhouse(openHtml);
    const country = gh.doc.getElementById('country') as HTMLInputElement;
    expect(country.getAttribute('aria-expanded')).toBe('true');
    const declared = greenhouseAdapter.widgetFor!(country)!;
    expect(declared).toMatchObject({ kind: 'combobox', expanded: country, bridge: 'react-select' });
    const listbox = gh.doc.getElementById(country.getAttribute('aria-controls')!)!;
    expect(country.closest('.select-shell')!.contains(listbox)).toBe(true);
    expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(244);
    const result = scan(gh.root, greenhouseAdapter, { platform: 'greenhouse' });
    const field = result.fields.find((each) => each.idAttr === 'country')!;
    expect(field).toMatchObject({ kind: 'combobox', label: 'Country' });
    const log = logEvents(gh.doc);
    const read = await readWidget(result.target(field.key)!, { adapter: greenhouseAdapter, root: gh.root });
    expect(read.status).toBe('read');
    const reading = read.status === 'read' ? read.reading : null;
    expect(reading?.kind).toBe('options');
    const options = reading?.kind === 'options' ? reading.options : [];
    expect(options).toHaveLength(244);
    expect(options[0]?.label).toBe('United States +1');
    // Already open (aria-expanded="true"): its declared mouseup, which would toggle it closed, is never sent; only the
    // focus moves that close a list once it is read.
    const sent = log.events.filter((event) => !event.trusted).map((event) => event.type);
    expect(sent.filter((type) => ['mouseup', 'mousedown', 'click', 'pointerdown', 'pointerup'].includes(type))).toEqual([]);
    expect(untrustedViolations(log.events)).toEqual([]);
  });
});
