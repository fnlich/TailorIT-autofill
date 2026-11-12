/*
 * jr7 RBP-7 P1 (FIX7PLAN §6.12): BambooHR on snapshot7's captures (fixtures/bamboohr/jr7-bamboohr{1,2}-*: each
 * application at one address, /careers/<n>, its posting view, its form and its page after submitting drawn in place),
 * each page at its own address (its header's source):
 * - RBP7-10 (= AUTO7-07): the h2 "Thank You" beside its paragraph is the sign on both confirmations, and on no other
 *   BambooHR page; the synthetic h3 page still reads it;
 * - RBP7-11: the posting view's text and its "Apply for This Job", the agent's entry alone, offered only where no form
 *   shows;
 * - RBP7-12: with formInPlace only BambooHR's adapter claims the page: the posting's entry is pressed once through the
 *   content runtime, the generic adapter beside it (without it, the generic adapter takes the share box for a form and
 *   nothing is pressed);
 * - RBP7-13: the required résumé is a field (its toggle the control, the file list the sign), planned the résumé;
 * - RBP7-14: State's menu, tied to its toggle by data-menu-id, is its declared list: read on the capture where it is
 *   open (bamboohr1's filled capture), and chosen from on a page whose script is stood in for.
 * The dropdowns' shown text is REDACTED by the converter (RBP7-V2 b): the stand-in shows the page's placeholder, never
 * the converted text. bamboohr1's blank form was converted with --frame-src (RBP7-V2 a); no test here reads its
 * reCAPTCHA. Golden synthetic profile only; no value of the owner's.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import b1Confirm from '../../../fixtures/bamboohr/jr7-bamboohr1-confirmation.html?raw';
import b1Blank from '../../../fixtures/bamboohr/jr7-bamboohr1-form-blank.html?raw';
import b1Filled from '../../../fixtures/bamboohr/jr7-bamboohr1-form-filled.html?raw';
import b1Posting from '../../../fixtures/bamboohr/jr7-bamboohr1-posting.html?raw';
import b2Confirm from '../../../fixtures/bamboohr/jr7-bamboohr2-confirmation.html?raw';
import b2Blank from '../../../fixtures/bamboohr/jr7-bamboohr2-form-blank.html?raw';
import b2Filled from '../../../fixtures/bamboohr/jr7-bamboohr2-form-filled.html?raw';
import b2Posting from '../../../fixtures/bamboohr/jr7-bamboohr2-posting.html?raw';
import swyfftForm from '../../../fixtures/bamboohr/swyfft-form.html?raw';
import syntheticSuccess from '../../../fixtures/synthetic/success/bamboohr.html?raw';
import { openAt, runtimeAt, servedAdapter, sourceOf, wallsOf } from '../../content/apply.testkit';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import type { ContentRuntime } from '../../content/runtime';
import { newSuccessSign, shownSignsOf, signsOf } from '../../content/submitted';
import { planFrame } from '../../core/plan/frame';
import type { BaseKey } from '../../core/types/field';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { deadline } from '../../dom/time';
import { scan, toFieldSpec } from '../../dom/scan';
import type { FieldTarget, WidgetReading } from '../../dom/types';
import { fillWidget, isActionable, readWidget } from '../../dom/widgets';
import { configuredAdapter } from '../configured';
import { adaptersFor, applicationOf } from '../index';
import { successSignsOf } from '../success';
import { fillabilityOf, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { BAMBOOHR_CONFIG, bambooHrAdapter } from './index';

const POSTINGS = [['bamboohr1', b1Posting], ['bamboohr2', b2Posting]] as const;
const FORMS = [['bamboohr1 blank', b1Blank], ['bamboohr1 filled', b1Filled], ['bamboohr2 blank', b2Blank],
  ['bamboohr2 filled', b2Filled]] as const;
const CONFIRMATIONS = [['bamboohr1', b1Confirm], ['bamboohr2', b2Confirm]] as const;
const ENTRY = 'button[data-bi-id="careers-site-apply-button"]';
const STATE = 'div.fab-Select:has(> select[name="state.value"])';
const COUNTRY = 'div.fab-Select:has(> select[name="countryId.value"])';

/** The config with `quirks` undone. */
const NOT_IN_PLACE = (() => {
  const { quirks: _inPlace, ...rest } = BAMBOOHR_CONFIG;
  return configuredAdapter(rest);
})();
/** The config without the code's widget hook (the rules' dropdowns, no list). */
const NO_MENU = configuredAdapter({ ...BAMBOOHR_CONFIG, code: {} });

const runtimes: ContentRuntime[] = [];
beforeAll(() => {
  testVocab();
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

async function open(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  return { ...fixture, root: bambooHrAdapter.detect(fixture.doc)?.formRoot ?? null };
}

describe('jr7 RBP-7 RBP7-10 (= AUTO7-07): the page after submitting', () => {
  it.each(CONFIRMATIONS)('%s: the paragraph beside its h2 "Thank You" is one sign, shown, new after the press',
    async (_name, html) => {
      const page = await open(html);
      const signs = signsOf(page.doc, 'bamboohr');
      expect(signs).toHaveLength(1);
      expect(signs[0]!.parentElement?.querySelector('h2')?.textContent).toBe('Thank You');
      expect(shownSignsOf(page.doc, 'bamboohr').size).toBe(1);
      expect(page.root).toBeNull();
      const gone = page.doc.createElement('form');
      expect(newSuccessSign(page.doc, 'bamboohr', { before: new Set(), root: gone, adapter: bambooHrAdapter }))
        .toBe(signs[0]);
      // Jobright's companion (an h3) alone misses it.
      const h3Only = { ...BAMBOOHR_CONFIG.success!, companion: { css: 'h3', text: /^Thank You$/ } };
      expect(successSignsOf(page.doc, [h3Only])).toEqual([]);
    });

  it('still reads the synthetic page\'s h3 block, never its decoys', async () => {
    const page = await open(syntheticSuccess);
    expect(signsOf(page.doc, 'bamboohr').map((sign) => sign.parentElement?.id)).toEqual(['done']);
  });

  it.each([...POSTINGS, ...FORMS, ['swyfft form', swyfftForm]] as const)('%s: no sign before the press',
    async (_name, html) => {
      const page = await open(html);
      expect(signsOf(page.doc, 'bamboohr')).toEqual([]);
    });
});

describe('jr7 RBP-7 RBP7-11: the posting view\'s text and its Apply for This Job', () => {
  it.each(POSTINGS)('%s posting: its text, and its one Apply the agent\'s entry alone, never a run\'s', async (_name, html) => {
    const page = await open(html);
    expect(page.root).toBeNull();
    expect(bambooHrAdapter.postingText?.(page.doc)?.matches('div.BambooRichText')).toBe(true);
    const entry = bambooHrAdapter.entryControl?.(page.doc);
    expect(entry?.matches(ENTRY)).toBe(true);
    expect(entry?.textContent).toBe('Apply for This Job');
    expect(bambooHrAdapter.entryNeverPressed).toBe(true);
    expect(bambooHrAdapter.neverPress?.(page.doc.body)).toContain(entry);
    const { posting: _undone, ...rest } = BAMBOOHR_CONFIG;
    expect(configuredAdapter(rest).entryControl?.(page.doc)).toBeNull();
    expect(configuredAdapter(rest).postingText?.(page.doc)).toBeNull();
  });

  it.each([...FORMS, ...CONFIRMATIONS] as const)('%s: no entry where the form, or the page after it, shows',
    async (_name, html) => {
      const page = await open(html);
      expect(bambooHrAdapter.entryControl?.(page.doc)).toBeNull();
    });
});

describe('jr7 RBP-7 RBP7-12: only BambooHR\'s adapter claims its one address (formInPlace)', () => {
  it.each(POSTINGS)('%s posting: says hello with no form, offers the entry, and run/start presses Apply once, the '
    + 'generic adapter beside it', async (_name, html) => {
    const address = sourceOf(html)!;
    expect(applicationOf(new URL(address))?.page).toBe('application');
    const { doc, clicks } = await openAt(html, address);
    const pressed: string[] = [];
    doc.addEventListener('click', (event) => {
      pressed.push((event.target as Element).closest('button')?.getAttribute('data-bi-id') ?? '?');
    }, true);
    const adapters = (url: URL) => adaptersFor(url, doc).map((adapter) => servedAdapter(adapter, address));
    expect(adapters(new URL(address)).map((adapter) => adapter.id)).toEqual(['bamboohr', 'generic']);
    const { worker, runtime } = await runtimeAt(doc, address, adapters);
    runtimes.push(runtime);
    await vi.waitFor(() => expect(worker.of('frame/hello').length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(worker.of('frame/hello')[0]).toMatchObject({ hasForm: false });
    await vi.waitFor(() => expect(wallsOf(worker).at(-1)).toMatchObject({ entry: true }), { timeout: 10_000 });
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(pressed).toEqual(['careers-site-apply-button']), { timeout: 10_000 });
    expect(clicks).toHaveLength(1);
  }, 45_000);

  it('without formInPlace the generic adapter takes the posting\'s share box for a form, and run/start presses nothing',
    async () => {
      const address = sourceOf(b2Posting)!;
      const { doc, clicks } = await openAt(b2Posting, address);
      const adapters = (url: URL) => [NOT_IN_PLACE, ...adaptersFor(url, doc).filter((adapter) => adapter.id !== 'bamboohr')]
        .map((adapter) => servedAdapter(adapter, address));
      const { worker, runtime } = await runtimeAt(doc, address, adapters);
      runtimes.push(runtime);
      await vi.waitFor(() => expect(worker.of('frame/hello').length).toBeGreaterThan(0), { timeout: 10_000 });
      expect(worker.of('frame/hello')[0]).toMatchObject({ hasForm: true });
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await deadline(1_500);
      expect(clicks).toEqual([]);
    }, 45_000);

  it.each(CONFIRMATIONS)('%s confirmation: says hello with no form (no run on the page after submitting)',
    async (_name, html) => {
      const address = sourceOf(html)!;
      const { doc } = await openAt(html, address);
      const { worker, runtime } = await runtimeAt(doc, address,
        (url) => adaptersFor(url, doc).map((adapter) => servedAdapter(adapter, address)));
      runtimes.push(runtime);
      await vi.waitFor(() => expect(worker.of('frame/hello').length).toBeGreaterThan(0), { timeout: 10_000 });
      expect(worker.of('frame/hello')[0]).toMatchObject({ hasForm: false });
      expect(runtime.page).toBeNull();
    }, 45_000);
});

describe('jr7 RBP-7 RBP7-13: the required résumé', () => {
  it.each([['bamboohr1 blank', b1Blank], ['bamboohr1 filled', b1Filled], ['bamboohr2 blank', b2Blank]] as const)(
    '%s: "Resume", required, a hidden file input behind its Choose File toggle, planned the résumé',
    async (_name, html) => {
      const page = await open(html);
      const input = page.doc.querySelector<HTMLInputElement>('div[data-fabric-component="FileUpload"] input[type="file"]')!;
      const toggle = page.doc.querySelector('div[data-fabric-component="FileUploadToggle"] button')!;
      expect(bambooHrAdapter.uploadWidgets?.(page.root!)).toEqual([{ control: toggle, input }]);
      const result = scan(page.root!, bambooHrAdapter, { platform: 'bamboohr' });
      expect(result.unrecognisedUploads).toEqual([]);
      const files = result.fields.filter((field) => field.kind === 'file');
      expect(files.map((field) => [field.label, field.required, field.visibility])).toEqual([
        ['Resume', true, 'hidden-file-with-visible-control']]);
      const out = planFrame({ specs: result.fields.map(toFieldSpec), canaries: [], profile: goldenProfile(),
        sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW });
      expect(out.results.find((row) => row.key === files[0]!.key)).toMatchObject({ category: 'file.resume' });
      expect(out.writes.some((write) => write.key === files[0]!.key)).toBe(true);
      // Without the rules it is an upload the scan cannot recognise, and no field.
      const { uploads: _uploads, ...rest } = BAMBOOHR_CONFIG;
      const bare = scan(page.root!, configuredAdapter(rest), { platform: 'bamboohr' });
      expect(bare.unrecognisedUploads).toHaveLength(1);
      expect(bare.fields.filter((field) => field.kind === 'file')).toEqual([]);
    });

  it('bamboohr2 filled: the page holds the file (its list shown, no input): no field, and its remove is never pressed',
    async () => {
      const page = await open(b2Filled);
      expect(page.doc.querySelector('div[data-fabric-component="FileUpload"] input[type="file"]')).toBeNull();
      const result = scan(page.root!, bambooHrAdapter, { platform: 'bamboohr' });
      expect([result.fields.filter((field) => field.kind === 'file').length, result.unrecognisedUploads.length])
        .toEqual([0, 0]);
      const remove = page.doc.querySelector('[data-fabric-component="FileUploadList"] button[aria-label="remove file"]');
      expect(remove).not.toBeNull();
      expect(bambooHrAdapter.neverPress?.(page.root!)).toContain(remove);
    });

  it('reads the file list as the file taken once it names the written file (uploadState)', async () => {
    const page = await open(b2Blank);
    const input = page.doc.querySelector<HTMLInputElement>('div[data-fabric-component="FileUpload"] input[type="file"]')!;
    expect(bambooHrAdapter.uploadState?.(input, 'resume.pdf')).toBe('pending');
    const area = input.closest('div[data-fabric-component="FileUpload"]')!;
    const list = page.doc.createElement('div');
    list.setAttribute('data-fabric-component', 'FileUploadList');
    list.textContent = 'resume.pdf';
    area.prepend(list);
    expect(bambooHrAdapter.uploadState?.(input, 'resume.pdf')).toBe('confirmed');
  });
});

describe('jr7 RBP-7 RBP7-14: a Fabric dropdown\'s menu, tied by data-menu-id, is its declared list', () => {
  it('bamboohr1 filled (State\'s menu open): the list is the menu its toggle names, its rows read; Country stays lazy',
    async () => {
      const page = await open(b1Filled);
      const state = page.doc.querySelector(STATE)!;
      const toggle = state.querySelector<HTMLButtonElement>('button[data-menu-id]')!;
      const decl = bambooHrAdapter.widgetFor!(state)!;
      expect(decl).toMatchObject({ kind: 'combobox', opener: toggle, results: { option: '[role="menuitem"], .fab-MenuOption' } });
      const menu = (decl.results!.list as () => Element | null)();
      expect(menu?.id).toBe(toggle.getAttribute('data-menu-id'));
      expect(menu?.getAttribute('role')).toBe('menu');
      const result = scan(page.root!, bambooHrAdapter, { platform: 'bamboohr' });
      const fieldOf = (css: string) => {
        const el = page.doc.querySelector(css);
        return result.fields.find((field) => result.target(field.key)?.widget?.element === el)!;
      };
      const read = fieldOf(STATE);
      expect([read.label, read.kind, read.required]).toEqual(['State', 'combobox', true]);
      expect(Array.isArray(read.options) && read.options.length).toBeGreaterThanOrEqual(9);
      expect(isActionable(result.target(read.key)!.widget!)).toBe(true);
      expect(fieldOf(COUNTRY).options).toBe('lazy');
      // Without the code's hook: no list, lazy, and the helpers do not act on it.
      const bare = scan(page.root!, NO_MENU, { platform: 'bamboohr' });
      const unread = bare.fields.find((field) => bare.target(field.key)?.widget?.element === state)!;
      expect(unread.options).toBe('lazy');
      expect(fillabilityOf(unread, bare.target(unread.key)!.widget)).toEqual({ fillable: false, reason: 'widget-phase-4' });
    });

  it('bamboohr2 blank (menus closed, no aria-controls): the list is the element its toggle\'s data-menu-id names, once '
    + 'drawn', async () => {
    const page = await open(b2Blank);
    const state = page.doc.querySelector(STATE)!;
    const toggle = state.querySelector<HTMLButtonElement>('button[data-menu-id]')!;
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    const list = bambooHrAdapter.widgetFor!(state)!.results!.list as () => Element | null;
    expect(list()).toBeNull();
    const menu = page.doc.createElement('div');
    menu.id = toggle.getAttribute('data-menu-id')!;
    menu.setAttribute('role', 'menu');
    page.doc.body.append(menu);
    expect(list()).toBe(menu);
  });

  it('bamboohr2 blank: reads State\'s list and chooses the profile\'s region through it (BambooHR\'s script stood in for)',
    async () => {
      const page = await open(b2Blank);
      const doc = page.doc;
      const state = doc.querySelector(STATE)!;
      const toggle = state.querySelector<HTMLButtonElement>('button[data-menu-id]')!;
      const shown = toggle.querySelector('.fab-SelectToggle__placeholder')!;
      // RBP7-V2 b: the converter wrote REDACTED into the toggle; the page shows its placeholder.
      shown.textContent = '-Select-';
      toggle.setAttribute('aria-label', 'State');
      const presses: string[] = [];
      let menu: HTMLElement | null = null;
      const close = () => {
        menu?.remove();
        menu = null;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.removeAttribute('aria-controls');
      };
      doc.addEventListener('click', (event) => {
        const target = event.target as Element;
        const row = target.closest('[role="menuitem"]');
        if (row !== null && menu?.contains(row)) {
          presses.push(row.textContent ?? '');
          shown.textContent = row.textContent;
          close();
          return;
        }
        if (!toggle.contains(target)) return;
        presses.push('toggle');
        if (menu !== null) {
          close();
          return;
        }
        menu = doc.createElement('div');
        menu.id = toggle.getAttribute('data-menu-id')!;
        menu.setAttribute('role', 'menu');
        menu.className = 'fab-MenuList';
        ['Oregon', 'Tennessee', 'Texas', 'Utah'].forEach((name, index) => {
          const row = doc.createElement('div');
          row.className = 'fab-MenuOption';
          row.id = String(index + 1);
          row.setAttribute('role', 'menuitem');
          row.tabIndex = -1;
          row.textContent = name;
          menu!.append(row);
        });
        doc.body.append(menu);
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-controls', menu.id);
      }, true);
      const readings = new Map<BaseKey, WidgetReading>();
      const target = (): FieldTarget => {
        const result = scan(page.root!, bambooHrAdapter, { platform: 'bamboohr', widgetReadings: readings });
        const field = result.fields.find((each) => result.target(each.key)?.widget?.element === state)!;
        return result.target(field.key)!;
      };
      const ctx = { adapter: bambooHrAdapter, root: page.root!, readings };
      expect(await readWidget(target(), ctx)).toMatchObject({ status: 'read' });
      const reading = [...readings.values()][0];
      const labels = reading?.kind === 'options' ? reading.options.map((option) => option.label) : [];
      expect(labels).toEqual(['Oregon', 'Tennessee', 'Texas', 'Utah']);
      expect(menu).toBeNull();
      presses.length = 0;
      const outcome = await fillWidget(target(), { kind: 'option', index: labels.indexOf('Texas'), cleanLabel: 'Texas' },
        ctx);
      expect(outcome).toMatchObject({ wrote: true, verification: 'verified' });
      expect(presses).toEqual(['toggle', 'Texas']);
      expect(shown.textContent).toBe('Texas');
    });
});
