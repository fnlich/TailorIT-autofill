/*
 * Rippling Recruiting's configured adapter on the owner's snapshots (fixtures/rippling: qu-careers-form from rippling-2,
 * empty with five custom questions; smartsuite-uploaded from rippling-0, a résumé in; qu-careers-posting from
 * rippling-4): the scan held against the hand-written expectations, and each rule of ./config.ts held to what the page
 * shows and read again with the rule undone: the phone code's title and suffix, the custom questions' titles, the SMS
 * radios, the uploads and their sign, the résumé's star, Submit, the never-pressed controls and the posting.
 * The text boxes that show no placeholder (Location, the custom text questions) are drawn by their padded wrapper,
 * which core pass Z2 of 2026-11-06 reads as their box (dom/camouflage.ts drawnByWrapper); they read camouflaged until
 * then, pinned here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeWorker, testVocab } from '../../content/content.testkit';
import { startContentRuntime } from '../../content/runtime';
import quExpect from '../../../fixtures/rippling/qu-careers-form.expect.json';
import quHtml from '../../../fixtures/rippling/qu-careers-form.html?raw';
import postingHtml from '../../../fixtures/rippling/qu-careers-posting.html?raw';
import smartExpect from '../../../fixtures/rippling/smartsuite-uploaded.expect.json';
import smartHtml from '../../../fixtures/rippling/smartsuite-uploaded.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { configuredAdapter } from '../configured';
import type { AtsConfig } from '../configured/types';
import { adaptersFor, applicationOf } from '../index';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { RIPPLING_CONFIG, ripplingAdapter } from './index';

const CASES = [
  { name: 'qu-careers-form', html: quHtml, expectation: readExpectation(quExpect) },
  { name: 'smartsuite-uploaded', html: smartHtml, expectation: readExpectation(smartExpect) },
] as const;

/** The same config with one of its rules undone. */
function without(key: Exclude<keyof AtsConfig, 'platform' | 'snapshots' | 'parse' | 'root'>) {
  const { [key]: _undone, ...rest } = RIPPLING_CONFIG;
  return configuredAdapter(rest);
}

async function open(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = ripplingAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

const q = <T extends Element = HTMLElement>(doc: Document, css: string) => doc.querySelector<T>(css)!;
const labelsOf = (root: Element, adapter: typeof ripplingAdapter) => scan(root, adapter, { platform: 'rippling' }).fields
  .map((field) => field.label);

afterEach(() => removeFixtures(document));

describe('the Rippling adapter: the snapshots against their expectations', () => {
  it.each(CASES)('$name: the scan matches the hand-written expectations',
    async ({ html, expectation }) => {
      const scanned = await scanCase(document, html, expectation.source);
      expect(scanned.adapter.id).toBe('rippling');
      expect(compareWithExpectation(scanned.doc, scanned.result, expectation)).toEqual([]);
    });
});

describe('the Rippling adapter: each rule, and the page read without it', () => {
  it('takes main#main-content form as the root, and none on the posting', async () => {
    const page = await open(quHtml);
    expect(page.root.matches('main#main-content form')).toBe(true);
    removeFixtures(document);
    const posting = await loadFixture(document, postingHtml, SNAPSHOT_VIEWPORT);
    expect(ripplingAdapter.detect(posting.doc)).toBeNull();
  });

  it('titles the phone\'s code by the phone field\'s label with "country code"; "Search" without the rules', async () => {
    const page = await open(quHtml);
    const code = q(page.doc, '[data-testid="phone_number-code"] input[role="combobox"]');
    expect(ripplingAdapter.labelFor?.(code)?.textContent).toBe('Phone number');
    expect(ripplingAdapter.labelSuffix?.(code)).toBe('country code');
    expect(labelsOf(page.root, ripplingAdapter)).toContain('Phone number country code');
    const plain = configuredAdapter({ ...RIPPLING_CONFIG, questions: RIPPLING_CONFIG.questions!.slice(1), code: {} });
    expect(labelsOf(page.root, plain)).toContain('Search');
    expect(labelsOf(page.root, plain)).not.toContain('Phone number country code');
  });

  it('titles each custom question by its block\'s p; "Select" and nothing without the rule', async () => {
    const page = await open(quHtml);
    const questions = ['Are you legally authorized to work in the United States of America?',
      'Will you now or in the future require sponsorship for employment visa status?',
      'Are you able to provide the required documentation to establish your identity and work authorization upon hire?',
      'What are your Salary Expectations for the role?', 'Who referred you?'];
    const read = labelsOf(page.root, ripplingAdapter);
    for (const question of questions) expect(read).toContain(question);
    const undone = labelsOf(page.root, configuredAdapter({ ...RIPPLING_CONFIG,
      questions: RIPPLING_CONFIG.questions!.filter((rule) => rule.container !== 'div.marginY--36') }));
    for (const question of questions) expect(undone).not.toContain(question);
    expect(undone.filter((label) => label === 'Select')).toHaveLength(3);
  });

  it('declares the SMS consent\'s drawn radios a radio group titled by the paragraph before it; no field without it',
    async () => {
      const page = await open(smartHtml);
      const group = q(page.doc, 'div[role="radiogroup"][data-testid="sms_opt_in"]');
      expect(ripplingAdapter.widgetFor?.(group)).toMatchObject({ kind: 'radio',
        members: Array.from(group.querySelectorAll('div[role="radio"]')),
        parts: Array.from(group.querySelectorAll('input[type="radio"]')) });
      const field = scan(page.root, ripplingAdapter, { platform: 'rippling' }).fields.find((each) => each.kind === 'radio');
      expect(field?.label).toMatch(/^Check Yes or No to indicate your agreement to receive text message updates from /);
      expect(Array.isArray(field?.options) && field.options.map((option) => option.label)).toEqual([
        'Yes - I consent to receiving text messages', 'No - I do not consent to receiving text messages']);
      expect(scan(page.root, without('widgets'), { platform: 'rippling' }).fields.some((each) => each.kind === 'radio'))
        .toBe(false);
    });

  it('pairs each upload with its drop zone, titles it, stars the résumé, and reads the chip as the file taken', async () => {
    const empty = await open(quHtml);
    const resume = q<HTMLInputElement>(empty.doc, 'input[data-testid="input-resume"]');
    expect(ripplingAdapter.uploadWidgets?.(empty.root)).toEqual([
      { control: q(empty.doc, 'label[data-testid="resume"]'), input: resume },
      { control: q(empty.doc, 'label[data-testid="cover_letter"]'), input: q(empty.doc, 'input[data-testid="input-cover_letter"]') }]);
    expect(ripplingAdapter.uploadState?.(resume, 'resume.pdf')).toBe('pending');
    const files = (adapter: typeof ripplingAdapter) => scan(empty.root, adapter, { platform: 'rippling' }).fields
      .filter((field) => field.kind === 'file').map((field) => [field.label, field.required]);
    expect(files(ripplingAdapter)).toEqual([['Résumé', true], ['Cover letter', false]]);
    expect(files(without('required'))).toEqual([['Résumé', false], ['Cover letter', false]]);
    expect(files(without('uploads'))).toEqual([]);
    removeFixtures(document);
    const taken = await open(smartHtml);
    const kept = q<HTMLInputElement>(taken.doc, 'input[data-testid="input-resume"]');
    // The behaviour review (M2): the chip confirms only the file it names, never the file the page held before; it is
    // a file the page holds (uploadHeld), the cover letter's empty drop zone none.
    expect(ripplingAdapter.uploadState?.(kept, 'resume.pdf')).toBe('pending');
    expect(ripplingAdapter.uploadHeld?.(kept)).toBe(true);
    expect(ripplingAdapter.uploadHeld?.(q<HTMLInputElement>(taken.doc, 'input[data-testid="input-cover_letter"]'))).toBe(false);
    q(taken.doc, '[data-testid="chip"] div[id^="chip-"][id$="-content"]').textContent = 'resume.pdf';
    expect(ripplingAdapter.uploadState?.(kept, 'resume.pdf')).toBe('confirmed');
    expect(ripplingAdapter.uploadState?.(q<HTMLInputElement>(taken.doc, 'input[data-testid="input-cover_letter"]'), 'x'))
      .toBe('pending');
    expect(without('uploads').uploadState?.(kept, 'resume.pdf')).toBeNull();
  });

  it('names Apply as Submit, yet never reads its step as final: what follows Apply is in no snapshot (the behaviour review, minor 5)', async () => {
    const page = await open(quHtml);
    const apply = q(page.doc, 'form button[type="submit"][data-testid="Apply"]');
    expect(ripplingAdapter.submitButton?.(page.root)).toBe(apply);
    expect(ripplingAdapter.isFinalStep?.(page.doc)).toBe('unknown');
    // The layer alone (the code's isFinalStep undone) would read a one-page form's shown Submit as final.
    const { isFinalStep: _unknown, ...code } = RIPPLING_CONFIG.code!;
    expect(configuredAdapter({ ...RIPPLING_CONFIG, code }).isFinalStep?.(page.doc)).toBe('final');
    expect(without('submit').submitButton?.(page.root)).toBeNull();
    expect(without('submit').isFinalStep?.(page.doc)).toBe('unknown');
  });

  it('never presses Exit, the AI opt-out, the legal links or the chip\'s buttons; nothing without the rule', async () => {
    const page = await open(smartHtml);
    const never = ripplingAdapter.neverPress?.(page.root) ?? [];
    const expected = [q(page.doc, 'button[data-testid="Exit to job board"]'),
      ...Array.from(page.doc.querySelectorAll('a[href^="https://app.rippling.com/legal/"]')),
      ...Array.from(page.doc.querySelectorAll('[data-testid="chip"] [role="button"]'))];
    expect(expected).toHaveLength(5);
    for (const el of expected) expect(never).toContain(el);
    expect(never).not.toContain(ripplingAdapter.submitButton?.(page.root));
    removeFixtures(document);
    const empty = await open(quHtml);
    const optOut = q(empty.doc, 'main#main-content form a[href*="/apply?"]');
    expect(optOut.textContent).toBe('click here');
    expect(ripplingAdapter.neverPress?.(empty.root)).toContain(optOut);
    expect(without('neverPress').neverPress?.(empty.root)).toEqual([]);
  });

  it('reads the posting\'s text and gives its Apply now to the agent\'s entry alone; nothing without the rule', async () => {
    const posting = await loadFixture(document, postingHtml, SNAPSHOT_VIEWPORT);
    const doc = posting.doc;
    expect(ripplingAdapter.postingText?.(doc)).toBe(q(doc, 'div.ATS_htmlPreview'));
    const entry = ripplingAdapter.entryControl?.(doc);
    expect(entry?.matches('button[data-testid="Apply now"]')).toBe(true);
    expect(ripplingAdapter.entryNeverPressed).toBe(true);
    const never = ripplingAdapter.neverPress?.(doc.documentElement) ?? [];
    for (const el of [...Array.from(doc.querySelectorAll('button[data-testid="Apply now"]')),
      ...Array.from(doc.querySelectorAll('a[role="link"][data-testid^="/"]')),
      ...Array.from(doc.querySelectorAll('span[role="button"][aria-label^="Share on"]'))]) expect(never).toContain(el);
    expect(without('posting').postingText?.(doc)).toBeNull();
    expect(without('posting').entryControl?.(doc)).toBeNull();
  });
});

describe("the Rippling posting (rippling-4): its footer's language picker is never a field", () => {
  /** The posting's address, as the fixture's header keeps it. */
  const POSTING = 'https://ats.rippling.com/qu-careers/jobs/73bf0c96-e3e8-42ca-820c-01f2360ed78d?src=LinkedIn';

  it('reads the address as the posting, so the content runtime picks no adapter there: no launcher, nothing to fill',
    async () => {
      // Core pass Z2 of 2026-11-06 (CORE-BLOCKERS item 32): the generic adapter's detect, asked alone, takes the body for
      // the footer's "Display language" combobox (footer > ... input[aria-label="Display language"][role=combobox]),
      // since Rippling's root (main#main-content form) is not on the posting. The runtime asks no adapter on an address
      // the platform's parser reads as a posting (runtime.ts resolvePage), so that reading never reaches a person.
      expect(applicationOf(new URL(POSTING))?.page).toBe('posting');
      const posting = await loadFixture(document, postingHtml, SNAPSHOT_VIEWPORT);
      const picker = posting.doc.querySelector('footer input[aria-label="Display language"][role="combobox"]');
      expect(picker).not.toBeNull();
      expect(adaptersFor(new URL(POSTING)).map((adapter) => adapter.id)).toEqual(['rippling', 'generic']);
      testVocab();
      const worker = createFakeWorker();
      const runtime = await startContentRuntime(worker.platform, posting.doc, { href: () => POSTING, isTop: true,
        settle: { quietMs: 60 } });
      try {
        expect(worker.of('frame/hello')[0]).toMatchObject({ hasForm: false });
        expect(runtime.page).toBeNull();
        expect(runtime.ui).toBeNull();
        expect(runtime.fill()).toBeNull();
      } finally {
        runtime.stop();
      }
    });
});
