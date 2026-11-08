/*
 * Declared untrusted keys (docs/SPEC-AMENDMENTS.md §12; WidgetDecl.keys): a widget whose adapter declares a key gets it
 * as an untrusted keydown and keyup on its text box, and no other widget gets any. The fixture is a combobox whose list
 * opens on a click and ignores focusout and blur, closing only on Escape, as Ashby's lists do (scratchpad's Ashby
 * capture, the plan's Phase 2): closeList sends the declared Escape only after focusout and blur left it open; a
 * widget that declares none is left open, with no key sent; a key the widget does not declare is never sent, nor one
 * to a control assertNotSubmit refuses, nor an Escape to a widget that does not say, right then, that it is open; and
 * (s2 wd, snapshot round 2) Enter is a search's query key alone (Workday's prompts) and the digits a date's parts' alone
 * (Workday's date input): neither is a key a widget's list or a text box around its write gets, even one that names it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter, WidgetDecl } from '../../adapters/types';
import { ALLOWED_EVENTS, DECLARED_KEYS, DIGIT_KEYS, fireKey, KEY_EVENTS, QUERY_KEYS, WIDGET_KEYS } from '../fillers/events';
import { fill } from '../fillers';
import { loadFixture, logEvents, removeFixtures, untrustedViolations, type Fixture } from '../fixture.testkit';
import { scan } from '../scan';
import type { WidgetTarget } from '../types';
import { closeList, openList, pressDeclaredKey } from './interact';

const PAGE = `<!doctype html><body><form id="f">
  <label for="city">City</label>
  <input id="city" role="combobox" aria-controls="city-list" aria-expanded="false" aria-autocomplete="none">
  <ul id="city-list" role="listbox" hidden><li role="option" id="austin">Austin</li><li role="option" id="dallas">Dallas</li></ul>
  <input id="send" type="submit" value="Send">
</form></body>`;

afterEach(() => removeFixtures(document));

/** The page, its list opened by a click on its text box and closed only by Escape, and its widget as an adapter that
 *  declares `keys` for it finds it. */
async function open(keys: WidgetDecl['keys']): Promise<{ fixture: Fixture; widget(id: string): WidgetTarget;
  ctx: { adapter: Adapter; root: Element } }> {
  const fixture = await loadFixture(document, PAGE);
  const root = fixture.doc.getElementById('f')!;
  const input = fixture.doc.getElementById('city')!;
  const list = fixture.doc.getElementById('city-list')!;
  const show = (shown: boolean) => {
    list.hidden = !shown;
    input.setAttribute('aria-expanded', String(shown));
  };
  input.addEventListener('click', () => show(true));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') show(false);
  });
  const adapter = {
    widgetFor: (control: Element) => (control.id === 'city' ? { kind: 'combobox', opener: control,
      expanded: control, ...(keys === undefined ? {} : { keys }), snapshot: 'the plan\'s Ashby capture' } : null),
  } as unknown as Adapter;
  const widget = (id: string) => {
    const result = scan(root, adapter, { platform: 'ashby' });
    const field = result.fields.find((candidate) => candidate.idAttr === id);
    if (field === undefined) throw new Error(`no field #${id}`);
    return result.target(field.key)!.widget!;
  };
  return { fixture, widget, ctx: { adapter, root } };
}

describe('declared untrusted keys', () => {
  it('closes a list that ignores focusout and blur with the Escape its adapter declares, a keydown and a keyup', async () => {
    const page = await open(['Escape']);
    const log = logEvents(page.fixture.doc);
    const widget = page.widget('city');
    expect(widget.keys).toEqual(['Escape']);
    const opened = await openList(widget, page.ctx);
    expect(opened).toMatchObject({ open: true, activated: true });
    expect(await closeList(page.widget('city'), page.ctx, { activated: true })).toBe(true);
    expect(page.fixture.doc.getElementById('city-list')!.hidden).toBe(true);
    expect(log.on('city').filter((event) => !event.trusted).map((event) => [event.type, event.trusted]))
      .toEqual([['click', false], ['focusout', false], ['blur', false], ['keydown', false], ['keyup', false]]);
    expect(untrustedViolations(log.events)).toEqual([]);
    const allowed = new Set<string>([...ALLOWED_EVENTS, ...KEY_EVENTS]);
    expect(log.events.filter((event) => !event.trusted && !allowed.has(event.type))).toEqual([]);
  });

  it('sends no key to a widget that declares none, nor one it does not declare, nor to a control that submits', async () => {
    const page = await open(undefined);
    const log = logEvents(page.fixture.doc);
    const widget = page.widget('city');
    expect(widget.keys).toEqual([]);
    await openList(widget, page.ctx);
    expect(await closeList(page.widget('city'), page.ctx, { activated: true })).toBe(false);
    expect(pressDeclaredKey(page.widget('city'), 'Escape', page.ctx)).toBe(false);
    removeFixtures(document);

    const declared = await open(['Escape']);
    const later = logEvents(declared.fixture.doc);
    expect(pressDeclaredKey(declared.widget('city'), 'ArrowDown', declared.ctx)).toBe(false);
    // A submit input, even one an adapter took for a widget's text box, gets no key.
    const send = declared.fixture.doc.getElementById('send') as HTMLInputElement;
    expect(pressDeclaredKey({ ...declared.widget('city'), element: send, input: send }, 'Escape', declared.ctx))
      .toBe(false);
    expect([...log.events, ...later.events].filter((event) => event.type === 'keydown' || event.type === 'keyup'))
      .toEqual([]);
  });

  it('sends no Escape to a widget that does not say, right then, that its list is open', async () => {
    const page = await open(['Escape']);
    const log = logEvents(page.fixture.doc);
    await openList(page.widget('city'), page.ctx);
    // The list is still drawn, but the widget says it is closed: an Escape there is the page's to read as it likes.
    page.fixture.doc.getElementById('city')!.setAttribute('aria-expanded', 'false');
    expect(pressDeclaredKey(page.widget('city'), 'Escape', page.ctx)).toBe(false);
    await closeList(page.widget('city'), page.ctx, { activated: true });
    expect(log.events.filter((event) => event.type === 'keydown' || event.type === 'keyup')).toEqual([]);
    expect(WIDGET_KEYS).toEqual(['Escape', 'ArrowDown']);
  });

  // s2 wd (snapshot round 2): Enter and the digits, each where its declaration allows it alone.
  it('admits Enter as a query key and the digits for a date’s parts, never as a widget’s or a write’s key', async () => {
    expect(QUERY_KEYS).toEqual(['Escape', 'ArrowDown', 'Enter']);
    expect(DIGIT_KEYS).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(DECLARED_KEYS).toEqual([...QUERY_KEYS, ...DIGIT_KEYS]);
    // A widget whose adapter lists Enter or a digit among its keys gets neither.
    const page = await open(['Escape', 'Enter', '4'] as unknown as WidgetDecl['keys']);
    const log = logEvents(page.fixture.doc);
    await openList(page.widget('city'), page.ctx);
    for (const key of ['Enter', '4'] as const) {
      expect(pressDeclaredKey(page.widget('city'), key as unknown as 'Escape', page.ctx)).toBe(false);
    }
    expect(log.events.filter((event) => event.type === 'keydown')).toEqual([]);
    removeFixtures(document);
    // A text box whose adapter names Enter around its write gets no key either.
    const plain = await loadFixture(document, '<!doctype html><body><form id="g"><label for="town">Town</label>'
      + '<input id="town" type="text"></form></body>');
    const later = logEvents(plain.doc);
    const root = plain.doc.getElementById('g')!;
    const input = plain.doc.getElementById('town') as HTMLInputElement;
    const scanned = scan(root, null, { platform: 'ashby' });
    const box = scanned.fields.find((field) => field.idAttr === 'town')!;
    fill(scanned.target(box.key)!, { kind: 'text', text: 'Austin' }, { root,
      adapter: { keyAroundWrite: () => 'Enter' } as unknown as Adapter });
    expect(input.value).toBe('Austin');
    expect(later.events.filter((event) => event.type === 'keydown')).toEqual([]);
    // Enter and the digits carry their legacy keyCode, as a keyboard's own events do.
    const codes: Array<[string, string, number]> = [];
    input.addEventListener('keydown', (event) => codes.push([event.key, event.code, event.keyCode]));
    fireKey(input, 'Enter');
    fireKey(input, '7');
    fireKey(input, 'Escape');
    expect(codes).toEqual([['Enter', 'Enter', 13], ['7', 'Digit7', 55], ['Escape', 'Escape', 0]]);
  });
});
