/*
 * jr7 BOARDS-7 P1 (FIX7PLAN §6.13; SP\jr7\audit\boards.md, corrected by boards-verify.md): the SmartRecruiters
 * adapter's jr7 fixes on the owner's snapshot7 pages (fixtures/smartrecruiters/jr7-smartrecruiter1-*) and, where the
 * capture is not committed yet, on a DOM variant of an earlier one made here:
 * - J7-SR-1: "I'm interested" is offered on the posting captured at its lower-case address, whose links name the
 *   company as it spells itself; a link to another company is still refused.
 * - J7-SR-3 (the verifier's narrowed fix: the question id anchored to its UUID): a screening list whose id names one
 *   field of a question of several (question_<question id>_gender, _ethnicity) or a repeated row's field
 *   (question_<question id>-0-level) takes that field's own published list. The answered screening capture
 *   (jr7-smartrecruiter1-screening-filled) waits for the converter (BOARDS-7's handoff), so its three lists (3, 8 and
 *   5 options, the definition's counts as the verifier read them) are made on xplor-screening's own definition here.
 * - J7-SR-4 (raised to high): the page after Submit draws "Application submitted!", the adapter's successSigns for an
 *   arm of SmartRecruiters; none on every other SmartRecruiters page, none for another platform's arm, none hidden.
 * Nothing here reads or prints a value of the owner's: the pages' values are the converter's REDACTED or cleared ones,
 * and every option label below is a synthetic word of this test's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import bertelsmannHtml from '../../../fixtures/smartrecruiters/bertelsmann-expired.html?raw';
import wiserOneClickHtml from '../../../fixtures/smartrecruiters/jr6-wiser-one-click.html?raw';
import wiserScreeningHtml from '../../../fixtures/smartrecruiters/jr6-wiser-screening.html?raw';
import xplorFilledHtml from '../../../fixtures/smartrecruiters/jr6-xplor-one-click-filled.html?raw';
import jr7OneClickHtml from '../../../fixtures/smartrecruiters/jr7-smartrecruiter1-oneclick-filled.html?raw';
import jr7PostingHtml from '../../../fixtures/smartrecruiters/jr7-smartrecruiter1-posting.html?raw';
import jr7SuccessHtml from '../../../fixtures/smartrecruiters/jr7-smartrecruiter1-success.html?raw';
import xplorOneClickHtml from '../../../fixtures/smartrecruiters/xplor-one-click.html?raw';
import xplorPostingHtml from '../../../fixtures/smartrecruiters/xplor-posting.html?raw';
import xplorScreeningHtml from '../../../fixtures/smartrecruiters/xplor-screening.html?raw';
import { applicationKey } from '../application-key';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { SMARTRECRUITERS_SUCCESS, smartRecruitersAdapter } from './index';
import { parseSmartRecruitersUrl } from './url';

const sourceOf = (html: string): string => /"source":"([^"]+)"/.exec(html)![1]!;
const XPLOR_SCREENING = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-58b4-4671-bd81-6ed11d3bcfd1/screening?dcr_ci=Xplor';

/** A page loaded at `address` (its base), so its links resolve there. */
async function load(html: string, address: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  return fixture;
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

afterEach(() => removeFixtures(document));

describe("J7-SR-1: the posting's entry, the company compared in lower case", () => {
  it("offers \"I'm interested\" on jr7-smartrecruiter1-posting at its captured, lower-case address", async () => {
    const address = sourceOf(jr7PostingHtml);
    const fixture = await load(jr7PostingHtml, address);
    const here = parseSmartRecruitersUrl(new URL(address))!;
    const bottom = fixture.doc.querySelector<HTMLElement>('a.js-oneclick[data-sr-track-position="bottom"]')!;
    const target = parseSmartRecruitersUrl(new URL(bottom.getAttribute('href')!, fixture.doc.baseURI))!;
    // The capture's own shape: the same company, spelt apart (booleans only).
    expect([here.page, target.page]).toEqual(['posting', 'application']);
    expect([target.board === here.board, target.board?.toLowerCase() === here.board?.toLowerCase()]).toEqual([false, true]);
    expect(smartRecruitersAdapter.entryControl!(fixture.doc)).toBe(bottom);
  });

  it("offers it at the company's own spelling too, and none for a link to another company", async () => {
    const lower = new URL(sourceOf(jr7PostingHtml));
    const fixture = await load(jr7PostingHtml, lower.href);
    const bottom = fixture.doc.querySelector<HTMLElement>('a.js-oneclick[data-sr-track-position="bottom"]')!;
    const company = parseSmartRecruitersUrl(new URL(bottom.getAttribute('href')!, fixture.doc.baseURI))!.board!;
    removeFixtures(document);
    const spelt = new URL(lower.href);
    spelt.pathname = spelt.pathname.replace(/^\/[^/]+/, `/${company}`);
    const own = await load(jr7PostingHtml, spelt.href);
    expect(smartRecruitersAdapter.entryControl!(own.doc))
      .toBe(own.doc.querySelector('a.js-oneclick[data-sr-track-position="bottom"]'));
    for (const link of Array.from(own.doc.querySelectorAll('a.js-oneclick'))) {
      link.setAttribute('href', (link.getAttribute('href') ?? '').replace(`/company/${company}/`, '/company/AnotherCompany/'));
    }
    expect(smartRecruitersAdapter.entryControl!(own.doc)).toBeNull();
  });
});

describe("J7-SR-3: a screening list of one field of a question takes that field's list", () => {
  /** xplor-screening's definition with three lists made fields of others (a DOM variant made here, synthetic labels):
   *  the 14-option list becomes question A's "gender" field (3 options), the 2-option list question A's "ethnicity"
   *  field (8), the 5-option list question B's repeated "level" field (5) beside its text field "lang", as
   *  snapshot7's screening step publishes Gender, Race/Ethnicity and a language's level. Returns each list's text box. */
  async function variant(change: (question: Record<string, unknown>) => void = () => undefined) {
    const fixture = await load(xplorScreeningHtml, XPLOR_SCREENING);
    const form = deepAll(fixture.doc, 'sr-screening-questions-form[definition]')[0]!;
    const definition = JSON.parse(form.getAttribute('definition')!) as { questions: Array<Record<string, unknown>> };
    const A = 'a0151063-d62b-49e7-9c6f-d17e59b99090';
    const B = '562715e2-4960-44f3-9e8d-2750ae765f9a';
    const values = (prefix: string, count: number) => Array.from({ length: count }, (_, at) => ({ id: `${prefix}-${at}`,
      label: `${prefix} option ${at + 1}` }));
    for (const question of definition.questions) {
      if (question.id === A) {
        question.fields = [{ id: 'gender', type: 'select', multipleChoice: false, values: values('Gender', 3) },
          { id: 'ethnicity', type: 'select', multipleChoice: false, values: values('Ethnicity', 8) }];
        change(question);
      }
      if (question.id === B) {
        question.fields = [{ id: 'lang', type: 'text', multipleChoice: false, values: [] },
          { id: 'level', type: 'select', multipleChoice: false, values: values('Level', 5) }];
      }
    }
    form.setAttribute('definition', JSON.stringify(definition));
    const box = (id: string) => deepAll(fixture.doc, `spl-autocomplete#${id}`)[0]!.shadowRoot!
      .querySelector('spl-input')!.shadowRoot!.querySelector<HTMLElement>('input[role="combobox"]')!;
    const renamed = (from: string, to: string) => {
      const el = deepAll(fixture.doc, `spl-autocomplete#question_${from}`)[0]!;
      el.id = `question_${to}`;
      return box(`question_${to}`);
    };
    return {
      gender: renamed(A, `${A}_gender`),
      ethnicity: renamed('9320d6d5-0b22-4e3f-b913-e7076e5e8083', `${A}_ethnicity`),
      level: renamed(B, `${B}-0-level`),
      // Untouched: a single-field question's list, read whole as before.
      untouched: box('question_5d965982-4693-4ca6-91ff-9dde3767755c'),
    };
  }

  const known = (box: HTMLElement) => smartRecruitersAdapter.widgetFor!(box)?.knownOptions ?? null;

  it("declares the three lists (3, 8 and 5 options), each its own field's, and leaves a single field's list whole", async () => {
    const boxes = await variant();
    expect([known(boxes.gender)?.length, known(boxes.ethnicity)?.length, known(boxes.level)?.length])
      .toEqual([3, 8, 5]);
    expect(known(boxes.gender)).toEqual(['Gender option 1', 'Gender option 2', 'Gender option 3']);
    expect(known(boxes.level)![0]).toBe('Level option 1');
    expect(smartRecruitersAdapter.widgetFor!(boxes.ethnicity)).toMatchObject({ kind: 'combobox' });
    expect(known(boxes.untouched)?.length).toBe(8);
  });

  it('leaves a field that takes several answers undeclared, and a field the question lacks', async () => {
    const several = await variant((question) => {
      (question.fields as Array<Record<string, unknown>>)[1]!.multipleChoice = true;
    });
    expect([known(several.gender)?.length, smartRecruitersAdapter.widgetFor!(several.ethnicity)]).toEqual([3, null]);
    removeFixtures(document);
    const lacking = await variant((question) => {
      question.fields = (question.fields as Array<Record<string, unknown>>).filter((field) => field.id !== 'gender');
    });
    expect(smartRecruitersAdapter.widgetFor!(lacking.gender)).toBeNull();
    expect(known(lacking.ethnicity)?.length).toBe(8);
  });
});

describe('J7-SR-4: "Application submitted!" after an armed Submit (successSigns)', () => {
  const ARM = applicationKey('smartrecruiters', 'https://jobs.smartrecruiters.com/citystateentertainmentllc/1');

  it('reads the one drawn sign of jr7-smartrecruiter1-success for an arm of SmartRecruiters', async () => {
    const fixture = await load(jr7SuccessHtml, sourceOf(jr7SuccessHtml));
    const sign = fixture.doc.querySelector('oc-success-page h2[data-test="success-page-confirmation"]');
    expect(sign).not.toBeNull();
    expect(smartRecruitersAdapter.successSigns!(fixture.doc, ARM)).toEqual([sign]);
    expect((sign!.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe('Application submitted!');
    // The address reads as the page after Submit too (url.ts, v5 p2-detect).
    expect(parseSmartRecruitersUrl(new URL(sourceOf(jr7SuccessHtml)))?.page).toBe('confirmation');
    expect(SMARTRECRUITERS_SUCCESS.css).toBe('oc-success-page [data-test="success-page"] h2[data-test="success-page-confirmation"]');
  });

  it("reads none for another platform's arm, and none while the sign is hidden", async () => {
    const fixture = await load(jr7SuccessHtml, sourceOf(jr7SuccessHtml));
    expect(smartRecruitersAdapter.successSigns!(fixture.doc, applicationKey('jazzhr', 'https://example.applytojob.com/apply/x')))
      .toEqual([]);
    fixture.doc.querySelector<HTMLElement>('oc-success-page')!.style.display = 'none';
    expect(smartRecruitersAdapter.successSigns!(fixture.doc, ARM)).toEqual([]);
  });

  it.each([
    ['xplor-posting', xplorPostingHtml], ['bertelsmann-expired', bertelsmannHtml], ['xplor-one-click', xplorOneClickHtml],
    ['xplor-screening', xplorScreeningHtml], ['jr6-xplor-one-click-filled', xplorFilledHtml],
    ['jr6-wiser-one-click', wiserOneClickHtml], ['jr6-wiser-screening', wiserScreeningHtml],
    ['jr7-smartrecruiter1-posting', jr7PostingHtml], ['jr7-smartrecruiter1-oneclick-filled', jr7OneClickHtml],
  ])('reads none on %s (no sign before the press)', async (_name, html) => {
    const fixture = await load(html, sourceOf(html));
    expect(smartRecruitersAdapter.successSigns!(fixture.doc, ARM)).toEqual([]);
  });
});
