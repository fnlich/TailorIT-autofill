/*
 * The snapshot build of 2026-11-06 (core-x, items 7 and 14; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06) in the content runtime: a top frame's
 * page whose address names no job (SuccessFactors' /career post-back with _s.crb and no job) names its chain in its
 * hello by its referrer's hash,
 * and takes the application the worker's answer gives it: its form is read then, the worker told of it, and its run
 * begins under that application's key. With no chain given, it stays as before: no form, no run. The form here is a
 * plain stand-in read by the generic adapter (the wiring is what is tested, no platform rule).
 * The behaviour review of 2026-11-06 (minor 9): SuccessFactors' /portalcareer (the application form after the account,
 * the owner's snapshot [career8...] "Apply for ... (4984)", not converted: it holds the person's history) is no chain
 * page until a fixture shows it: it names no chain, takes none, and no run fills it.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { applicationOf } from '../adapters';
import { hrefHash } from '../adapters/chain';
import { wrapperOf } from './chain-frame';
import { genericAdapter } from '../adapters/generic';
import { CAUTIOUS_SETTINGS } from '../core/plan/settings.testkit';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const ACCOUNT = 'https://career8.successfactors.com/career?company=donnelleyf&login_ns=register&career_job_req_id=4984&_s.crb=T1';
const FORM = 'https://career8.successfactors.com/career?_s.crb=T2';
const PORTAL_FORM = 'https://career8.successfactors.com/portalcareer?_s.crb=T2';
const PAGE = `<!doctype html><html><head><title>Apply</title></head><body>
  <form id="careerform" method="post" action="/career">
    <label for="first">First Name</label><input id="first" name="first" type="text">
    <label for="last">Last Name</label><input id="last" name="last" type="text">
    <label for="email">Email Address</label><input id="email" name="email" type="email">
    <button type="submit">Save</button>
  </form></body></html>`;

/** The content settings the fake worker answers (content.testkit.ts createFakeWorker), for a scripted hello. */
const SETTINGS = { panel: CAUTIOUS_SETTINGS.panel, modes: { next: CAUTIOUS_SETTINGS.modes.next,
  afterPageTurn: CAUTIOUS_SETTINGS.modes.afterPageTurn, submit: CAUTIOUS_SETTINGS.modes.submit,
  agentSkip: CAUTIOUS_SETTINGS.modes.agentSkip, signIn: CAUTIOUS_SETTINGS.modes.signIn },
llm: { ...CAUTIOUS_SETTINGS.llm }, offerToSaveAnswers: CAUTIOUS_SETTINGS.offerToSaveAnswers };

beforeAll(() => testVocab());
const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

describe('a top frame’s chain page in the content runtime (core-x, items 7 and 14)', () => {
  it('names its referrer’s hash, takes the application the worker gives it, and runs under that key', async () => {
    const key = applicationOf(new URL(ACCOUNT))!.applicationKey;
    const worker = createFakeWorker({ script: { 'frame/hello': [{ ok: true, data: { frameId: 0, connected: true,
      settings: SETTINGS, chained: { applicationKey: key } } }] } as never });
    const fixture = await loadFixture(document, PAGE);
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => FORM, isTop: true,
      referrer: () => ACCOUNT, adapters: () => [genericAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    const hellos = worker.of('frame/hello');
    expect(hellos[0]).toMatchObject({ chain: { from: hrefHash(ACCOUNT) }, hasForm: false });
    // Keyed: its form read, the worker told of it (no chain named again).
    expect(runtime.page?.app.applicationKey).toBe(key);
    await expect.poll(() => worker.of('frame/hello').length).toBeGreaterThan(1);
    expect(worker.of('frame/hello')[1]).toMatchObject({ hasForm: true });
    expect(worker.of('frame/hello')[1]!.chain).toBeUndefined();
    await runtime.fill();
    expect(worker.of('run/begin')[0]).toMatchObject({ applicationKey: key });
  });

  it('stays as before where the worker gives no chain: no form, no run; and names none without a referrer', async () => {
    const worker = createFakeWorker();
    const fixture = await loadFixture(document, PAGE);
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => FORM, isTop: true,
      referrer: () => ACCOUNT, adapters: () => [genericAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(worker.of('frame/hello')).toHaveLength(1);
    expect(runtime.page).toBeNull();
    expect(runtime.fill()).toBeNull();
    removeFixtures(document);
    const silent = createFakeWorker();
    const again = await loadFixture(document, PAGE);
    const second = await startContentRuntime(silent.platform, again.doc, { href: () => FORM, isTop: true,
      referrer: () => '', adapters: () => [genericAdapter], settle: { quietMs: 40 } });
    runtimes.push(second);
    expect(silent.of('frame/hello')).toEqual([]);
    expect(second.page).toBeNull();
  });

  it('takes no chain on SuccessFactors’ /portalcareer, whatever the worker answers: no form, no run (minor 9)',
    async () => {
      const key = applicationOf(new URL(ACCOUNT))!.applicationKey;
      const worker = createFakeWorker({ script: { 'frame/hello': [{ ok: true, data: { frameId: 0, connected: true,
        settings: SETTINGS, chained: { applicationKey: key } } }] } as never });
      const fixture = await loadFixture(document, PAGE.replace('action="/career"', 'action="/portalcareer"'));
      const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => PORTAL_FORM, isTop: true,
        referrer: () => ACCOUNT, adapters: () => [genericAdapter], settle: { quietMs: 40 } });
      runtimes.push(runtime);
      expect(worker.of('frame/hello').every((hello) => hello.chain === undefined)).toBe(true);
      expect(runtime.page).toBeNull();
      expect(runtime.fill()).toBeNull();
      expect(worker.of('run/begin')).toEqual([]);
    });
});

// The behaviour review of 2026-11-06 (minor 17, CF3): a frame has a wrapper only directly below the tab's top frame.
describe('a subframe’s wrapper (content/chain-frame.ts wrapperOf)', () => {
  it('is none for a frame whose parent is itself a frame, though of the same origin (CF3)', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><iframe id="inner" srcdoc="<p>inner</p>"></iframe></body>');
    const inner = fixture.doc.getElementById('inner') as HTMLIFrameElement;
    await expect.poll(() => inner.contentDocument?.querySelector('p') ?? null).not.toBeNull();
    // Its parent (the fixture's frame) can be read, but is not the top frame.
    expect(inner.contentWindow!.parent).toBe(fixture.view);
    expect(fixture.view.top).not.toBe(fixture.view);
    expect(wrapperOf(inner.contentWindow)).toBeNull();
  });
});
