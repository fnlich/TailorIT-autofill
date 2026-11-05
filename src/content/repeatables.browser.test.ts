/*
 * repeatables.ts on its own, in a real layout engine: the Add clicks from counts (planAdd), each counted before it is
 * made and only when assertNotSubmit allows it; "I currently work here"'s rows after the loop (planCurrentJob); and the
 * order of a block's box and end date. The whole step, through the runtime, is steps.browser.test.ts's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter } from '../adapters/types';
import { genericAdapter } from '../adapters/generic';
import type { RepeatableAnswer } from '../core/steps/blocks';
import type { FieldKey } from '../core/types/field';
import type { FillResult, PlannedWrite } from '../core/types/fill';
import type { RepeatableCounter, RepeatableKind } from '../core/types/run';
import { loadFixture, logEvents, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import { deadline } from '../dom/time';
import {
  addBlocks, boxBeforeEndDate, currentJobRows, filesAfterTheRest, needsClicks, rowsReadyToSave, sectionsOf, type AddEnv,
} from './repeatables';

afterEach(() => removeFixtures(document));

/** A page of positions: `blocks` shown, an Add of `addButton`'s markup that adds one on any click (or ignores
 *  untrusted ones with `ignoreUntrusted`). */
function positions(blocks: number, options: { addButton?: string; ignoreUntrusted?: boolean; inForm?: boolean } = {}) {
  const block = (index: number) => `<div class="block" data-block="${index}"><label for="company-${index}">Company</label>
    <input id="company-${index}"><label for="end-${index}">End date</label><input id="end-${index}" type="month">
    <label><input type="checkbox" id="current-${index}" data-current> I currently work here</label></div>`;
  const add = options.addButton ?? '<button type="button" id="add">Add another position</button>';
  const body = `<h2>Experience</h2><div id="blocks">${Array.from({ length: blocks }, (_, i) => block(i)).join('')}</div>${add}`;
  return `<!doctype html><body style="margin:0;font:16px sans-serif">${options.inForm === false ? `<div id="root">${body}</div>`
    : `<form id="root" action="/__submitted">${body}</form>`}
    <script>const add = document.getElementById('add'); const blocks = document.getElementById('blocks');
    add.addEventListener('click', (event) => { event.preventDefault(); if (${options.ignoreUntrusted === true} && !event.isTrusted) return;
      const n = blocks.children.length; const div = document.createElement('div'); div.className = 'block';
      div.dataset.block = String(n); div.innerHTML = '<label for="company-' + n + '">Company</label><input id="company-' + n + '">';
      blocks.append(div); });</script></body>`;
}

/** The generic adapter with the page's one experience section. */
const adapterOf = (): Adapter => ({
  ...genericAdapter,
  repeatables: (root) => [{ kind: 'experience', blocks: () => Array.from(root.querySelectorAll('#blocks > .block')),
    addButton: () => root.querySelector<HTMLElement>('#add'),
    currentlyHere: (block) => block.querySelector<HTMLInputElement>('input[data-current]') }],
});

/** An add environment over the page, its counters kept here as RunState would keep them. */
function envOf(fixture: Fixture, profile: number, prior: RepeatableCounter | null = null) {
  const root = fixture.doc.getElementById('root')!;
  const adapter = adapterOf();
  const stored: RepeatableCounter[] = [];
  let counter = prior;
  const env: AddEnv = { adapter, root, signal: new AbortController().signal, settle: { quietMs: 40 },
    profile: new Map<RepeatableKind, number>([['experience', profile]]), prior: () => counter,
    record: async (_kind, next) => {
      stored.push(next);
      counter = next;
    }, stopped: () => false };
  return { env, root, adapter, stored, sections: sectionsOf(adapter, root) };
}

describe('addBlocks: one Add click at a time, from counts', () => {
  it('clicks until every entry has a block, counting each click before it is made', async () => {
    const fixture = await loadFixture(document, positions(1));
    const log = logEvents(fixture.doc);
    const { env, sections, stored } = envOf(fixture, 3);
    const outcomes = await addBlocks(env, sections);
    expect(outcomes).toEqual([{ kind: 'experience', counter: { profile: 3, rendered: 3, addClicks: 2 }, clicks: 2,
      stop: 'complete', missing: 0, opened: sections[0]!.blocks().slice(1) }]);
    expect(outcomes[0]!.opened).toHaveLength(2);
    // Before each click, then the end: the clicks never pass the profile's count.
    expect(stored).toEqual([{ profile: 3, rendered: 1, addClicks: 1 }, { profile: 3, rendered: 2, addClicks: 2 },
      { profile: 3, rendered: 3, addClicks: 2 }]);
    expect(log.on('add').map((event) => [event.type, event.trusted])).toEqual([['click', false], ['click', false]]);
    expect(needsClicks(outcomes)).toBe(0);
  });

  it('stops when a click adds no block: the person adds the rest', async () => {
    const fixture = await loadFixture(document, positions(1, { ignoreUntrusted: true }));
    const { env, sections } = envOf(fixture, 2);
    const outcomes = await addBlocks(env, sections);
    expect(outcomes).toEqual([{ kind: 'experience', counter: { profile: 2, rendered: 1, addClicks: 1 }, clicks: 1,
      stop: 'add-ignored', missing: 1, opened: [] }]);
    expect(needsClicks(outcomes)).toBe(1);
  });

  it('never clicks a typeless button inside a form, and does not count the click it never made', async () => {
    const fixture = await loadFixture(document, positions(0, { addButton: '<button id="add">Add position</button>' }));
    const log = logEvents(fixture.doc);
    const { env, sections, stored } = envOf(fixture, 1);
    const outcomes = await addBlocks(env, sections);
    expect(outcomes).toEqual([{ kind: 'experience', counter: { profile: 1, rendered: 0, addClicks: 0 }, clicks: 0,
      stop: 'add-refused', missing: 1, opened: [] }]);
    expect(stored).toEqual([{ profile: 1, rendered: 0, addClicks: 0 }]);
    expect(log.events).toEqual([]);
    expect(needsClicks(outcomes)).toBe(1);
  });

  it('never clicks past the clicks a reload already counted, nor an Add that is hidden', async () => {
    const reloaded = await loadFixture(document, positions(1));
    const again = envOf(reloaded, 2, { profile: 2, rendered: 1, addClicks: 2 });
    expect(await addBlocks(again.env, again.sections)).toMatchObject([{ stop: 'add-cap', clicks: 0, missing: 1 }]);
    removeFixtures(document);
    const hidden = await loadFixture(document, positions(1, { addButton:
      '<button type="button" id="add" style="display:none">Add another position</button>' }));
    const unseen = envOf(hidden, 2);
    expect(await addBlocks(unseen.env, unseen.sections)).toMatchObject([{ stop: 'no-add-button', clicks: 0, missing: 1 }]);
  });

  it('adds nothing for a section the worker counted no entries for', async () => {
    const fixture = await loadFixture(document, positions(2));
    const { env, sections } = envOf(fixture, 0);
    expect(await addBlocks(env, sections)).toMatchObject([{ stop: 'complete', clicks: 0, missing: 0 }]);
  });
});

describe('the Add button is checked at its click (the Phase 5 review, X-S3 and X-S7)', () => {
  /** An add environment whose record (runstate/put, a round trip to the worker) lets the page act meanwhile. */
  function racing(fixture: Fixture, meanwhile: (add: HTMLElement) => void) {
    const { env, sections, stored } = envOf(fixture, 2);
    const add = fixture.doc.getElementById('add')!;
    const record = env.record;
    env.record = async (kind, next) => {
      await record(kind, next);
      await deadline(5);
      if (next.addClicks === 1) meanwhile(add);
    };
    return { env, sections, stored };
  }

  for (const [name, meanwhile] of [
    ['turns it into a submit button', (add: HTMLElement) => add.removeAttribute('type')],
    ['hides it', (add: HTMLElement) => add.setAttribute('hidden', '')],
    ['disables it', (add: HTMLElement) => ((add as HTMLButtonElement).disabled = true)],
    ['takes it out of the page', (add: HTMLElement) => add.remove()],
  ] as const) {
    it(`never clicks an Add the page ${name} while its click was being counted, and uncounts it`, async () => {
      const fixture = await loadFixture(document, positions(1));
      const log = logEvents(fixture.doc);
      let submits = 0;
      fixture.doc.getElementById('root')!.addEventListener('submit', (event) => {
        submits += 1;
        event.preventDefault();
      });
      const { env, sections, stored } = racing(fixture, meanwhile);
      const outcomes = await addBlocks(env, sections);
      expect(submits).toBe(0);
      expect(log.on('add').filter((event) => event.type === 'click')).toEqual([]);
      expect(outcomes).toEqual([{ kind: 'experience', counter: { profile: 2, rendered: 1, addClicks: 0 }, clicks: 0,
        stop: 'add-refused', missing: 1, opened: [] }]);
      // Counted before the click, as ever; then the click it never made is taken back.
      expect(stored).toEqual([{ profile: 2, rendered: 1, addClicks: 1 }, { profile: 2, rendered: 1, addClicks: 0 }]);
    });
  }

  it("never clicks an Add that is, sits in or holds the adapter's Next", async () => {
    const page = `<!doctype html><body><form id="root"><div id="blocks"></div><div id="row">
      <button type="button" id="next" data-action="next"><span id="inner">Next</span></button></div></form>
      <script>window.__next = 0; document.getElementById('next').addEventListener('click', () => { window.__next += 1; });
      </script></body>`;
    for (const addId of ['next', 'inner', 'row']) {
      const fixture = await loadFixture(document, page);
      const root = fixture.doc.getElementById('root')!;
      const adapter: Adapter = { ...genericAdapter, nextButton: () => fixture.doc.getElementById('next'),
        isFinalStep: () => 'not-final', repeatables: () => [{ kind: 'experience',
          blocks: () => Array.from(root.querySelectorAll('#blocks > .block')),
          addButton: () => fixture.doc.getElementById(addId) }] };
      let counter: RepeatableCounter | null = null;
      const env: AddEnv = { adapter, root, signal: new AbortController().signal, settle: { quietMs: 40 },
        profile: new Map<RepeatableKind, number>([['experience', 1]]), prior: () => counter,
        record: async (_kind, next) => {
          counter = next;
        }, stopped: () => false };
      const outcomes = await addBlocks(env, sectionsOf(adapter, root));
      expect([addId, (fixture.view as unknown as { __next: number }).__next, outcomes[0]?.stop])
        .toEqual([addId, 0, 'add-refused']);
      removeFixtures(document);
    }
  });
});

describe('"I currently work here" after the loop (planCurrentJob)', () => {
  /** The page's rows for block 0's box and end date, as the plan left them (nothing of ours written). */
  function rowsOf(fixture: Fixture, wrote = false) {
    const root = fixture.doc.getElementById('root')!;
    const adapter = adapterOf();
    const result = scan(root, adapter, { platform: 'lever' });
    const rows = new Map<FieldKey, FillResult>();
    for (const field of result.fields) {
      const category = field.label === 'End date' ? 'experience.endDate' as const
        : field.label === 'I currently work here' ? 'experience.current' as const : 'experience.company' as const;
      rows.set(field.key, { key: field.key, label: field.label, kind: field.kind, category,
        section: `experience[${field.section.block}]`, required: field.required, status: wrote ? 'verified' : 'skipped',
        provenance: wrote ? 'profile' : null, matcherStage: 'not-applicable', confidence: 1, reason: wrote ? 'ok' : 'already-correct',
        wrote, verification: wrote ? 'verified' : 'not-applicable', needsUserAction: false });
    }
    return { result, rows, section: sectionsOf(adapter, root)[0]! };
  }
  const answer = (current: boolean): RepeatableAnswer => ({ kind: 'experience', profile: 1, entries: [0], current: [current] });
  const byLabel = (rows: ReadonlyMap<FieldKey, FillResult>, label: string) => [...rows.values()].find((row) => row.label === label)!;

  it('skips a current job\'s end date the page disabled, and flags one it still holds', async () => {
    const fixture = await loadFixture(document, positions(1, { inForm: false }));
    (fixture.doc.getElementById('current-0') as HTMLInputElement).checked = true;
    (fixture.doc.getElementById('end-0') as HTMLInputElement).disabled = true;
    const disabled = rowsOf(fixture);
    expect(byLabel(currentJobRows(disabled.rows, disabled.result, disabled.section, answer(true)), 'End date'))
      .toMatchObject({ status: 'skipped', reason: 'end-date-not-applicable', wrote: false, needsUserAction: false });
    (fixture.doc.getElementById('end-0') as HTMLInputElement).disabled = false;
    (fixture.doc.getElementById('end-0') as HTMLInputElement).value = '2021-05';
    const held = rowsOf(fixture);
    expect(byLabel(currentJobRows(held.rows, held.result, held.section, answer(true)), 'End date'))
      .toMatchObject({ status: 'flagged', reason: 'prefill-conflict', needsUserAction: true });
  });

  it('flags a past job\'s box the page ticked, and its disabled end date; never unticks it', async () => {
    const fixture = await loadFixture(document, positions(1, { inForm: false }));
    (fixture.doc.getElementById('current-0') as HTMLInputElement).checked = true;
    (fixture.doc.getElementById('end-0') as HTMLInputElement).disabled = true;
    const { rows, result, section } = rowsOf(fixture);
    const after = currentJobRows(rows, result, section, answer(false));
    expect(byLabel(after, 'I currently work here')).toMatchObject({ status: 'flagged', reason: 'unexpected-selection' });
    expect(byLabel(after, 'End date')).toMatchObject({ status: 'flagged', reason: 'unexpected-selection' });
    expect((fixture.doc.getElementById('current-0') as HTMLInputElement).checked).toBe(true);
  });

  it('never replaces the row of our own write, nor touches a block without an entry', async () => {
    const fixture = await loadFixture(document, positions(1, { inForm: false }));
    (fixture.doc.getElementById('current-0') as HTMLInputElement).checked = true;
    const ours = rowsOf(fixture, true);
    expect(currentJobRows(ours.rows, ours.result, ours.section, answer(false))).toEqual(ours.rows);
    const none = rowsOf(fixture);
    expect(currentJobRows(none.rows, none.result, none.section, { ...answer(false), entries: [null] })).toEqual(none.rows);
    expect(currentJobRows(none.rows, none.result, none.section, undefined)).toEqual(none.rows);
  });
});

describe('boxBeforeEndDate', () => {
  const item = (key: string, category: FillResult['category'], section: string, kind: 'check' | 'date') => ({
    write: { key, value: kind === 'check' ? { kind: 'check' } : { kind: 'date', iso: '2021-05' } } as unknown as PlannedWrite,
    planned: { key, category, section } as unknown as FillResult,
  });

  it('writes a block\'s "I currently work here" before its end date, and leaves other blocks\' order alone', () => {
    const end0 = item('end-0', 'experience.endDate', 'experience[0]', 'date');
    const end1 = item('end-1', 'experience.endDate', 'experience[1]', 'date');
    const box0 = item('box-0', 'experience.current', 'experience[0]', 'check');
    expect(boxBeforeEndDate([end0, end1, box0]).map((entry) => entry.write.key)).toEqual(['box-0', 'end-0', 'end-1']);
    expect(boxBeforeEndDate([box0, end0]).map((entry) => entry.write.key)).toEqual(['box-0', 'end-0']);
    const box1 = item('box-1', 'experience.current', 'experience[1]', 'check');
    expect(boxBeforeEndDate([end0, box1]).map((entry) => entry.write.key)).toEqual(['end-0', 'box-1']);
  });
});

describe('rowsReadyToSave: a block whose Save the run may press (the Phase 7a review)', () => {
  const row = (extra: Partial<FillResult> = {}): FillResult => ({ key: 'k' as FieldKey, label: 'School', kind: 'text',
    category: 'education.school', section: 'education[0]', required: true, status: 'verified', provenance: 'profile',
    matcherStage: 'not-applicable', confidence: 1, reason: 'ok', wrote: true, verification: 'verified',
    needsUserAction: false, ...extra });
  const skipped = { status: 'skipped' as const, reason: 'no-profile-value' as const, wrote: false, provenance: null,
    verification: 'not-applicable' as const };

  it('is ready once every row is verified or skipped and one holds our value, written or already right', () => {
    expect(rowsReadyToSave([row(), row({ ...skipped, required: false })])).toBe(true);
    expect(rowsReadyToSave([row({ ...skipped, reason: 'already-correct' })])).toBe(true);
    // Nothing of ours in it.
    expect(rowsReadyToSave([row({ ...skipped, required: false })])).toBe(false);
    expect(rowsReadyToSave([])).toBe(false);
  });

  it('is never ready with a row flagged, changed by the person, or one they filled', () => {
    expect(rowsReadyToSave([row(), row({ status: 'flagged', reason: 'filled-low-confidence', needsUserAction: true })]))
      .toBe(false);
    expect(rowsReadyToSave([row(), row({ status: 'skipped', reason: 'changed-by-you', wrote: false })])).toBe(false);
    expect(rowsReadyToSave([row({ detail: { userEdited: true } })])).toBe(false);
    expect(rowsReadyToSave([row(), row({ ...skipped, needsUserAction: true })])).toBe(false);
  });
});

describe('filesAfterTheRest (Adapter.quirks.filesLast)', () => {
  it('moves the file writes after every other, each kind keeping its order', () => {
    const item = (key: string, kind: 'file' | 'text') => ({ write: { key, value: kind === 'file'
      ? { kind: 'file', ref: 'resume' } : { kind: 'text', text: '' } } as unknown as PlannedWrite });
    const queue = [item('resume', 'file'), item('first', 'text'), item('photo', 'file'), item('last', 'text')];
    expect(filesAfterTheRest(queue).map((entry) => entry.write.key)).toEqual(['first', 'last', 'resume', 'photo']);
  });
});
