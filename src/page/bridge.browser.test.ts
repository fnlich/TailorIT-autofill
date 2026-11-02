/*
 * The page-world bridge (page/bridge.ts, docs/SPEC-AMENDMENTS.md §12) on the real react-select 5.10.2, in a fixture
 * frame it is installed in as the extension installs it in a page, driven through the isolated world's client
 * (dom/bridge.ts) and, as a page script would, by raw events: a single select, a multi-select (an option chosen already
 * is never chosen again, which would remove it), grouped options, a disabled option and a disabled select, a label no
 * option has or two have, a custom getOptionLabel, and the wrong kind; the field reading's allowlist; a forged command,
 * which changes only the widget it names; commands that are no commands; an answer that never comes, which is never
 * waited for; a context without crypto.randomUUID (an https form embedded in an http page) and a page whose event
 * constructor throws, which end in no answer rather than an error; and a select inside an open shadow root. The bridge
 * itself sends no event a page could take for a person's: no mouse, pointer, key, touch, focus, click or input event.
 */
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { createElement as h, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import Select, { type GroupBase, type MultiValue, type SingleValue } from 'react-select';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { askBridge } from '../dom/bridge';
import { BRIDGE_COMMAND, BRIDGE_RESULT, parseAnswer, type BridgeAnswer } from '../dom/bridge-protocol';
import { loadFixture, logEvents, removeFixtures, untrustedViolations, type EventLog, type Fixture } from '../dom/fixture.testkit';
import { installBridge } from './bridge';

interface Choice {
  value: string;
  label: string;
  closed?: boolean;
}

type Options = ReadonlyArray<Choice | GroupBase<Choice>>;

/** The selects of the fixture, by their text box's id. */
interface Spec {
  id: string;
  options: Options;
  multi?: boolean;
  disabled?: boolean;
  /** The options carry their label as `name` (a custom getOptionLabel). */
  named?: boolean;
}

const YES_NO: Choice[] = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
const SPECS: Spec[] = [
  { id: 'single', options: YES_NO },
  { id: 'twin', options: YES_NO },
  { id: 'multi', multi: true, options: ['TypeScript', 'Ruby', 'Go'].map((label) => ({ value: label.toLowerCase(), label })) },
  { id: 'grouped', options: [{ label: 'North America', options: [{ value: 'ca', label: 'Canada' },
    { value: 'us', label: 'United States' }] }, { label: 'Europe', options: [{ value: 'fr', label: 'France' }] }] },
  { id: 'gated', options: [{ value: 'open', label: 'Open' }, { value: 'shut', label: 'Closed', closed: true }] },
  { id: 'twice', options: [{ value: 'a', label: 'Other' }, { value: 'b', label: 'Other' }, { value: 'c', label: 'None' }] },
  { id: 'off', disabled: true, options: YES_NO },
  { id: 'named', named: true, options: [{ value: 'x', label: 'unused', name: 'Named one' } as Choice] },
];

interface Page {
  fixture: Fixture;
  /** React's value of each select, as its onChange gave it: an option's value, their values, or null. */
  values: Record<string, unknown>;
  events: EventLog;
  input(id: string): HTMLInputElement;
  /** What the select shows chosen: its single value's text, or its chips' texts. */
  shown(id: string): string[];
}

const mounted: Root[] = [];
const removals: Array<() => void> = [];
afterEach(() => {
  for (const root of mounted.splice(0)) root.unmount();
  for (const remove of removals.splice(0)) remove();
  removeFixtures(document);
});

/** The fixture: every select of SPECS, and a plain React text box (a field of Ashby's shape, its value beside it). */
async function open({ bridge = true }: { bridge?: boolean } = {}): Promise<Page> {
  const fixture = await loadFixture(document, '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    { width: 900, height: 1400 });
  const values: Record<string, unknown> = {};
  const cache = createCache({ key: 'bridge-test', container: fixture.doc.head });
  const select = (spec: Spec): ReactElement => h('div', { key: spec.id, className: `wrap-${spec.id}` },
    h(Select<Choice, boolean>, {
      inputId: spec.id, instanceId: spec.id, options: spec.options, isMulti: spec.multi === true,
      isDisabled: spec.disabled === true, classNamePrefix: 'rs',
      isOptionDisabled: (option: Choice) => option.closed === true,
      ...(spec.named ? { getOptionLabel: (option: Choice) => (option as unknown as { name: string }).name } : {}),
      onChange: (next: SingleValue<Choice> | MultiValue<Choice>) => {
        values[spec.id] = Array.isArray(next) ? (next as readonly Choice[]).map((option) => option.value)
          : (next as Choice | null)?.value ?? null;
      },
    }));
  const FieldBox = (props: { field: { type: unknown; path: unknown; value: string } }): ReactElement =>
    h('input', { id: 'field-box', defaultValue: props.field.value });
  const EntryBox = (props: { fieldEntry: { field: { type: unknown; path: unknown } } }): ReactElement =>
    h('input', { id: 'entry-box', 'data-type': String(props.fieldEntry.field.type) });
  const root = createRoot(fixture.doc.getElementById('root')!);
  mounted.push(root);
  flushSync(() => root.render(h(CacheProvider, { value: cache }, h('div', null, ...SPECS.map(select),
    h(FieldBox, { field: { type: 'Location', path: '_systemfield_location', value: 'Austin, Texas' } }),
    h(EntryBox, { fieldEntry: { field: { type: 'x'.repeat(101), path: 'line\nbreak' } } }),
    h('div', { id: 'plain-react' }, 'Not a select')))));
  const plain = fixture.doc.createElement('div');
  plain.id = 'no-react';
  fixture.doc.body.append(plain);
  if (bridge) removals.push(installBridge(fixture.doc));
  const events = logEvents(fixture.doc);
  removals.push(() => events.stop());
  const input = (id: string) => fixture.doc.getElementById(id) as HTMLInputElement;
  return {
    fixture, values, events, input,
    shown: (id) => {
      const wrap = fixture.doc.querySelector(`.wrap-${id}`)!;
      return Array.from(wrap.querySelectorAll('.rs__single-value, .rs__multi-value__label'), (el) => el.textContent ?? '');
    },
  };
}

/** Asks the bridge to choose `label` in the select `id`. */
const choose = (page: Page, id: string, label: string, multi = false) =>
  askBridge(page.input(id), { op: 'react-select.choose', label, multi });

/** An answer's ok and reason. */
const said = (answer: BridgeAnswer | null) => (answer === null ? null : { ok: answer.ok, reason: answer.reason });

/** The events the bridge must never cause: what a person's mouse, keyboard, finger or focus would. */
const PERSON_EVENTS = /^(?:mouse|pointer|key|touch|focus|click|dblclick|blur|input|change|beforeinput|submit)/;

/** The events of a log the bridge could have caused: every one dispatched by script (untrusted), and every trusted one
 *  but the browser's own pointer and mouse boundary events, which it fires by itself when the page changes under a
 *  cursor that sits still (untrustedViolations' rule). */
const caused = (log: EventLog) => [...log.events.filter((event) => !event.trusted && PERSON_EVENTS.test(event.type)),
  ...untrustedViolations(log.events)];

describe('the page-world bridge on react-select 5.10.2', () => {
  it("chooses a single select's option by its label, as react-select's own choice does", async () => {
    const page = await open();
    expect(said(await choose(page, 'single', 'No'))).toEqual({ ok: true, reason: 'ok' });
    await vi.waitFor(() => expect(page.shown('single')).toEqual(['No']));
    expect(page.values.single).toBe('no');
    // White space collapsed, as the scanner's labels are; the menu was never opened, and stays shut.
    expect(said(await choose(page, 'single', '  Yes \n'))).toEqual({ ok: true, reason: 'ok' });
    await vi.waitFor(() => expect(page.shown('single')).toEqual(['Yes']));
    expect(page.fixture.doc.querySelector('.wrap-single .rs__menu')).toBeNull();
    expect(caused(page.events)).toEqual([]);
  });

  it('adds to a multi-select, and never chooses an option chosen already (that would remove it)', async () => {
    const page = await open();
    expect(said(await choose(page, 'multi', 'Ruby', true))).toEqual({ ok: true, reason: 'ok' });
    await vi.waitFor(() => expect(page.shown('multi')).toEqual(['Ruby']));
    expect(said(await choose(page, 'multi', 'Go', true))).toEqual({ ok: true, reason: 'ok' });
    await vi.waitFor(() => expect(page.shown('multi')).toEqual(['Ruby', 'Go']));
    expect(said(await choose(page, 'multi', 'Ruby', true))).toEqual({ ok: false, reason: 'chosen' });
    expect(page.values.multi).toEqual(['ruby', 'go']);
    expect(page.shown('multi')).toEqual(['Ruby', 'Go']);
    expect(caused(page.events)).toEqual([]);
  });

  it("chooses from grouped options, and reads a label as the select's own getOptionLabel does", async () => {
    const page = await open();
    expect(said(await choose(page, 'grouped', 'France'))).toEqual({ ok: true, reason: 'ok' });
    await vi.waitFor(() => expect(page.values.grouped).toBe('fr'));
    // A group's own label is no option.
    expect(said(await choose(page, 'grouped', 'Europe'))).toEqual({ ok: false, reason: 'no-match' });
    expect(said(await choose(page, 'named', 'Named one'))).toEqual({ ok: true, reason: 'ok' });
    await vi.waitFor(() => expect(page.values.named).toBe('x'));
    expect(said(await choose(page, 'named', 'unused'))).toEqual({ ok: false, reason: 'no-match' });
  });

  it('refuses a disabled option, a disabled select, a label no option has or two have, and the wrong kind', async () => {
    const page = await open();
    expect(said(await choose(page, 'gated', 'Closed'))).toEqual({ ok: false, reason: 'disabled' });
    expect(said(await choose(page, 'off', 'Yes'))).toEqual({ ok: false, reason: 'disabled' });
    expect(said(await choose(page, 'single', 'Maybe'))).toEqual({ ok: false, reason: 'no-match' });
    expect(said(await choose(page, 'twice', 'Other'))).toEqual({ ok: false, reason: 'ambiguous' });
    expect(said(await choose(page, 'single', 'Yes', true))).toEqual({ ok: false, reason: 'wrong-kind' });
    expect(said(await choose(page, 'multi', 'Go', false))).toEqual({ ok: false, reason: 'wrong-kind' });
    expect(page.values).toEqual({});
    // An element that is no select's own text box, a React one or not.
    expect(said(await askBridge(page.fixture.doc.getElementById('plain-react')!,
      { op: 'react-select.choose', label: 'Yes', multi: false }))).toEqual({ ok: false, reason: 'no-widget' });
    expect(said(await askBridge(page.fixture.doc.getElementById('no-react')!,
      { op: 'react-select.choose', label: 'Yes', multi: false }))).toEqual({ ok: false, reason: 'no-react' });
    expect(caused(page.events)).toEqual([]);
  });

  it("reads a React field's type and path, and nothing else: no value, no string past its allowlist", async () => {
    const page = await open();
    const answer = await askBridge(page.input('field-box'), { op: 'react.field' });
    expect(answer).toMatchObject({ ok: true, reason: 'ok', field: { type: 'Location', path: '_systemfield_location' } });
    expect(Object.keys(answer!.field!)).toEqual(['type', 'path']);
    expect(JSON.stringify(answer)).not.toContain('Austin');
    // A type over 100 characters and a path with a line break are not read: no field.
    expect(said(await askBridge(page.input('entry-box'), { op: 'react.field' }))).toEqual({ ok: false, reason: 'no-field' });
    expect(said(await askBridge(page.input('single'), { op: 'react.field' }))).toEqual({ ok: false, reason: 'no-field' });
  });

  it("changes only the widget a forged command names, with that widget's own option", async () => {
    const page = await open();
    const forge = (el: Element, detail: unknown) => {
      const answers: unknown[] = [];
      el.addEventListener(BRIDGE_RESULT, (event) => answers.push((event as CustomEvent).detail), { once: true });
      const handled = !el.dispatchEvent(new page.fixture.view.CustomEvent(BRIDGE_COMMAND, { detail, cancelable: true }));
      return { handled, answers };
    };
    const forged = forge(page.input('single'), JSON.stringify({ v: 1, id: 'page-forged-1', op: 'react-select.choose',
      label: 'Yes', multi: false }));
    expect(forged.handled).toBe(true);
    expect(parseAnswer(forged.answers[0], 'page-forged-1')).toMatchObject({ ok: true, reason: 'ok' });
    await vi.waitFor(() => expect(page.values.single).toBe('yes'));
    // Another select's option, named on this one, is no option of it.
    const elsewhere = forge(page.input('single'), JSON.stringify({ v: 1, id: 'page-forged-2', op: 'react-select.choose',
      label: 'France', multi: false }));
    expect(parseAnswer(elsewhere.answers[0], 'page-forged-2')).toMatchObject({ ok: false, reason: 'no-match' });
    expect(page.values).toEqual({ single: 'yes' });
    expect(page.shown('twin')).toEqual([]);
    expect(page.shown('grouped')).toEqual([]);
  });

  it('ignores what is no command: an object detail, an unknown op, a bad id, another key, a label past its cap', async () => {
    const page = await open();
    const input = page.input('single');
    const command = { v: 1, id: 'page-forged-3', op: 'react-select.choose', label: 'Yes', multi: false };
    const details: unknown[] = [command, JSON.stringify({ ...command, op: 'react-select.clear' }),
      JSON.stringify({ ...command, id: 'short' }), JSON.stringify({ ...command, value: 'yes' }),
      JSON.stringify({ ...command, label: 'Y'.repeat(301) }), JSON.stringify({ ...command, multi: 'no' }),
      JSON.stringify({ ...command, v: 2 }), '{not json', `"${'a'.repeat(2_100)}"`];
    let answers = 0;
    input.addEventListener(BRIDGE_RESULT, () => {
      answers += 1;
    });
    for (const detail of details) {
      const handled = !input.dispatchEvent(new page.fixture.view.CustomEvent(BRIDGE_COMMAND, { detail, cancelable: true }));
      expect(handled, JSON.stringify(detail).slice(0, 80)).toBe(false);
    }
    expect(answers).toBe(0);
    expect(page.values).toEqual({});
  });

  it('answers null at once without the bridge, and at once when a page takes a command and never answers it', async () => {
    const page = await open({ bridge: false });
    const started = performance.now();
    expect(await choose(page, 'single', 'Yes')).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
    expect(page.values).toEqual({});
    // A page that takes the command (preventDefault) and never answers: the bridge answers inside the dispatch, so
    // nothing is waited for (a page cannot hold a run with commands it swallows).
    const swallow = (event: Event) => event.preventDefault();
    page.fixture.doc.addEventListener(BRIDGE_COMMAND, swallow, true);
    removals.push(() => page.fixture.doc.removeEventListener(BRIDGE_COMMAND, swallow, true));
    const held = performance.now();
    expect(await choose(page, 'single', 'Yes')).toBeNull();
    expect(performance.now() - held).toBeLessThan(50);
    // The run's signal, aborted, sends nothing.
    const seen: unknown[] = [];
    page.fixture.view.addEventListener(BRIDGE_COMMAND, (event) => seen.push(event), true);
    const stop = new AbortController();
    stop.abort();
    expect(askBridge(page.input('single'), { op: 'react-select.choose', label: 'Yes', multi: false }, stop.signal))
      .toBeNull();
    expect(seen).toEqual([]);
  });

  it('works where crypto.randomUUID does not (a context that is not secure), and ends in null when the page throws', async () => {
    const page = await open();
    const crypto = page.fixture.view.Crypto.prototype as unknown as Record<string, unknown>;
    const own = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true, writable: true });
    try {
      expect(said(await choose(page, 'single', 'No'))).toEqual({ ok: true, reason: 'ok' });
      await vi.waitFor(() => expect(page.values.single).toBe('no'));
    } finally {
      if (own !== undefined) Object.defineProperty(crypto, 'randomUUID', own);
    }
    // A page whose own event constructor throws: no answer, never an error that would end the run.
    const view = page.fixture.view as unknown as Record<string, unknown>;
    const Custom = view.CustomEvent;
    view.CustomEvent = function broken() {
      throw new Error('the page broke CustomEvent');
    };
    try {
      expect(await choose(page, 'single', 'Yes')).toBeNull();
    } finally {
      view.CustomEvent = Custom;
    }
    expect(page.values.single).toBe('no');
  });

  it('chooses in a select drawn inside an open shadow root, by the element the command was sent on', async () => {
    const page = await open();
    const host = page.fixture.doc.createElement('div');
    page.fixture.doc.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const container = page.fixture.doc.createElement('div');
    shadow.append(container);
    const values: unknown[] = [];
    const root = createRoot(container);
    mounted.push(root);
    const cache = createCache({ key: 'bridge-shadow', container: shadow });
    flushSync(() => root.render(h(CacheProvider, { value: cache }, h(Select<Choice, false>, { inputId: 'shadowed',
      instanceId: 'shadowed', options: YES_NO, classNamePrefix: 'rs',
      onChange: (next: SingleValue<Choice>) => values.push(next?.value ?? null) }))));
    const input = shadow.getElementById('shadowed') as HTMLInputElement;
    expect(said(await askBridge(input, { op: 'react-select.choose', label: 'Yes', multi: false })))
      .toEqual({ ok: true, reason: 'ok' });
    await vi.waitFor(() => expect(values).toEqual(['yes']));
    // The host itself is no select's text box.
    expect(said(await askBridge(host, { op: 'react-select.choose', label: 'Yes', multi: false })))
      .toEqual({ ok: false, reason: 'no-react' });
  });
});
