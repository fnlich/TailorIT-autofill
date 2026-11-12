/*
 * Pinpoint's configured adapter on the owner's snapshots (fixtures/pinpoint: prophetx-form from pinpoint-0, the empty
 * application; prophetx-posting from pinpoint-1; prophetx-thanks from pinpoint-2, the page after submitting): the scan
 * held against the hand-written expectations, and each rule of ./config.ts held to what the page shows and read again
 * with the rule undone: the root (and the panel's fade-in), the Yes/No groups, required by class, the react-select, the
 * résumé's upload and title, Submit, the never-pressed controls, the posting and its entry, and the confirmation.
 * Each panel fades in from opacity 0 (animate.css fadeIn): a page is read here once its animations are finished, as a
 * person sees it a second after it loads (the converter measured it so too).
 */
import { afterEach, describe, expect, it } from 'vitest';
import formExpect from '../../../fixtures/pinpoint/prophetx-form.expect.json';
import formHtml from '../../../fixtures/pinpoint/prophetx-form.html?raw';
import postingHtml from '../../../fixtures/pinpoint/prophetx-posting.html?raw';
import thanksHtml from '../../../fixtures/pinpoint/prophetx-thanks.html?raw';
import { signsOf } from '../../content/submitted';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { platformOfUrl } from '../../shared/hosts';
import { configuredAdapter, configuredSuccessSigns } from '../configured';
import type { AtsConfig } from '../configured/types';
import { adaptersFor } from '../index';
import { fillabilityOf } from '../test/expectations.testkit';
import { compareWithExpectation, readExpectation, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { PINPOINT_CONFIG, pinpointAdapter } from './index';
import { parsePinpointUrl } from './url';

const EXPECTATION = readExpectation(formExpect);
const POSTING = 'https://prophetexchange.pinpointhq.com/en/postings/c0dae85d-514e-490a-be0e-133196663338';

/** The same config with one of its rules undone. */
function without(key: Exclude<keyof AtsConfig, 'platform' | 'snapshots' | 'parse' | 'root'>) {
  const { [key]: _undone, ...rest } = PINPOINT_CONFIG;
  return configuredAdapter(rest);
}

/** A snapshot, its fade-in finished. */
async function shown(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  fixture.doc.getAnimations().forEach((animation) => animation.finish());
  return fixture;
}

async function open() {
  const fixture = await shown(formHtml);
  const root = pinpointAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

const q = <T extends Element = HTMLElement>(doc: Document, css: string) => doc.querySelector<T>(css)!;
const read = (root: Element, adapter: typeof pinpointAdapter) => scan(root, adapter, { platform: 'pinpoint' }).fields;

afterEach(() => removeFixtures(document));

describe('the Pinpoint adapter: the snapshot against its expectations', () => {
  it('prophetx-form: the registry\'s adapter takes the form, and the scan matches the hand-written expectations', async () => {
    const fixture = await shown(formHtml);
    const url = new URL(EXPECTATION.source);
    const [adapter] = adaptersFor(url);
    expect(adapter?.id).toBe('pinpoint');
    const root = adapter!.detect(fixture.doc)!.formRoot;
    const result = scan(root, adapter!, { platform: platformOfUrl(url.href)! });
    expect(compareWithExpectation(fixture.doc, result, EXPECTATION)).toEqual([]);
  });
});

describe('the Pinpoint adapter: each rule, and the page read without it', () => {
  it('takes form#application-form once its panel shows, none while it fades in from opacity 0', async () => {
    const fixture = await loadFixture(document, formHtml, SNAPSHOT_VIEWPORT);
    for (const animation of fixture.doc.getAnimations()) {
      animation.pause();
      animation.currentTime = 0;
    }
    expect(pinpointAdapter.detect(fixture.doc)).toBeNull();
    fixture.doc.getAnimations().forEach((animation) => animation.finish());
    expect(pinpointAdapter.detect(fixture.doc)?.formRoot.id).toBe('application-form');
  });

  it('makes each Yes/No question one group titled by its span; the whole Questions fieldset without the rule', async () => {
    const page = await open();
    const radio = q(page.doc, '#application_form_application_answers_attributes_0_boolean_answer_true');
    expect(pinpointAdapter.groupOf?.(radio)).toBe(radio.closest('div.pad-v-3'));
    const groups = (adapter: typeof pinpointAdapter) => read(page.root, adapter).filter((field) => field.kind === 'radio')
      .map((field) => [field.label, field.required]);
    expect(groups(pinpointAdapter)).toEqual([['Are you legally authorized to work in the U.S.?', true],
      ['Will you now or in the future require employer sponsorship for work authorization?', true]]);
    const loose = configuredAdapter({ ...PINPOINT_CONFIG, questions: PINPOINT_CONFIG.questions!.map((rule) => {
      const { group: _group, ...rest } = rule;
      return rest;
    }) });
    expect(groups(loose)).toEqual([['3.Questions', false], ['3.Questions', false]]);
  });

  it('reads required from the title\'s class where no attribute says it; not without the rule', async () => {
    const page = await open();
    const required = (adapter: typeof pinpointAdapter) => read(page.root, adapter)
      .filter((field) => ['radio', 'combobox', 'file'].includes(field.kind)).map((field) => field.required);
    expect(required(pinpointAdapter)).toEqual([true, true, true, true]);
    expect(required(without('required'))).toEqual([false, false, false, false]);
  });

  it('declares the react-select for the bridge, its box the control; widget-phase-4 without the rule', async () => {
    const page = await open();
    const input = q(page.doc, 'input.react-select__input[role="combobox"]');
    expect(pinpointAdapter.widgetFor?.(input)).toMatchObject({ kind: 'combobox', opener: input, expanded: input,
      box: q(page.doc, 'div.react-select__control'), bridge: 'react-select', snapshot: 'pinpoint-0, jr7-pinpointhq1-form' });
    const verdict = (adapter: typeof pinpointAdapter) => {
      const result = scan(page.root, adapter, { platform: 'pinpoint' });
      const field = result.fields.find((each) => each.kind === 'combobox')!;
      return fillabilityOf(field, result.target(field.key)?.widget);
    };
    expect(verdict(pinpointAdapter)).toEqual({ fillable: true });
    expect(verdict(without('widgets'))).toEqual({ fillable: false, reason: 'widget-phase-4' });
  });

  it('titles the résumé by its question, its "Attach" label the upload control; the label alone without the rules', async () => {
    const page = await open();
    const input = q<HTMLInputElement>(page.doc, 'input.file-field__input');
    expect(pinpointAdapter.uploadWidgets?.(page.root)).toEqual([{ control: q(page.doc, 'label.file-field__label'), input }]);
    const file = (adapter: typeof pinpointAdapter) => read(page.root, adapter).filter((field) => field.kind === 'file')
      .map((field) => [field.label, field.required, field.description]);
    expect(file(pinpointAdapter)).toEqual([['Résumé / CV', true, 'Accepted file formats are .pdf and .docx']]);
    // Without it, the control's own words name the input (the title still marks it required and gives its help).
    expect(file(without('uploads'))).toEqual([['Attach Résumé / CV', true, 'Accepted file formats are .pdf and .docx']]);
    // No sign of a file taken is in the snapshots: the input's own files decide.
    expect(pinpointAdapter.uploadState?.(input, 'resume.pdf')).toBeNull();
  });

  it('names Submit, final while it shows, never LinkedIn, Save for later, the back link or the cookie buttons', async () => {
    const page = await open();
    const submit = q(page.doc, 'form#application-form button[type="submit"][name="button"]');
    expect(pinpointAdapter.submitButton?.(page.root)).toBe(submit);
    expect(pinpointAdapter.isFinalStep?.(page.doc)).toBe('final');
    expect(without('submit').submitButton?.(page.root)).toBeNull();
    const never = pinpointAdapter.neverPress?.(page.root) ?? [];
    for (const css of ['a.external-button--linkedin', 'button#application-save-later-link', 'a.external-panel__back-link']) {
      expect(never, css).toContain(q(page.doc, css));
    }
    expect(never).not.toContain(submit);
    expect(without('neverPress').neverPress?.(page.root)).toEqual([]);
  });

  it('reads the posting\'s text and gives its first Apply Now to the agent\'s entry alone', async () => {
    const posting = await shown(postingHtml);
    const doc = posting.doc;
    expect(pinpointAdapter.detect(doc)).toBeNull();
    expect(pinpointAdapter.postingText?.(doc)).toBe(q(doc, '#external-jobs-show-description'));
    expect(pinpointAdapter.entryControl?.(doc)).toBe(q(doc, '#external-jobs-show-apply-now a.external-button'));
    const never = pinpointAdapter.neverPress?.(doc.documentElement) ?? [];
    for (const css of ['#external-jobs-show-apply-now a.external-button', 'a[href*="/register-your-interest/"]',
      'button.cm__btn', 'a[data-cc]']) {
      expect(never, css).toContain(q(doc, css));
    }
    expect(without('posting').entryControl?.(doc)).toBeNull();
    expect(parsePinpointUrl(new URL(POSTING))?.page).toBe('posting');
  });

  it('reads the thanks page by its address, and its section#application-thanks as the sign', async () => {
    const thanks = await shown(thanksHtml);
    const doc = thanks.doc;
    expect(parsePinpointUrl(new URL(`${POSTING}/applications/thanks?token=REDACTED`))?.page).toBe('confirmation');
    expect(pinpointAdapter.canonicalApplicationUrl(new URL(`${POSTING}/applications/thanks`))).toBeNull();
    const section = q(doc, 'section#application-thanks');
    expect(section.textContent).toContain('Your application was received successfully.');
    expect(signsOf(doc, 'pinpoint')).toEqual([section]);
    expect(configuredSuccessSigns(doc, { ...PINPOINT_CONFIG, success: undefined })).toEqual([]);
  });
});
