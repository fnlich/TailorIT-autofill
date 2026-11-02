/*
 * Declared untrusted keys (docs/SPEC-AMENDMENTS.md §12; WidgetDecl.keys): a widget whose adapter declares a key gets it
 * as an untrusted keydown and keyup on its text box, and no other widget gets any. The fixture is a combobox whose list
 * opens on a click and ignores focusout and blur, closing only on Escape, as Ashby's lists do (scratchpad's Ashby
 * capture, the plan's Phase 2): closeList sends the declared Escape only after focusout and blur left it open; a
 * widget that declares none is left open, with no key sent; a key the widget does not declare is never sent, nor one
 * to a control assertNotSubmit refuses, nor an Escape to a widget that does not say, right then, that it is open; and
 * Enter is no key a widget may declare until a snapshot needs it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter, WidgetDecl } from '../../adapters/types';
import { ALLOWED_EVENTS, DECLARED_KEYS, KEY_EVENTS } from '../fillers/events';
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
    expect(DECLARED_KEYS).toEqual(['Escape', 'ArrowDown']);
  });
});
