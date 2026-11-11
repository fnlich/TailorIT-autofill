/*
 * v5 Phase 2 (P2-fill), the whole run in a frame (the content runtime with the fake worker planning over the golden
 * profile and its résumé):
 * - a rich-text box (contenteditable) takes the profile's answer through the browser's own insert, read back verified;
 * - a résumé control its adapter declares to open the page's own picker (Adapter.uploadPickers; a synthetic page that
 *   makes its file input at the press, as Dropzone does) gets the résumé through the picker armed for that press, with
 *   the page patches installed as the worker's injection installs them; the page's alert on taking the file is held,
 *   counted, and the count shown on the page (v5 p2-fill review, security 4); with no patches in the frame nothing is
 *   pressed and the row asks the person;
 * - Rippling's application (fixtures/rippling/qu-careers-form.html, its résumé help "The résumé will be parsed to fill
 *   in the application details": quirks.resumeParse) gets its résumé first and its parse waited for, so the profile's
 *   answers are written over what the page's parse put in, never under it; v5 p2-fill review (L1): a parse slower than
 *   3 s too (Rippling shows no busy sign), and the form read again after it, so the parsed first name we overwrite is
 *   a flagged prefill-conflict row.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ripplingHtml from '../../fixtures/rippling/qu-careers-form.html?raw';
import ripplingRoutes from '../../fixtures/rippling/qu-careers-form.routes.json';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import type { FillResult } from '../core/types/fill';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import { editableText } from '../dom/values';
import { installPatches } from '../page/patches';
import { PAGE_COPY } from '../shared/copy';
import { createFakeWorker, fakePdf, GOLDEN_RESUME, goldenProfile, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const runtimes: ContentRuntime[] = [];
const removals: Array<() => void> = [];
beforeAll(() => {
  testVocab();
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  for (const remove of removals.splice(0)) remove();
  removeFixtures(document);
});

const HREF = 'https://jobs.lever.co/tailorit-fixture/p2-fill/apply';

function worker() {
  return createFakeWorker({ resume: { bytes: fakePdf(48_213), name: GOLDEN_RESUME.fileName, mime: 'application/pdf' },
    letter: { state: { state: 'none', reason: 'cover-letter-none' } } });
}

async function run(doc: Document, adapters: Adapter[], href = HREF) {
  const fake = worker();
  const runtime = await startContentRuntime(fake.platform, doc, { href: () => href, isTop: true,
    adapters: () => adapters, settle: { quietMs: 120 } });
  runtimes.push(runtime);
  await runtime.fill({});
  const report = fake.reports.at(-1) ?? fake.liveReports.at(-1);
  return { rows: (report?.fields ?? []) as FillResult[], fake, runtime };
}

describe('a rich-text box in a run', () => {
  it('takes the profile\'s answer through the browser\'s own insert, verified', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <span id="fl">First name</span>
      <div id="first" contenteditable="true" role="textbox" aria-multiline="false" aria-labelledby="fl"
        style="display:block;min-height:24px;border:1px solid #888;padding:4px"></div>
      <label for="e">Email</label><input id="e" type="email" style="border:1px solid #888"></form></body>`);
    const { rows } = await run(fixture.doc, [genericAdapter]);
    const first = rows.find((row) => row.category === 'identity.firstName');
    expect(first).toMatchObject({ kind: 'text', wrote: true, verification: 'verified' });
    expect(editableText(fixture.doc.getElementById('first')!)).toBe(goldenProfile().identity.firstName);
  }, 60_000);

  // v5 p2-fill review (L6): an editor whose selection follows the document's selectionchange on a later task.
  it('lets an editor that syncs its selection on selectionchange see it before the insert', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <span id="fl">First name</span>
      <div id="first" contenteditable="true" role="textbox" aria-multiline="false" aria-labelledby="fl"
        style="display:block;min-height:24px;border:1px solid #888;padding:4px">Old</div>
      <label for="e">Email</label><input id="e" type="email" style="border:1px solid #888"></form></body>`);
    const box = fixture.doc.getElementById('first')!;
    let all = false;
    fixture.doc.addEventListener('selectionchange', () => {
      const selection = fixture.view.getSelection();
      const now = selection !== null && selection.rangeCount === 1 && selection.getRangeAt(0).toString() === box.textContent;
      fixture.view.setTimeout(() => {
        all = now;
      }, 0);
    });
    box.addEventListener('beforeinput', (event) => {
      event.preventDefault();
      if ((event as InputEvent).inputType !== 'insertText') return;
      const data = (event as InputEvent).data ?? '';
      box.textContent = all ? data : `${box.textContent ?? ''}${data}`;
      all = false;
    });
    const { rows } = await run(fixture.doc, [genericAdapter]);
    expect(editableText(box)).toBe(goldenProfile().identity.firstName);
    expect(rows.find((row) => row.category === 'identity.firstName')).toMatchObject({ wrote: true,
      verification: 'verified' });
  }, 60_000);
});

/** A page whose résumé control makes its file input at the press and clicks it (as Dropzone does), and alerts once the
 *  file is taken. */
const PICKER_PAGE = `<!doctype html><body><form id="f">
  <label for="n">Full name</label><input id="n" style="border:1px solid #888">
  <div><span id="rl">Resume</span> <button type="button" id="attach" aria-labelledby="rl">Attach</button>
  <span id="taken"></span></div></form>
  <script>
    document.getElementById('attach').addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.addEventListener('change', function () {
        document.getElementById('taken').textContent = input.files.length + ' file';
        window.alert('Resume uploaded');
      });
      window.__input = input;
      input.click();
    });
  </script></body>`;

const withPicker: Adapter = { ...genericAdapter,
  uploadPickers: (root) => Array.from(root.querySelectorAll<HTMLElement>('#attach')) };

describe('a résumé control that opens the page\'s own picker (Adapter.uploadPickers)', () => {
  it('gets the résumé through the picker armed for its press; the page\'s alert is held, counted', async () => {
    const fixture = await loadFixture(document, PICKER_PAGE);
    removals.push(installPatches(fixture.doc));
    const alert = vi.fn();
    Object.assign(fixture.view, { alert });
    const { rows, fake, runtime } = await run(fixture.doc, [withPicker]);
    // The run asked the worker once for the page patches in this document (the test installed them itself).
    expect(fake.of('page/patches')).toHaveLength(1);
    const resume = rows.find((row) => row.category === 'file.resume');
    expect(resume).toMatchObject({ kind: 'file', wrote: true, verification: 'verified' });
    const input = (fixture.view as unknown as { __input: HTMLInputElement }).__input;
    expect(input.files?.[0]?.name).toBe(GOLDEN_RESUME.fileName);
    expect(fixture.doc.getElementById('taken')!.textContent).toBe('1 file');
    expect(alert).not.toHaveBeenCalled();
    // v5 p2-fill review (security 4): the person sees the count, in our words, never the page's.
    await vi.waitFor(() => expect(runtime.ui!.toasts.shown).toContain('dialogs'));
    const said = runtime.ui!.shadow.querySelector('.toast[data-kind="dialogs"] .notice')?.textContent;
    expect(said).toBe(PAGE_COPY.toasts.dialogs(1, 0));
    expect(said).toBe('The page showed 1 message while Autofill filled it. Autofill closed it; check the page.');
    expect(said).not.toContain('Resume uploaded');
  }, 60_000);

  it('presses nothing where no patches answer: the row is the person\'s (needs-your-click)', async () => {
    const fixture = await loadFixture(document, PICKER_PAGE);
    const clicks = vi.fn();
    fixture.doc.getElementById('attach')!.addEventListener('click', clicks);
    const { rows } = await run(fixture.doc, [withPicker]);
    const resume = rows.find((row) => row.category === 'file.resume');
    expect(resume).toMatchObject({ wrote: false, reason: 'needs-your-click', needsUserAction: true });
    expect(clicks).not.toHaveBeenCalled();
  }, 60_000);

  it('without the declaration the control is no field (undo proof for uploadPickers)', async () => {
    const fixture = await loadFixture(document, PICKER_PAGE);
    removals.push(installPatches(fixture.doc));
    const { rows } = await run(fixture.doc, [genericAdapter]);
    expect(rows.some((row) => row.category === 'file.resume')).toBe(false);
  }, 60_000);
});

/** Rippling's application, its page played by the test: the résumé taken at once (its chip, the adapter's `done` sign,
 *  rippling-0: <div data-testid="chip"><div id="chip-<n>-content"><div>name</div>...), and the parse filling the first
 *  name PARSE_AFTER_MS later, after the upload's confirmation (UPLOAD_QUIET_MS, 1 s of quiet). Answers the order the
 *  page saw the résumé, the parse and the run's first-name write in. */
const PARSE_AFTER_MS = 2_400;

function parseOnUpload(doc: Document, view: Window & typeof globalThis, afterMs = PARSE_AFTER_MS): string[] {
  const seen: string[] = [];
  // The first-name box of the fixture (<input data-testid="input-first_name" ...>).
  const firstName = doc.querySelector<HTMLInputElement>('input[data-testid="input-first_name"]')!;
  const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')!.set!;
  doc.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    if (target === firstName && target.value !== 'Parsed') seen.push('first-name');
    // Any other box the run writes, a custom question's AI answer among them (v5 p2-stream's one round: answers land in
    // passes after the résumé's).
    else if (target !== firstName && target.type !== 'file') seen.push('write');
  }, true);
  const input = doc.querySelector<HTMLInputElement>('input[data-testid="input-resume"]')!;
  input.addEventListener('change', () => {
    seen.push('resume');
    const chip = doc.createElement('div');
    chip.setAttribute('data-testid', 'chip');
    const content = doc.createElement('div');
    content.id = 'chip-1-content';
    const name = doc.createElement('div');
    name.textContent = input.files?.[0]?.name ?? '';
    content.append(name);
    chip.append(content);
    input.closest('div[data-testid="field"]')!.append(chip);
    view.setTimeout(() => {
      setter.call(firstName, 'Parsed');
      firstName.dispatchEvent(new view.Event('input', { bubbles: true }));
      seen.push('parsed');
    }, afterMs);
  });
  return seen;
}

describe('the résumé first where the page parses it (quirks.resumeParse)', () => {
  const href = Object.keys(ripplingRoutes)[0]!;

  it('Rippling: writes the résumé first, waits for the parse, and writes the profile over it', async () => {
    const fixture = await loadFixture(document, ripplingHtml, { width: 1280, height: 2600 });
    const seen = parseOnUpload(fixture.doc, fixture.view);
    const { rows } = await run(fixture.doc, (await import('../adapters')).adaptersFor(new URL(href)), href);
    expect(seen[0]).toBe('resume');
    expect(seen.indexOf('parsed')).toBeLessThan(seen.indexOf('first-name'));
    // Nothing else was written under the parse either: every other write came after it.
    expect(seen.slice(0, seen.indexOf('parsed'))).toEqual(['resume']);
    const first = rows.find((row) => row.category === 'identity.firstName');
    // v5 p2-fill review (L1): read again after the parse, the parsed name we wrote over is flagged.
    expect(first).toMatchObject({ wrote: true, verification: 'verified', status: 'flagged', reason: 'prefill-conflict' });
  }, 60_000);

  // v5 p2-fill review (L1): Rippling shows no sign of its parse, which lands when its server answers.
  it('Rippling: waits for a parse slower than 3 s, and flags the parsed value it writes over', async () => {
    const fixture = await loadFixture(document, ripplingHtml, { width: 1280, height: 2600 });
    const seen = parseOnUpload(fixture.doc, fixture.view, 5_000);
    const { rows } = await run(fixture.doc, (await import('../adapters')).adaptersFor(new URL(href)), href);
    expect(seen[0]).toBe('resume');
    expect(seen.indexOf('parsed')).toBeGreaterThan(0);
    expect(seen.slice(0, seen.indexOf('parsed'))).toEqual(['resume']);
    expect(seen.indexOf('parsed')).toBeLessThan(seen.indexOf('first-name'));
    const first = rows.find((row) => row.category === 'identity.firstName');
    expect(first).toMatchObject({ wrote: true, status: 'flagged', reason: 'prefill-conflict' });
    expect((fixture.doc.querySelector('input[data-testid="input-first_name"]') as HTMLInputElement).value)
      .toBe(goldenProfile().identity.firstName);
  }, 60_000);

  it('without the quirk the parse lands after the profile\'s answer (undo proof)', async () => {
    const fixture = await loadFixture(document, ripplingHtml, { width: 1280, height: 2600 });
    const seen = parseOnUpload(fixture.doc, fixture.view);
    const adapters = (await import('../adapters')).adaptersFor(new URL(href))
      .map((adapter) => ({ ...adapter, quirks: { ...adapter.quirks, resumeParse: undefined } }));
    await run(fixture.doc, adapters as Adapter[], href);
    expect(seen.indexOf('first-name')).toBeLessThan(seen.indexOf('parsed'));
  }, 60_000);
});

/** A posting page with no form, its own Apply a link to the application (as Lever's is: applicationLinkOf). */
const POSTING = 'https://jobs.lever.co/acme/1b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00';
const POSTING_PAGE = `<!doctype html><body><main><h1>Platform Engineer</h1><p>We build platforms.</p>
  <a id="apply" href="${POSTING}/apply">Apply for this job</a></main></body>`;
/** The generic adapter with the posting's Apply declared as its entry (a test stand-in for a platform's entryControl:
 *  in a srcdoc frame the platforms' own read the document's address, which is not the posting's). jr6 apply F2 item 1:
 *  it stands for the address's own adapter (Lever's), since only an own adapter offers an entry. */
const withEntry: Adapter = { ...genericAdapter, id: 'lever',
  entryControl: (doc) => doc.querySelector<HTMLElement>('a#apply') };

// jr6 apply F2 (the owner, 2026-11-10: the button's word stays "Autofill"): the panel's Autofill on a posting page.
describe('Autofill on a posting page: the posting\u2019s own Apply (v5 p2-fill, jr6 apply F2)', () => {
  async function posting(adapters: Adapter[]) {
    const fixture = await loadFixture(document, POSTING_PAGE);
    const pressed: string[] = [];
    // The browser's navigation the link would make stands still: the click is recorded.
    fixture.doc.addEventListener('click', (event) => {
      const link = (event.target as Element).closest('a');
      if (link === null) return;
      event.preventDefault();
      pressed.push(link.id);
    });
    const fake = worker();
    const runtime = await startContentRuntime(fake.platform, fixture.doc, { href: () => POSTING, isTop: true,
      adapters: () => adapters, settle: { quietMs: 120 } });
    runtimes.push(runtime);
    return { fixture, fake, pressed };
  }

  it('tells the worker its posting offers its own Apply, and presses it on the panel\'s run/start', async () => {
    const { fake, pressed } = await posting([withEntry]);
    await vi.waitFor(() => expect(fake.of('frame/wall').at(-1)).toMatchObject({ wall: null, entry: true }), { timeout: 5_000 });
    expect(pressed).toEqual([]);
    await fake.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(pressed).toEqual(['apply']));
  }, 30_000);

  // v5 p2-fill review (L5): a press that cannot be made is told, so the panel says why; the next press clears it.
  // jr6 apply F2 item 2 (AF-2, AF-12): the frame waits for an Apply drawn late first (ENTRY_WAIT_MS), says it works
  // meanwhile (entering), and says why when none came ('none').
  it('tells the worker when its Apply could not be pressed (none came in the wait), and clears it at the next press',
    async () => {
      const { fixture, fake, pressed } = await posting([withEntry]);
      await vi.waitFor(() => expect(fake.of('frame/wall').at(-1)).toMatchObject({ wall: null, entry: true }),
        { timeout: 5_000 });
      // The page takes its Apply away before the panel's press comes.
      const link = fixture.doc.getElementById('apply')!;
      link.remove();
      await fake.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(fake.of('frame/wall').at(-1)).toMatchObject({ entering: true }), { timeout: 2_000 });
      await vi.waitFor(() => expect(fake.of('frame/wall').at(-1)).toMatchObject({ wall: null, entryRefused: true,
        refusal: 'none' }), { timeout: 12_000 });
      expect(fake.of('frame/wall').at(-1)?.entering).toBeUndefined();
      expect(pressed).toEqual([]);
      // Back, and pressed: the refusal is cleared.
      fixture.doc.querySelector('main')!.append(link);
      await vi.waitFor(() => expect(fake.of('frame/wall').at(-1)).toMatchObject({ entry: true }), { timeout: 5_000 });
      await fake.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(pressed).toEqual(['apply']));
      expect(fake.of('frame/wall').at(-1)?.entryRefused).toBeUndefined();
      expect(fake.of('frame/wall').at(-1)?.refusal).toBeUndefined();
    }, 40_000);

  it('a posting whose adapter declares no entry offers none and presses nothing (undo proof)', async () => {
    const { fake, pressed } = await posting([genericAdapter]);
    await deadline(1_500);
    expect(fake.of('frame/wall').some((message) => message.entry === true)).toBe(false);
    await fake.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await deadline(500);
    expect(pressed).toEqual([]);
    // jr6 apply F2 item 2 (AF-2, AF-12): Autofill is offered on every page of ours, so its press there says why it
    // found nothing to press ('none'), at once (no adapter declares an Apply or a form drawn late).
    expect(fake.of('frame/wall').at(-1)).toMatchObject({ entryRefused: true, refusal: 'none' });
  }, 30_000);
});
