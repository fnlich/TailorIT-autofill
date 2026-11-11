/*
 * jr6 (FIXPLAN §6.9, BUILD.md §4 C3): the SmartRecruiters adapter's jr6 hooks on the owner's pages, the auditor's
 * harness (SP\jr6\audit\smartrecruiters.md §3) turned into asserts. Pages: fixtures/smartrecruiters/xplor-posting,
 * bertelsmann-expired, xplor-one-click, xplor-screening (the snapshot build of 2026-11-06) and the jr6 cases
 * jr6-xplor-one-click-filled, jr6-wiser-one-click and jr6-wiser-screening (SR-8). Each finding's hooks are asserted on
 * them, and read again without the hook (its proof). Fill outcomes that need ENGINE E1 to E3 or RULES' new rules are
 * the package's P2 (SP\jr6\build\SMARTRECRUITERS.md). Profiles: the golden synthetic one only; nothing here reads or
 * prints a value of the owner's.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import wiserOneClickHtml from '../../../fixtures/smartrecruiters/jr6-wiser-one-click.html?raw';
import xplorFilledHtml from '../../../fixtures/smartrecruiters/jr6-xplor-one-click-filled.html?raw';
import xplorOneClickHtml from '../../../fixtures/smartrecruiters/xplor-one-click.html?raw';
import xplorScreeningHtml from '../../../fixtures/smartrecruiters/xplor-screening.html?raw';
import { createFakeWorker, testVocab } from '../../content/content.testkit';
import { lateAdapters, lateFormMs } from '../../content/late-form';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { quietWait } from '../../dom/settle';
import { genericAdapter } from '../generic';
import { adaptersFor } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import type { Adapter } from '../types';
import { SMARTRECRUITERS_FORM_LATE_MS, smartRecruitersAdapter } from './index';

const XPLOR = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-58b4-4671-bd81-6ed11d3bcfd1';
const WISER = 'https://jobs.smartrecruiters.com/oneclick-ui/company/WiserSolutions/publication/1477f9aa-cf19-47a8-93a4-7178574f6b11';
const XPLOR_POSTING = 'https://jobs.smartrecruiters.com/Xplor/744000159905715-senior-site-reliability-engineer';
/** A file name of the golden synthetic profile's kind; never the owner's. */
const RESUME_NAME = 'alex-rivera-resume.pdf';

/** The application pages: the blank first page, the two filled ones (jr6) and the blank screening step. */
const PAGES = {
  blank: { html: xplorOneClickHtml, address: `${XPLOR}?dcr_ci=Xplor` },
  xplorFilled: { html: xplorFilledHtml, address: `${XPLOR}?dcr_ci=Xplor` },
  wiser: { html: wiserOneClickHtml, address: `${WISER}?dcr_ci=WiserSolutions` },
  screening: { html: xplorScreeningHtml, address: `${XPLOR}/screening?dcr_ci=Xplor` },
} as const;

/** A page loaded at its own address (its base), its form root as the adapter detects it. */
async function load(page: keyof typeof PAGES) {
  const { html, address } = PAGES[page];
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  return { fixture, doc: fixture.doc, root: smartRecruitersAdapter.detect(fixture.doc)!.formRoot };
}

/** Every element under `scope` matching `selector`, open shadow roots included. */
function deepAll(scope: Document | Element | ShadowRoot, selector: string): Element[] {
  const found: Element[] = [];
  const visit = (at: Document | Element | ShadowRoot) => {
    for (const el of Array.from(at.querySelectorAll('*'))) {
      if (el.matches(selector)) found.push(el);
      if (el.shadowRoot !== null) visit(el.shadowRoot);
    }
  };
  visit(scope);
  return found;
}

/** The one element `selector` names, open shadow roots included. */
function deepOne<T extends Element = Element>(scope: Document | Element | ShadowRoot, selector: string): T {
  const found = deepAll(scope, selector);
  expect(found, selector).toHaveLength(1);
  return found[0] as T;
}

/** A drop zone's own file input (in its shadow root). */
const fileInputOf = (zone: Element): HTMLInputElement => zone.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;

/** A file row as SmartRecruiters' drop zone draws one (jr6-wiser-one-click.html's li.c-spl-file-list-item), named
 *  `name`: a DOM variant made in the test. */
function addFileRow(zone: Element, name: string): void {
  const doc = zone.ownerDocument;
  const row = doc.createElement('li');
  row.className = 'c-spl-file-list-item';
  const label = doc.createElement('span');
  label.className = 'c-spl-file-list-item-name';
  label.textContent = name;
  row.append(label);
  let list = zone.shadowRoot!.querySelector('ul.c-spl-file-list');
  if (list === null) {
    list = doc.createElement('ul');
    list.className = 'c-spl-file-list';
    zone.shadowRoot!.append(list);
  }
  list.append(row);
}

beforeAll(() => {
  testVocab();
});

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** The adapter without one of its members. */
const without = (member: keyof Adapter): Adapter => ({ ...smartRecruitersAdapter, [member]: undefined });

/** Waits until `ready` holds, at most `capMs`. */
async function until(view: Window & typeof globalThis, doc: Document, ready: () => boolean, capMs = 4_000): Promise<boolean> {
  const wait = quietWait<boolean>({ view, quietMs: 50, capMs, signal: undefined, aborted: false,
    atQuiet: () => (ready() ? true : null), atCap: () => ready() });
  wait.observe(doc.documentElement);
  return wait.done;
}

// ── C3 (APPLYPLAN, SP\jr6\audit\apply-c.md C3; BUILD.md §4): the one-click form drawn after the script starts ─────────

describe('C3: the one-click form is waited for when the page draws it late', () => {
  it('declares a 30 s wait, every SmartRecruiters address takes it, and only its own adapter may claim meanwhile', () => {
    expect(SMARTRECRUITERS_FORM_LATE_MS).toBe(30_000);
    expect(smartRecruitersAdapter.quirks).toEqual({ formLateMs: SMARTRECRUITERS_FORM_LATE_MS });
    for (const address of [`${XPLOR}?dcr_ci=Xplor`, `${XPLOR}/screening?dcr_ci=Xplor`, XPLOR_POSTING]) {
      const adapters = adaptersFor(new URL(address));
      expect(adapters.map((each) => each.id), address).toEqual(['smartrecruiters', 'generic']);
      expect(lateFormMs(adapters), address).toBe(30_000);
      // While the wait runs, the generic adapter (which takes any page with a visible control: the Easy Apply drop zone
      // is drawn first) never claims the page.
      expect(lateAdapters(adapters), address).toEqual([smartRecruitersAdapter]);
    }
    // Without the quirk nothing is waited for, and the generic adapter may claim at once.
    expect(lateFormMs([without('quirks'), genericAdapter])).toBe(0);
    expect(lateAdapters([without('quirks'), genericAdapter])).toHaveLength(2);
  });

  it("the content runtime finds Xplor's one-click form drawn after it started, and says hello with it", async () => {
    // xplor-one-click.html with its <oc-oneclick-form> taken out before the runtime starts and put back 600 ms later, as
    // SmartRecruiters' Angular app draws it once its data is fetched (the audit measured a form drawn 1 s late).
    const fixture = await loadFixture(document, xplorOneClickHtml, SNAPSHOT_VIEWPORT);
    const doc = fixture.doc;
    const form = doc.querySelector('oc-oneclick-form')!;
    const parent = form.parentElement!;
    const next = form.nextSibling;
    form.remove();
    const fake = createFakeWorker();
    const runtime = await startContentRuntime(fake.platform, doc, { href: () => `${XPLOR}?dcr_ci=Xplor`, isTop: true });
    runtimes.push(runtime);
    expect(runtime.page).toBeNull();
    expect(fake.of('frame/hello').map((hello) => hello.hasForm)).toEqual([false]);
    fixture.view.setTimeout(() => parent.insertBefore(form, next), 600);
    expect(await until(fixture.view, doc, () => runtime.page !== null, 8_000)).toBe(true);
    expect(runtime.page?.adapter).toBe(smartRecruitersAdapter);
    expect(runtime.page?.root).toBe(form);
    expect(await until(fixture.view, doc, () => fake.of('frame/hello').length === 2)).toBe(true);
    expect(fake.of('frame/hello').map((hello) => hello.hasForm)).toEqual([false, true]);
  });
});

// ── SR-11 (FIXPLAN §6.9 item 5): a file the drop zone shows ───────────────────────────────────────────────────────────

describe('SR-11: the résumé a drop zone shows is held, by its row', () => {
  it.each(['xplorFilled', 'wiser'] as const)('%s: the Resume shows one file; the field holds it', async (page) => {
    const { doc, root } = await load(page);
    const zone = deepOne(doc, 'spl-dropzone[data-test="resume-upload"]');
    const input = fileInputOf(zone);
    const rows = Array.from(zone.shadowRoot!.querySelectorAll('li.c-spl-file-list-item'));
    expect(rows).toHaveLength(1);
    const shown = rows[0]!.querySelector('.c-spl-file-list-item-name')!.textContent!.trim();
    expect(smartRecruitersAdapter.uploadHeld!(input)).toBe(true);
    expect(smartRecruitersAdapter.uploadHeldNames!(input)).toEqual([shown]);
    // Its input itself holds none (a capture keeps no file): the page's row decides.
    expect(input.files?.length ?? 0).toBe(0);
    const result = scan(root, smartRecruitersAdapter, { platform: 'smartrecruiters' });
    const resume = result.fields.find((field) => field.label === 'Resume')!;
    expect(resume.current).toEqual({ kind: 'files', count: 1, held: true, names: [shown] });
    // Read without the hook: empty, so the planner would upload again over the page's file.
    const plain = scan(root, without('uploadHeld'), { platform: 'smartrecruiters' });
    expect(plain.fields.find((field) => field.label === 'Resume')!.current.kind).toBe('empty');
  });

  it('a blank page shows none; neither does the Easy Apply drop zone, whose list is hidden', async () => {
    const { doc, root } = await load('blank');
    const zone = deepOne(doc, 'spl-dropzone[data-test="resume-upload"]');
    expect(smartRecruitersAdapter.uploadHeld!(fileInputOf(zone))).toBe(false);
    expect(smartRecruitersAdapter.uploadHeldNames!(fileInputOf(zone))).toEqual([]);
    const result = scan(root, smartRecruitersAdapter, { platform: 'smartrecruiters' });
    expect(result.fields.find((field) => field.label === 'Resume')!.current.kind).toBe('empty');
    // The Easy Apply drop zone (hidefilelist: it draws no list), even with a row drawn: no file here (it is excluded from
    // the fields).
    const easy = deepOne(doc, 'spl-dropzone[data-test="apply-with-resume-container"]');
    expect(easy.hasAttribute('hidefilelist')).toBe(true);
    addFileRow(easy, RESUME_NAME);
    expect(smartRecruitersAdapter.uploadHeld!(fileInputOf(easy))).toBe(false);
    expect(smartRecruitersAdapter.uploadState!(fileInputOf(easy), RESUME_NAME)).toBeNull();
  });

  it("a file the run put in is uploaded once a row names it; pending until then; null for any other input", async () => {
    const { doc } = await load('blank');
    const zone = deepOne(doc, 'spl-dropzone[data-test="resume-upload"]');
    const input = fileInputOf(zone);
    expect(smartRecruitersAdapter.uploadState!(input, RESUME_NAME)).toBe('pending');
    addFileRow(zone, 'another-file.pdf');
    expect(smartRecruitersAdapter.uploadState!(input, RESUME_NAME)).toBe('pending');
    addFileRow(zone, ` ${RESUME_NAME} `);
    expect(smartRecruitersAdapter.uploadState!(input, RESUME_NAME)).toBe('confirmed');
    expect(smartRecruitersAdapter.uploadState!(input, '')).toBe('pending');
    expect(smartRecruitersAdapter.uploadHeldNames!(input)).toEqual(['another-file.pdf', RESUME_NAME]);
    // A box that is no drop zone's file input: no reading of the adapter's.
    const firstName = deepOne<HTMLInputElement>(doc, 'spl-input#first-name-input').shadowRoot!.querySelector('input')!;
    expect(smartRecruitersAdapter.uploadState!(firstName, RESUME_NAME)).toBeNull();
    expect(smartRecruitersAdapter.uploadHeld!(firstName)).toBe(false);
  });

  it("the screening step's Additional attachments holds none", async () => {
    const { doc } = await load('screening');
    const zone = deepOne(doc, 'spl-dropzone[data-spl-field]');
    expect(smartRecruitersAdapter.uploadHeld!(fileInputOf(zone))).toBe(false);
    expect(smartRecruitersAdapter.uploadState!(fileInputOf(zone), RESUME_NAME)).toBe('pending');
  });
});
