import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import trap07 from '../../fixtures/traps/07-option-injection.html?raw';
import trap11 from '../../fixtures/traps/11-forged-wxt-events.html?raw';
import type { PlanOutput } from '../core/plan/types';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab, trapUrl, type FakeWorkerOptions } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const POSTING = 'https://jobs.lever.co/tailorit-fixture/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00';
const plain = trap11.replace(/<script>[\s\S]*<\/script>/, '');

beforeAll(() => {
  testVocab();
});

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
  document.querySelectorAll('[data-test-root]').forEach((el) => el.remove());
});

async function startOn(html: string, href: string | (() => string), worker: FakeWorkerOptions = {}) {
  const fixture = await loadFixture(document, html);
  const fake = createFakeWorker(worker);
  const runtime = await startContentRuntime(fake.platform, fixture.doc, {
    href: typeof href === 'string' ? () => href : href, isTop: true, quiet: { quietMs: 60 } });
  runtimes.push(runtime);
  return { fixture, fake, runtime };
}

describe('the content runtime’s start-up', () => {
  it('listens before it says hello, so the worker’s frame/ping is answered at once', async () => {
    let listening: boolean | null = null;
    let pong: Promise<unknown> | null = null;
    const fixture = await loadFixture(document, plain);
    const fake = createFakeWorker({ onMessage: (message) => {
      if (message.type !== 'frame/hello') return;
      listening = fake.platform.handlerRegistered;
      pong = fake.platform.deliver({ v: 1, type: 'frame/ping' });
    } });
    runtimes.push(await startContentRuntime(fake.platform, fixture.doc, { href: () => trapUrl('start'), isTop: true }));
    expect(listening).toBe(true);
    expect(await pong).toEqual({ ok: true, data: { pong: true } });
    expect(fake.messages[0]).toEqual({ v: 1, type: 'frame/hello', isTop: true, hasForm: true });
  });

  it('says hello again before a run when the first hello went unanswered', async () => {
    const { fake, runtime } = await startOn(plain, trapUrl('hello'), { script: { 'frame/hello': [{ ok: false,
      error: 'unavailable' }] } });
    expect(runtime.frameId).toBeNull();
    expect(await runtime.fill()).toBe('review');
    expect(fake.of('frame/hello')).toHaveLength(2);
    expect(fake.reports.at(-1)!.frameId).toBe(0);
  });

  it('mounts the launcher on the form root, idle', async () => {
    const { runtime } = await startOn(plain, trapUrl('start'));
    expect(runtime.page?.adapter.id).toBe('generic');
    expect(runtime.page?.root.localName).toBe('form');
    expect(runtime.ui!.launcher.view).toEqual({ state: 'idle', action: 'fill' });
    expect(runtime.frameId).toBe(0);
  });

  it('takes only this extension’s own messages from outside any tab, and parses them strictly', async () => {
    const { fake } = await startOn(plain, trapUrl('senders'));
    const ping = { v: 1, type: 'frame/ping' };
    expect(await fake.platform.deliverFrom(ping, { id: 'another-extension' })).toEqual({ ok: false, error: 'bad_sender' });
    expect(await fake.platform.deliverFrom(ping, { id: 'memory-extension', tabId: 7 }))
      .toEqual({ ok: false, error: 'bad_sender' });
    expect(await fake.platform.deliver({ v: 1, type: 'frame/ping', extra: true })).toEqual({ ok: false, error: 'bad_message' });
    expect(await fake.platform.deliver({ v: 1, type: 'draft/confirm', fieldKey: 'k' }))
      .toEqual({ ok: false, error: 'not_implemented' });
    expect(await fake.platform.deliver({ v: 1, type: 'answer/read', fieldKey: 'k' }))
      .toEqual({ ok: false, error: 'not_implemented' });
    expect(await fake.platform.deliver({ v: 1, type: 'report/update', reports: [] })).toEqual({ ok: true, data: {} });
  });

  it('reads a posting page with no form for policy text, tells the worker the pattern id, and offers no launcher', async () => {
    const page = '<!doctype html><body><main><h1>Developer Advocate</h1><p>We read every application ourselves. '
      + 'Please do not use AI tools to apply.</p></main></body>';
    const { fake, runtime } = await startOn(page, POSTING);
    expect(fake.of('frame/hello')[0]).toMatchObject({ hasForm: false });
    expect(fake.of('policy/hit')).toEqual([{ v: 1, type: 'policy/hit', applicationKey: expect.stringMatching(/^lever:/),
      patternId: 'do-not-use-ai' }]);
    expect(runtime.ui).toBeNull();
    expect(runtime.fill()).toBeNull();
    expect(await fake.platform.deliver({ v: 1, type: 'run/start', dryRun: false })).toEqual({ ok: true, data: {} });
    expect(fake.of('run/begin')).toEqual([]);
  });

  it('sends one clean reading for a posting page that says nothing about AI', async () => {
    const { fake } = await startOn('<!doctype html><body><p>Build the future of payments.</p></body>', POSTING);
    expect(fake.of('policy/hit').map((message) => message.patternId)).toEqual([null]);
  });

  it('runs nothing on a page with no form root', async () => {
    const { fake, runtime } = await startOn('<!doctype html><body><p>No fields here.</p></body>', trapUrl('none'));
    expect(fake.of('frame/hello')[0]).toMatchObject({ hasForm: false });
    expect(runtime.ui).toBeNull();
    expect(fake.of('policy/hit')).toEqual([]);
  });

  it('follows the address: another application ends the run, says hello again, and reads a posting page', async () => {
    let href = trapUrl('route');
    const { fixture, fake, runtime } = await startOn(plain, () => href);
    expect(await runtime.fill()).toBe('review');
    href = POSTING;
    fixture.view.dispatchEvent(new fixture.view.PopStateEvent('popstate'));
    await vi.waitFor(() => expect(fake.of('frame/hello')).toHaveLength(2));
    expect(fake.of('frame/hello')[1]).toMatchObject({ hasForm: false });
    await vi.waitFor(() => expect(fake.of('policy/hit')).toHaveLength(1));
    expect(runtime.page).toBeNull();
    expect(runtime.ui!.launcher.el.getBoundingClientRect().width).toBe(0);
  });

  it('ignores a forged pagehide, and leaves for good on a real one', async () => {
    const { fixture, runtime } = await startOn(plain, trapUrl('pagehide'));
    fixture.view.dispatchEvent(new fixture.view.PageTransitionEvent('pagehide', { persisted: false }));
    expect(runtime.stopped).toBe(false);
    expect(runtime.ui!.host.isConnected).toBe(true);
    // Removing the frame unloads its document: the browser's own pagehide, which is trusted.
    fixture.frame.remove();
    await vi.waitFor(() => expect(runtime.stopped).toBe(true));
    expect(runtime.ui).toBeNull();
  });
});

describe('what the worker asks of a frame', () => {
  /** A plan whose Degree row carries two suggestions (the matcher's, by index and score only). */
  const withSuggestions = (plan: PlanOutput): PlanOutput => ({ ...plan, results: plan.results.map((row) => (row.label === 'Degree'
    ? { ...row, detail: { suggestions: [{ index: 1, score: 0.61 }, { index: 3, score: 0.55 }] } } : row)) });

  it('describes a row’s suggested options with their visible labels, read from a fresh scan', async () => {
    const { fake, runtime } = await startOn(trap07, trapUrl('07'), { editPlan: withSuggestions });
    expect(await runtime.fill()).toBe('review');
    const degree = fake.reports.at(-1)!.fields.find((row) => row.label === 'Degree')!;
    expect(await fake.platform.deliver({ v: 1, type: 'field/describe', fieldKey: degree.key })).toEqual({ ok: true,
      data: { options: [{ index: 1, label: 'High school' }, { index: 3, label: "Bachelor's Degree" }] } });
    const email = fake.reports.at(-1)!.fields.find((row) => row.label === 'Email')!;
    expect(await fake.platform.deliver({ v: 1, type: 'field/describe', fieldKey: email.key }))
      .toEqual({ ok: true, data: { options: [] } });
  });

  it('shows a field on request: scrolled into view and outlined, with no event on the field', async () => {
    const { fixture, fake, runtime } = await startOn(trap07, trapUrl('07'));
    expect(await runtime.fill()).toBe('review');
    const seen: string[] = [];
    const record = (event: Event) => seen.push(event.type);
    for (const type of ['focus', 'focusin', 'click', 'input']) fixture.doc.addEventListener(type, record, true);
    const email = fake.reports.at(-1)!.fields.find((row) => row.label === 'Email')!;
    expect(await fake.platform.deliver({ v: 1, type: 'field/focus', fieldKey: email.key })).toEqual({ ok: true, data: {} });
    expect(runtime.ui!.focusShown).toBe(true);
    expect(seen).toEqual([]);
    expect(fixture.doc.activeElement).toBe(fixture.doc.body);
  });

  it('starts a run on run/start, one at a time', async () => {
    const { fake, runtime } = await startOn(plain, trapUrl('start'));
    await fake.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await fake.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(runtime.run?.ended).toBe('review'));
    expect(fake.of('run/begin')).toEqual([expect.objectContaining({ trigger: 'panel', dryRun: false })]);
  });
});

describe('the launcher in the page', () => {
  it('sends panel/open inside the person’s click, with nothing awaited before it', async () => {
    const form = document.createElement('form');
    form.dataset.testRoot = '';
    form.style.cssText = 'display:block;width:640px;margin:40px';
    const label = document.createElement('label');
    label.htmlFor = 'launcher-test-email';
    label.textContent = 'Email';
    const input = document.createElement('input');
    input.id = 'launcher-test-email';
    input.type = 'email';
    form.append(label, input);
    document.body.append(form);
    let inClick = false;
    const opened: boolean[] = [];
    const fake = createFakeWorker({ onMessage: (message) => {
      if (message.type === 'panel/open') opened.push(inClick);
    } });
    const runtime = await startContentRuntime(fake.platform, document, { href: () => trapUrl('launcher'), isTop: true,
      quiet: { quietMs: 60 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('review');
    expect(input.value).toBe('alex.rivera.f7q2@example.com');
    const ui = runtime.ui!;
    expect(ui.launcher.view).toMatchObject({ state: 'review', action: 'open-review' });
    // Capture listeners on the host run before the launcher's handler, bubbling ones after it.
    ui.host.addEventListener('click', () => {
      inClick = true;
    }, { capture: true });
    ui.host.addEventListener('click', () => {
      inClick = false;
    });
    ui.launcher.el.click();
    expect(opened).toEqual([]);
    const host = ui.host.getBoundingClientRect();
    const box = ui.launcher.el.getBoundingClientRect();
    await userEvent.click(ui.host, { force: true, position: { x: box.left - host.left + 16, y: box.top - host.top + 16 } });
    expect(opened).toEqual([true]);
  });
});
