/*
 * v5 p2-fill review (security 3): text a person cannot see inside a rich-text box (contenteditable) never reaches the
 * AI. The box's `current` is the visibleText walker's reading of it (dom/values.ts editableVisibleText), so off-screen,
 * see-through and tiny text in it is left out of every request; and Edit with AI refuses a box that holds any (its
 * innerText and its visible reading differ beyond white space): nothing is sent, the box says why and its row is
 * flagged 'hidden-text-in-box'. innerText stays for our own write's read-back.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DraftItem } from '../core/plan/drafts';
import type { FillResult } from '../core/types/fill';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import { editableHidesText, editableText, editableVisibleText, readBackTextOf, textOfControl } from '../dom/values';
import { genericAdapter } from '../adapters/generic';
import { PAGE_COPY } from '../shared/copy';
import { createFakeWorker, FAKE_DRAFT, FAKE_TASK_ID, testVocab, trapUrl } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const runtimes: ContentRuntime[] = [];
beforeAll(() => {
  testVocab();
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

const WHY = 'Why do you want to work here?';
/** What the page hides in the box: off the screen, see-through, too small to read. */
const HIDDEN = ['OFFSCREEN-P2F-MARK', 'CLEAR-P2F-MARK', 'TINY-P2F-MARK'];
const HIDING = `<span style="position:absolute;left:-9999px">${HIDDEN[0]}</span>`
  + `<span style="color:transparent">${HIDDEN[1]}</span><span style="font-size:1px">${HIDDEN[2]}</span>`;

/** Puts what the page hides into `into`, built node by node. */
function hideIn(into: Element): void {
  const doc = into.ownerDocument;
  for (const [mark, style] of [[HIDDEN[0]!, 'position:absolute;left:-9999px'], [HIDDEN[1]!, 'color:transparent'],
    [HIDDEN[2]!, 'font-size:1px']] as const) {
    const span = doc.createElement('span');
    span.setAttribute('style', style);
    span.textContent = mark;
    into.append(' ', span);
  }
}

/** A form whose free-text question is a rich-text box holding `inside`. */
const form = (inside: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  body { font: 16px/1.5 system-ui, sans-serif; color: #222; background: #fff; }
  label, span.l { display: block; margin-top: 12px; } input { display: block; width: 320px; }
  #why { display: block; width: 420px; min-height: 96px; border: 1px solid #888; padding: 4px; }
  </style></head><body><main><form action="/__submitted" method="post">
    <label for="first">First name</label><input id="first" name="first">
    <span class="l" id="wl">${WHY}</span>
    <div id="why" contenteditable="true" role="textbox" aria-labelledby="wl">${inside}</div>
    <label for="email">Email</label><input id="email" name="email" type="email">
    <button type="submit">Submit application</button>
  </form></main></body></html>`;

describe('a rich-text box\'s text for the AI (security 3)', () => {
  it('reads only what a person can see of the box; innerText stays for the read-back', async () => {
    const fixture = await loadFixture(document, form(`<p>I like the team. ${HIDING}</p>`));
    const box = fixture.doc.getElementById('why')!;
    expect(editableVisibleText(box)).toBe('I like the team.');
    expect(textOfControl(box)).toBe('I like the team.');
    for (const mark of HIDDEN) expect(editableText(box)).toContain(mark);
    expect(readBackTextOf(box)).toBe(editableText(box));
    expect(editableHidesText(box)).toBe(true);
    // The scan's current, which every plan and draft request carries, holds none of it.
    const scanned = scan(fixture.doc.body, genericAdapter, { platform: 'lever' });
    const field = scanned.fields.find((candidate) => candidate.label === WHY);
    expect(field?.current).toEqual({ kind: 'text', text: 'I like the team.' });
    // A box whose text is all in sight hides nothing, white space aside.
    const shown = fixture.doc.createElement('p');
    shown.textContent = 'I like   the team.';
    const more = fixture.doc.createElement('p');
    more.textContent = 'And the work.';
    box.replaceChildren(shown, more);
    expect(editableHidesText(box)).toBe(false);
  });

  it('sends none of it in a plan or a draft request', async () => {
    const fixture = await loadFixture(document, form(`<p>I like the team. ${HIDING}</p>`));
    const drafted: DraftItem[] = [];
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS, ai: { draft: (item) => {
      drafted.push(item);
      return { key: item.key, text: FAKE_DRAFT, taskId: FAKE_TASK_ID };
    } } });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl('p2f-hidden'),
      isTop: true, settle: { quietMs: 60 }, ai: { pollMs: 20 } });
    runtimes.push(runtime);
    await runtime.fill();
    const sent = JSON.stringify([worker.messages, drafted]);
    expect(sent).toContain('I like the team.');
    for (const mark of HIDDEN) expect(sent).not.toContain(mark);
  });

  it('Edit with AI refuses a box holding hidden text: nothing sent, the box says why, the row is flagged', async () => {
    const fixture = await loadFixture(document, form(''));
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl('p2f-hidden-edit'),
      isTop: true, settle: { quietMs: 60 }, ai: { pollMs: 20 } });
    runtimes.push(runtime);
    await runtime.fill();
    const box = fixture.doc.getElementById('why')!;
    const rowOf = () => (worker.reports.at(-1)!.fields as FillResult[]).find((row) => row.label === WHY)!;
    expect(editableText(box)).toBe(FAKE_DRAFT);
    const key = rowOf().key;
    // The page puts text a person cannot see into the box after our draft.
    hideIn(box.querySelector('p, div') ?? box);
    expect(editableHidesText(box)).toBe(true);
    expect(await runtime.run!.rewrite(key)).toBe('hidden');
    expect(worker.of('draft/rewrite')).toEqual([]);
    expect(PAGE_COPY.aiEdit.outcomes.hidden).not.toBe('');
    await vi.waitFor(() => expect(rowOf()).toMatchObject({ status: 'flagged', reason: 'hidden-text-in-box' }));
    for (const mark of HIDDEN) expect(JSON.stringify(worker.messages)).not.toContain(mark);
  });
});
