import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter } from '../../adapters/types';
import { loadFixture, logEvents, removeFixtures } from '../fixture.testkit';
import { assertNotSubmit, clickIfAllowed, type ClickRefusal } from './not-submit';

const PAGE = `<!doctype html><body>
  <form id="f" action="/__submitted">
    <button id="typeless">Add another</button>
    <button id="typed-submit" type="submit">Add</button>
    <button id="plain-button" type="button">Add another</button>
    <button id="apply-word" type="button">Apply now</button>
    <input id="submit-input" type="submit" value="Go">
    <input id="image-input" type="image" alt="Go" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
    <button id="wrapper"><span id="inside">Inner text</span></button>
    <label for="submit-input" id="submit-label"><span id="in-label">Label of the go button</span></label>
    <div role="button" id="adapter-submit">Go on</div>
    <div role="button" id="send-word">Send</div>
    <button id="next">Next</button>
    <button id="next-submit" type="button">Submit and continue</button>
    <label><input type="checkbox" id="confirm-box" aria-label="I confirm"> I confirm the above is true</label>
    <a href="#top" id="link">Continue</a>
  </form>
  <button id="orphan">Add</button>
  <button id="owned" form="f">Owned from outside</button>
</body>`;

describe('assertNotSubmit', () => {
  afterEach(() => removeFixtures(document));

  async function setup(nextStep: 'final' | 'not-final' | 'unknown' = 'not-final') {
    const fixture = await loadFixture(document, PAGE);
    const root = fixture.doc.getElementById('f')!;
    const adapter = {
      submitButton: () => fixture.doc.getElementById('adapter-submit'),
      nextButton: () => fixture.doc.getElementById('next'),
      isFinalStep: () => nextStep,
    } as unknown as Adapter;
    return { fixture, root, adapter };
  }

  it('refuses everything whose activation could submit, and allows the rest', async () => {
    const { fixture, root, adapter } = await setup();
    const refusal = (id: string): ClickRefusal | null => {
      const verdict = assertNotSubmit(fixture.doc.getElementById(id)!, { adapter, root });
      return verdict.ok ? null : verdict.refusal;
    };
    const table: Array<[string, ClickRefusal | null]> = [
      ['typeless', 'submits-form'],
      ['typed-submit', 'submits-form'],
      ['plain-button', null],
      ['apply-word', 'submit-word'],
      ['submit-input', 'submits-form'],
      ['image-input', 'submits-form'],
      ['wrapper', 'submits-form'],
      ['inside', 'inside-submit'],
      ['submit-label', 'label-of-refused'],
      ['in-label', 'label-of-refused'],
      ['adapter-submit', 'adapter-submit'],
      ['send-word', 'submit-word'],
      ['next', 'submits-form'],
      ['confirm-box', null],
      ['link', null],
      ['orphan', null],
      ['owned', 'submits-form'],
    ];
    expect(table.map(([id]) => [id, refusal(id)])).toEqual(table);
  });

  it("allows the adapter's Next button only when the step machine asks, on a step declared not final", async () => {
    for (const [step, allowed] of [['not-final', true], ['unknown', false], ['final', false]] as const) {
      const { fixture, root, adapter } = await setup(step);
      const next = fixture.doc.getElementById('next')!;
      expect(assertNotSubmit(next, { adapter, root }).ok).toBe(false);
      expect([step, assertNotSubmit(next, { adapter, root, allowNext: true }).ok]).toEqual([step, allowed]);
      removeFixtures(document);
    }
    const { fixture, root, adapter } = await setup('not-final');
    const wording = { ...adapter, nextButton: () => fixture.doc.getElementById('next-submit') } as Adapter;
    expect(assertNotSubmit(fixture.doc.getElementById('next-submit')!, { adapter: wording, root, allowNext: true }))
      .toEqual({ ok: false, refusal: 'submit-word' });
  });

  it("refuses, without the step machine's word, a click that is, sits in or holds the adapter's Next, and one that holds its Submit (the Phase 5 review, X-S7)", async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form id="f">
      <div id="next-row"><button type="button" id="step-next" data-action="next"><span id="in-next">Next</span></button></div>
      <div id="submit-row"><div role="button" id="go">Go on</div></div>
      <button type="button" id="plain">Add another</button></form></body>`);
    const root = fixture.doc.getElementById('f')!;
    const adapter = { submitButton: () => fixture.doc.getElementById('go'),
      nextButton: () => fixture.doc.getElementById('step-next'), isFinalStep: () => 'not-final' } as unknown as Adapter;
    const verdict = (id: string, allowNext?: boolean) => assertNotSubmit(fixture.doc.getElementById(id)!,
      { adapter, root, ...(allowNext === undefined ? {} : { allowNext }) });
    expect(verdict('step-next')).toEqual({ ok: false, refusal: 'adapter-next' });
    expect(verdict('in-next')).toEqual({ ok: false, refusal: 'adapter-next' });
    expect(verdict('next-row')).toEqual({ ok: false, refusal: 'adapter-next' });
    expect(verdict('submit-row')).toEqual({ ok: false, refusal: 'adapter-submit' });
    expect(verdict('f')).toEqual({ ok: false, refusal: 'adapter-submit' });
    expect(verdict('plain')).toEqual({ ok: true });
    // The step machine's own click on Next stays allowed on a step declared not final; never one that holds Submit.
    expect(verdict('step-next', true)).toEqual({ ok: true });
    expect(verdict('submit-row', true)).toEqual({ ok: false, refusal: 'adapter-submit' });
    const log = logEvents(fixture.doc);
    expect(clickIfAllowed(fixture.doc.getElementById('step-next')!, { adapter, root })).toBe(false);
    expect(log.events).toEqual([]);
  });

  it('clicks only what it allows, and a refused click sends no event at all', async () => {
    const { fixture, root, adapter } = await setup();
    const log = logEvents(fixture.doc);
    let submitted = 0;
    fixture.doc.getElementById('f')!.addEventListener('submit', (event) => {
      submitted += 1;
      event.preventDefault();
    });
    expect(clickIfAllowed(fixture.doc.getElementById('typeless')!, { adapter, root })).toBe(false);
    expect(clickIfAllowed(fixture.doc.getElementById('inside')!, { adapter, root })).toBe(false);
    expect(log.events).toEqual([]);
    expect(clickIfAllowed(fixture.doc.getElementById('plain-button')!, { adapter, root })).toBe(true);
    expect(log.events.map((event) => [event.type, event.trusted])).toEqual([['click', false]]);
    expect(submitted).toBe(0);
  });
});
