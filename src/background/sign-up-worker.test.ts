/*
 * v4 (the owner, 2026-11-07; docs/SPEC-AMENDMENTS.md §13), the worker's side:
 * - "Sign up & Autofill" (panel/fill {signIn: true}): for that one run in that tab, Sign-in acts as Auto (the tab's
 *   content settings, and signin/credential), with every refusal Sign-in Auto has (credentials:read, the disclosure
 *   acknowledged, once per tab, wall and host); another tab, a dry run, and the run's end (its report at review) are
 *   outside it, and Sign-in Manual stays as it was otherwise.
 * - PageState.wall: the account wall the tab's application frame (its top frame, or the claim frame) says it shows
 *   (frame/wall), kept while that document says hello again, gone with it.
 * - A wall with no form: Autofill reaches the wall's frame (run/start), and the tab's next form is started once.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { SIGN_UP_GRANT_MS } from './sign-up';
import {
  beginRun, contentSender, frameReport, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent,
  type TestWorker,
} from './worker.testkit';

const OPTIONS = pageSender('options.html');
const PANEL = pageSender();
const WORKDAY = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/login';
const PASSWORD = 'dummy-password-not-real';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

/** The Workday account page's top frame of tab `tab`, as Chrome reports it. */
const top = (tab = 12, overrides: Record<string, unknown> = {}) => contentSender({ url: WORKDAY,
  tab: { id: tab, url: WORKDAY }, documentId: `doc-${tab}`, ...overrides });
const ask = (worker: TestWorker, sender = top()) =>
  worker.deliver({ v: 1, type: 'signin/credential', wall: 'sign-in' }, sender);
const fill = (worker: TestWorker, tabId: number, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'panel/fill', tabId, dryRun: false, ...extra }, PANEL);
const pageOf = async (worker: TestWorker, tabId: number) => ((await worker.deliver({ v: 1, type: 'panel/reports',
  tabId }, PANEL)) as { data: { page?: Record<string, unknown> } }).data.page;

/** A worker with Sign-in on Manual (the default), a connection that may read sign-ins (unless `scopes` is false), and
 *  TailorIT holding the Workday sign-in. */
async function signUpWorker(options: { scopes?: boolean; disclosure?: number } = {}) {
  const record = tokenRecord();
  const scopes = options.scopes === false ? record.scopes.filter((scope) => scope !== 'credentials:read') : record.scopes;
  const worker = await startTestWorker({ token: tokenRecord({ scopes }),
    ...(options.disclosure === undefined ? {} : { disclosure: options.disclosure }) });
  await worker.deliver({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS }, OPTIONS);
  worker.tailorit.reply('GET /api/autofill/credentials', { json: { host: 'acme.wd5.myworkdayjobs.com',
    email: 'alex.rivera@example.com', password: PASSWORD } });
  return worker;
}

/** The settings/changed the worker last told a frame of `tabId`. */
const lastSettingsTo = (worker: TestWorker, tabId: number) => (sentToFrames(worker)
  .filter((sent) => sent.tabId === tabId && typeOfSent(sent) === 'settings/changed').at(-1)?.message as
  { settings: { modes: { signIn: string } } } | undefined)?.settings.modes.signIn;

describe('Sign up & Autofill: Sign-in Auto for one run, in one tab (v4)', () => {
  it('starts the tab’s form with {signIn}, tells its frames Sign-in Auto, and answers the credential for that tab alone', async () => {
    const worker = await signUpWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top());
    // Sign-in Manual: refused before the grant.
    expect(await ask(worker)).toEqual({ ok: false, error: 'unavailable' });
    expect(await fill(worker, 12, { signIn: true })).toEqual({ ok: true, data: { frames: 1 } });
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'run/start').map((sent) => sent.message))
      .toEqual([{ v: 1, type: 'run/start', dryRun: false, signIn: true }]);
    expect(lastSettingsTo(worker, 12)).toBe('auto');
    // The frame's next hello hears it too (and so does its run/begin: the same content settings).
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top()))
      .toMatchObject({ ok: true, data: { settings: { modes: { signIn: 'auto' } } } });
    expect(await ask(worker)).toMatchObject({ ok: true, data: { password: PASSWORD } });
    // Once per tab, wall and host still.
    expect(await ask(worker)).toEqual({ ok: false, error: 'expired' });
    // Another tab holds no grant: Sign-in Manual there.
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top(13));
    expect(await ask(worker, top(13))).toEqual({ ok: false, error: 'unavailable' });
  });

  it('keeps every refusal of Sign-in Auto: without credentials:read or the disclosure, nothing is answered', async () => {
    for (const options of [{ scopes: false }, { disclosure: 2 }]) {
      const worker = await signUpWorker(options);
      await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top());
      await fill(worker, 12, { signIn: true });
      expect(await ask(worker), JSON.stringify(options)).toEqual({ ok: false, error: 'unavailable' });
      expect(worker.tailorit.count('GET /api/autofill/credentials')).toBe(0);
    }
  });

  it('grants nothing in a dry run, and a plain Autofill ends the grant', async () => {
    const dry = await signUpWorker();
    await dry.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top());
    await fill(dry, 12, { signIn: true, dryRun: true });
    expect(sentToFrames(dry).filter((sent) => typeOfSent(sent) === 'run/start').map((sent) => sent.message))
      .toEqual([{ v: 1, type: 'run/start', dryRun: true }]);
    expect(await ask(dry)).toEqual({ ok: false, error: 'unavailable' });

    const worker = await signUpWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top());
    await fill(worker, 12, { signIn: true });
    await fill(worker, 12);
    expect(lastSettingsTo(worker, 12)).toBe('manual');
    expect(await ask(worker)).toEqual({ ok: false, error: 'unavailable' });
  });

  it('ends with the run: its report at review, or SIGN_UP_GRANT_MS', async () => {
    const worker = await signUpWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender({ tab: { id: 7 } }));
    await fill(worker, 7, { signIn: true });
    const runId = await beginRun(worker);
    // A report at a working status keeps it.
    await worker.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId, 0, { status: 'auth-needed' }) },
      contentSender());
    expect(lastSettingsTo(worker, 7)).toBe('auto');
    await worker.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId, 0, { status: 'review' }) },
      contentSender());
    await vi.waitFor(() => expect(lastSettingsTo(worker, 7)).toBe('manual'));

    const timed = await signUpWorker();
    await timed.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top());
    await fill(timed, 12, { signIn: true });
    timed.clock.now += SIGN_UP_GRANT_MS;
    expect(await ask(timed)).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('PageState.wall: the account wall the tab’s application frame shows (v4)', () => {
  it('is set by the top frame’s frame/wall, kept while its document says hello again, and cleared when it goes', async () => {
    const worker = await signUpWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top());
    expect((await pageOf(worker, 12))?.wall).toBeUndefined();
    expect(await worker.deliver({ v: 1, type: 'frame/wall', wall: 'create-account' }, top())).toEqual({ ok: true, data: {} });
    expect((await pageOf(worker, 12))?.wall).toBe('create-account');
    // The same document says hello again (a route of its own): the wall stays.
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, nav: 1 }, top());
    expect((await pageOf(worker, 12))?.wall).toBe('create-account');
    expect(await worker.deliver({ v: 1, type: 'frame/wall', wall: null }, top())).toEqual({ ok: true, data: {} });
    expect((await pageOf(worker, 12))?.wall).toBeUndefined();
    // A new document starts with none.
    await worker.deliver({ v: 1, type: 'frame/wall', wall: 'sign-in' }, top());
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top(12, { documentId: 'doc-next' }));
    expect((await pageOf(worker, 12))?.wall).toBeUndefined();
  });

  // s2 profile (the review fix P1): what a page with no form waits for, for the side panel.
  it('says what a page with no form waits for (frame/wall’s waits), kept while its document says hello, never for a page with a form', async () => {
    const worker = await signUpWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, top());
    await worker.deliver({ v: 1, type: 'frame/wall', wall: 'sign-in', waits: 'sign-in-failed' }, top());
    expect(await pageOf(worker, 12)).toMatchObject({ wall: 'sign-in', waits: 'sign-in-failed' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false, nav: 1 }, top());
    expect((await pageOf(worker, 12))?.waits).toBe('sign-in-failed');
    await worker.deliver({ v: 1, type: 'frame/wall', wall: 'sign-in', waits: 'challenge' }, top());
    expect((await pageOf(worker, 12))?.waits).toBe('challenge');
    await worker.deliver({ v: 1, type: 'frame/wall', wall: null }, top());
    expect(await pageOf(worker, 12)).not.toHaveProperty('waits');
    // A page with a form: its run's own report says what it waits for.
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, nav: 2 }, top());
    await worker.deliver({ v: 1, type: 'frame/wall', wall: 'sign-in', waits: 'sign-in' }, top());
    expect(await pageOf(worker, 12)).not.toHaveProperty('waits');
    // Only a value of its list.
    expect(await worker.deliver({ v: 1, type: 'frame/wall', wall: null, waits: 'anything' }, top()))
      .toMatchObject({ ok: false });
  });

  it('reads only the application frame’s: a subframe’s wall is not the page’s, and an unknown document is expired', async () => {
    const worker = await signUpWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top());
    const sub = top(12, { frameId: 3, documentId: 'doc-sub' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false }, sub);
    await worker.deliver({ v: 1, type: 'frame/wall', wall: 'sign-in' }, sub);
    expect((await pageOf(worker, 12))?.wall).toBeUndefined();
    expect(await worker.deliver({ v: 1, type: 'frame/wall', wall: 'sign-in' }, top(12, { documentId: 'doc-gone' })))
      .toEqual({ ok: false, error: 'expired' });
  });
});

describe('a wall with no form (v4)', () => {
  it('sends run/start to the wall’s frame, and starts the tab’s next form once, with {signIn}', async () => {
    const worker = await signUpWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, top());
    await worker.deliver({ v: 1, type: 'frame/wall', wall: 'sign-in' }, top());
    expect(await fill(worker, 12, { signIn: true })).toEqual({ ok: true, data: { frames: 1 } });
    const starts = () => sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'run/start');
    expect(starts().map((sent) => [sent.message, sent.options?.frameId])).toEqual([
      [{ v: 1, type: 'run/start', dryRun: false, signIn: true }, 0]]);
    // The sign-in brought the application's form, in a new document: started once.
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top(12, { documentId: 'doc-form' }));
    await vi.waitFor(() => expect(starts()).toHaveLength(2));
    expect(starts()[1]).toMatchObject({ message: { v: 1, type: 'run/start', dryRun: false, signIn: true },
      options: { frameId: 0, documentId: 'doc-form' } });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top(12, { documentId: 'doc-again' }));
    expect(starts()).toHaveLength(2);
  });

  it('a plain Autofill at a choice of how to apply reaches its frame, and starts the next form without {signIn}', async () => {
    const worker = await signUpWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, top());
    await worker.deliver({ v: 1, type: 'frame/wall', wall: null, choice: true }, top());
    expect(await fill(worker, 12)).toEqual({ ok: true, data: { frames: 1 } });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top(12, { documentId: 'doc-form' }));
    const starts = () => sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'run/start');
    await vi.waitFor(() => expect(starts()).toHaveLength(2));
    expect(starts().map((sent) => sent.message)).toEqual([{ v: 1, type: 'run/start', dryRun: false },
      { v: 1, type: 'run/start', dryRun: false }]);
    // No grant of Sign-in Auto came with it.
    expect(await ask(worker, top(12, { documentId: 'doc-form' }))).toEqual({ ok: false, error: 'unavailable' });
  });

  it('sends nothing to a page with no form, wall or choice', async () => {
    const worker = await signUpWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, top());
    expect(await fill(worker, 12, { signIn: true })).toEqual({ ok: true, data: { frames: 0 } });
  });
});

// ── The v4 review ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('the v4 review: a grant holds for the site it was given for (security M1, behaviour M3)', () => {
  const TENANT = 'https://acme.wd5.myworkdayjobs.com';
  /** Workday's "Start Your Application" choice (its /apply: a posting by its parser) and its application form. */
  const CHOICE = `${TENANT}/en-US/careers/job/x/Engineer_JR-0000001/apply`;
  const FORM = `${CHOICE}/applyManually`;
  const OTHER_JOB = `${TENANT}/en-US/careers/job/x/Designer_JR-0000002/apply/applyManually`;
  const LEVER = 'https://jobs.lever.co/othercompany/1b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00/apply';
  const at = (url: string, documentId: string, tab = 12) => top(tab, { url, tab: { id: tab, url }, documentId });
  const starts = (worker: TestWorker) => sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'run/start');

  /** A worker whose tab 12 shows a wall with no form at `url`, granted Sign up & Autofill there. */
  async function walled(url = WORKDAY, choice = false) {
    const worker = await signUpWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, at(url, 'doc-wall'));
    await worker.deliver({ v: 1, type: 'frame/wall', wall: choice ? null : 'sign-in', ...(choice ? { choice: true } : {}) },
      at(url, 'doc-wall'));
    expect(await fill(worker, 12, { signIn: true })).toEqual({ ok: true, data: { frames: 1 } });
    expect(starts(worker)).toHaveLength(1);
    expect(lastSettingsTo(worker, 12)).toBe('auto');
    return worker;
  }

  it('starts no form of another site the tab then shows, and ends the grant there: its settings back to Manual', async () => {
    const worker = await walled();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, at(LEVER, 'doc-lever'));
    await vi.waitFor(() => expect(lastSettingsTo(worker, 12)).toBe('manual'));
    expect(starts(worker)).toHaveLength(1);
    // Nothing of it is left for the tab: the Workday form that follows later is not started either.
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, at(FORM, 'doc-form'));
    expect(starts(worker)).toHaveLength(1);
    expect(await ask(worker, at(FORM, 'doc-form'))).toEqual({ ok: false, error: 'unavailable' });
  });

  it('starts the form of the application it was given for, never another application of the same site', async () => {
    const other = await walled(CHOICE, true);
    await other.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, at(OTHER_JOB, 'doc-other'));
    expect(starts(other)).toHaveLength(1);

    const same = await walled(CHOICE, true);
    await same.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, at(FORM, 'doc-form'));
    await vi.waitFor(() => expect(starts(same)).toHaveLength(2));
    expect(starts(same)[1]).toMatchObject({ message: { v: 1, type: 'run/start', dryRun: false, signIn: true },
      options: { frameId: 0, documentId: 'doc-form' } });
  });

  it('answers the credential for a sender of the grant’s origin alone, and says Sign-in Auto to its frames alone', async () => {
    const worker = await walled();
    // A frame on another site in the same tab (its document never said hello): no Sign-in Auto for it.
    worker.tailorit.reply('GET /api/autofill/credentials', { json: { host: 'jobs.lever.co', email: 'alex.rivera@example.com',
      password: PASSWORD } });
    expect(await ask(worker, at(LEVER, 'doc-lever-unsaid'))).toEqual({ ok: false, error: 'unavailable' });
    expect(worker.tailorit.count('GET /api/autofill/credentials')).toBe(0);
    worker.tailorit.reply('GET /api/autofill/credentials', { json: { host: 'acme.wd5.myworkdayjobs.com',
      email: 'alex.rivera@example.com', password: PASSWORD } });
    // A subframe of another origin hears Sign-in Manual; the grant's own frame Sign-in Auto.
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true },
      top(12, { url: LEVER, frameId: 4, documentId: 'doc-sub' })))
      .toMatchObject({ ok: true, data: { settings: { modes: { signIn: 'manual' } } } });
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, at(WORKDAY, 'doc-wall')))
      .toMatchObject({ ok: true, data: { settings: { modes: { signIn: 'auto' } } } });
    expect(await ask(worker, at(WORKDAY, 'doc-wall'))).toMatchObject({ ok: true, data: { password: PASSWORD } });
  });

  it('tells the tab’s frames their settings again once the grant ends by time (its timer, or a read past it)', async () => {
    const timed = await walled();
    timed.timers.advance(SIGN_UP_GRANT_MS);
    await vi.waitFor(() => expect(lastSettingsTo(timed, 12)).toBe('manual'));

    const read = await walled();
    read.clock.now += SIGN_UP_GRANT_MS;
    expect(await ask(read, at(WORKDAY, 'doc-wall'))).toEqual({ ok: false, error: 'unavailable' });
    await vi.waitFor(() => expect(lastSettingsTo(read, 12)).toBe('manual'));
  });
});

describe('the v4 review: PageState.choice, the entry choice the side panel offers Autofill at (behaviour M4)', () => {
  it('is set from the application frame’s frame/wall {choice} at Workday’s /apply (a posting by its parser), and cleared with it', async () => {
    const CHOICE = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x/Engineer_JR-0000001/apply';
    const sender = top(12, { url: CHOICE, tab: { id: 12, url: CHOICE }, documentId: 'doc-choice' });
    const worker = await signUpWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, sender);
    expect(await pageOf(worker, 12)).toMatchObject({ support: 'no-form', posting: true });
    expect((await pageOf(worker, 12))?.choice).toBeUndefined();
    await worker.deliver({ v: 1, type: 'frame/wall', wall: null, choice: true }, sender);
    expect(await pageOf(worker, 12)).toMatchObject({ support: 'no-form', posting: true, choice: true });
    expect((await pageOf(worker, 12))?.wall).toBeUndefined();
    // The choice went (the person chose): cleared.
    await worker.deliver({ v: 1, type: 'frame/wall', wall: null }, sender);
    expect((await pageOf(worker, 12))?.choice).toBeUndefined();
    // A subframe's choice is not the page's.
    const sub = top(12, { url: CHOICE, frameId: 3, documentId: 'doc-sub' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false }, sub);
    await worker.deliver({ v: 1, type: 'frame/wall', wall: null, choice: true }, sub);
    expect((await pageOf(worker, 12))?.choice).toBeUndefined();
  });
});
