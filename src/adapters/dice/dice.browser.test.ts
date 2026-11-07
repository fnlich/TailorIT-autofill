/*
 * The Dice adapter (DESIGN-NEW-ATS §5, builder B) on the owner's snapshots of 2026-11-06 (fixtures/dice; the design's
 * ids dice-0, -1, -2, -7, -8): each case's hooks and scan held against its hand-written expectations, the wizard read
 * from its meter (the step, its count, Next, the review's Submit, Back never), the React Aria select and the city
 * search, the step-1 cards (the résumé already in, the cover letter's drop zone), the open File options menu, and every
 * rule shown to matter by the same page read with that rule undone.
 */
import { afterEach, describe, expect, it } from 'vitest';
import reviewAExpect from '../../../fixtures/dice/a-review.expect.json';
import reviewAHtml from '../../../fixtures/dice/a-review.html?raw';
import step2Expect from '../../../fixtures/dice/a-step2.expect.json';
import step2Html from '../../../fixtures/dice/a-step2.html?raw';
import step1Expect from '../../../fixtures/dice/b-step1.expect.json';
import step1Html from '../../../fixtures/dice/b-step1.html?raw';
import reviewDExpect from '../../../fixtures/dice/d-review.expect.json';
import reviewDHtml from '../../../fixtures/dice/d-review.html?raw';
import menuExpect from '../../../fixtures/dice/d-step1-menu.expect.json';
import menuHtml from '../../../fixtures/dice/d-step1-menu.html?raw';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan } from '../../dom/scan';
import { signInFormOf } from '../../dom/sign-in-form';
import type { ScannedField } from '../../dom/types';
import { platformOfUrl } from '../../shared/hosts';
import { configuredAdapter, type AtsConfig } from '../configured';
import { ATS_CONFIGS } from '../configured/registry';
import { adaptersFor } from '../index';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import type { Adapter } from '../types';
import { DICE_CONFIG, DICE_FIXTURES, diceAdapter } from './index';

const A = 'https://www.dice.com/job-applications/3a06d5dd-fb34-4b05-b96c-47bf093651e0/wizard';
const B = 'https://www.dice.com/job-applications/49ef3ddd-e13a-4c2a-a8be-5845aa1c3932/wizard';
const D = 'https://www.dice.com/job-applications/edf24268-9e60-4fad-a3cf-2c6439c82ff1/wizard';

const CASES = [
  { name: 'a-step2', html: step2Html, json: step2Expect, address: A },
  { name: 'a-review', html: reviewAHtml, json: reviewAExpect, address: A },
  { name: 'b-step1', html: step1Html, json: step1Expect, address: B },
  { name: 'd-step1-menu', html: menuHtml, json: menuExpect, address: D },
  { name: 'd-review', html: reviewDHtml, json: reviewDExpect, address: D },
] as const;

const WIZARD = 'div:has(> div[role="meter"][aria-label="Application progress"])';
const SELECT_GROUP = 'div.group[data-rac]:has(> div[data-testid="hidden-select-container"])';

afterEach(() => removeFixtures(document));

const open = (html: string) => loadFixture(document, html, SNAPSHOT_VIEWPORT);
const q = <T extends Element = HTMLElement>(fixture: Fixture, selector: string) => fixture.doc.querySelector<T>(selector)!;
/** The adapter the config builds with some of its rules or code changed. */
const without = (change: Partial<AtsConfig>): Adapter => configuredAdapter({ ...DICE_CONFIG, ...change });
/** The config's code without the named hooks. */
const codeWithout = (...names: string[]) => Object.fromEntries(Object.entries(DICE_CONFIG.code!)
  .filter(([name]) => !names.includes(name)));
const fieldsOf = (fixture: Fixture, adapter: Adapter = diceAdapter): readonly ScannedField[] =>
  scan(adapter.detect(fixture.doc)!.formRoot, adapter, { platform: 'dice' }).fields;
/** A button of the wizard by its words. */
const named = (fixture: Fixture, word: string) => Array.from(fixture.doc.querySelectorAll<HTMLElement>(`${WIZARD} button`))
  .find((button) => button.textContent?.trim() === word)!;

describe('the Dice adapter: its hooks and scans on the snapshots', () => {
  it("names each snapshot it was written from, and is the registry's adapter on the wizard's path alone", () => {
    expect([...DICE_FIXTURES].sort()).toEqual(CASES.map((each) => `fixtures/dice/${each.name}.html`).sort());
    expect(adaptersFor(new URL(A))[0]).toBe(diceAdapter);
    expect(ATS_CONFIGS.dice).toBe(DICE_CONFIG);
    // The posting and Dice's sign-in are off the matched path: the content script never runs there.
    for (const address of ['https://www.dice.com/job-detail/3a06d5dd-fb34-4b05-b96c-47bf093651e0',
      'https://www.dice.com/dashboard/login?redirectUrl=%2Fjob-applications%2F3a06d5dd-fb34-4b05-b96c-47bf093651e0%2Fwizard']) {
      expect(platformOfUrl(address), address).toBeNull();
    }
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ html, json }) => {
    const fixture = await open(html);
    expect(compareHooks(fixture.doc, diceAdapter, readHooks(json))).toEqual([]);
  });

  it.each(CASES.filter((each) => readHooks(each.json).detect !== null))('$name: the scan of its root is the expectation',
    async ({ html, json, address }) => {
      const read = await scanCase(document, html, address);
      expect(read.adapter).toBe(diceAdapter);
      expect(compareWithExpectation(read.doc, read.result, readExpectation(json))).toEqual([]);
    });
});

describe('the wizard (a-step2, a-review, b-step1, d-review)', () => {
  it("reads each step from its meter and h2, presses Next on a form's step and Submit's step is the last", async () => {
    const expected = [
      { html: step1Html, anchors: ['1', '3'], heading: 'Resume & Cover Letter', final: 'not-final' },
      { html: step2Html, anchors: ['2', '3'], heading: 'Additional Information', final: 'not-final' },
      { html: reviewAHtml, anchors: ['3', '3'], heading: 'Review your application', final: 'final' },
      { html: reviewDHtml, anchors: ['3', '3'], heading: 'Review your application', final: 'final' },
    ] as const;
    for (const { html, anchors, heading, final } of expected) {
      const fixture = await open(html);
      const root = diceAdapter.detect(fixture.doc)!.formRoot;
      expect(root).toBe(q(fixture, WIZARD));
      expect(diceAdapter.stepSignature?.(fixture.doc)).toEqual({ anchors: [...anchors], heading });
      expect(diceAdapter.isFinalStep?.(fixture.doc)).toBe(final);
      expect(diceAdapter.nextButton?.(root) ?? null).toBe(final === 'final' ? null : named(fixture, 'Next'));
      expect(diceAdapter.submitButton?.(root) ?? null).toBe(final === 'final' ? named(fixture, 'Submit') : null);
      removeFixtures(document);
    }
  });

  it('is final only where the meter stands at its maximum, and never with its rules undone', async () => {
    const fixture = await open(reviewDHtml);
    const root = diceAdapter.detect(fixture.doc)!.formRoot;
    // Undone (the form as the root, as the generic reading takes it): the review, with no form, has no root.
    expect(without({ root: { css: `${WIZARD} > form`, from: 'a-step2' } }).detect(fixture.doc)).toBeNull();
    // Undone (no Submit by its words, no finality code): the review's Submit is unknown, so it is never pressed.
    const bare = without({ code: codeWithout('submitButton', 'isFinalStep') });
    expect([bare.submitButton?.(root) ?? null, bare.isFinalStep?.(fixture.doc)]).toEqual([null, 'unknown']);
    // A Submit on a step the meter puts before the last is not trusted.
    q(fixture, `${WIZARD} > div[role="meter"]`).setAttribute('aria-valuenow', '2');
    expect(diceAdapter.isFinalStep?.(fixture.doc)).toBe('unknown');
  });

  it("never presses Back, a review's step links, the job's link or the account menu", async () => {
    for (const html of [step2Html, reviewAHtml]) {
      const fixture = await open(html);
      const never = diceAdapter.neverPress!(fixture.doc.documentElement);
      expect(never).toContain(named(fixture, 'Back'));
      expect(never).not.toContain(named(fixture, html === step2Html ? 'Next' : 'Submit'));
      // Undone (the rules alone): Back, a type=button with no other mark, is not named.
      expect(without({ code: codeWithout('neverPress') }).neverPress!(fixture.doc.documentElement))
        .not.toContain(named(fixture, 'Back'));
      removeFixtures(document);
    }
  });
});

describe('the fields (a-step2, b-step1)', () => {
  it('reads the React Aria select as one widget labelled by its question, its answer from its trigger', async () => {
    // Read, never filled: the helpers act only where standard ARIA names the list, which the trigger does only while
    // open (unseen; the expectation's note).
    const fixture = await open(step2Html);
    const group = q(fixture, SELECT_GROUP);
    const decl = diceAdapter.widgetFor!(group)!;
    expect(decl).toMatchObject({ kind: 'combobox', opener: q(fixture, `${SELECT_GROUP} > button[aria-haspopup="listbox"]`),
      parts: [q(fixture, 'select[name="workAuthorization"]')], snapshot: 'a-step2' });
    const select = () => fieldsOf(fixture).find((field) => field.label === 'Work Authorization');
    expect(select()?.current).toEqual({ kind: 'empty' });
    // The trigger's value span (its aria-labelledby's first id) showing one of the mirror select's options.
    const valueId = q(fixture, `${SELECT_GROUP} > button`).getAttribute('aria-labelledby')!.split(' ')[0]!;
    fixture.doc.getElementById(valueId)!.textContent = 'Green Card Holder';
    expect(select()?.current).toEqual({ kind: 'selected', labels: ['Green Card Holder'] });
    // Undone: with no shownAnswer the group's whole text reads as the answer; with no widget rule the select is no
    // field at all (its mirror is aria-hidden, its trigger no ARIA widget); with no question rule it has no label.
    const noAnswer = without({ code: codeWithout('widgetFor') });
    expect(fieldsOf(fixture, noAnswer).find((field) => field.kind === 'combobox')?.current)
      .toEqual({ kind: 'selected', labels: ['Work Authorization * Green Card Holder'] });
    expect(fieldsOf(fixture, without({ widgets: DICE_CONFIG.widgets!.slice(1), code: codeWithout('widgetFor') }))
      .map((field) => field.kind)).toEqual(['typeahead-remote']);
    expect(fieldsOf(fixture, without({ questions: undefined, code: codeWithout('labelFor') }))
      .find((field) => field.kind === 'combobox')?.labelSource).toBe('none');
  });

  it('declares the city a search as it is typed, and sections each field by the step', async () => {
    const fixture = await open(step2Html);
    const city = () => (adapter: Adapter) => fieldsOf(fixture, adapter).find((field) => field.nameAttr === 'candidateLocation');
    expect(city()(diceAdapter)).toMatchObject({ kind: 'typeahead-remote', section: { id: 'additional-information' } });
    // Undone: a lazy combobox; and under the "Learn more" disclosure's h3, the nearest heading before it.
    expect(city()(without({ widgets: DICE_CONFIG.widgets!.slice(0, 1), code: codeWithout('widgetFor') }))?.kind)
      .toBe('combobox');
    expect(city()(without({ sections: undefined }))?.section.id).toBe('learn-more');
  });

  it('reads the cover letter by its card, and has no résumé field while a résumé is in', async () => {
    const fixture = await open(step1Html);
    const root = diceAdapter.detect(fixture.doc)!.formRoot;
    const input = q<HTMLInputElement>(fixture, 'form > input[type="file"]');
    expect(diceAdapter.uploadWidgets?.(root)).toEqual([{ input,
      control: q(fixture, 'div.rounded-lg.border > button[type="button"]') }]);
    const result = scan(root, diceAdapter, { platform: 'dice' });
    expect(result.fields.map((field) => [field.kind, field.label, field.required])).toEqual([['file', 'Cover letter', false]]);
    expect(result.unrecognisedUploads).toEqual([]);
    expect(diceAdapter.neverPress!(fixture.doc.documentElement)).toContain(q(fixture, 'button[aria-label="File options"]'));
    // Undone: with no label code the input is unlabelled; with no upload rule it is only a hidden control ignored.
    expect(fieldsOf(fixture, without({ code: codeWithout('labelFor') }))[0]?.labelSource).toBe('none');
    const noUpload = scan(root, without({ uploads: undefined }), { platform: 'dice' });
    expect([noUpload.fields.length, noUpload.counters.hiddenControlsIgnored]).toEqual([0, 1]);
  });
});

describe('what Dice leaves to the person (b-step1, d-step1-menu)', () => {
  it('reads nothing and presses nothing while the File options menu holds the page inert', async () => {
    const fixture = await open(menuHtml);
    expect(diceAdapter.detect(fixture.doc)).toBeNull();
    expect(diceAdapter.isFinalStep?.(fixture.doc)).toBe('unknown');
    const never = diceAdapter.neverPress!(fixture.doc.documentElement);
    for (const key of ['replace', 'delete']) expect(never).toContain(q(fixture, `[role="menuitem"][data-key="${key}"]`));
    expect(detectPause(fixture.doc, null, diceAdapter)).toBeNull();
  });

  it('reads the wizard under the late signed-out header, and declares no sign-in on any page', async () => {
    for (const { html } of CASES) {
      const fixture = await open(html);
      for (const wall of ['sign-in', 'create-account', 'email-gate'] as const) {
        expect(signInFormOf(diceAdapter, fixture.doc, wall)).toBeNull();
      }
      expect(diceAdapter.authState?.(fixture.doc)).toBeNull();
      removeFixtures(document);
    }
    const signedOut = await open(step1Html);
    expect(signedOut.doc.querySelector('a[href="https://www.dice.com/dashboard/login"]')).not.toBeNull();
    expect(diceAdapter.detect(signedOut.doc)?.formRoot).toBe(q(signedOut, WIZARD));
  });
});
