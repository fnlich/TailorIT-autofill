/*
 * jr8 ICIMS (the owner's report of 2026-11-13: "icims is not working well. from `apply` button to fill the content";
 * SP\jr8\ICIMS-8.md R2): Autofill on an iCIMS portal's posting presses Apply in the frame that claims the wrapper's
 * application, and iCIMS moves the top to /jobs/<id>/<slug>/login, a wrapper that reloads itself with its layout
 * parameters (src/adapters/icims/url.ts: ?mobile=...&needsRedirect=false&...) and draws the gate in its new
 * iframe#icims_content_iframe. The top's first /login document holds no frame of the application, and the gate's frame
 * may say hello before the reloaded wrapper does: the registry's top then wraps nothing, so the gate's frame is no claim
 * frame at its hello and its form was never started; the wrapper's own hello offered nothing (the agent's does: agent.ts
 * hello, "That frame's hello may have come first"). Measured end to end in Chrome (SP\jr8\ICIMS-8.md: the gate frame
 * registered with its form, no run, nothing typed). A claimed frame whose form found no claim frame at its hello now
 * waits for the top's next document: a wrapper whose claim frame it is offers it the entry grant's form, once; any other
 * top document lets it go. Addresses are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { FRAME_PROBE_GRACE_MS } from './frames';
import {
  advance, applyWorker, at, fill, hello, press, settle, starts, startsAfter, startsAt, TAB, wall,
} from './apply-worker.testkit';
import { NO_RECEIVER, type TestWorker } from './worker.testkit';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const HOST = 'https://careers-acme.icims.com';
const LAYOUT = 'mobile=false&width=1280&height=500&bga=true&needsRedirect=false&jan1offset=-480&jun1offset=-420';
/** The posting's wrapper and its claimed frame. */
const TOP = `${HOST}/jobs/1234/engineer/job?${LAYOUT}`;
const FRAME = `${HOST}/jobs/1234/engineer/job?in_iframe=1&${LAYOUT}`;
/** Where Apply takes the top: /login first, which reloads itself with its layout parameters, its gate in the frame. */
const LOGIN_FIRST = `${HOST}/jobs/1234/engineer/login`;
const LOGIN_TOP = `${HOST}/jobs/1234/engineer/login?${LAYOUT}`;
const LOGIN_FRAME = `${HOST}/jobs/1234/engineer/login?in_iframe=1&${LAYOUT}`;
const framed = (url: string, documentId: string, frameId: number) => at(url, documentId, TAB, { frameId });

/** The posting's wrapper and its claimed frame showing Apply; Autofill, then the frame's press. Every document named
 *  in `gone` no longer answers the sweep's ping. */
async function pressedOnPosting(gone: Set<string>): Promise<TestWorker> {
  const worker = await applyWorker();
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
  expect(startsAt(worker)).toEqual([{ frameId: 5, documentId: 'doc-frame', signIn: false }]);
  gone.add('doc-top');
  gone.add('doc-frame');
  return worker;
}

describe('jr8 ICIMS R2: the gate after Apply starts when the reloading wrapper says hello after its frame', () => {
  it("the top's first /login document, then the gate's frame, then the reloaded wrapper: the gate's run starts once",
    async () => {
      const gone = new Set<string>();
      const worker = await pressedOnPosting(gone);
      // The top's first /login document: an application page with no frame of its own.
      await hello(worker, at(LOGIN_FIRST, 'doc-login-first'), false);
      await settle();
      advance(worker, 50);
      gone.add('doc-login-first');
      // The gate's frame says hello before the reloaded wrapper: no claim frame yet, nothing started.
      await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true, claimed: true },
        framed(LOGIN_FRAME, 'doc-gate', 7));
      await settle();
      expect(starts(worker)).toHaveLength(1);
      advance(worker, 50);
      // The reloaded wrapper says hello: its claim frame is the gate's, which gets the grant's run/start.
      await hello(worker, at(LOGIN_TOP, 'doc-login-top'), false, { wraps: true });
      expect(await startsAfter(worker, 2)).toBe(2);
      expect(startsAt(worker)[1]).toEqual({ frameId: 7, documentId: 'doc-gate', signIn: false });
      // Once: the wrapper saying hello again, or the frame, starts nothing more.
      await hello(worker, at(LOGIN_TOP, 'doc-login-top'), false, { wraps: true });
      await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true, claimed: true },
        framed(LOGIN_FRAME, 'doc-gate', 7));
      await settle();
      expect(starts(worker)).toHaveLength(2);
    });

  it('the usual order (the wrapper first, then its frame) still starts the gate once, from the frame\'s hello', async () => {
    const gone = new Set<string>();
    const worker = await pressedOnPosting(gone);
    await hello(worker, at(LOGIN_TOP, 'doc-login-top'), false, { wraps: true });
    await settle();
    worker.timers.advance(FRAME_PROBE_GRACE_MS);
    await settle();
    expect(starts(worker)).toHaveLength(1);
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true, claimed: true },
      framed(LOGIN_FRAME, 'doc-gate', 7));
    expect(await startsAfter(worker, 2)).toBe(2);
    expect(startsAt(worker)[1]).toEqual({ frameId: 7, documentId: 'doc-gate', signIn: false });
  });

  it("never a frame that said hello before the top's previous document: it was that document's, gone", async () => {
    const gone = new Set<string>();
    const worker = await pressedOnPosting(gone);
    // A claimed frame with a form under the top's first /login document (whose next document came after it).
    await hello(worker, at(LOGIN_FIRST, 'doc-login-first'), false);
    advance(worker, 50);
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true, claimed: true },
      framed(LOGIN_FRAME, 'doc-gate-old', 7));
    advance(worker, 50);
    // The top loads once more before the wrapper (a second reload): the old frame belongs to a document now gone.
    await hello(worker, at(LOGIN_FIRST, 'doc-login-again'), false);
    advance(worker, 50);
    await hello(worker, at(LOGIN_TOP, 'doc-login-top'), false, { wraps: true });
    await settle();
    expect(starts(worker)).toHaveLength(1);
  });

  it('nothing without a grant: a plain page load of the reloading wrapper starts no run', async () => {
    const worker = await applyWorker();
    await hello(worker, at(LOGIN_FIRST, 'doc-login-first'), false);
    advance(worker, 50);
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true, claimed: true },
      framed(LOGIN_FRAME, 'doc-gate', 7));
    advance(worker, 50);
    await hello(worker, at(LOGIN_TOP, 'doc-login-top'), false, { wraps: true });
    await settle();
    expect(starts(worker)).toHaveLength(0);
  });
});
