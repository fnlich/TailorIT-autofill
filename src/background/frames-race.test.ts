/*
 * jr6 SHELL-B (INTEGRATION.md SHELL-B item 2; F3a.md's open issue; the apply audit's AP-2 race, SP\jr6\audit\apply-a.md):
 * an iCIMS company wrapper reloads at /login after its Apply, with a fresh claimed frame below it. When that frame says
 * hello before the old claimed frame is swept (FRAME_PROBE_GRACE_MS), the registry holds two claimed frames: the claim
 * (frames.ts claimFrameOf) now goes to the one that holds a form, so the gate's run starts in it, once. The worker as
 * index.ts wires it, with synthetic addresses of the acme portal (as jr6-grant-worker.test.ts's wrapper case).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { applyWorker, at, fill, hello, pageOf, press, settle, startsAfter, startsAt, TAB, wall } from './apply-worker.testkit';
import { NO_RECEIVER } from './worker.testkit';

const TOP = 'https://careers-acme.icims.com/jobs/1234/job?mobile=false&needsRedirect=false';
const FRAME = `${TOP}&in_iframe=1`;
const GATE_TOP = 'https://careers-acme.icims.com/jobs/1234/x/login';
const GATE_FRAME = `${GATE_TOP}?in_iframe=1`;
const framed = (url: string, documentId: string, frameId: number) => at(url, documentId, TAB, { frameId });

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

/** The wrapper's posting, its claimed frame offering the site's Apply; Autofill pressed it there. */
async function pressedInWrapper() {
  const worker = await applyWorker();
  // The documents the reload replaced answer nothing from now on (Chrome's "no receiving end").
  const gone = new Set<string>();
  worker.fakes.frameAnswers = ({ options }) => {
    if (options?.documentId !== undefined && gone.has(options.documentId)) throw new Error(NO_RECEIVER);
    return { ok: true, data: { pong: true } };
  };
  await hello(worker, at(TOP, 'doc-top'), false, { wraps: true });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false, claimed: true },
    framed(FRAME, 'doc-frame', 5));
  await wall(worker, framed(FRAME, 'doc-frame', 5), { entry: true });
  expect(await fill(worker)).toEqual({ ok: true, data: { frames: 1 } });
  expect(await press(worker, framed(FRAME, 'doc-frame', 5))).toEqual({ ok: true, data: {} });
  gone.add('doc-top');
  gone.add('doc-frame');
  return worker;
}

describe('the claim after a wrapper reloads (jr6 SHELL-B, AP-2)', () => {
  it('starts the gate’s run in the new claimed frame that says hello before the old one is swept', async () => {
    const worker = await pressedInWrapper();
    // The top reloads at /login; its new claimed frame shows the gate (a form root) before any sweep forgot the old one.
    await hello(worker, at(GATE_TOP, 'doc-top-2'), false, { wraps: true });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true, claimed: true },
      framed(GATE_FRAME, 'doc-gate', 6));
    expect(await startsAfter(worker, 2)).toBe(2);
    expect(startsAt(worker)[1]).toEqual({ frameId: 6, documentId: 'doc-gate', signIn: false });
    // The panel's page is the gate's (its frame the tab's application frame), not the old posting's entry.
    expect(await pageOf(worker)).toMatchObject({ support: 'form' });
    expect((await pageOf(worker))?.entry).toBeUndefined();
  });

  it('also when the new frame says hello before the new top, and only once', async () => {
    const worker = await pressedInWrapper();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true, claimed: true },
      framed(GATE_FRAME, 'doc-gate', 6));
    expect(await startsAfter(worker, 2)).toBe(2);
    expect(startsAt(worker)[1]).toEqual({ frameId: 6, documentId: 'doc-gate', signIn: false });
    await hello(worker, at(GATE_TOP, 'doc-top-2'), false, { wraps: true });
    // The same gate document says hello again: started once.
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true, claimed: true },
      framed(GATE_FRAME, 'doc-gate', 6));
    await settle();
    expect(startsAt(worker)).toHaveLength(2);
  });
});
