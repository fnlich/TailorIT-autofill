/*
 * The Workday adapter's application steps on the owner's signed-in snapshots of 2026-11-06 (src/adapters/workday/
 * application.ts; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): each converted step held against its hand-checked expectations (the scan of
 * the flow page and every hook, `fields` and `hooks`, as the public capture's cases are) and its `steps` entry: the
 * step's signature parts, its finality, its Next and its Submit, each widget's kind and whether it shows an answer, and
 * the repeatable sections. Then each rule on its own: the dropdown chosen by the widget helpers through its own ARIA
 * (Workday's script stood in for by a listener drawing the snapshot's own open list), the prompt never typed into,
 * Next withheld while a required date is empty, the "I currently work here" boxes one per block, the upload's word,
 * Review's Submit only there, the account view's error and the loading panel.
 */
import { afterEach, describe, expect, it } from 'vitest';
import cisiveExpect from '../../../fixtures/workday/cisive-autofill-resume.expect.json';
import cisiveHtml from '../../../fixtures/workday/cisive-autofill-resume.html?raw';
import sourceOpenExpect from '../../../fixtures/workday/resolvetech-source-open.expect.json';
import sourceOpenHtml from '../../../fixtures/workday/resolvetech-source-open.html?raw';
import resolveExpExpect from '../../../fixtures/workday/resolvetech-my-experience.expect.json';
import resolveExpHtml from '../../../fixtures/workday/resolvetech-my-experience.html?raw';
import webExpExpect from '../../../fixtures/workday/web-my-experience.expect.json';
import webExpHtml from '../../../fixtures/workday/web-my-experience.html?raw';
import webQuestionsExpect from '../../../fixtures/workday/web-application-questions.expect.json';
import webQuestionsHtml from '../../../fixtures/workday/web-application-questions.html?raw';
import aepExpect from '../../../fixtures/workday/aep-application-questions-2.expect.json';
import aepHtml from '../../../fixtures/workday/aep-application-questions-2.html?raw';
import disclosuresExpect from '../../../fixtures/workday/danafarber-voluntary-disclosures.expect.json';
import disclosuresHtml from '../../../fixtures/workday/danafarber-voluntary-disclosures.html?raw';
import selfIdExpect from '../../../fixtures/workday/danafarber-self-identify.expect.json';
import selfIdHtml from '../../../fixtures/workday/danafarber-self-identify.html?raw';
import reviewExpect from '../../../fixtures/workday/web-review.expect.json';
import reviewHtml from '../../../fixtures/workday/web-review.html?raw';
import verilyExpect from '../../../fixtures/workday/verily-sign-in-verify.expect.json';
import verilyHtml from '../../../fixtures/workday/verily-sign-in-verify.html?raw';
// s2 wd: the owner's snapshots of round 2 (2026-11-07).
import countryOpenExpect from '../../../fixtures/workday/s2-exelixis-country-open.expect.json';
import countryOpenHtml from '../../../fixtures/workday/s2-exelixis-country-open.html?raw';
import stateOpenExpect from '../../../fixtures/workday/s2-exelixis-state-open.expect.json';
import stateOpenHtml from '../../../fixtures/workday/s2-exelixis-state-open.html?raw';
import exelixisExpExpect from '../../../fixtures/workday/s2-exelixis-my-experience.expect.json';
import exelixisExpHtml from '../../../fixtures/workday/s2-exelixis-my-experience.html?raw';
import verilyCreateExpect from '../../../fixtures/workday/s2-verily-create-account.expect.json';
import verilyCreateHtml from '../../../fixtures/workday/s2-verily-create-account.html?raw';
import verilySourceExpect from '../../../fixtures/workday/s2-verily-source-open.expect.json';
import verilySourceHtml from '../../../fixtures/workday/s2-verily-source-open.html?raw';
import verilyInfoExpect from '../../../fixtures/workday/s2-verily-my-information.expect.json';
import verilyInfoHtml from '../../../fixtures/workday/s2-verily-my-information.html?raw';
import verilyStudyExpect from '../../../fixtures/workday/s2-verily-field-of-study-open.expect.json';
import verilyStudyHtml from '../../../fixtures/workday/s2-verily-field-of-study-open.html?raw';
import noItemsExpect from '../../../fixtures/workday/s2-verily-school-no-items.expect.json';
import noItemsHtml from '../../../fixtures/workday/s2-verily-school-no-items.html?raw';
import degreeOpenExpect from '../../../fixtures/workday/s2-verily-degree-open.expect.json';
import degreeOpenHtml from '../../../fixtures/workday/s2-verily-degree-open.html?raw';
import schoolResultsExpect from '../../../fixtures/workday/s2-verily-school-results.expect.json';
import schoolResultsHtml from '../../../fixtures/workday/s2-verily-school-results.html?raw';
import afterAddExpect from '../../../fixtures/workday/s2-verily-field-of-study-after-add.expect.json';
import afterAddHtml from '../../../fixtures/workday/s2-verily-field-of-study-after-add.html?raw';
import pureErrorsExpect from '../../../fixtures/workday/s2-pureinsurance-my-experience-errors.expect.json';
import pureErrorsHtml from '../../../fixtures/workday/s2-pureinsurance-my-experience-errors.html?raw';
import pureDegreeExpect from '../../../fixtures/workday/s2-pureinsurance-degree-open.expect.json';
import pureDegreeHtml from '../../../fixtures/workday/s2-pureinsurance-degree-open.html?raw';
import syntheticHtml from '../../../fixtures/synthetic/workday/steps.html?raw';
import { classifyByRules } from '../../core/resolver/classifyRules';
import { scan, toFieldSpec } from '../../dom/scan';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { fillWidget, isActionable, listOf, readWidget } from '../../dom/widgets';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import { WORKDAY_STEP_SNAPSHOTS, workdayAdapter } from './index';

/** A step case's `steps` entry (hand-checked against the page). */
interface ExpectedSteps {
  signature: { heading: string; progress: string; anchors: string[] };
  final: 'final' | 'not-final' | 'unknown';
  next: string | null;
  submit: string | null;
  widgets: Array<{ control: string; kind: string; answered: boolean }>;
  repeatables: Array<{ kind: string; blocks: number; add: string | null }>;
}

const stepsOf = (json: unknown) => (json as { steps: ExpectedSteps }).steps;
const sourceOf = (json: unknown) => (json as { source: string }).source;

const CASES = [
  { name: 'cisive-autofill-resume', html: cisiveHtml, json: cisiveExpect },
  { name: 'resolvetech-source-open', html: sourceOpenHtml, json: sourceOpenExpect },
  { name: 'resolvetech-my-experience', html: resolveExpHtml, json: resolveExpExpect },
  { name: 'web-my-experience', html: webExpHtml, json: webExpExpect },
  { name: 'web-application-questions', html: webQuestionsHtml, json: webQuestionsExpect },
  { name: 'aep-application-questions-2', html: aepHtml, json: aepExpect },
  { name: 'danafarber-voluntary-disclosures', html: disclosuresHtml, json: disclosuresExpect },
  { name: 'danafarber-self-identify', html: selfIdHtml, json: selfIdExpect },
  { name: 'web-review', html: reviewHtml, json: reviewExpect },
  // s2 wd
  { name: 's2-exelixis-country-open', html: countryOpenHtml, json: countryOpenExpect },
  { name: 's2-exelixis-state-open', html: stateOpenHtml, json: stateOpenExpect },
  { name: 's2-exelixis-my-experience', html: exelixisExpHtml, json: exelixisExpExpect },
  { name: 's2-verily-create-account', html: verilyCreateHtml, json: verilyCreateExpect },
  { name: 's2-verily-source-open', html: verilySourceHtml, json: verilySourceExpect },
  { name: 's2-verily-my-information', html: verilyInfoHtml, json: verilyInfoExpect },
  { name: 's2-verily-field-of-study-open', html: verilyStudyHtml, json: verilyStudyExpect },
  { name: 's2-verily-school-no-items', html: noItemsHtml, json: noItemsExpect },
  { name: 's2-verily-degree-open', html: degreeOpenHtml, json: degreeOpenExpect },
  { name: 's2-verily-school-results', html: schoolResultsHtml, json: schoolResultsExpect },
  { name: 's2-verily-field-of-study-after-add', html: afterAddHtml, json: afterAddExpect },
  { name: 's2-pureinsurance-my-experience-errors', html: pureErrorsHtml, json: pureErrorsExpect },
  { name: 's2-pureinsurance-degree-open', html: pureDegreeHtml, json: pureDegreeExpect },
] as const;

async function load(html: string): Promise<Fixture> {
  return loadFixture(document, html, SNAPSHOT_VIEWPORT);
}

/** The one element `selector` names, or a failure. */
function one(doc: Document, selector: string): Element {
  const found = Array.from(doc.querySelectorAll(selector));
  expect(found, selector).toHaveLength(1);
  return found[0]!;
}

afterEach(() => removeFixtures(document));

describe('the Workday adapter on the application steps (the owner’s snapshots of 2026-11-06)', () => {
  it('names each snapshot its step hooks were written from', () => {
    expect([...CASES.map((each) => `fixtures/workday/${each.name}.html`), 'fixtures/workday/verily-sign-in-verify.html'].sort())
      .toEqual([...WORKDAY_STEP_SNAPSHOTS].sort());
  });

  it.each(CASES)('$name: every account and entry hook answers what the page shows', async ({ html, json }) => {
    const fixture = await load(html);
    expect(compareHooks(fixture.doc, workdayAdapter, readHooks(json))).toEqual([]);
  });

  it.each(CASES)('$name: the scan of the flow page is the expectation', async ({ html, json }) => {
    const scanned = await scanCase(document, html, sourceOf(json));
    expect(scanned.adapter).toBe(workdayAdapter);
    expect(compareWithExpectation(scanned.doc, scanned.result, readExpectation(json))).toEqual([]);
  });

  it.each(CASES)('$name: its signature, finality, Next and Submit', async ({ html, json }) => {
    const steps = stepsOf(json);
    const fixture = await load(html);
    const root = workdayAdapter.detect(fixture.doc)!.formRoot;
    expect(workdayAdapter.stepSignature!(fixture.doc)).toEqual(steps.signature);
    expect(workdayAdapter.isFinalStep!(fixture.doc)).toBe(steps.final);
    expect(workdayAdapter.nextButton!(root)).toBe(steps.next === null ? null : one(fixture.doc, steps.next));
    expect(workdayAdapter.submitButton!(root)).toBe(steps.submit === null ? null : one(fixture.doc, steps.submit));
  });

  it.each(CASES)('$name: its widgets, what each shows, and its repeatable sections', async ({ html, json }) => {
    const steps = stepsOf(json);
    const scanned = await scanCase(document, html, sourceOf(json));
    for (const widget of steps.widgets) {
      const control = one(scanned.doc, widget.control);
      const field = scanned.result.fields.find((each) => scanned.result.target(each.key)?.widget?.element === control);
      expect(field?.kind, widget.control).toBe(widget.kind);
      expect(field?.current.kind, widget.control).toBe(widget.answered ? 'selected' : 'empty');
    }
    const sections = workdayAdapter.repeatables!(scanned.root);
    expect(sections.map((section) => ({ kind: section.kind, blocks: section.blocks().length,
      add: section.addButton()?.textContent?.trim() ?? null }))).toEqual(steps.repeatables);
  });
});

describe('Workday’s dropdown: a select-only combobox the helpers act on through its own ARIA', () => {
  /** resolvetech's My Information with its source list closed, and Workday's script stood in for: a click on the
   *  dropdown's button draws the snapshot's own open list (resolvetech-source-open.html) and names it, a click on one
   *  of its options writes that option on the button and closes it. Nothing else answers. */
  async function withDropdown() {
    const fixture = await load(sourceOpenHtml);
    const doc = fixture.doc;
    const button = doc.querySelector<HTMLButtonElement>('button#source--source')!;
    const list = doc.querySelector<HTMLElement>('ul[role="listbox"]#nxgyi')!;
    const popup = list.parentElement!.parentElement!;
    // Closed, as every other dropdown of the snapshots is: no aria-expanded, no aria-controls, the list gone.
    button.removeAttribute('aria-expanded');
    button.removeAttribute('aria-controls');
    popup.remove();
    const events: string[] = [];
    doc.addEventListener('click', (event) => {
      const option = (event.target as Element).closest('[role="option"]');
      if (option !== null && list.contains(option)) {
        events.push(`option:${option.textContent?.trim() ?? ''}`);
        button.textContent = option.textContent?.trim() ?? '';
        button.setAttribute('value', option.getAttribute('data-value') ?? '');
        button.removeAttribute('aria-expanded');
        button.removeAttribute('aria-controls');
        popup.remove();
        return;
      }
      if ((event.target as Element).closest('button#source--source') === null) return;
      events.push('button');
      if (popup.isConnected) {
        popup.remove();
        button.removeAttribute('aria-expanded');
        button.removeAttribute('aria-controls');
      } else {
        doc.body.append(popup);
        button.setAttribute('aria-expanded', 'true');
        button.setAttribute('aria-controls', 'nxgyi');
      }
    });
    return { fixture, button, events };
  }

  it('is actionable though it names no list while closed, and reads its list once open', async () => {
    const { fixture, button, events } = await withDropdown();
    const { scan } = await import('../../dom/scan');
    const root = workdayAdapter.detect(fixture.doc)!.formRoot;
    const result = scan(root, workdayAdapter, { platform: 'workday' });
    const field = result.fields.find((each) => result.target(each.key)?.widget?.element === button)!;
    const target = result.target(field.key)!;
    expect(field.kind).toBe('combobox');
    expect(field.current).toEqual({ kind: 'empty' });
    expect(isActionable(target.widget!)).toBe(true);
    expect(listOf(button)).toBeNull();
    const readings = new Map();
    const read = await readWidget(target, { adapter: workdayAdapter, root, readings });
    expect(read.status).toBe('read');
    const labels = read.status === 'read' && read.reading.kind === 'options' ? read.reading.options.map((option) => option.label) : [];
    expect(labels).toContain('LinkedIn');
    expect(labels).toHaveLength(10);
    // Opened by its button's click, closed by a second one: nothing else was pressed.
    expect(events).toEqual(['button', 'button']);
  });

  it('chooses the planned option by its click, and reads the answer back from the button', async () => {
    const { fixture, button, events } = await withDropdown();
    const { scan } = await import('../../dom/scan');
    const root = workdayAdapter.detect(fixture.doc)!.formRoot;
    const readings = new Map();
    let result = scan(root, workdayAdapter, { platform: 'workday' });
    let field = result.fields.find((each) => result.target(each.key)?.widget?.element === button)!;
    await readWidget(result.target(field.key)!, { adapter: workdayAdapter, root, readings });
    result = scan(root, workdayAdapter, { platform: 'workday', widgetReadings: readings });
    field = result.fields.find((each) => result.target(each.key)?.widget?.element === button)!;
    const index = Array.isArray(field.options) ? field.options.findIndex((option) => option.label === 'LinkedIn') : -1;
    expect(index).toBeGreaterThan(0);
    const outcome = await fillWidget(result.target(field.key)!, { kind: 'option', index, cleanLabel: 'LinkedIn' },
      { adapter: workdayAdapter, root, readings });
    expect(outcome.wrote).toBe(true);
    expect(events.at(-1)).toBe('option:LinkedIn');
    const after = scan(root, workdayAdapter, { platform: 'workday', widgetReadings: readings });
    const chosen = after.fields.find((each) => after.target(each.key)?.widget?.element === button)!;
    expect(chosen.current).toEqual({ kind: 'selected', labels: ['LinkedIn'] });
  });
});

describe('the other step rules, each on its own', () => {
  // s2 wd (snapshot round 2): the prompt's results list is declared (s2-verily-field-of-study-open.html), so the widget
  // helpers search it; before, no ARIA named it and they refused it (widget-unsupported).
  it('searches a prompt through the results list its adapter declares, read as a search, never opened to be read',
    async () => {
      const scanned = await scanCase(document, resolveExpHtml, sourceOf(resolveExpExpect));
      const root = scanned.root;
      for (const id of ['skills--skills', 'education-71--fieldOfStudy']) {
        const input = scanned.doc.getElementById(id)!;
        const field = scanned.result.fields.find((each) => scanned.result.target(each.key)?.control === input)!;
        const target = scanned.result.target(field.key)!;
        expect(field.kind).toBe('typeahead-remote');
        expect(isActionable(target.widget!)).toBe(true);
        expect(target.widget!.queryKey).toBe('Enter');
        expect(await readWidget(target, { adapter: workdayAdapter, root })).toEqual({ status: 'read',
          reading: { kind: 'remote' } });
        expect((input as HTMLInputElement).value).toBe('');
      }
    });

  it('withholds Next while a required date shows no digits, and offers it once every required part shows its own',
    async () => {
      const fixture = await load(resolveExpHtml);
      const root = workdayAdapter.detect(fixture.doc)!.formRoot;
      expect(workdayAdapter.isFinalStep!(fixture.doc)).toBe('not-final');
      expect(workdayAdapter.nextButton!(root)).toBeNull();
      const parts = Array.from(fixture.doc.querySelectorAll<HTMLInputElement>('input[role="spinbutton"]'))
        .filter((part) => part.getAttribute('aria-required') === 'true');
      // s2 wd: a value in the hidden spin button alone is no date a person sees: its display still shows "MM".
      for (const part of parts) part.value = '1';
      expect(workdayAdapter.nextButton!(root)).toBeNull();
      // Every required part but one shows digits: still withheld.
      // resolvetech-my-experience.html: <div aria-hidden="true" id="<wrapper>-dateSectionMonth-display" ...>MM</div>
      // beside <input role="spinbutton" id="<wrapper>-dateSectionMonth-input" ...>.
      const display = (part: HTMLInputElement) => fixture.doc.getElementById(part.id.replace(/-input$/, '-display'))!;
      for (const part of parts.slice(1)) display(part).textContent = '01';
      expect(workdayAdapter.nextButton!(root)).toBeNull();
      // The last one shows its number through aria-valuenow: Next.
      parts[0]!.setAttribute('aria-valuenow', '1');
      expect(workdayAdapter.nextButton!(root)?.getAttribute('data-automation-id')).toBe('pageFooterNextButton');
    });

  it('makes each block’s “I currently work here” a box of its own, though every block names it alike', async () => {
    const scanned = await scanCase(document, webExpHtml, sourceOf(webExpExpect));
    const boxes = Array.from(scanned.doc.querySelectorAll('input[name="currentlyWorkHere"]'));
    expect(boxes).toHaveLength(2);
    const fields = boxes.map((box) => scanned.result.fields.find((each) => scanned.result.target(each.key)?.control === box));
    expect(fields.map((field) => [field?.kind, field?.section])).toEqual([['checkbox', { id: 'experience', block: 0 }],
      ['checkbox', { id: 'experience', block: 1 }]]);
    const sections = workdayAdapter.repeatables!(scanned.root);
    const experience = sections.find((section) => section.kind === 'experience')!;
    expect(experience.blocks().map((block) => experience.currentlyHere!(block))).toEqual(boxes);
  });

  it('reads an upload as confirmed once its field shows the file’s name and “Successfully Uploaded!”', async () => {
    const fixture = await load(webExpHtml);
    const root = workdayAdapter.detect(fixture.doc)!.formRoot;
    const [resume] = workdayAdapter.uploadWidgets!(root);
    expect(resume?.control.getAttribute('data-automation-id')).toBe('select-files');
    // The converter wrote REDACTED for the file's name the page showed.
    expect(workdayAdapter.uploadState!(resume!.input, 'REDACTED')).toBe('confirmed');
    expect(workdayAdapter.uploadState!(resume!.input, 'another-file.pdf')).toBe('pending');
    fixture.doc.querySelector('[data-automation-id="file-upload-successful"]')!.remove();
    expect(workdayAdapter.uploadState!(resume!.input, 'REDACTED')).toBe('pending');
  });

  // The core pass of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06's possible double upload): after "Autofill with Resume", My
  // Experience's Resume/CV shows the resume Workday read as an uploaded item while its input holds no file. The scan reads
  // such a field as holding a file before any upload is planned (Adapter.uploadHeld), so the planner keeps it.
  it('reads a field showing a file Workday took as holding one, whatever its name, so nothing is uploaded again',
    async () => {
      for (const [html, inputs] of [[webExpHtml, ['resumeAttachments', 'additionalAttachments']],
        [resolveExpHtml, ['resumeAttachments']]] as const) {
        const fixture = await load(html);
        const root = workdayAdapter.detect(fixture.doc)!.formRoot;
        // The integration of 2026-11-06 (Adapter.uploadHeldNames): each field's shown file name goes with it, as a
        // person reads it (the fixtures' names are redacted: synthetic ones, spaced as a page may space them, here).
        const shownNames = Array.from(fixture.doc.querySelectorAll('[data-automation-id="file-upload-item-name"]'));
        expect(shownNames).toHaveLength(inputs.length);
        shownNames.forEach((name, index) => { name.textContent = `  Shown   file ${index + 1}.pdf `; });
        const names = inputs.map((_, index) => [`Shown file ${index + 1}.pdf`]);
        const files = scan(root, workdayAdapter, { platform: 'workday' }).fields.filter((field) => field.kind === 'file');
        expect(files.map((field) => field.current)).toEqual(inputs.map((_, index) =>
          ({ kind: 'files', count: 1, held: true, names: names[index] })));
        for (const [index, { input }] of workdayAdapter.uploadWidgets!(root).entries()) {
          expect(input.files?.length ?? 0).toBe(0);
          expect(workdayAdapter.uploadHeld!(input)).toBe(true);
          expect(workdayAdapter.uploadHeldNames!(input)).toEqual(names[index]);
        }
        // Without the names hook a held field carries no name (the planner then replaces it as the setting says).
        expect(scan(root, { ...workdayAdapter, uploadHeldNames: undefined }, { platform: 'workday' }).fields
          .filter((field) => field.kind === 'file').map((field) => field.current))
          .toEqual(inputs.map(() => ({ kind: 'files', count: 1, held: true })));
        // Without the hook the empty inputs read empty, and a resume would be planned for them.
        const plain = scan(root, { ...workdayAdapter, uploadHeld: undefined }, { platform: 'workday' }).fields
          .filter((field) => field.kind === 'file');
        expect(plain.map((field) => field.current)).toEqual(inputs.map(() => ({ kind: 'empty' })));
        // A field that shows no upload done (its "Successfully Uploaded!" gone) holds nothing.
        for (const done of Array.from(fixture.doc.querySelectorAll('[data-automation-id="file-upload-successful"]'))) done.remove();
        expect(scan(root, workdayAdapter, { platform: 'workday' }).fields.filter((field) => field.kind === 'file')
          .map((field) => field.current)).toEqual(inputs.map(() => ({ kind: 'empty' })));
        removeFixtures(document);
      }
    });

  // The behaviour review of 2026-11-06 (M2): a drop zone's own label names no document ("Upload a file (5MB max)"); its
  // group's heading does ("Resume/CV"), read as its help text, so the core's résumé rule knows the résumé's field and the
  // person's "Résumé already on the page" setting acts on it.
  it("reads a drop zone's group heading as its help text: the résumé's field is the résumé (M2)", async () => {
    for (const [html, headings] of [[webExpHtml, ['Resume/CV', 'Additional Attachments']],
      [resolveExpHtml, ['Resume/CV']]] as const) {
      const fixture = await load(html);
      const root = workdayAdapter.detect(fixture.doc)!.formRoot;
      const files = scan(root, workdayAdapter, { platform: 'workday' }).fields.filter((field) => field.kind === 'file');
      expect(files.map((field) => [field.label, field.description])).toEqual(headings.map((heading) =>
        ['Upload a file (5MB max)', heading]));
      expect(classifyByRules(toFieldSpec(files[0]!))).toMatchObject({ category: 'file.resume' });
      // Undone: the label alone names no document.
      const plain = scan(root, { ...workdayAdapter, descriptionFor: undefined }, { platform: 'workday' }).fields
        .filter((field) => field.kind === 'file');
      expect(classifyByRules(toFieldSpec(plain[0]!))?.category ?? null).not.toBe('file.resume');
      removeFixtures(document);
    }
  });

  it('offers Review’s Submit as Submit only, never as Next, and no step before it as Submit', async () => {
    for (const [html, final] of [[reviewHtml, true], [sourceOpenHtml, false], [cisiveHtml, false]] as const) {
      const fixture = await load(html);
      const root = workdayAdapter.detect(fixture.doc)!.formRoot;
      const footer = fixture.doc.querySelector('[data-automation-id="pageFooterNextButton"]');
      expect(workdayAdapter.submitButton!(root)).toBe(final ? footer : null);
      expect(workdayAdapter.nextButton!(root)).toBe(final ? null : footer);
    }
  });

  it('reads no step where the bar disagrees: Review not on its last step, a step page on the last', async () => {
    const review = await load(reviewHtml);
    const steps = Array.from(review.doc.querySelectorAll('[data-automation-id="progressBar"] > li'));
    steps.at(-1)!.setAttribute('data-automation-id', 'progressBarInactiveStep');
    steps.at(-2)!.setAttribute('data-automation-id', 'progressBarActiveStep');
    expect(workdayAdapter.isFinalStep!(review.doc)).toBe('unknown');
    const info = await load(sourceOpenHtml);
    const bar = Array.from(info.doc.querySelectorAll('[data-automation-id="progressBar"] > li'));
    for (const step of bar) step.setAttribute('data-automation-id', 'progressBarCompletedStep');
    bar.at(-1)!.setAttribute('data-automation-id', 'progressBarActiveStep');
    expect(workdayAdapter.isFinalStep!(info.doc)).toBe('unknown');
  });

  it('gives Self Identify’s questions the disability form’s title as help text, and no other step’s', async () => {
    const scanned = await scanCase(document, selfIdHtml, sourceOf(selfIdExpect));
    const group = scanned.result.fields.find((field) => field.kind === 'checkbox-group')!;
    expect(group.label).toBe('Please check one of the boxes below');
    expect(group.description).toBe('Voluntary Self-Identification of Disability');
    const disclosures = await scanCase(document, disclosuresHtml, sourceOf(disclosuresExpect));
    expect(disclosures.result.fields.every((field) => field.description === '')).toBe(true);
  });

  it('reads the sign-in’s error above its form, and the loading panel only while a person can see it', async () => {
    const fixture = await load(verilyHtml);
    const form = fixture.doc.querySelector('form[data-automation-id="signInFormo"]')!;
    const error = fixture.doc.querySelector('[data-automation-id="errorMessage"]');
    expect(workdayAdapter.errors!(form).map((each) => each.el)).toEqual([error]);
    expect(compareHooks(fixture.doc, workdayAdapter, readHooks(verilyExpect))).toEqual([]);
    expect(workdayAdapter.isBusy!(fixture.doc)).toBe(false);
    const panel = fixture.doc.querySelector<HTMLElement>('[data-automation-id="glassPanel"]')!;
    for (let at: HTMLElement | null = panel; at !== null; at = at.parentElement) at.style.setProperty('display', 'block', 'important');
    panel.style.setProperty('visibility', 'visible', 'important');
    panel.style.setProperty('opacity', '1', 'important');
    panel.querySelector<HTMLElement>('[data-automation-id="wd-LoadingPanel"]')!.style.cssText = 'display:block;width:40px;height:40px;opacity:1;visibility:visible';
    expect(workdayAdapter.isBusy!(fixture.doc)).toBe(true);
  });
});

describe('the synthetic steps page the e2e spec runs on (fixtures/synthetic/workday/steps.html)', () => {
  it('is read as the snapshots are: its steps, its Next, its dropdown chosen through its own script, its Review', async () => {
    const fixture = await load(syntheticHtml);
    const doc = fixture.doc;
    const root = workdayAdapter.detect(doc)!.formRoot;
    expect(workdayAdapter.stepSignature!(doc)).toEqual({ heading: 'My Information', progress: 'current step 1 of 3',
      anchors: ['applyFlowMyInfoPage'] });
    expect(workdayAdapter.isFinalStep!(doc)).toBe('not-final');
    expect(workdayAdapter.nextButton!(root)?.textContent).toBe('Save and Continue');
    const readings = new Map();
    let result = scan(root, workdayAdapter, { platform: 'workday' });
    const country = doc.getElementById('country--country')!;
    let field = result.fields.find((each) => result.target(each.key)?.widget?.element === country)!;
    expect([field.label, field.kind, field.required]).toEqual(['Country', 'combobox', true]);
    expect(await readWidget(result.target(field.key)!, { adapter: workdayAdapter, root, readings })).toMatchObject({ status: 'read' });
    result = scan(root, workdayAdapter, { platform: 'workday', widgetReadings: readings });
    field = result.fields.find((each) => result.target(each.key)?.widget?.element === country)!;
    const index = Array.isArray(field.options) ? field.options.findIndex((option) => option.label === 'United States of America') : -1;
    const outcome = await fillWidget(result.target(field.key)!, { kind: 'option', index, cleanLabel: 'United States of America' },
      { adapter: workdayAdapter, root, readings });
    expect(outcome.wrote).toBe(true);
    expect(country.textContent).toBe('United States of America');
    // The rest of the step, then its Save and Continue (a person's click here): My Experience, its required date empty.
    for (const id of ['name--legalName--firstName', 'name--legalName--lastName', 'address--city', 'address--postalCode']) {
      (doc.getElementById(id) as HTMLInputElement).value = 'x';
    }
    workdayAdapter.nextButton!(root)!.click();
    expect(workdayAdapter.stepSignature!(doc).anchors).toEqual(['applyFlowMyExpPage']);
    expect(workdayAdapter.nextButton!(root)).toBeNull();
    const sections = workdayAdapter.repeatables!(root);
    expect(sections.map((section) => [section.kind, section.blocks().length, section.addButton()?.textContent])).toEqual([
      ['experience', 1, 'Add Another']]);
    // The person's date, as Workday shows it (s2 wd: each part's display), and the value the page's own check reads.
    for (const part of Array.from(doc.querySelectorAll<HTMLInputElement>('input[role="spinbutton"]'))) {
      part.value = '1';
      part.parentElement!.querySelector('[data-automation-id$="-display"]')!.textContent = '01';
    }
    for (const id of ['workExperience-61--jobTitle', 'workExperience-61--companyName']) {
      (doc.getElementById(id) as HTMLInputElement).value = 'x';
    }
    workdayAdapter.nextButton!(root)!.click();
    expect(workdayAdapter.isFinalStep!(doc)).toBe('final');
    expect(workdayAdapter.submitButton!(root)?.textContent).toBe('Submit');
    expect(workdayAdapter.nextButton!(root)).toBeNull();
  });
});
