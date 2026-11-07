import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter } from '../../adapters/types';
import { loadFixture, logEvents, removeFixtures } from '../fixture.testkit';
import { assertKeyTarget, assertNotSubmit, clickIfAllowed, type ClickRefusal } from './not-submit';

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
    <div role="listbox">
      <div role="option" id="confirm-option">Acknowledge/Confirm</div>
      <div role="option" id="submit-option">I confirm and submit my application</div>
      <div role="option" id="option-holding"><span role="button">Submit</span></div>
      <button type="button" role="option" id="button-option">Submit</button>
    </div>
    <div role="option" id="loose-option">Confirm</div>
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
      // "Confirm" in a list's option chooses a value (the live BeyondTrust form's one option); any other submit word in
      // it still counts, and an option that holds a control, is a button, or sits in no list keeps all its words.
      ['confirm-option', null],
      ['submit-option', 'submit-word'],
      ['option-holding', 'submit-word'],
      ['button-option', 'submit-word'],
      ['loose-option', 'submit-word'],
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

describe('assertKeyTarget: a declared key to a list (the Phase 7a review)', () => {
  afterEach(() => removeFixtures(document));

  it("reads only the list's own words, never its options', and keeps every other refusal", async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form id="f">
      <ul role="listbox" id="plain"><li role="option">I will submit my portfolio later</li><li role="option">No</li></ul>
      <ul role="listbox" id="named" aria-label="Submit"><li role="option">Yes</li></ul>
      <button id="wrap" type="submit"><ul role="listbox" id="inside"><li role="option">Yes</li></ul></button>
      <div role="button" id="go"><ul role="listbox" id="in-submit"><li role="option">Yes</li></ul></div>
    </form></body>`);
    const root = fixture.doc.getElementById('f')!;
    const adapter = { submitButton: () => fixture.doc.getElementById('go') } as unknown as Adapter;
    const verdict = (id: string, check = assertKeyTarget) => {
      const answer = check(fixture.doc.getElementById(id)!, { adapter, root });
      return answer.ok ? null : answer.refusal;
    };
    // A click on the list would be refused by its option's words; a key is not.
    expect(verdict('plain', assertNotSubmit)).toBe('submit-word');
    expect(verdict('plain')).toBeNull();
    expect(verdict('named')).toBe('submit-word');
    expect(verdict('inside')).toBe('inside-submit');
    expect(verdict('in-submit')).toBe('adapter-submit');
  });
});

// ── The security fix of 2026-11-06 (S9): the adapter's Submit, Next and never-pressed list across shadow roots ──
// The review's probe P2: UltiPro draws its Submit as a ukg-button host whose native button sits in the host's open
// shadow root. That button is the Submit whatever its words (a localised label says no submit word).
describe('assertNotSubmit across shadow roots (S9)', () => {
  afterEach(() => removeFixtures(document));

  async function hosted() {
    const fixture = await loadFixture(document, `<!doctype html><body><form id="app"><label for="n">Name</label><input id="n">
      <ukg-button id="submit" data-automation="btn-submit"></ukg-button>
      <ukg-button id="next" data-automation="btn-next"></ukg-button>
      <ukg-button id="never" data-automation="btn-social"></ukg-button>
      <ukg-button id="other" data-automation="btn-other"></ukg-button></form></body>`);
    const inner: Record<string, HTMLElement> = {};
    for (const id of ['submit', 'next', 'never', 'other']) {
      const shadow = fixture.doc.getElementById(id)!.attachShadow({ mode: 'open' });
      const button = fixture.doc.createElement('button');
      button.className = 'ukg-button-native';
      button.type = 'button';
      button.setAttribute('aria-label', 'Weiter');
      button.textContent = 'Weiter';
      shadow.append(button);
      inner[id] = button;
    }
    return { fixture, root: fixture.doc.getElementById('app')!, inner };
  }

  it('P2: refuses the native button inside the Submit host, the Next host and a never-pressed host, whatever its words',
    async () => {
      const { fixture, root, inner } = await hosted();
      const adapter = { submitButton: () => fixture.doc.getElementById('submit'),
        nextButton: () => fixture.doc.getElementById('next'),
        neverPress: () => [fixture.doc.getElementById('never')!], isFinalStep: () => 'final' } as unknown as Adapter;
      const refusal = (el: Element) => {
        const verdict = assertNotSubmit(el, { adapter, root });
        return verdict.ok ? null : verdict.refusal;
      };
      expect(refusal(fixture.doc.getElementById('submit')!)).toBe('adapter-submit');
      expect(refusal(inner.submit!)).toBe('adapter-submit');
      expect(refusal(inner.next!)).toBe('adapter-next');
      expect(refusal(inner.never!)).toBe('adapter-never-press');
      // A host the adapter names nowhere stays a plain button.
      expect(refusal(inner.other!)).toBeNull();
    });
});
// ── end of the security fix's block (S9) ──
