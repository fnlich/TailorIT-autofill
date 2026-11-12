/*
 * s2 wd (snapshot round 2, 2026-11-07; the coordinator's decisions 3, 4 and 6): the Workday adapter on the owner's
 * round-2 snapshots, each rule on its own, Workday's script stood in for by a listener where a rule needs the page to
 * answer (no MHTML holds React):
 * - dates: each dateInputWrapper is one date field (Adapter.dateFor), its layout its parts' (month and year, a year
 *   alone, month, day and year), written part by part (dom/fillers/date-parts.ts): the value setter first, the
 *   declared digits where the page did not take it, read back from the displays, a day never made up, the calendar
 *   never touched, and what was not taken given back;
 * - prompts: the results list found anew where the page draws it (the popup whose data-associated-widget names the
 *   prompt), Enter after the typed query, a result chosen by a click on its label, a category row never chosen;
 * - My Experience: the section looked up again on each call, so a section Workday draws anew after an Add is read, and
 *   the add cap started again on a new document that shows fewer blocks than were counted.
 * Every value here is made up; the fixtures hold none (the converter's --redact).
 */
import { afterEach, describe, expect, it } from 'vitest';
import exelixisExpHtml from '../../../fixtures/workday/s2-exelixis-my-experience.html?raw';
import verilySourceHtml from '../../../fixtures/workday/s2-verily-source-open.html?raw';
import verilyStudyHtml from '../../../fixtures/workday/s2-verily-field-of-study-open.html?raw';
import noItemsHtml from '../../../fixtures/workday/s2-verily-school-no-items.html?raw';
import schoolResultsHtml from '../../../fixtures/workday/s2-verily-school-results.html?raw';
import afterAddHtml from '../../../fixtures/workday/s2-verily-field-of-study-after-add.html?raw';
import resolveExpHtml from '../../../fixtures/workday/resolvetech-my-experience.html?raw';
import pureErrorsHtml from '../../../fixtures/workday/s2-pureinsurance-my-experience-errors.html?raw';
import pureDegreeHtml from '../../../fixtures/workday/s2-pureinsurance-degree-open.html?raw';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { planFrame } from '../../core/plan/frame';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { toFieldSpec } from '../../dom/scan';
import { fillWidget, readWidget } from '../../dom/widgets';
import { fieldAlerts } from './application';
import selfIdHtml from '../../../fixtures/workday/danafarber-self-identify.html?raw';
import { plannedFieldOf } from '../../content/pass';
import { addBlocks, currentJobRows, sectionsOf } from '../../content/repeatables';
import { readBack } from '../../content/values';
import type { FillResult } from '../../core/types/fill';
import type { RepeatableCounter } from '../../core/types/run';
import { fill } from '../../dom/fillers';
import { fillDateParts } from '../../dom/fillers/date-parts';
import { holds } from '../../dom/fillers/verify';
import { loadFixture, logEvents, removeFixtures, untrustedViolations } from '../../dom/fixture.testkit';
import { domGuardBeforeWrite } from '../../dom/guard';
import { scan } from '../../dom/scan';
import type { FieldTarget, ScanResult } from '../../dom/types';
import { isActionable, readList, searchTypeahead, widgetListOf } from '../../dom/widgets';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { workdayAdapter } from './index';

afterEach(() => removeFixtures(document));

async function load(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = workdayAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root, scan: (adapter = workdayAdapter) => scan(root, adapter, { platform: 'workday' }) };
}

/** The field whose control (or widget's element or text box) is `el`. */
function fieldAt(result: ScanResult, el: Element): FieldTarget {
  const field = result.fields.find((each) => {
    const target = result.target(each.key);
    return target?.control === el || target?.widget?.element === el || target?.widget?.input === el;
  });
  if (field === undefined) throw new Error(`no field at #${el.id}`);
  return result.target(field.key)!;
}

// ── Dates ───────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('Workday’s date input: one date field, written part by part (s2 wd, decision 3)', () => {
  it('makes each dateInputWrapper one date field: From and To per job, its layout its parts’', async () => {
    const page = await load(exelixisExpHtml);
    const dates = page.scan().fields.filter((field) => field.kind === 'date');
    // s2-exelixis-my-experience.html: four parsed jobs, the first a current one (Workday draws no To for it).
    expect(dates.map((field) => [field.label, field.section.id, field.section.block, field.required,
      field.constraints.format, field.current.kind, field.labelVisible, field.camouflaged])).toEqual([
      ['From', 'experience', 0, true, 'month-year', 'empty', true, false],
      ['From', 'experience', 1, true, 'month-year', 'empty', true, false],
      ['To', 'experience', 1, true, 'month-year', 'empty', true, false],
      ['From', 'experience', 2, true, 'month-year', 'empty', true, false],
      ['To', 'experience', 2, true, 'month-year', 'empty', true, false],
      ['From', 'experience', 3, true, 'month-year', 'empty', true, false],
      ['To', 'experience', 3, true, 'month-year', 'empty', true, false]]);
    // The parts themselves stay hidden controls the scan ignored, as before.
    expect(page.scan().counters.hiddenControlsIgnored).toBe(page.scan({ ...workdayAdapter, dateFor: undefined })
      .counters.hiddenControlsIgnored);
    // Undone: without the hook no date is a field (the spin buttons are 1 px and scale(0.01)).
    expect(page.scan({ ...workdayAdapter, dateFor: undefined }).fields.filter((field) => field.kind === 'date')).toEqual([]);
  });

  it('reads a year alone as a year and month, day and year as a full date', async () => {
    const resolve = await load(resolveExpHtml);
    expect(resolve.scan().fields.filter((field) => field.kind === 'date').map((field) => [field.label,
      field.constraints.format])).toEqual([['From', 'month-year'], ['To', 'month-year'], ['From', 'year'],
      ['To (Actual or Expected)', 'year']]);
    removeFixtures(document);
    const selfId = await load(selfIdHtml);
    expect(selfId.scan().fields.filter((field) => field.kind === 'date').map((field) => [field.label,
      // jr6 workday-new-1: the disability form's own date reads "Date signed" (labelSuffix).
      field.constraints.format])).toEqual([['Date signed', 'date']]);
  });

  it('is required, disabled or read-only as all its parts are, where its legend draws no star', async () => {
    const page = await load(exelixisExpHtml);
    const wrapper = page.doc.getElementById('workExperience-346--startDate')!;
    const parts = Array.from(wrapper.querySelectorAll<HTMLInputElement>('input[role="spinbutton"]'));
    // Its legend's star gone: its parts' aria-required="true" still say it.
    wrapper.closest('fieldset')!.querySelector('abbr')!.remove();
    const date = () => fieldAt(page.scan(), wrapper).field;
    expect(date().required).toBe(true);
    for (const part of parts) part.setAttribute('aria-required', 'false');
    expect(date().required).toBe(false);
    // Its parts disabled, or read-only: so is it, and nothing is written.
    expect([date().disabled, date().readOnly]).toEqual([false, false]);
    for (const part of parts) part.disabled = true;
    expect(date().disabled).toBe(true);
    for (const part of parts) {
      part.disabled = false;
      part.readOnly = true;
    }
    expect(date().readOnly).toBe(true);
    expect(await fillDateParts(fieldAt(page.scan(), wrapper), '2025-04', { adapter: workdayAdapter, root: page.root }))
      .toMatchObject({ wrote: false, reason: 'disabled-or-readonly' });
  });

  /** s2-exelixis-my-experience with Workday's script stood in for: `commit` says when a part takes its digits ('input':
   *  on the value setter's input event, a microtask later as React draws; 'keys': only from typed digit keys; 'none':
   *  never). The display shows what was taken, and the spin button its aria-valuenow. The keys each part got are
   *  recorded. */
  async function withDates(commit: 'input' | 'keys' | 'none') {
    const page = await load(exelixisExpHtml);
    const doc = page.doc;
    const keys: Record<string, string[]> = {};
    const typed: Record<string, string> = {};
    const show = (input: HTMLInputElement, text: string) => {
      doc.getElementById(input.id.replace(/-input$/, '-display'))!.textContent = text;
      input.setAttribute('aria-valuenow', String(Number(text)));
    };
    doc.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      if (commit !== 'input' || !input.matches('input[role="spinbutton"]') || !/^\d+$/.test(input.value)) return;
      queueMicrotask(() => show(input, input.value));
    });
    doc.addEventListener('keydown', (event) => {
      const input = event.target as HTMLInputElement;
      if (!input.matches('input[role="spinbutton"]')) return;
      (keys[input.id] ??= []).push(event.key);
      if (commit !== 'keys' || !/^\d$/.test(event.key)) return;
      typed[input.id] = (typed[input.id] ?? '') + event.key;
      queueMicrotask(() => show(input, typed[input.id]!));
    });
    return { page, keys };
  }

  const FROM = 'workExperience-346--startDate';

  it('writes month and year with the value setter where the page takes it, and reads them back from the displays',
    async () => {
      const { page, keys } = await withDates('input');
      const log = logEvents(page.doc);
      const target = fieldAt(page.scan(), page.doc.getElementById(FROM)!);
      expect(await fillDateParts(target, '2025-04', { adapter: workdayAdapter, root: page.root }))
        .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
      expect(page.doc.getElementById(`${FROM}-dateSectionMonth-display`)!.textContent).toBe('04');
      expect(page.doc.getElementById(`${FROM}-dateSectionYear-display`)!.textContent).toBe('2025');
      // What the scan and the read-back after the settle read now.
      const after = fieldAt(page.scan(), page.doc.getElementById(FROM)!);
      expect(after.field.current).toEqual({ kind: 'text', text: '2025-04' });
      expect(readBack(after)).toEqual({ kind: 'text', text: '2025-04' });
      expect(holds(after, { kind: 'date', iso: '2025-04' }, 'text')).toBe(true);
      expect(holds(after, { kind: 'date', iso: '2025-05' }, 'text')).toBe(false);
      // Focus and focusin (jr6 ENGINE E3, WD-23), then the setter's events, on the parts: no key, no calendar.
      expect(keys).toEqual({});
      expect(log.on(`${FROM}-dateSectionMonth-input`).map((event) => event.type))
        .toEqual(['focus', 'focusin', 'input', 'change', 'focusout', 'blur']);
      expect(log.events.some((event) => event.target.includes('dateIcon') || event.type === 'click')).toBe(false);
      expect(untrustedViolations(log.events)).toEqual([]);
      // Written again: already right, nothing sent.
      const again = logEvents(page.doc);
      expect(await fillDateParts(after, '2025-04', { adapter: workdayAdapter, root: page.root }))
        .toMatchObject({ wrote: false, verification: 'verified', reason: 'already-correct' });
      expect(again.events).toEqual([]);
    });

  it('types the declared digits into a part the setter did not reach, its own value given back first', async () => {
    const { page, keys } = await withDates('keys');
    const target = fieldAt(page.scan(), page.doc.getElementById(FROM)!);
    expect(await fillDateParts(target, '2025-04', { adapter: workdayAdapter, root: page.root }))
      .toMatchObject({ wrote: true, verification: 'verified', reason: 'ok' });
    expect(keys).toEqual({ [`${FROM}-dateSectionMonth-input`]: ['0', '4'],
      [`${FROM}-dateSectionYear-input`]: ['2', '0', '2', '5'] });
    expect((page.doc.getElementById(`${FROM}-dateSectionMonth-input`) as HTMLInputElement).value).toBe('');
    expect(fieldAt(page.scan(), page.doc.getElementById(FROM)!).field.current).toEqual({ kind: 'text', text: '2025-04' });
  });

  it('gives each part its own value back where the page took nothing, and leaves the date to the person', async () => {
    const { page, keys } = await withDates('none');
    const target = fieldAt(page.scan(), page.doc.getElementById(FROM)!);
    const log = logEvents(page.doc);
    expect(await fillDateParts(target, '2025-04', { adapter: workdayAdapter, root: page.root }))
      .toEqual({ wrote: false, verification: 'not-checked', reason: 'needs-your-click', needsUserAction: true });
    // The fix of 2026-11-08: a date the page took nothing in is never left (the page would validate what it held).
    expect(log.events.filter((event) => event.type === 'focusout' || event.type === 'blur')).toEqual([]);
    expect(Array.from(page.doc.getElementById(FROM)!.querySelectorAll<HTMLInputElement>('input'))
      .map((input) => input.value)).toEqual(['', '']);
    expect(page.doc.getElementById(`${FROM}-dateSectionMonth-display`)!.textContent).toBe('MM');
    expect(Object.keys(keys).sort()).toEqual([`${FROM}-dateSectionMonth-input`, `${FROM}-dateSectionYear-input`]);
    // Without the declared digits, no key at all.
    removeFixtures(document);
    const plain = await withDates('none');
    const undeclared = fieldAt(plain.page.scan({ ...workdayAdapter, dateFor: (el) => {
      const declared = workdayAdapter.dateFor!(el);
      return declared === null ? null : { parts: declared.parts, snapshot: declared.snapshot };
    } }), plain.page.doc.getElementById(FROM)!);
    expect(undeclared.dateParts?.digits).toBe(false);
    expect(await fillDateParts(undeclared, '2025-04', { adapter: workdayAdapter, root: plain.page.root }))
      .toMatchObject({ wrote: false, reason: 'needs-your-click' });
    expect(plain.keys).toEqual({});
    // The setter's write the page did not take is given back: each part holds what it held.
    expect(Array.from(plain.page.doc.getElementById(FROM)!.querySelectorAll<HTMLInputElement>('input'))
      .map((input) => input.value)).toEqual(['', '']);
  });

  it('writes the From of a block Add drew, read back as Workday shows a typed date (snapshot4)', async () => {
    // s2-verily-field-of-study-after-add: Work Experience 1 after Add. The owner's capture of a typed From (shapes
    // only, its digits redacted) shows the month's display zero-padded ("04"), its spin button's value, aria-valuenow
    // and aria-valuetext the number ("4"), the year's all four digits, and the help "current value is 4/2025".
    const page = await load(afterAddHtml);
    const doc = page.doc;
    doc.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      if (!input.matches('input[role="spinbutton"]') || !/^\d+$/.test(input.value)) return;
      queueMicrotask(() => {
        const number = String(Number(input.value));
        const year = input.getAttribute('aria-label') === 'Year';
        doc.getElementById(input.id.replace(/-input$/, '-display'))!.textContent = year ? number : number.padStart(2, '0');
        for (const name of ['aria-valuenow', 'aria-valuetext']) input.setAttribute(name, number);
        input.value = number;
      });
    });
    const wrapper = doc.getElementById('workExperience-7--startDate')!;
    const target = fieldAt(page.scan(), wrapper);
    expect([target.field.label, target.field.section, target.field.required]).toEqual(['From',
      { id: 'experience', block: 0 }, true]);
    expect(await fillDateParts(target, '2025-04', { adapter: workdayAdapter, root: page.root }))
      .toMatchObject({ wrote: true, verification: 'verified', reason: 'ok' });
    expect(Array.from(wrapper.querySelectorAll<HTMLInputElement>('input'), (input) => input.value)).toEqual(['4', '2025']);
    expect(fieldAt(page.scan(), wrapper).field.current).toEqual({ kind: 'text', text: '2025-04' });
  });

  it('never makes up a day: a month and a year go into no month, day and year input', async () => {
    const page = await load(selfIdHtml);
    const log = logEvents(page.doc);
    const target = fieldAt(page.scan(), page.doc.getElementById('selfIdentifiedDisabilityData--dateSignedOn')!);
    expect(await fillDateParts(target, '2025-04', { adapter: workdayAdapter, root: page.root }))
      .toMatchObject({ wrote: false, reason: 'format-unsupported' });
    expect(log.events).toEqual([]);
  });

  it('passes the DOM guard as its parts, and is written by the pass, not the native date filler', async () => {
    const { page } = await withDates('input');
    const result = page.scan();
    const target = fieldAt(result, page.doc.getElementById(FROM)!);
    // The wrapper is no native control: its parts are what the guard asks about (s2 wd), so it is no auth field.
    const verdict = domGuardBeforeWrite(result, plannedFieldOf(target.field));
    expect(verdict.ok).toBe(true);
    // The native fillers refuse it: it is date-parts.ts's, which content/pass.ts awaits.
    expect(fill(target, { kind: 'date', iso: '2025-04' }, { adapter: workdayAdapter, root: page.root }))
      .toMatchObject({ wrote: false, reason: 'widget-unsupported' });
  });

  it('reads a current job’s To drawn in parts by its displays, when the run leaves it (planCurrentJob)', async () => {
    // resolvetech-my-experience.html: one job, its From and To, "I currently work here" beside them.
    const page = await load(resolveExpHtml);
    const [section] = sectionsOf(workdayAdapter, page.root).filter((each) => each.kind === 'experience');
    section!.currentlyHere!(section!.blocks()[0]!)!.checked = true;
    const rowsOf = (result: ScanResult) => {
      const to = fieldAt(result, page.doc.getElementById('workExperience-62--endDate')!);
      const row = { key: to.field.key, section: 'experience[0]', category: 'experience.endDate', label: 'To',
        status: 'skipped', reason: 'end-date-not-applicable', wrote: false, needsUserAction: false } as unknown as FillResult;
      return { key: row.key, out: currentJobRows(new Map([[row.key, row]]), result, section!,
        { kind: 'experience', profile: 1, entries: [0], current: [true] }) };
    };
    // Empty (its displays "MM" and "YYYY"), required: the person's to leave empty, flagged.
    const empty = rowsOf(page.scan());
    expect(empty.out.get(empty.key)).toMatchObject({ status: 'flagged', reason: 'end-date-not-applicable' });
    // Its displays show a date the page holds: kept, and the conflict flagged.
    page.doc.getElementById('workExperience-62--endDate-dateSectionMonth-display')!.textContent = '03';
    page.doc.getElementById('workExperience-62--endDate-dateSectionYear-display')!.textContent = '2024';
    const filled = rowsOf(page.scan());
    expect(filled.out.get(filled.key)).toMatchObject({ status: 'flagged', reason: 'prefill-conflict' });
  });
});

// ── Prompts ─────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('Workday’s prompts: searched through their declared results list, Enter after each query (s2 wd, decision 4)',
  () => {
    /** s2-verily-field-of-study-open with Workday's script stood in for: the Field of Study popup closed, and drawn
     *  again (its rows from the top) only on an Enter keydown in its box after typed text; the box's typed text drawn a
     *  microtask after the input event, as React draws it; a click on a row's label part chooses it: its pill shown in
     *  the prompt, the popup gone, the box emptied. `answersEnter` false: Enter does nothing. */
    async function withPrompt(html: string, input: string, answersEnter = true) {
      const page = await load(html);
      const doc = page.doc;
      const box = doc.getElementById(input) as HTMLInputElement;
      const container = box.closest('[data-automation-id="multiSelectContainer"]')!;
      const prompt = Array.from(doc.querySelectorAll('[data-automation-id="responsiveMonikerPrompt"]'))
        .find((each) => each.getAttribute('data-associated-widget') === container.id)!;
      const popup = prompt.closest('[data-popper-placement]')!;
      const listbox = prompt.querySelector<HTMLElement>('[data-automation-id="activeListContainer"]')!;
      const rows = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
      rows.forEach((row, at) => { row.style.top = `${at * 32}px`; });
      const inner = listbox.firstElementChild as HTMLElement;
      inner.style.height = `${rows.length * 32}px`;
      inner.style.maxHeight = `${rows.length * 32}px`;
      popup.remove();
      const events: string[] = [];
      box.addEventListener('input', () => queueMicrotask(() => box.setAttribute('data-typed', box.value)));
      box.addEventListener('keydown', (event) => {
        events.push(`keydown:${event.key}`);
        if (event.key === 'Enter' && answersEnter && box.value !== '') doc.body.append(popup);
      });
      doc.addEventListener('click', (event) => {
        const target = event.target as Element;
        const row = target.closest('[role="option"][data-automation-id="menuItem"]');
        if (row === null || !popup.contains(row)) return;
        events.push(`click:${target.getAttribute('data-automation-id') ?? target.localName}`);
        const label = row.querySelector('[data-automation-id="promptOption"]')!.textContent!.trim();
        // The pill, as s2-verily-my-information.html draws one: ul[data-automation-id=selectedItemList] > li >
        // div[role=option][data-automation-id=selectedItem] > p[data-automation-id=promptOption].
        const make = (tag: string, attributes: Record<string, string>, ...children: Array<Node | string>) => {
          const el = doc.createElement(tag);
          for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
          el.append(...children);
          return el;
        };
        const list = make('ul', { 'data-automation-id': 'selectedItemList' }, make('li', { role: 'presentation' },
          make('div', { role: 'option', 'data-automation-id': 'selectedItem' },
            make('p', { 'data-automation-id': 'promptOption' }, label))));
        container.querySelector('[data-automation-id="multiselectInputContainer"]')!.append(list);
        popup.remove();
        box.value = '';
      });
      return { page, box, listbox, rows, events };
    }

    function hooksFor(page: Awaited<ReturnType<typeof load>>, box: HTMLInputElement, wanted: (label: string) => boolean) {
      return {
        guard: async () => ({ ok: true as const, target: fieldAt(page.scan(), box) }),
        match: async (results: ReadonlyArray<{ label: string; disabled: boolean }>) => {
          const index = results.findIndex((result) => wanted(result.label));
          return index < 0 ? { choose: null, reason: 'no-match' as const, blocked: false }
            : { choose: { index, cleanLabel: results[index]!.label } };
        },
      };
    }

    it('finds its results list anew where the page draws it, and reads each row by its label', async () => {
      const { page, box, listbox, rows } = await withPrompt(verilyStudyHtml, 'education-6--fieldOfStudy');
      const widget = fieldAt(page.scan(), box).widget!;
      expect(isActionable(widget)).toBe(true);
      // Closed: no list. Drawn: the popup the prompt's container names, found by the declared hook.
      expect(widgetListOf(widget)).toBeNull();
      page.doc.body.append(listbox.closest('[data-popper-placement]')!);
      expect(widgetListOf(widget)).toBe(listbox);
      const read = await readList(listbox, { labelOf: widget.optionLabel, option: widget.results!.option,
        unchoosable: widget.results!.unchoosable });
      expect(read.options.map((option) => option.label)).toEqual(rows.map((row) =>
        row.querySelector('[data-automation-id="promptOption"]')!.textContent!.trim()));
      expect(read.options.every((option) => !option.disabled)).toBe(true);
    });

    it('types a query, sends Enter to its box, and chooses the matching result by a click on its label', async () => {
      const { page, box, rows, events } = await withPrompt(verilyStudyHtml, 'education-6--fieldOfStudy');
      const wanted = rows[1]!.querySelector('[data-automation-id="promptOption"]')!.textContent!.trim();
      const log = logEvents(page.doc);
      const result = await searchTypeahead(fieldAt(page.scan(), box), [wanted], { adapter: workdayAdapter, root: page.root },
        hooksFor(page, box, (label) => label === wanted));
      expect(result).toMatchObject({ verified: true, reason: 'ok', typed: 1 });
      expect(result.chosen?.cleanLabel).toBe(wanted);
      expect(events).toEqual(['keydown:Enter', 'click:promptOption']);
      expect(fieldAt(page.scan(), box).field.current).toEqual({ kind: 'selected', labels: [wanted] });
      // Enter only to its own box, as a keydown and a keyup, untrusted.
      expect(log.events.filter((event) => event.type === 'keydown' || event.type === 'keyup')
        .map((event) => [event.type, event.target, event.trusted])).toEqual([['keydown', box.id, false],
        ['keyup', box.id, false]]);
      expect(untrustedViolations(log.events)).toEqual([]);
    });

    it('sends no Enter to a page that did not answer the typed text, and stops there (needs-your-click)', async () => {
      const { page, box } = await withPrompt(verilyStudyHtml, 'education-6--fieldOfStudy');
      // The page's script is not there: typing changes nothing in the page (the box without its listeners).
      const still = box.cloneNode(true) as HTMLInputElement;
      box.replaceWith(still);
      const log = logEvents(page.doc);
      const result = await searchTypeahead(fieldAt(page.scan(), still), ['Fixture Studies'],
        { adapter: workdayAdapter, root: page.root }, hooksFor(page, still, () => true));
      expect(result).toMatchObject({ chosen: null, reason: 'needs-your-click' });
      expect(log.events.filter((event) => event.type === 'keydown' || event.type === 'keyup')).toEqual([]);
    });

    it('never chooses a row that only opens a list of its own (a category)', async () => {
      // s2-verily-source-open: "How Did You Hear About Us?", four categories, each a chevron and no radio.
      const { page, box, listbox, rows, events } = await withPrompt(verilySourceHtml, 'source--source');
      expect(rows).toHaveLength(4);
      const widget = fieldAt(page.scan(), box).widget!;
      page.doc.body.append(listbox.closest('[data-popper-placement]')!);
      const read = await readList(listbox, { labelOf: widget.optionLabel, option: widget.results!.option,
        unchoosable: widget.results!.unchoosable });
      expect(read.options.map((option) => option.disabled)).toEqual([true, true, true, true]);
      listbox.closest('[data-popper-placement]')!.remove();
      // A match that names one is never clicked.
      const result = await searchTypeahead(fieldAt(page.scan(), box), ['Fixture Board'],
        { adapter: workdayAdapter, root: page.root }, hooksFor(page, box, () => true));
      expect(result.chosen).toBeNull();
      expect(events.filter((event) => event.startsWith('click'))).toEqual([]);
    });

    // snapshot4 (2026-11-07 evening): the owner's captures of a search Workday answered.
    it('reads the list’s own “No Items.” row as no answer, and chooses nothing there', async () => {
      // s2-verily-school-no-items: School opened with nothing typed, one row "No Items." of type 2 and no radio.
      const { page, box, listbox, rows, events } = await withPrompt(noItemsHtml, 'education-6--school');
      expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['No Items.']);
      const widget = fieldAt(page.scan(), box).widget!;
      page.doc.body.append(listbox.closest('[data-popper-placement]')!);
      const read = await readList(listbox, { labelOf: widget.optionLabel, option: widget.results!.option,
        unchoosable: widget.results!.unchoosable });
      expect(read.options).toEqual([expect.objectContaining({ label: 'No Items.', disabled: true })]);
      listbox.closest('[data-popper-placement]')!.remove();
      // The worker's match never takes a result that cannot be chosen; here the test's own takes any other.
      const result = await searchTypeahead(fieldAt(page.scan(), box), ['Fixture University'],
        { adapter: workdayAdapter, root: page.root }, {
          guard: async () => ({ ok: true as const, target: fieldAt(page.scan(), box) }),
          match: async (results) => {
            const index = results.findIndex((each) => !each.disabled);
            return index < 0 ? { choose: null, reason: 'no-match' as const, blocked: false }
              : { choose: { index, cleanLabel: results[index]!.label } };
          },
        });
      expect(result).toMatchObject({ chosen: null, reason: 'no-match', typed: 1 });
      expect(events).toEqual(['keydown:Enter']);
    });

    it('chooses among the search results Workday lists under its “Search Results” header', async () => {
      // s2-verily-school-results: School's search results (data-uxi-multiselectlist-issearch="true", "Search Results
      // (17)", 13 rows drawn, each a radio leaf of type 1), their words redacted by the converter: made-up ones here.
      const { page, box, listbox, rows, events } = await withPrompt(schoolResultsHtml, 'education-6--school');
      const list = listbox.closest('[data-uxi-widget-type="multiselectlist"]')!;
      expect(list.getAttribute('data-uxi-multiselectlist-issearch')).toBe('true');
      expect(listbox.closest('[data-automation-id="responsiveMonikerPrompt"]')!
        .querySelector('[data-automation-id="promptTitle"]')!.getAttribute('title')).toBe('Search Results');
      expect(rows).toHaveLength(13);
      rows.forEach((row, at) => {
        row.querySelector('[data-automation-id="promptOption"]')!.textContent = `Fixture University ${at + 1}`;
        row.setAttribute('aria-label', `Fixture University ${at + 1} not checked`);
      });
      const result = await searchTypeahead(fieldAt(page.scan(), box), ['Fixture University 4'],
        { adapter: workdayAdapter, root: page.root }, hooksFor(page, box, (label) => label === 'Fixture University 4'));
      expect(result).toMatchObject({ verified: true, reason: 'ok', typed: 1 });
      expect(result.chosen?.index).toBe(3);
      expect(events).toEqual(['keydown:Enter', 'click:promptOption']);
      expect(fieldAt(page.scan(), box).field.current).toEqual({ kind: 'selected', labels: ['Fixture University 4'] });
    });
  });

// ── My Experience ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('Workday’s My Experience: every job added, a section drawn anew read again (s2 wd, decision 6)', () => {
  /** s2-verily-field-of-study-open's Work Experience (no block, its "Add") with Workday's script stood in for: each
   *  Add's click adds a block, drawn in place, or (`redraw`) in a whole new section put in the old one's place. */
  async function withSection(redraw: boolean) {
    const page = await load(verilyStudyHtml);
    const doc = page.doc;
    let added = 0;
    doc.addEventListener('click', (event) => {
      const add = (event.target as Element).closest('button[data-automation-id="add-button"]');
      const section = add?.closest('[role="group"][aria-labelledby="Work-Experience-section"]') ?? null;
      if (add === null || section === null) return;
      added += 1;
      const into = redraw ? section.cloneNode(true) as Element : section;
      const button = into.querySelector('button[data-automation-id="add-button"]')!;
      // A block as s2-exelixis-my-experience.html draws one: div[role=group][aria-labelledby=Work-Experience-<n>-panel]
      // > div > h5#Work-Experience-<n>-panel.
      const block = doc.createElement('div');
      block.setAttribute('role', 'group');
      block.setAttribute('aria-labelledby', `Work-Experience-${added}-panel`);
      const heading = doc.createElement('h5');
      heading.id = `Work-Experience-${added}-panel`;
      heading.textContent = `Work Experience ${added}`;
      block.append(doc.createElement('div'));
      block.firstElementChild!.append(heading);
      button.closest('[role="group"] > div')!.before(block);
      button.textContent = 'Add Another';
      if (redraw) section.replaceWith(into);
    });
    return page;
  }

  function env(page: Awaited<ReturnType<typeof load>>, prior: RepeatableCounter | null) {
    const counters: RepeatableCounter[] = [];
    return { counters, env: { adapter: workdayAdapter, root: page.root, signal: new AbortController().signal,
      settle: { quietMs: 50, capMs: 1_000 }, profile: new Map([['experience', 3] as const]),
      prior: () => counters.at(-1) ?? prior, record: async (_: unknown, counter: RepeatableCounter) => {
        counters.push(counter);
      }, stopped: () => false } };
  }

  it.each([false, true])('adds a block per entry, the section drawn anew after each Add or not (redraw %s)', async (redraw) => {
    const page = await withSection(redraw);
    const sections = sectionsOf(workdayAdapter, page.root).filter((section) => section.kind === 'experience');
    const { env: addEnv } = env(page, null);
    const [outcome] = await addBlocks(addEnv, sections);
    expect(outcome).toMatchObject({ clicks: 3, stop: 'complete', missing: 0 });
    expect(sections[0]!.blocks()).toHaveLength(3);
  });

  it('adds again on a new document that shows fewer blocks than were counted, never past the profile', async () => {
    const page = await withSection(false);
    const sections = sectionsOf(workdayAdapter, page.root).filter((section) => section.kind === 'experience');
    // The run counted three clicks and three blocks on this step before the page was loaded again, empty.
    const earlier = { profile: 3, rendered: 3, addClicks: 3 };
    const [first] = await addBlocks(env(page, earlier).env, sections);
    expect(first).toMatchObject({ clicks: 3, stop: 'complete' });
    // In the same document a later plan keeps the cap: the blocks it shows are the run's.
    for (const block of sections[0]!.blocks()) block.remove();
    const [second] = await addBlocks(env(page, earlier).env, sections);
    expect(second).toMatchObject({ clicks: 0, stop: 'add-cap' });
  });
});

// ── The fix of 2026-11-08 (snapshot5) ───────────────────────────────────────────────────────────────────────────────

describe('snapshot5: Workday’s dates left only once written, its field alerts, and its Degree (the fix of 2026-11-08)', () => {
  const PURE_FROM = 'workExperience-5--startDate';

  /** s2-pureinsurance-my-experience-errors, its alerts and its "Errors Found" summary taken away (the page before the
   *  fill), with Workday's date script stood in for as snapshot5 shows it behaves: a part draws its digits as its input
   *  event comes; leaving a part (its focusout) validates the date its parts show then, and a date shown in part
   *  ("09" and "YYYY") gets the field's alert, "Error: Invalid Date: MM/", which that part's own next leave with the
   *  whole date drawn takes away (the capture: every date written showed its month-only alert though its year was in). */
  async function withValidation() {
    const page = await load(pureErrorsHtml);
    const doc = page.doc;
    for (const alert of Array.from(doc.querySelectorAll('[data-automation-id="inputAlert"]'))) alert.parentElement!.remove();
    doc.querySelector('[data-automation-id="errorHeading"]')!.closest('div[id]')!.remove();
    const alerts = new Map<string, Element>();
    const events: string[] = [];
    doc.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      if (!input.matches('input[role="spinbutton"]') || !/^\d+$/.test(input.value)) return;
      events.push(`input:${input.getAttribute('aria-label')}`);
      doc.getElementById(input.id.replace(/-input$/, '-display'))!.textContent = input.value;
      input.setAttribute('aria-valuenow', String(Number(input.value)));
    });
    doc.addEventListener('focusout', (event) => {
      const input = event.target as HTMLInputElement;
      if (!input.matches('input[role="spinbutton"]')) return;
      events.push(`leave:${input.getAttribute('aria-label')}`);
      const wrapper = input.closest('[data-automation-id="dateInputWrapper"]')!;
      const shown = Array.from(wrapper.querySelectorAll('[data-automation-id$="-display"]'), (display) => display.textContent ?? '');
      const digits = shown.filter((text) => /^\d+$/.test(text)).length;
      if (digits === shown.length) {
        alerts.get(input.id)?.remove();
        alerts.delete(input.id);
      } else if (digits > 0 && !alerts.has(input.id)) {
        // snapshot5: <p id="error1-<field>" data-automation-id="inputAlert"><span>Error: </span>Invalid Date: MM/</p>.
        const alert = doc.createElement('p');
        alert.setAttribute('data-automation-id', 'inputAlert');
        alert.textContent = `Error: Invalid Date: ${shown[0]}/`;
        wrapper.closest('fieldset')!.append(alert);
        alerts.set(input.id, alert);
      }
    });
    return { page, events };
  }

  it('writes every part before leaving the date, so Workday validates it whole and shows no "Invalid Date"', async () => {
    const { page, events } = await withValidation();
    const target = fieldAt(page.scan(), page.doc.getElementById(PURE_FROM)!);
    expect(await fillDateParts(target, '2023-09', { adapter: workdayAdapter, root: page.root }))
      .toMatchObject({ wrote: true, verification: 'verified', reason: 'ok' });
    // Both parts written, then the date left: never a leave between the month and the year.
    expect(events).toEqual(['input:Month', 'input:Year', 'leave:Month', 'leave:Year']);
    expect(fieldAlerts(page.root)).toEqual([]);
    expect(fieldAt(page.scan(), page.doc.getElementById(PURE_FROM)!).field.current).toEqual({ kind: 'text', text: '2023-09' });
  });

  it('leaves once more a date that holds the planned value but shows its alert, so Workday validates it whole', async () => {
    // The owner's page as snapshot5 shows it: the date whole (here made up), its month-only alert still under it.
    const page = await load(pureErrorsHtml);
    const doc = page.doc;
    for (const [part, digits] of [['Month', '09'], ['Year', '2023']] as const) {
      doc.getElementById(`${PURE_FROM}-dateSection${part}-display`)!.textContent = digits;
      doc.getElementById(`${PURE_FROM}-dateSection${part}-input`)!.setAttribute('aria-valuenow', String(Number(digits)));
    }
    const field = doc.getElementById(PURE_FROM)!.closest('[data-automation-id^="formField-"]')!;
    const leaves: string[] = [];
    // Workday's validation stood in for: leaving a part of a whole date takes its field's alert away.
    doc.addEventListener('focusout', (event) => {
      const input = event.target as Element;
      if (!field.contains(input)) return;
      leaves.push(input.getAttribute('aria-label') ?? '');
      field.querySelector('[data-automation-id="inputAlert"]')?.remove();
    });
    const target = fieldAt(page.scan(), doc.getElementById(PURE_FROM)!);
    expect(target.dateParts?.alert?.()).not.toBeNull();
    expect(await fillDateParts(target, '2023-09', { adapter: workdayAdapter, root: page.root }))
      .toMatchObject({ wrote: false, verification: 'verified', reason: 'already-correct' });
    expect(leaves).toEqual(['Month', 'Year']);
    expect(target.dateParts?.alert?.()).toBeNull();
    // A whole date with no alert is not touched.
    leaves.length = 0;
    await fillDateParts(fieldAt(page.scan(), doc.getElementById(PURE_FROM)!), '2023-09',
      { adapter: workdayAdapter, root: page.root });
    expect(leaves).toEqual([]);
  });

  it('reads each field’s alert as the page’s errors, its digits never kept', async () => {
    const page = await load(pureErrorsHtml);
    // The capture: six dates' "Invalid Date" alerts and Degree's "required", listed in the "Errors Found" summary too.
    const alerts = fieldAlerts(page.root);
    expect(alerts.map((alert) => [alert.closest('[data-automation-id^="formField-"]')!.getAttribute('data-automation-id'),
      alert.textContent!.replace(/\s+/g, ' ').trim()])).toEqual([
      ...Array.from({ length: 3 }, () => [['formField-startDate', 'Error: Invalid Date: REDACTED/'],
        ['formField-endDate', 'Error: Invalid Date: REDACTED/']]).flat(),
      ['formField-degree', 'Error: The field Degree is required and must have a value.']]);
    const errors = workdayAdapter.errors!(page.root).map((error) => error.el);
    for (const alert of alerts) expect(errors).toContain(alert);
    // A field's alert a person cannot see is none.
    (alerts[0] as HTMLElement).style.display = 'none';
    expect(fieldAlerts(page.root)).toHaveLength(alerts.length - 1);
  });

  it('reads the Degree list pureinsurance shows and chooses the profile’s degree there by its click', async () => {
    // s2-pureinsurance-degree-open: the Degree dropdown open, 13 degrees after "Select One"; Workday's script stood in
    // for: the button's click opens and closes the list, an option's click chooses it and takes the field's alert away.
    const page = await load(pureDegreeHtml);
    const doc = page.doc;
    const button = doc.getElementById('education-65--degree')!;
    const list = doc.querySelector('ul[role="listbox"]#sy8s1d')!;
    const popup = list.closest('[data-popper-placement]')!;
    const close = () => {
      popup.remove();
      button.removeAttribute('aria-expanded');
      button.removeAttribute('aria-controls');
    };
    close();
    const clicks: string[] = [];
    doc.addEventListener('click', (event) => {
      const option = (event.target as Element).closest('[role="option"]');
      if (option !== null && list.contains(option)) {
        clicks.push(`option:${option.textContent!.trim()}`);
        button.textContent = option.textContent!.trim();
        button.setAttribute('value', option.getAttribute('data-value')!);
        button.removeAttribute('aria-invalid');
        button.closest('[data-automation-id="formField-degree"]')!.querySelector('[data-automation-id="inputAlert"]')?.remove();
        close();
        return;
      }
      if ((event.target as Element).closest('#education-65--degree') === null) return;
      clicks.push('button');
      if (popup.isConnected) close();
      else {
        doc.body.append(popup);
        button.setAttribute('aria-expanded', 'true');
        button.setAttribute('aria-controls', 'sy8s1d');
      }
    });
    const readings = new Map();
    const degreeOf = (result: ScanResult) => fieldAt(result, button);
    const read = await readWidget(degreeOf(page.scan()), { adapter: workdayAdapter, root: page.root, readings });
    expect(read).toMatchObject({ status: 'read', reading: { kind: 'options', complete: true } });
    const result = scan(page.root, workdayAdapter, { platform: 'workday', widgetReadings: readings });
    const specs = result.fields.map(toFieldSpec);
    // The golden profile's degree, a B.S. (its school 2015-2019).
    const output = planFrame({ specs, canaries: [], profile: goldenProfile(), sensitiveState: 'loaded', savedAnswers: [],
      settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
      repeatables: [{ kind: 'experience', entries: null }, { kind: 'education', entries: null }] });
    const degree = degreeOf(result);
    const write = output.writes.find((each) => each.key === degree.field.key)!;
    expect(write.value).toMatchObject({ kind: 'option', cleanLabel: 'Bachelor of Science (B.S)' });
    const outcome = await fillWidget(degree, write.value, { adapter: workdayAdapter, root: page.root, readings },
      write.origin);
    expect(outcome).toMatchObject({ wrote: true, verification: 'verified' });
    expect(clicks.at(-1)).toBe('option:Bachelor of Science (B.S)');
    expect(degreeOf(scan(page.root, workdayAdapter, { platform: 'workday', widgetReadings: readings })).field.current)
      .toEqual({ kind: 'selected', labels: ['Bachelor of Science (B.S)'] });
  });
});
