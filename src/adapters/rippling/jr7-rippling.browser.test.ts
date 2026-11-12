/*
 * jr7 RBP-7 P1 (FIX7PLAN §6.12): Rippling on snapshot7's captures (fixtures/rippling/jr7-rippling1-*: a board reached
 * under the /en-GB/ locale; jr7-rippling2-*: a board without one), each page at its own address (its header's source):
 * - RBP7-01 (= AUTO7-02's extension half): every rippling1 page is its application's page under one key, so its posting
 *   says hello and the agent's entry presses its "Apply now" (it said nothing at all before);
 * - RBP7-02 (= AUTO7-14): the five form captures read as the final step, Apply pressable only once the form is filled;
 * - RBP7-04 (= AUTO7-14): the confirmation's action card heading is the drawn sign, on both confirmations, and on no other
 *   Rippling page (the rule for every new success sign: absent before the press);
 * - RBP7-06 (live): every select controller's combobox is declared with its list, found as Jobright's W() finds it, and
 *   a custom question is read and answered through it on a page whose script is stood in for; the rules' SMS radios
 *   survive the code's widget hook;
 * - RBP7-05 (live): the Location is a remote search over places, its suggestion chosen through the declared list (the
 *   page's script stood in for), never a typed place alone.
 * The comboboxes' shown text is REDACTED by the converter (RBP7-V2 b): where a test needs a combobox's shown answer it
 * builds a variant whose trigger shows the page's placeholder ("Select"), never reading the converted one. Golden
 * synthetic profile only; no value of the owner's.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import r1Blank from '../../../fixtures/rippling/jr7-rippling1-apply-blank.html?raw';
import r1Filled from '../../../fixtures/rippling/jr7-rippling1-apply-filled.html?raw';
import r1Resume from '../../../fixtures/rippling/jr7-rippling1-apply-resume.html?raw';
import r1Confirm from '../../../fixtures/rippling/jr7-rippling1-confirmation.html?raw';
import r1Posting from '../../../fixtures/rippling/jr7-rippling1-posting.html?raw';
import r2Blank from '../../../fixtures/rippling/jr7-rippling2-apply-blank.html?raw';
import r2Filled from '../../../fixtures/rippling/jr7-rippling2-apply-filled.html?raw';
import r2Confirm from '../../../fixtures/rippling/jr7-rippling2-confirmation.html?raw';
import r2Posting from '../../../fixtures/rippling/jr7-rippling2-posting.html?raw';
import quForm from '../../../fixtures/rippling/qu-careers-form.html?raw';
import quPosting from '../../../fixtures/rippling/qu-careers-posting.html?raw';
import smartForm from '../../../fixtures/rippling/smartsuite-uploaded.html?raw';
import { openAt, runtimeAt, servedAdapter, sourceOf, wallsOf } from '../../content/apply.testkit';
import { testVocab } from '../../content/content.testkit';
import { stepButtonsOf } from '../../content/press';
import type { ContentRuntime } from '../../content/runtime';
import { newSuccessSign, shownSignsOf, signsOf } from '../../content/submitted';
import type { BaseKey } from '../../core/types/field';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import type { FieldTarget, WidgetReading } from '../../dom/types';
import { fillWidget, isActionable, readWidget, searchTypeahead, type TypeaheadHooks } from '../../dom/widgets';
import { configuredAdapter } from '../configured';
import { adaptersFor, applicationOf } from '../index';
import { successSignsOf } from '../success';
import { fillabilityOf, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { RIPPLING_CONFIG, ripplingAdapter } from './index';

const FORMS = [['rippling1 blank', r1Blank, false], ['rippling1 part-filled', r1Resume, false],
  ['rippling1 filled', r1Filled, true], ['rippling2 blank', r2Blank, false], ['rippling2 filled', r2Filled, true]] as const;
const CONFIRMATIONS = [['rippling1', r1Confirm], ['rippling2', r2Confirm]] as const;
/** Every other Rippling page the extension holds (snapshot7's and the earlier snapshots'). */
const OTHERS: ReadonlyArray<readonly [string, string]> = [['rippling1 posting', r1Posting],
  ['rippling2 posting', r2Posting], ...FORMS.map(([name, html]) => [name, html] as const),
  ['qu-careers posting', quPosting], ['qu-careers form', quForm], ['smartsuite form', smartForm]];

/** The adapter without the code's widget hook (the rules' alone: the SMS radios). */
const RULES_ONLY = (() => {
  const { widgetFor: _declared, ...code } = RIPPLING_CONFIG.code!;
  return configuredAdapter({ ...RIPPLING_CONFIG, code });
})();

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
  return { ...fixture, root: ripplingAdapter.detect(fixture.doc)?.formRoot ?? null };
}

/** A list as Rippling's popper draws it once open (a stand-in): div[data-testid=popper] > ul[role=listbox] >
 *  li[role=option] per label, built node by node. */
function popperList(doc: Document, labels: readonly string[]): HTMLElement {
  const holder = doc.createElement('div');
  holder.setAttribute('data-testid', 'popper');
  const list = doc.createElement('ul');
  list.setAttribute('role', 'listbox');
  for (const label of labels) {
    const option = doc.createElement('li');
    option.setAttribute('role', 'option');
    option.textContent = label;
    list.append(option);
  }
  holder.append(list);
  return holder;
}

/** The select controllers' comboboxes of a page, in document order. */
const selectComboboxes = (doc: Document) =>
  Array.from(doc.querySelectorAll<HTMLElement>('[data-testid="select-controller"] [role="combobox"]'));

describe('jr7 RBP-7 RBP7-01: a board under a locale (rippling1, /en-GB/)', () => {
  it('reads every rippling1 page as its application\'s page under one key: posting, form, form, form, confirmation', () => {
    const pages = [r1Posting, r1Blank, r1Resume, r1Filled, r1Confirm].map((html) => applicationOf(new URL(sourceOf(html)!)));
    expect(pages.map((page) => page?.page ?? null)).toEqual(['posting', 'application', 'application', 'application',
      'confirmation']);
    expect(new Set(pages.map((page) => page!.applicationKey)).size).toBe(1);
    // Its canonical form names no locale.
    expect(new URL(pages[1]!.applicationUrl).pathname.startsWith('/en-GB/')).toBe(false);
    expect(new URL(sourceOf(r1Posting)!).pathname.startsWith('/en-GB/')).toBe(true);
  });

  it('says hello on the posting, offers its Apply now to the agent\'s entry, and run/start presses it alone', async () => {
    const address = sourceOf(r1Posting)!;
    const { doc, clicks } = await openAt(r1Posting, address);
    const pressed: string[] = [];
    doc.addEventListener('click', (event) => {
      pressed.push((event.target as Element).closest('[data-testid]')?.getAttribute('data-testid') ?? '?');
    }, true);
    const { worker, runtime } = await runtimeAt(doc, address,
      (url) => adaptersFor(url, doc).map((adapter) => servedAdapter(adapter, address)));
    runtimes.push(runtime);
    await vi.waitFor(() => expect(worker.of('frame/hello').length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(worker.of('frame/hello')[0]).toMatchObject({ hasForm: false });
    await vi.waitFor(() => expect(wallsOf(worker).at(-1)).toMatchObject({ entry: true }), { timeout: 10_000 });
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(pressed).toEqual(['Apply now']), { timeout: 10_000 });
    expect(clicks).toHaveLength(1);
  }, 45_000);
});

describe('jr7 RBP-7 RBP7-02 (= AUTO7-14): the one-page form is the final step', () => {
  it.each(FORMS)('%s: final, Apply found, pressable only once the form is filled', async (_name, html, filled) => {
    const page = await open(html);
    expect(page.root?.matches('main#main-content form')).toBe(true);
    expect(ripplingAdapter.isFinalStep?.(page.doc)).toBe('final');
    const buttons = stepButtonsOf({ doc: page.doc, adapter: ripplingAdapter, root: page.root! });
    expect(buttons).toMatchObject({ final: 'final', next: false, submit: filled });
  });

  it.each([['rippling1 posting', r1Posting], ['rippling2 posting', r2Posting], ...CONFIRMATIONS])(
    '%s: no form, so no step: unknown', async (_name, html) => {
      const page = await open(html);
      expect(page.root).toBeNull();
      expect(ripplingAdapter.isFinalStep?.(page.doc)).toBe('unknown');
    });
});

describe('jr7 RBP-7 RBP7-04 (= AUTO7-14): the action card is the drawn sign after Apply', () => {
  it.each(CONFIRMATIONS)('%s confirmation: one sign, shown, and new for an Apply armed on the form', async (_name, html) => {
    const page = await open(html);
    const signs = signsOf(page.doc, 'rippling');
    expect(signs).toHaveLength(1);
    expect(signs[0]!.matches('main#main-content [data-testid="action-card"] h5')).toBe(true);
    expect(shownSignsOf(page.doc, 'rippling').size).toBe(1);
    // As content/submitted.ts reads it after the press: the form's root gone, no sign at the press.
    const gone = page.doc.createElement('form');
    expect(newSuccessSign(page.doc, 'rippling', { before: new Set(), root: gone, adapter: ripplingAdapter })).toBe(signs[0]);
    // And the confirmation's address is the form's application (url.ts), the first sign.
    expect(applicationOf(new URL(sourceOf(html)!))?.page).toBe('confirmation');
  });

  it('reads "applied for" (rippling1, en-GB) as "applied to" (rippling2): Jobright\'s "to" alone misses rippling1', async () => {
    const jobrightWords = { ...RIPPLING_CONFIG.success!, text: /^You have successfully applied to\s+\S/ };
    const one = await open(r1Confirm);
    expect(successSignsOf(one.doc, [jobrightWords])).toHaveLength(0);
    expect(successSignsOf(one.doc, [RIPPLING_CONFIG.success!])).toHaveLength(1);
    removeFixtures(document);
    const two = await open(r2Confirm);
    expect(successSignsOf(two.doc, [jobrightWords])).toHaveLength(1);
  });

  it.each(OTHERS)('%s: no sign before Apply', async (_name, html) => {
    const page = await open(html);
    expect(signsOf(page.doc, 'rippling')).toEqual([]);
  });
});

describe('jr7 RBP-7 RBP7-06 (live): the select controller\'s comboboxes, declared with their list', () => {
  it.each([['rippling1', r1Blank, 9], ['rippling2', r2Blank, 7]] as const)(
    '%s blank: each of its %i comboboxes a declared combobox the helpers act on, fillable; the SMS radios the rules\'',
    async (_name, html, count) => {
      const page = await open(html);
      const comboboxes = selectComboboxes(page.doc);
      expect(comboboxes).toHaveLength(count);
      const result = scan(page.root!, ripplingAdapter, { platform: 'rippling' });
      for (const combobox of comboboxes) {
        const field = result.fields.find((each) => result.target(each.key)?.widget?.element === combobox);
        expect(field?.kind, combobox.id).toBe('combobox');
        const widget = result.target(field!.key)!.widget!;
        expect([widget.declared, isActionable(widget)], combobox.id).toEqual([true, true]);
        expect(fillabilityOf(field!, widget), combobox.id).toEqual({ fillable: true });
      }
      // The required custom questions (their own aria-label "Select") are among them, titled by their block's p.
      const custom = result.fields.filter((each) => each.kind === 'combobox' && each.required
        && !each.label.startsWith('Phone number'));
      expect(custom.length).toBe(count === 9 ? 4 : 2);
      // The rules' SMS radios survive the code's hook.
      const sms = page.doc.querySelector('div[role="radiogroup"][data-testid="sms_opt_in"]');
      expect(sms === null ? null : ripplingAdapter.widgetFor?.(sms)?.kind).toBe(sms === null ? null : 'radio');
      // Without the code's hook the custom questions are no combobox the helpers may act on (widget-phase-4).
      const bare = scan(page.root!, RULES_ONLY, { platform: 'rippling' });
      const unread = bare.fields.filter((each) => each.kind === 'combobox' && each.required
        && !each.label.startsWith('Phone number'));
      expect(unread.length).toBe(custom.length);
      for (const field of unread) {
        expect(fillabilityOf(field, bare.target(field.key)?.widget)).toEqual({ fillable: false, reason: 'widget-phase-4' });
      }
    });

  it('finds the list as Jobright\'s W() does: aria-controls, else its id and "-list", else the one shown popper list',
    async () => {
      const page = await open(r2Blank);
      const combobox = selectComboboxes(page.doc).find((each) => each.getAttribute('aria-label') === 'Select')!;
      const decl = ripplingAdapter.widgetFor!(combobox)!;
      expect(decl).toMatchObject({ kind: 'combobox', opener: combobox, expanded: combobox,
        results: { option: 'li[role="option"]' } });
      const list = decl.results!.list as () => Element | null;
      expect(list()).toBeNull();
      const popper = (doc: Document) => {
        const holder = popperList(doc, ['Yes', 'No']);
        doc.body.append(holder);
        return holder.querySelector('ul')!;
      };
      const first = popper(page.doc);
      expect(list()).toBe(first);
      // Two shown: none is taken for this one.
      const second = popper(page.doc);
      expect(list()).toBeNull();
      second.parentElement!.style.display = 'none';
      expect(list()).toBe(first);
      // Its id and "-list" first, then aria-controls before both.
      const byId = page.doc.createElement('ul');
      byId.id = `${combobox.id}-list`;
      page.doc.body.append(byId);
      expect(list()).toBe(byId);
      const named = page.doc.createElement('ul');
      named.id = 'named-list';
      page.doc.body.append(named);
      combobox.setAttribute('aria-controls', 'named-list');
      expect(list()).toBe(named);
    });

  it('reads a custom question\'s list and chooses its answer through it (Rippling\'s script stood in for)', async () => {
    const page = await open(r2Blank);
    const doc = page.doc;
    const combobox = selectComboboxes(doc).find((each) => each.getAttribute('aria-label') === 'Select')!;
    // RBP7-V2 b: the converter wrote REDACTED into the trigger; the page shows its placeholder.
    const shown = combobox.querySelector('p')!;
    shown.textContent = 'Select';
    const presses: string[] = [];
    let holder: HTMLElement | null = null;
    const close = () => {
      holder?.remove();
      holder = null;
      combobox.setAttribute('aria-expanded', 'false');
    };
    doc.addEventListener('click', (event) => {
      const target = event.target as Element;
      const option = target.closest('li[role="option"]');
      if (option !== null && holder?.contains(option)) {
        presses.push(option.textContent ?? '');
        shown.textContent = option.textContent;
        close();
        return;
      }
      if (!combobox.contains(target)) return;
      presses.push('combobox');
      if (holder !== null) {
        close();
        return;
      }
      holder = popperList(doc, ['Yes', 'No']);
      doc.body.append(holder);
      combobox.setAttribute('aria-expanded', 'true');
    }, true);
    const readings = new Map<BaseKey, WidgetReading>();
    const target = (): FieldTarget => {
      const result = scan(page.root!, ripplingAdapter, { platform: 'rippling', widgetReadings: readings });
      const field = result.fields.find((each) => result.target(each.key)?.widget?.element === combobox)!;
      return result.target(field.key)!;
    };
    const ctx = { adapter: ripplingAdapter, root: page.root!, readings };
    expect(await readWidget(target(), ctx)).toMatchObject({ status: 'read' });
    const reading = [...readings.values()][0];
    expect(reading?.kind === 'options' ? reading.options.map((option) => option.label) : null).toEqual(['Yes', 'No']);
    expect(holder).toBeNull();
    presses.length = 0;
    const outcome = await fillWidget(target(), { kind: 'option', index: 0, cleanLabel: 'Yes' }, ctx);
    expect(outcome).toMatchObject({ wrote: true, verification: 'verified' });
    expect(presses).toEqual(['combobox', 'Yes']);
    expect(shown.textContent).toBe('Yes');
  });
});

describe('jr7 RBP-7 RBP7-05 (live): the Location, a remote search over places', () => {
  it.each([['rippling1', r1Blank], ['rippling2', r2Blank]] as const)(
    '%s blank: declared a remote search, required and fillable; its list aria-controls, else the one shown popper list',
    async (_name, html) => {
      const page = await open(html);
      const box = page.doc.querySelector<HTMLInputElement>('[data-testid="location"] input')!;
      const decl = ripplingAdapter.widgetFor!(box)!;
      expect(decl).toMatchObject({ kind: 'typeahead-remote', opener: box, results: { option: 'li[role="option"]' } });
      const result = scan(page.root!, ripplingAdapter, { platform: 'rippling' });
      const field = result.fields.find((each) => each.label === 'Location')!;
      expect([field.kind, field.required]).toEqual(['typeahead-remote', true]);
      expect(fillabilityOf(field, result.target(field.key)!.widget)).toEqual({ fillable: true });
      const list = decl.results!.list as () => Element | null;
      expect(list()).toBeNull();
      const holder = popperList(page.doc, ['Austin, TX, USA']);
      page.doc.body.append(holder);
      expect(list()).toBe(holder.firstElementChild);
      const named = page.doc.createElement('ul');
      named.id = 'location-list';
      page.doc.body.append(named);
      box.setAttribute('aria-controls', 'location-list');
      expect(list()).toBe(named);
      // Without the code's hook it is a text box typed into, as before.
      const bare = scan(page.root!, RULES_ONLY, { platform: 'rippling' });
      expect(bare.fields.find((each) => each.label === 'Location')?.kind).toBe('text');
    });

  it('chooses the suggestion matching the profile\'s place and reads it back (Rippling\'s script stood in for)', async () => {
    const page = await open(r2Blank);
    const doc = page.doc;
    const box = doc.querySelector<HTMLInputElement>('[data-testid="location"] input')!;
    const queries: string[] = [];
    let holder: HTMLElement | null = null;
    // The page's suggestions for what is typed (as Rippling's Places search draws them in its popper).
    box.addEventListener('input', () => {
      queries.push(box.value);
      holder?.remove();
      holder = popperList(doc, ['Austin, MN, USA', 'Austin, TX, USA']);
      doc.body.append(holder);
    });
    doc.addEventListener('click', (event) => {
      const option = (event.target as Element).closest('li[role="option"]');
      if (option === null || holder === null || !holder.contains(option)) return;
      box.value = option.textContent ?? '';
      holder.remove();
      holder = null;
    }, true);
    const target = (): FieldTarget => {
      const result = scan(page.root!, ripplingAdapter, { platform: 'rippling' });
      const field = result.fields.find((each) => each.label === 'Location')!;
      return result.target(field.key)!;
    };
    const hooks: TypeaheadHooks = {
      guard: async () => ({ ok: true, target: target() }),
      match: async (results) => {
        const index = results.findIndex((each) => each.label === 'Austin, TX, USA');
        return index < 0 ? { choose: null, reason: 'no-match', blocked: false }
          : { choose: { index, cleanLabel: 'Austin, TX, USA' } };
      },
    };
    const result = await searchTypeahead(target(), ['Austin, TX'], { adapter: ripplingAdapter, root: page.root! }, hooks);
    expect(result).toMatchObject({ verified: true, reason: 'ok', typed: 1, chosen: { index: 1, cleanLabel: 'Austin, TX, USA' } });
    expect(queries).toEqual(['Austin, TX']);
    expect(box.value).toBe('Austin, TX, USA');
  });
});

describe('jr7 RBP-7 RBP7-07 (the adapter half; FIX7PLAN §3.3): a custom question\'s help is its description', () => {
  it('rippling1 blank: the attestation reads its help, which asks for the full name typed; no other question gains one',
    async () => {
      const page = await open(r1Blank);
      const result = scan(page.root!, ripplingAdapter, { platform: 'rippling' });
      const attestation = result.fields.find((field) => field.label === 'Truth Certification/Attestation Clause')!;
      expect([attestation.kind, attestation.required]).toEqual(['text', true]);
      expect(attestation.description.length).toBeGreaterThan(400);
      expect(attestation.description).toMatch(/\btyping your full name\b/);
      // The help is read from the block's second div.marginBottom--4 alone: every other custom question shows none.
      const others = result.fields.filter((field) => field !== attestation && field.description !== ''
        && page.doc.getElementById(field.idAttr ?? '')?.closest('div.marginY--36') !== null);
      expect(others.map((field) => field.label)).toEqual([]);
      // Without the rule's help, the attestation has no description (RULES-7 could read no signature request).
      const noHelp = configuredAdapter({ ...RIPPLING_CONFIG, questions: RIPPLING_CONFIG.questions!.map((rule) => {
        const { help: _help, ...rest } = rule;
        return rest;
      }) });
      const bare = scan(page.root!, noHelp, { platform: 'rippling' });
      expect(bare.fields.find((field) => field.label === attestation.label)?.description).toBe('');
    });
});
