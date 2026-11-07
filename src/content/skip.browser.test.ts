/*
 * v3 Phase 3 in the content script: the run's live progress (report/live: "Scanning the page", then the rows with the
 * field being written now), and Skip: the side panel's run/skip gives up the one write being made (a resume that never
 * arrives, here), flags its row skipped-by-you, writes nothing into it, and the run goes on with the fields after it.
 * A Skip for another field, or for none, is refused. Keys only travel: never a value.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { loadFixture, logEvents, removeFixtures } from '../dom/fixture.testkit';
import type { Adapter } from '../adapters/types';
import { genericAdapter } from '../adapters/generic';
import {
  createFakeWorker, fakePdf, testVocab, trapUrl, VALUE_SENTINELS, type FakeWorker, type FakeWorkerOptions,
} from './content.testkit';
import { CAUTIOUS_SETTINGS } from '../core/plan/settings.testkit';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { progressOf, type FrameReport } from '../shared/report';
import { startContentRuntime, type ContentRuntime } from './runtime';

let logs: MockInstance;
beforeAll(() => {
  testVocab();
  logs = vi.spyOn(console, 'info');
});
afterAll(() => logs.mockRestore());

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** A plain page: Email, then a resume upload, then Phone. */
const PAGE = `<!doctype html><html><head><style>body{margin:0;background:#fff;color:#222;font:16px/1.5 system-ui,sans-serif}
  form>label{display:block;margin-top:12px}</style></head><body><main><h1>Engineer</h1><p>A visible description of the
  role.</p><form action="/__submitted" method="post"><label for="email">Email</label><input id="email" type="email"
  name="email"><label for="cv">Resume/CV</label><input id="cv" type="file" accept=".pdf" name="resume">
  <label for="phone">Phone</label><input id="phone" type="tel" name="phone"><button type="submit">Submit application</button>
  </form></main></body></html>`;

async function start(id: string, hang: boolean, options: { adapters?: (url: URL) => Adapter[];
  worker?: FakeWorkerOptions; settle?: { quietMs: number; capMs?: number } } = {}) {
  const fixture = await loadFixture(document, PAGE);
  const events = logEvents(fixture.doc);
  const worker = createFakeWorker({ resume: { bytes: fakePdf(4096), name: 'Alex Rivera Resume.pdf',
    mime: 'application/pdf', hang }, ...options.worker });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl(id), isTop: true,
    settle: options.settle ?? { quietMs: 60 }, resume: { idleMs: 60_000 }, ...(options.adapters === undefined ? {} : { adapters: options.adapters }) });
  runtimes.push(runtime);
  return { fixture, events, worker, runtime };
}

/** The key of the field being written now once the live report names the one labelled `label`. */
async function currentKey(worker: FakeWorker, label: string): Promise<string> {
  let key: string | null = null;
  await vi.waitFor(() => {
    const live = worker.liveReports.find((report) => report.fields.find((row) => row.key === report.filling?.current)
      ?.label === label);
    key = live?.filling?.current ?? null;
    expect(key).not.toBeNull();
  }, { timeout: 5_000 });
  return key!;
}

describe('Skip and the live progress (v3 Phase 3)', () => {
  it('gives up the one write being made at the person’s Skip, flags it, and fills the fields after it', async () => {
    const { fixture, events, worker, runtime } = await start('skip-cv', true);
    const ending = runtime.fill()!;
    // The side panel learns which field is being written from the live report (keys only), as the person would see it.
    await vi.waitFor(() => expect(worker.liveReports.some((report) => report.filling?.current !== null
      && report.fields.find((row) => row.key === report.filling?.current)?.label === 'Resume/CV')).toBe(true),
    { timeout: 5_000 });
    const live = worker.liveReports.find((report) => report.fields.find((row) => row.key === report.filling?.current)
      ?.label === 'Resume/CV')!;
    const cvKey = live.filling!.current!;
    // The first live report said "Scanning the page": no row, nothing being written.
    expect(worker.liveReports[0]).toMatchObject({ status: 'scan-step', fields: [], filling: { current: null, pending: [] } });
    expect(live.filling!.pending).toContain(cvKey);
    // Skip for a field not being written now is refused.
    expect(await worker.platform.deliver({ v: 1, type: 'run/skip', fieldKey: 'lever|main|nothing|none|0' }))
      .toEqual({ ok: false, error: 'expired' });
    expect(await worker.platform.deliver({ v: 1, type: 'run/skip', fieldKey: cvKey })).toEqual({ ok: true, data: {} });
    expect(await ending).toBe('review');
    const report = worker.reports.at(-1)!;
    const rowOf = (label: string) => report.fields.find((row) => row.label === label)!;
    expect(rowOf('Resume/CV')).toMatchObject({ status: 'flagged', reason: 'skipped-by-you', wrote: false, provenance: null,
      needsUserAction: true });
    expect((fixture.doc.getElementById('cv') as HTMLInputElement).files?.length ?? 0).toBe(0);
    expect(events.on('cv')).toEqual([]);
    // The run went on: the field after it was filled.
    expect(rowOf('Phone')).toMatchObject({ status: 'verified', wrote: true });
    expect((fixture.doc.getElementById('phone') as HTMLInputElement).value).not.toBe('');
    // The run's own report says more than its progress: no live report after it, and none carries a value.
    expect(report.filling).toBeUndefined();
    for (const each of worker.liveReports) {
      for (const sentinel of VALUE_SENTINELS) expect(JSON.stringify(each)).not.toContain(sentinel);
    }
    // A Skip once the run rests is refused.
    expect(await worker.platform.deliver({ v: 1, type: 'run/skip', fieldKey: cvKey })).toEqual({ ok: false, error: 'expired' });
  });

  it('sends its live progress as report/live, never as report/put, and the launcher’s badge shows the percent', async () => {
    // The badge as each live report goes: the percent the panels show, by the same rule (shared/report.ts progressOf).
    const held: { runtime: ContentRuntime | null } = { runtime: null };
    const badges: Array<{ shown: number | undefined; expected: number | undefined }> = [];
    const { worker, runtime } = await start('skip-live', false, { worker: { onMessage(message) {
      if (message.type !== 'report/live') return;
      const report = (message as { report?: unknown }).report as FrameReport;
      const progress = progressOf([report]);
      badges.push({ shown: held.runtime?.ui?.launcher.view.percent, expected: progress.of > 0 ? progress.percent : undefined });
    } } });
    held.runtime = runtime;
    expect(await runtime.fill()).toBe('review');
    expect(badges.some((badge) => badge.expected !== undefined)).toBe(true);
    for (const badge of badges) expect(badge.shown).toBe(badge.expected);
    expect(worker.liveReports.length).toBeGreaterThan(0);
    expect(worker.liveReports.every((report) => report.filling !== undefined)).toBe(true);
    expect(worker.reports.every((report) => report.filling === undefined)).toBe(true);
    // At rest the badge counts what needs the person again, by the review's own rule.
    expect(runtime.ui!.launcher.view.state).toBe('review');
  });

  it('keeps a file already put into its input when Skip ends the wait for the page’s upload: upload-not-confirmed', async () => {
    // A page that never says the upload is done (Adapter.uploadState: pending until its cap).
    const pending: Adapter = { ...genericAdapter, uploadState: () => 'pending' };
    const { fixture, worker, runtime } = await start('skip-upload', false, { adapters: () => [pending] });
    const ending = runtime.fill()!;
    const cvKey = await currentKey(worker, 'Resume/CV');
    const cv = fixture.doc.getElementById('cv') as HTMLInputElement;
    await vi.waitFor(() => expect(cv.files?.length ?? 0).toBe(1), { timeout: 5_000 });
    expect(await worker.platform.deliver({ v: 1, type: 'run/skip', fieldKey: cvKey })).toEqual({ ok: true, data: {} });
    expect(await ending).toBe('review');
    const report = worker.reports.at(-1)!;
    const rowOf = (label: string) => report.fields.find((row) => row.label === label)!;
    // Written, never verified, and left for a look: the file stays where it was put.
    expect(rowOf('Resume/CV')).toMatchObject({ reason: 'upload-not-confirmed', wrote: true, status: 'flagged',
      needsUserAction: true });
    expect(cv.files?.length).toBe(1);
    expect(rowOf('Phone')).toMatchObject({ status: 'verified', wrote: true });
  });

  it('holds the Skip on a later attempt at the same step: the field is never planned or written again', async () => {
    const { fixture, worker, runtime } = await start('skip-later', true, { settle: { quietMs: 60, capMs: 800 } });
    const ending = runtime.fill()!;
    const cvKey = await currentKey(worker, 'Resume/CV');
    // An email code box shows at the Skip (v4: a page still busy no longer pauses, D7): the pass stops, paused there.
    const code = fixture.doc.createElement('div');
    const label = fixture.doc.createElement('label');
    label.htmlFor = 'vcode';
    label.textContent = 'Verification code';
    const box = fixture.doc.createElement('input');
    box.id = 'vcode';
    box.name = 'vcode';
    code.append(label, box);
    fixture.doc.querySelector('form')!.append(code);
    expect(await worker.platform.deliver({ v: 1, type: 'run/skip', fieldKey: cvKey })).toEqual({ ok: true, data: {} });
    expect(await ending).toBe('paused');
    // The code entered, its box goes: the run carries on by itself (v4, D10), the same step again from the books the
    // first attempt left.
    code.remove();
    await vi.waitFor(() => expect(worker.of('run/begin')).toHaveLength(2), { timeout: 5_000 });
    await vi.waitFor(() => expect(worker.reports.at(-1)!.status).toBe('review'), { timeout: 8_000 });
    const report = worker.reports.at(-1)!;
    expect(report.fields.find((row) => row.label === 'Resume/CV')).toMatchObject({ reason: 'skipped-by-you',
      wrote: false });
    expect((fixture.doc.getElementById('cv') as HTMLInputElement).files?.length ?? 0).toBe(0);
    // The one resume asked for is the first attempt's: the hanging one, never asked again.
    expect(worker.portLog.filter((entry) => entry.message.type === 'resume/request')).toHaveLength(1);
  });

  it('counts the fields waiting for the AI as still being filled, never as left for the person', async () => {
    // First name from the profile; a list and a question the plan leaves for the AI (a pick and a classification).
    const fixture = await loadFixture(document, `<!doctype html><html><body><main><h1>Platform Engineer</h1>
      <form action="/__submitted" method="post"><label for="first">First name</label><input id="first" name="first">
      <label for="source">How did you hear about us?</label><select id="source" name="source"><option value="">Select...</option>
      <option value="post">LinkedIn job post</option><option value="message">LinkedIn recruiter message</option></select>
      <label for="work">Where do you work today?</label><input id="work" name="work">
      <button type="submit">Submit application</button></form></main></body></html>`);
    let runtime: ContentRuntime | null = null;
    const badge: Array<number | undefined> = [];
    const worker = createFakeWorker({ settings: CAUTIOUS_SETTINGS, ai: {
      pick: (item) => ({ picked: item.candidates.findIndex((candidate) => candidate.label === 'LinkedIn job post'),
        why: 'ok' }),
      classify: (item) => ({ key: item.key, category: 'current_employer', why: 'ok' }),
    }, onMessage(message) {
      // How far the fill is as the AI's answers are asked for: the launcher's badge, by the panels' own rule.
      if (message.type === 'plan/poll') badge.push(runtime?.ui?.launcher.view.percent);
    } });
    runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl('ai-waiting'), isTop: true,
      settle: { quietMs: 60 }, ai: { pollMs: 20, capMs: 2_000 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('review');
    // While both waited: First name filled, the two waiting still being filled (1 of 3), never 100%.
    expect(badge[0]).toBe(33);
    expect(worker.reports.at(-1)!.fields.filter((row) => row.wrote)).toHaveLength(3);
  });
});

describe('Skip on a field whose AI answer the run waits for (v3 Phase 3 review)', () => {
  it('gives up that field’s answer: flagged skipped-by-you, and the run comes to rest without it', async () => {
    const fixture = await loadFixture(document, `<!doctype html><html><body><main><h1>Platform Engineer</h1>
      <form action="/__submitted" method="post"><label for="first">First name</label><input id="first" name="first">
      <label for="source">How did you hear about us?</label><select id="source" name="source"><option value="">Select...</option>
      <option value="post">LinkedIn job post</option><option value="message">LinkedIn recruiter message</option></select>
      <button type="submit">Submit application</button></form></main></body></html>`);
    // The AI's pick for the list never comes.
    const worker = createFakeWorker({ settings: CAUTIOUS_SETTINGS, aiHold: true });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl('ai-skip'), isTop: true,
      settle: { quietMs: 60 }, ai: { pollMs: 20, capMs: 60_000 } });
    runtimes.push(runtime);
    const ending = runtime.fill()!;
    const key = await currentKey(worker, 'How did you hear about us?');
    expect(await worker.platform.deliver({ v: 1, type: 'run/skip', fieldKey: key })).toEqual({ ok: true, data: {} });
    expect(await ending).toBe('review');
    const report = worker.reports.at(-1)!;
    expect(report.fields.find((row) => row.label === 'How did you hear about us?')).toMatchObject({
      reason: 'skipped-by-you', wrote: false });
    expect((fixture.doc.getElementById('source') as HTMLSelectElement).value).toBe('');
    expect(report.fields.find((row) => row.label === 'First name')).toMatchObject({ status: 'verified', wrote: true });
  });

  it('takes a Skip sent while a poll for the answer is out, and never loses it (the audit of 2026-11-06, m5)', async () => {
    const LABEL = 'How did you hear about us?';
    const fixture = await loadFixture(document, `<!doctype html><html><body><main><h1>Platform Engineer</h1>
      <form action="/__submitted" method="post"><label for="first">First name</label><input id="first" name="first">
      <label for="source">${LABEL}</label><select id="source" name="source"><option value="">Select...</option>
      <option value="post">LinkedIn job post</option><option value="message">LinkedIn recruiter message</option></select>
      <button type="submit">Submit application</button></form></main></body></html>`);
    // The AI's pick never comes; the first poll answers at once, the second only when the test lets it.
    let key = '';
    let polls = 0;
    const held = () => ({ ok: true, data: { writes: [], results: [], awaiting: [key], persistableCanaries: [],
      savable: [], aiEditable: [] } });
    let answerFirst: (value: unknown) => void = () => undefined;
    let answerSecond: (value: unknown) => void = () => undefined;
    const first = new Promise((resolve) => {
      answerFirst = resolve;
    });
    const second = new Promise((resolve) => {
      answerSecond = resolve;
    });
    const worker = createFakeWorker({ settings: CAUTIOUS_SETTINGS, aiHold: true, script: { 'plan/poll': [first, second] },
      onMessage(message) {
        if (message.type === 'plan/request') {
          const specs = (message as { specs?: Array<{ key: string; label: string }> }).specs ?? [];
          key = specs.find((spec) => spec.label === LABEL)?.key ?? key;
        }
        if (message.type !== 'plan/poll') return;
        polls += 1;
        if (polls === 1) answerFirst(held());
      } });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl('ai-skip-poll'),
      isTop: true, settle: { quietMs: 60 }, ai: { pollMs: 20, capMs: 60_000 } });
    runtimes.push(runtime);
    const ending = runtime.fill()!;
    const shown = await currentKey(worker, LABEL);
    // The second poll is out, unanswered: the person's Skip then is taken.
    await vi.waitFor(() => expect(polls).toBe(2), { timeout: 5_000 });
    expect(await worker.platform.deliver({ v: 1, type: 'run/skip', fieldKey: shown })).toEqual({ ok: true, data: {} });
    answerSecond(held());
    expect(await ending).toBe('review');
    const report = worker.reports.at(-1)!;
    expect(report.fields.find((row) => row.label === LABEL)).toMatchObject({ reason: 'skipped-by-you', wrote: false });
    expect((fixture.doc.getElementById('source') as HTMLSelectElement).value).toBe('');
  });
});

describe('Skip on a widget whose option was already clicked (the audit of 2026-11-06: m11, pass.ts afterWait)', () => {
  /** A select-only list whose page takes a click slowly: busy at once, its choice shown 1.2 s later. */
  const SLOW_LIST = `<!doctype html><html><head><style>body{margin:0;background:#fff;color:#222;font:16px/1.5 system-ui}
    [role=listbox]{margin:0;border:1px solid #888}[role=listbox][hidden]{display:none}</style></head><body><main>
    <h1>Engineer</h1><p>A visible description of the role.</p><form action="/__submitted" method="post">
    <label for="email">Email</label><input id="email" type="email" name="email">
    <span id="q">Country</span>
    <div id="cb" role="combobox" tabindex="0" aria-labelledby="q" aria-haspopup="listbox" aria-controls="cl"
      aria-expanded="false">Select a country</div>
    <ul id="cl" role="listbox" aria-labelledby="q" hidden><li id="us" role="option" aria-selected="false">United States</li>
      <li id="ca" role="option" aria-selected="false">Canada</li></ul>
    <label for="phone">Phone</label><input id="phone" type="tel" name="phone">
    <button type="submit">Submit application</button></form></main>
    <script>
      const cb = document.getElementById('cb');
      const cl = document.getElementById('cl');
      cb.addEventListener('click', () => { cl.hidden = !cl.hidden; cb.setAttribute('aria-expanded', String(!cl.hidden)); });
      for (const option of cl.querySelectorAll('[role=option]')) option.addEventListener('click', () => {
        window.clicked = (window.clicked ?? 0) + 1;
        cl.hidden = true;
        cb.setAttribute('aria-expanded', 'false');
        cb.setAttribute('aria-busy', 'true');
        setTimeout(() => { cb.textContent = option.textContent; option.setAttribute('aria-selected', 'true');
          cb.removeAttribute('aria-busy'); }, 1200);
      });
    </script></body></html>`;

  it('keeps the click as written (never skipped-by-you), and the field is never written again', async () => {
    const fixture = await loadFixture(document, SLOW_LIST);
    const worker = createFakeWorker({ settings: CAUTIOUS_SETTINGS });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl('skip-clicked'),
      isTop: true, settle: { quietMs: 60, capMs: 6_000 } });
    runtimes.push(runtime);
    const ending = runtime.fill()!;
    const key = await currentKey(worker, 'Country');
    const view = fixture.view as unknown as { clicked?: number };
    // The person's Skip once the option was clicked, while the page still shows it busy.
    await vi.waitFor(() => expect(view.clicked).toBe(1), { timeout: 5_000 });
    expect(await worker.platform.deliver({ v: 1, type: 'run/skip', fieldKey: key })).toEqual({ ok: true, data: {} });
    expect(await ending).toBe('review');
    const report = worker.reports.at(-1)!;
    const country = report.fields.find((row) => row.label === 'Country')!;
    expect(country.reason).not.toBe('skipped-by-you');
    expect(country).toMatchObject({ wrote: true });
    expect(report.fields.find((row) => row.label === 'Phone')).toMatchObject({ status: 'verified', wrote: true });
    await vi.waitFor(() => expect(fixture.doc.getElementById('cb')!.textContent).toBe('United States'));
    expect(view.clicked).toBe(1);
  });
});

describe('the launcher’s tab beside the browser’s side panel (v3 Phase 3 review)', () => {
  it('stays hidden in a page that loads while the side panel shows its tab, and shows once the panel leaves it', async () => {
    const fixture = await loadFixture(document, PAGE);
    const settings = { panel: DEFAULT_SETTINGS.panel, llm: DEFAULT_SETTINGS.llm,
      modes: { next: DEFAULT_SETTINGS.modes.next, afterPageTurn: DEFAULT_SETTINGS.modes.afterPageTurn, submit: DEFAULT_SETTINGS.modes.submit, agentSkip: DEFAULT_SETTINGS.modes.agentSkip, signIn: DEFAULT_SETTINGS.modes.signIn },
      offerToSaveAnswers: DEFAULT_SETTINGS.offerToSaveAnswers };
    // The worker's answer to this document's hello: the side panel shows the tab (it told the page before this one).
    const worker = createFakeWorker({ script: { 'frame/hello': [{ ok: true, data: { frameId: 0, connected: true, settings,
      side: true } }] } });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl('side-reload'),
      isTop: true, settle: { quietMs: 60 } });
    runtimes.push(runtime);
    await vi.waitFor(() => expect(runtime.ui?.edge ?? null).not.toBeNull());
    await vi.waitFor(() => expect(worker.of('frame/hello').length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(runtime.ui!.edge!.el.hidden).toBe(true));
    expect(await worker.platform.deliver({ v: 1, type: 'panel/side', open: false })).toEqual({ ok: true, data: {} });
    await vi.waitFor(() => expect(runtime.ui!.edge!.el.hidden).toBe(false));
  });
});

describe('the frame’s word that its form asks for a cover letter (v3 Phase 3 review)', () => {
  const page = (letter: string) => `<!doctype html><html><body><main><h1>Engineer</h1><form action="/__submitted"
    method="post"><label for="email">Email</label><input id="email" type="email" name="email">${letter}
    <button type="submit">Submit application</button></form></main></body></html>`;
  async function hello(html: string, id: string) {
    const fixture = await loadFixture(document, html);
    const worker = createFakeWorker();
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl(id), isTop: true,
      settle: { quietMs: 60 } });
    runtimes.push(runtime);
    await vi.waitFor(() => expect(worker.of('frame/hello').some((message) => message.hasForm === true)).toBe(true));
    return worker.of('frame/hello').filter((message) => message.hasForm === true).at(-1)!;
  }

  it('says so for a cover letter field a person can see', async () => {
    expect(await hello(page('<label for="cl">Cover letter</label><input id="cl" type="file" name="cl">'), 'letter-shown'))
      .toMatchObject({ letter: true });
  });

  it('never for one only an unseen name calls a cover letter', async () => {
    expect(await hello(page('<textarea id="cl" name="cl" aria-label="Cover letter"></textarea>'), 'letter-unseen'))
      .not.toHaveProperty('letter');
  });
});

