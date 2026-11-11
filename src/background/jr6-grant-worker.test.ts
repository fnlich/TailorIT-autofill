/*
 * jr6 apply F3a (the owner, 2026-11-10: "extension should also click `apply` to find and run the form"; the session's
 * jr6 APPLYPLAN §1 D2-D4, §5 F3a): the worker's grant follows the application in the same tab and site, through the
 * real worker. One Autofill press on a posting: the application frame hears run/start; the grant is pending until that
 * frame says it pressed the site's own Apply (entry/pressed, from the tab's application frame in its document, on its
 * origin, 6 a minute per tab); then the next form is started (takeFill, also at the press's destination key), and a
 * wall or a choice of a new document gets one run/start (takeStep, AF-3), 3 at most. Ported from the auditors'
 * harnesses (-wt-v4drop jr6-apply-worker.test.ts, -wt-v4fixB jr6-apply-c-worker.test.ts), with synthetic addresses.
 * Booleans and counts only.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { SITES_MATCH } from '../shared/hosts';
import type { RawSender } from '../platform/fake';
import { FRAME_PROBE_GRACE_MS } from './frames';
import { ENTRY_ARM_MS, ENTRY_ELSEWHERE_MS, ENTRY_NEXT_MS, ENTRY_PRESSED_LIMIT, ENTRY_WAITING_MS, SIGN_UP_GRANT_MS } from './sign-up';
import { SITES_KEY } from './sites';
import {
  advance, applyWorker, at, cancel, cancelsAt, fill, GREENHOUSE_FORM, hello, keyOf, LEVER_FORM, LEVER_OTHER,
  LEVER_POSTING, pageOf, postingTab, press, settle, starts, startsAfter, startsAt, TAB, wall,
} from './apply-worker.testkit';
import { NO_RECEIVER, saveSignup, sentToFrames, typeOfSent, type TestWorker } from './worker.testkit';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

/** Workday: a posting, its choice of how to apply (/apply, a posting by its parser, same key), its form, and its
 *  account page (no key). */
const WD = 'https://acme.wd5.myworkdayjobs.com/en-US/careers';
const WD_POSTING = `${WD}/job/x/Engineer_JR-0000001`;
const WD_CHOICE = `${WD_POSTING}/apply`;
const WD_FORM = `${WD_CHOICE}/applyManually`;
const WD_LOGIN = `${WD}/login`;
/** SmartRecruiters: a posting and its one-click application (another key: a publication uuid). */
const SR_POSTING = 'https://jobs.smartrecruiters.com/Acme/744000159905715-senior-engineer';
const SR_FORM = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/189a97ff-58b4-4671-bd81-6ed11d3bcfd1?dcr_ci=Acme';
/** A company's own page (the career sites), its job and its /apply (another key, same origin). */
const COMPANY = 'https://careers.northwind.example/jobs/42';
const COMPANY_APPLY = `${COMPANY}/apply`;

/** Answers whether the tab's next form, of `url` in document `documentId`, is started (counts run/start). */
async function formStarted(worker: TestWorker, url: string, documentId: string, before: number): Promise<boolean> {
  await hello(worker, at(url, documentId), true);
  await settle();
  return starts(worker).length > before;
}

describe('the pending entry grant (items 1 and 2)', () => {
  it('starts the next form only once the application frame said it pressed (entry/pressed arms it)', async () => {
    const unarmed = await applyWorker();
    await postingTab(unarmed, LEVER_POSTING);
    await fill(unarmed);
    expect(await formStarted(unarmed, LEVER_FORM, 'doc-form', 1)).toBe(false);

    const armed = await applyWorker();
    const posting = await postingTab(armed, LEVER_POSTING);
    await fill(armed);
    expect(await press(armed, posting)).toEqual({ ok: true, data: {} });
    expect(await formStarted(armed, LEVER_FORM, 'doc-form', 1)).toBe(true);
    expect(startsAt(armed)).toEqual([{ frameId: 0, documentId: 'doc-posting', signIn: false },
      { frameId: 0, documentId: 'doc-form', signIn: false }]);
  });

  it('ends at its frame\'s refusal, newly said; a refusal still standing from before does not end a new grant', async () => {
    const worker = await applyWorker();
    const posting = await postingTab(worker, LEVER_POSTING);
    await fill(worker);
    await wall(worker, posting, { entryRefused: true, refusal: 'none' });
    expect(await press(worker, posting)).toEqual({ ok: false, error: 'expired' });
    expect(await formStarted(worker, LEVER_FORM, 'doc-form', 1)).toBe(false);

    const again = await applyWorker();
    const sender = await postingTab(again, LEVER_POSTING);
    await wall(again, sender, { entryRefused: true, refusal: 'nothing-followed' });
    // The person presses Autofill again; the frame's last word (the old refusal) comes again before it clears it.
    await fill(again);
    await wall(again, sender, { entryRefused: true, refusal: 'nothing-followed' });
    expect(await press(again, sender)).toEqual({ ok: true, data: {} });
  });

  it('ends ENTRY_ARM_MS after it was given, unarmed; armed just before, it holds', async () => {
    const late = await applyWorker();
    const posting = await postingTab(late, LEVER_POSTING);
    await fill(late);
    advance(late, ENTRY_ARM_MS);
    expect(await press(late, posting)).toEqual({ ok: false, error: 'expired' });
    expect(await formStarted(late, LEVER_FORM, 'doc-form', 1)).toBe(false);

    const inTime = await applyWorker();
    const sender = await postingTab(inTime, LEVER_POSTING);
    await fill(inTime);
    advance(inTime, ENTRY_ARM_MS - 1);
    expect(await press(inTime, sender)).toEqual({ ok: true, data: {} });
    advance(inTime, ENTRY_ARM_MS);
    expect(await formStarted(inTime, LEVER_FORM, 'doc-form', 1)).toBe(true);
  });

  it('is never a fill grant with no key: a frame that names no application, and a press that names none, end it', async () => {
    const keyless = await applyWorker();
    const login = at(WD_LOGIN, 'doc-login');
    await hello(keyless, login, false);
    await fill(keyless);
    expect(await press(keyless, login)).toEqual({ ok: false, error: 'expired' });
    // It ended: a later press with a key arms nothing, and no form is started.
    expect(await press(keyless, login, keyOf(WD_FORM))).toEqual({ ok: false, error: 'expired' });
    expect(await formStarted(keyless, WD_FORM, 'doc-form', 1)).toBe(false);

    // The press names its destination: that application's form alone.
    const named = await applyWorker();
    const sender = at(WD_LOGIN, 'doc-login');
    await hello(named, sender, false);
    await fill(named);
    expect(await press(named, sender, keyOf(WD_FORM))).toEqual({ ok: true, data: {} });
    expect(await formStarted(named, `${WD}/job/x/Designer_JR-0000002/apply/applyManually`, 'doc-other', 1)).toBe(false);
    expect(await formStarted(named, WD_FORM, 'doc-form', 1)).toBe(true);
  });

  it('is never given for a dry run, nor for a page with a form (Autofill starts that form)', async () => {
    const dry = await applyWorker();
    const posting = await postingTab(dry, LEVER_POSTING);
    await fill(dry, TAB, { dryRun: true });
    expect(await press(dry, posting)).toEqual({ ok: false, error: 'expired' });

    const form = await applyWorker();
    const sender = at(LEVER_FORM, 'doc-form');
    await hello(form, sender, true);
    await fill(form);
    expect(await press(form, sender)).toEqual({ ok: false, error: 'expired' });
  });
});

describe('entry/pressed: who may say it (item 3)', () => {
  it('only the tab\'s application frame, in the document registered for it, on its origin, one the grant reached', async () => {
    const worker = await applyWorker();
    const posting = await postingTab(worker, LEVER_POSTING);
    const sub = at(LEVER_POSTING, 'doc-sub', TAB, { frameId: 3, parentFrameId: 0 });
    await hello(worker, sub, false);
    await fill(worker);
    // Another frame of the tab.
    expect(await press(worker, sub)).toEqual({ ok: false, error: 'bad_sender' });
    // The top frame, but another document than the one registered.
    expect(await press(worker, at(LEVER_POSTING, 'doc-old'))).toEqual({ ok: false, error: 'bad_sender' });
    // The registered document, said from another origin's address.
    expect(await press(worker, at(GREENHOUSE_FORM, 'doc-posting'))).toEqual({ ok: false, error: 'bad_sender' });
    // Another tab.
    expect(await press(worker, at(LEVER_POSTING, 'doc-posting', 13))).toEqual({ ok: false, error: 'bad_sender' });
    expect(await press(worker, posting)).toEqual({ ok: true, data: {} });

    // A new document of the same site the grant never reached says it pressed: nothing is armed by it.
    const other = await applyWorker();
    await postingTab(other, LEVER_POSTING);
    await fill(other);
    const next = at(LEVER_POSTING, 'doc-next');
    await hello(other, next, false);
    expect(await press(other, next)).toEqual({ ok: false, error: 'expired' });

    // The tab moved to another origin: its grant ended; that page's press arms nothing.
    const moved = await applyWorker();
    await postingTab(moved, LEVER_POSTING);
    await fill(moved);
    const elsewhere = at(GREENHOUSE_FORM, 'doc-gh');
    await hello(moved, elsewhere, false);
    expect(await press(moved, elsewhere)).toEqual({ ok: false, error: 'expired' });
  });

  it(`is limited to ${ENTRY_PRESSED_LIMIT.count} a minute per tab: the next is rate-limited, another tab is not`, async () => {
    const worker = await applyWorker();
    const posting = await postingTab(worker, LEVER_POSTING);
    await fill(worker);
    for (let n = 0; n < ENTRY_PRESSED_LIMIT.count; n += 1) {
      expect(await press(worker, posting), `press ${n + 1}`).toMatchObject({ ok: true });
    }
    expect(await press(worker, posting)).toMatchObject({ ok: false, error: 'rate_limited' });
    // A sender that is not the application frame is counted too: the limit comes first.
    expect(await press(worker, at(LEVER_POSTING, 'doc-old'))).toMatchObject({ ok: false, error: 'rate_limited' });
    // Another tab has its own count.
    const other = await postingTab(worker, LEVER_POSTING, 'doc-13', true, 13);
    expect(await press(worker, other)).toEqual({ ok: false, error: 'expired' });
    advance(worker, ENTRY_PRESSED_LIMIT.windowMs);
    expect(await press(worker, posting)).not.toMatchObject({ error: 'rate_limited' });
  });

  it('logs flags alone', async () => {
    const worker = await applyWorker();
    const posting = await postingTab(worker, LEVER_POSTING);
    await fill(worker);
    await press(worker, posting, keyOf(LEVER_OTHER));
    const armed = logs.mock.calls.filter((call) => String(call[0]).includes('grant.armed'));
    expect(armed).toEqual([['[tailorit-autofill] grant.armed', { armed: true, nextKey: true }]]);
  });
});

describe('takeStep: a wall or a choice of the next document (AF-3)', () => {
  /** Workday's posting pressed: its choice page, then its account page, loaded as new documents. */
  async function pressedPosting(worker: TestWorker) {
    const posting = await postingTab(worker, WD_POSTING);
    await fill(worker);
    expect(await press(worker, posting)).toEqual({ ok: true, data: {} });
  }

  it('gives a new document\'s choice, then its wall, one run/start each, and starts the form after them', async () => {
    const worker = await applyWorker();
    await pressedPosting(worker);
    const choice = at(WD_CHOICE, 'doc-choice');
    await hello(worker, choice, false);
    await wall(worker, choice, { choice: true });
    expect(await startsAfter(worker, 2)).toBe(2);
    expect(startsAt(worker)[1]).toEqual({ frameId: 0, documentId: 'doc-choice', signIn: false });
    // The same document says it again: once per document.
    await wall(worker, choice, { choice: true });
    await settle();
    expect(starts(worker)).toHaveLength(2);
    // The choice's frame presses Apply Manually (a document the grant reached): its account page, then the form.
    expect(await press(worker, choice)).toEqual({ ok: true, data: {} });
    const login = at(WD_LOGIN, 'doc-login');
    await hello(worker, login, false);
    await wall(worker, login, { wall: 'create-account' });
    expect(await startsAfter(worker, 3)).toBe(3);
    expect(await formStarted(worker, WD_FORM, 'doc-form', 3)).toBe(true);
  });

  it('carries Sign up & Autofill\'s signIn where the grant holds it', async () => {
    const worker = await applyWorker();
    await saveSignup(worker);
    const choice = at(WD_CHOICE, 'doc-choice');
    await hello(worker, choice, false);
    await wall(worker, choice, { choice: true });
    await fill(worker, TAB, { signIn: true });
    expect(await press(worker, choice)).toEqual({ ok: true, data: {} });
    const login = at(WD_LOGIN, 'doc-login');
    await hello(worker, login, false);
    await wall(worker, login, { wall: 'sign-in' });
    await startsAfter(worker, 2);
    expect(startsAt(worker)).toEqual([{ frameId: 0, documentId: 'doc-choice', signIn: true },
      { frameId: 0, documentId: 'doc-login', signIn: true }]);
  });

  it('never without a press, never in the document pressed in, never at a form, never after the grant\'s time', async () => {
    const unpressed = await applyWorker();
    const posting = await postingTab(unpressed, WD_POSTING);
    await fill(unpressed);
    // The press's own document shows a choice drawn in place: the frame answers it itself.
    await wall(unpressed, posting, { choice: true });
    const choice = at(WD_CHOICE, 'doc-choice');
    await hello(unpressed, choice, false);
    await wall(unpressed, choice, { choice: true });
    await settle();
    expect(starts(unpressed)).toHaveLength(1);

    const same = await applyWorker();
    const sender = await postingTab(same, WD_POSTING);
    await fill(same);
    await press(same, sender);
    await wall(same, sender, { choice: true });
    await settle();
    expect(starts(same)).toHaveLength(1);

    // A document with a form (Sign up & Autofill's grant outlives its first form, so only the form stops a step).
    const form = await applyWorker();
    await saveSignup(form);
    const formChoice = at(WD_CHOICE, 'doc-choice');
    await hello(form, formChoice, false);
    await wall(form, formChoice, { choice: true });
    await fill(form, TAB, { signIn: true });
    await press(form, formChoice);
    expect(await formStarted(form, WD_FORM, 'doc-form', 1)).toBe(true);
    const gate = at(WD_LOGIN, 'doc-gate');
    await hello(form, gate, true);
    await wall(form, gate, { wall: 'sign-in' });
    await settle();
    expect(starts(form)).toHaveLength(2);

    const timed = await applyWorker();
    await pressedPosting(timed);
    advance(timed, SIGN_UP_GRANT_MS);
    const login = at(WD_LOGIN, 'doc-login');
    await hello(timed, login, false);
    await wall(timed, login, { wall: 'sign-in' });
    await settle();
    expect(starts(timed)).toHaveLength(1);
  });

  it('never on another origin or for another application of the same site', async () => {
    const worker = await applyWorker();
    await pressedPosting(worker);
    const other = at(`${WD}/job/x/Designer_JR-0000002/apply`, 'doc-other');
    await hello(worker, other, false);
    await wall(worker, other, { choice: true });
    const gh = at(GREENHOUSE_FORM, 'doc-gh');
    await hello(worker, gh, false);
    await wall(worker, gh, { wall: 'sign-in' });
    await settle();
    expect(starts(worker)).toHaveLength(1);
  });

  it('gives 3 steps per grant at most', async () => {
    const worker = await applyWorker();
    await pressedPosting(worker);
    for (let n = 1; n <= 4; n += 1) {
      const login = at(WD_LOGIN, `doc-login-${n}`);
      await hello(worker, login, false);
      await wall(worker, login, { wall: 'sign-in' });
      await settle();
    }
    expect(starts(worker)).toHaveLength(1 + 3);
  });

  it('never starts again a gate that is a form root, started by takeFill (one mark per document)', async () => {
    // Sign up & Autofill keeps the grant after its form started, so only the mark stops a second start.
    const worker = await applyWorker();
    await saveSignup(worker);
    const choice = at(WD_CHOICE, 'doc-choice');
    await hello(worker, choice, false);
    await wall(worker, choice, { choice: true });
    await fill(worker, TAB, { signIn: true });
    await press(worker, choice);
    const gate = at(WD_FORM, 'doc-gate');
    expect(await formStarted(worker, WD_FORM, 'doc-gate', 1)).toBe(true);
    // The same document loses its form root and shows a wall: no step there.
    await hello(worker, gate, false);
    await wall(worker, gate, { wall: 'sign-in' });
    await settle();
    expect(starts(worker)).toHaveLength(2);
    // A new document's wall still gets its step.
    const login = at(WD_LOGIN, 'doc-login');
    await hello(worker, login, false);
    await wall(worker, login, { wall: 'sign-in' });
    expect(await startsAfter(worker, 3)).toBe(3);
  });
});

describe('the press\'s destination (C4, apply-flow-new-2)', () => {
  it('SmartRecruiters: the one-click form named by the press is started without the referrer chain', async () => {
    const withKey = await applyWorker();
    const posting = await postingTab(withKey, SR_POSTING);
    await fill(withKey);
    await press(withKey, posting, keyOf(SR_FORM));
    expect(await formStarted(withKey, SR_FORM, 'doc-form', 1)).toBe(true);
    expect(starts(withKey)).toHaveLength(2);

    // No key named (today's chain-less case): not started.
    const without = await applyWorker();
    const sender = await postingTab(without, SR_POSTING);
    await fill(without);
    await press(without, sender);
    expect(await formStarted(without, SR_FORM, 'doc-form', 1)).toBe(false);

    // Named, but the form came after ENTRY_NEXT_MS: not started.
    const late = await applyWorker();
    const lateSender = await postingTab(late, SR_POSTING);
    await fill(late);
    await press(late, lateSender, keyOf(SR_FORM));
    advance(late, ENTRY_NEXT_MS);
    expect(await formStarted(late, SR_FORM, 'doc-form', 1)).toBe(false);
  });

  it('a form of another key than the one named is not started', async () => {
    const worker = await applyWorker();
    const posting = await postingTab(worker, LEVER_POSTING);
    await fill(worker);
    await press(worker, posting, keyOf(SR_FORM));
    expect(await formStarted(worker, LEVER_OTHER, 'doc-other', 1)).toBe(false);
    expect(await formStarted(worker, LEVER_FORM, 'doc-form', 1)).toBe(true);
  });

  describe('a company\'s own page', () => {
    /** A worker with the career sites on; `document` is injected as a company page frame of the tab. */
    async function companyWorker() {
      return applyWorker({ before: async (fakes) => {
        fakes.granted.add(SITES_MATCH);
        await fakeBrowser.storage.local.set({ [SITES_KEY]: { sites: true } });
      } });
    }
    async function companyFrame(worker: TestWorker, url: string, documentId: string): Promise<RawSender> {
      const sender = at(url, documentId);
      expect(await worker.deliver({ v: 1, type: 'page/recognised', reason: 'application-form' }, sender))
        .toMatchObject({ ok: true });
      return sender;
    }
    async function pressedCompany(worker: TestWorker, nextKey?: string) {
      const job = await companyFrame(worker, COMPANY, 'doc-job');
      await hello(worker, job, false);
      await fill(worker);
      expect(await press(worker, job, nextKey)).toEqual({ ok: true, data: {} });
    }
    async function applyStarted(worker: TestWorker): Promise<boolean> {
      const form = await companyFrame(worker, COMPANY_APPLY, 'doc-apply');
      await hello(worker, form, true);
      await settle();
      return starts(worker).length > 1;
    }

    it('its same-origin /apply form is started by the press\'s nextKey', async () => {
      const worker = await companyWorker();
      await pressedCompany(worker, keyOf(COMPANY_APPLY));
      expect(await applyStarted(worker)).toBe(true);
    });

    it('a button (no key named): its first form of the same origin within ENTRY_NEXT_MS, not after', async () => {
      const inTime = await companyWorker();
      await pressedCompany(inTime);
      advance(inTime, ENTRY_NEXT_MS - 1);
      expect(await applyStarted(inTime)).toBe(true);

      const late = await companyWorker();
      await pressedCompany(late);
      advance(late, ENTRY_NEXT_MS);
      expect(await applyStarted(late)).toBe(false);
    });
  });
});

describe('a press again during the hand-off (apply-c-new-1)', () => {
  /** SmartRecruiters' posting pressed; its one-click page loaded, its form not drawn yet. */
  async function handOff(worker: TestWorker): Promise<RawSender> {
    const posting = await postingTab(worker, SR_POSTING);
    await fill(worker);
    await press(worker, posting, keyOf(SR_FORM));
    const oneClick = at(SR_FORM, 'doc-form');
    await hello(worker, oneClick, false);
    return oneClick;
  }

  it('a plain Autofill there keeps the armed grant: the form drawn after it is started', async () => {
    const worker = await applyWorker();
    const oneClick = await handOff(worker);
    expect(await fill(worker)).toEqual({ ok: true, data: { frames: 1 } });
    expect(startsAt(worker)[1]).toEqual({ frameId: 0, documentId: 'doc-form', signIn: false });
    await hello(worker, oneClick, true);
    expect(await startsAfter(worker, 3)).toBe(3);
  });

  it('Sign up & Autofill there is a new grant (the person\'s latest word), pending its own press', async () => {
    const worker = await applyWorker();
    await saveSignup(worker);
    const oneClick = await handOff(worker);
    await fill(worker, TAB, { signIn: true });
    await hello(worker, oneClick, true);
    await settle();
    expect(starts(worker)).toHaveLength(2);
  });
});

describe('PageState.entering and refusal \'elsewhere\' from the grant (items 2 and 5)', () => {
  it('says entering from the press until something of it is taken, at most ENTRY_WAITING_MS', async () => {
    const worker = await applyWorker();
    const posting = await postingTab(worker, LEVER_POSTING);
    await fill(worker);
    expect((await pageOf(worker))?.entering).toBeUndefined();
    await press(worker, posting);
    expect((await pageOf(worker))?.entering).toBe(true);
    // The posting's document went; the next one says hello with no form yet: still entering.
    await hello(worker, at(LEVER_FORM, 'doc-form'), false);
    expect((await pageOf(worker))?.entering).toBe(true);
    // Its form shows and is started: no longer.
    await hello(worker, at(LEVER_FORM, 'doc-form'), true);
    await settle();
    expect((await pageOf(worker))?.entering).toBeUndefined();

    const timed = await applyWorker();
    const sender = await postingTab(timed, LEVER_POSTING);
    await fill(timed);
    await press(timed, sender);
    const panel = timed.connect('panel', { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/sidepanel.html' });
    panel.post({ v: 1, type: 'panel/watch', tabId: TAB });
    await vi.waitFor(() => expect((panel.received.at(-1) as { page?: { entering?: true } } | undefined)?.page?.entering)
      .toBe(true));
    advance(timed, ENTRY_WAITING_MS);
    // The panel hears it end without anything else happening in the tab.
    await vi.waitFor(() => expect((panel.received.at(-1) as { page?: { entering?: true } }).page?.entering).toBeUndefined());
  });

  it('says refusal \'elsewhere\' once a recent press led to another origin, until the next press or ENTRY_ELSEWHERE_MS', async () => {
    const worker = await applyWorker();
    const posting = await postingTab(worker, LEVER_POSTING);
    await fill(worker);
    await press(worker, posting);
    await hello(worker, at(GREENHOUSE_FORM, 'doc-gh'), false);
    expect(await pageOf(worker)).toMatchObject({ support: 'no-form', entryRefused: true, refusal: 'elsewhere' });
    // The person's next press clears it.
    await fill(worker);
    expect((await pageOf(worker))?.refusal).toBeUndefined();

    const timed = await applyWorker();
    const sender = await postingTab(timed, LEVER_POSTING);
    await fill(timed);
    await press(timed, sender);
    await hello(timed, at(GREENHOUSE_FORM, 'doc-gh'), false);
    advance(timed, ENTRY_ELSEWHERE_MS);
    expect((await pageOf(timed))?.refusal).toBeUndefined();

    // A grant never pressed, or pressed long ago, ends there without saying it.
    const unpressed = await applyWorker();
    await postingTab(unpressed, LEVER_POSTING);
    await fill(unpressed);
    await hello(unpressed, at(GREENHOUSE_FORM, 'doc-gh'), false);
    expect((await pageOf(unpressed))?.refusal).toBeUndefined();
    const old = await applyWorker();
    const oldSender = await postingTab(old, LEVER_POSTING);
    await fill(old);
    await press(old, oldSender);
    advance(old, ENTRY_NEXT_MS);
    await hello(old, at(GREENHOUSE_FORM, 'doc-gh'), false);
    expect((await pageOf(old))?.refusal).toBeUndefined();
  });

  it('never on a page with a form', async () => {
    const worker = await applyWorker();
    const posting = await postingTab(worker, LEVER_POSTING);
    await fill(worker);
    await press(worker, posting);
    await hello(worker, at(GREENHOUSE_FORM, 'doc-gh'), true);
    const page = await pageOf(worker);
    expect(page?.support).toBe('form');
    expect(page?.refusal).toBeUndefined();
    expect(page?.entering).toBeUndefined();
  });
});

describe('the panel\'s Cancel (item 6)', () => {
  it('reaches the application frame while it is entering, and ends the tab\'s entry grant', async () => {
    const worker = await applyWorker();
    const posting = await postingTab(worker, LEVER_POSTING);
    await fill(worker);
    await wall(worker, posting, { entry: true, entering: true });
    expect(await cancel(worker)).toEqual({ ok: true, data: { frames: 1 } });
    expect(cancelsAt(worker)).toEqual([0]);
    expect(await press(worker, posting)).toEqual({ ok: false, error: 'expired' });

    // Not entering: the frame is not sent run/cancel, the grant ends all the same.
    const idle = await applyWorker();
    const sender = await postingTab(idle, LEVER_POSTING);
    await fill(idle);
    await press(idle, sender);
    expect(await cancel(idle)).toEqual({ ok: true, data: { frames: 0 } });
    expect(await formStarted(idle, LEVER_FORM, 'doc-form', 1)).toBe(false);
  });
});

describe('ADP\'s job details: an entry at an application address loads its card (apply-b-new-2)', () => {
  const DETAILS = 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=267cfc8f-e6d3-499b-8a38-c6abe8ee3d82&jobId=590196&ccId=19000101_000001';
  const refreshes = (worker: TestWorker) => sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'job/refresh');

  it('the top frame that says entry is the card frame for its document, looked up once', async () => {
    const worker = await applyWorker({ lookupOnLoad: true });
    const sender = at(DETAILS, 'doc-details');
    worker.fakes.frameAnswers = async (sent) => {
      const message = sent.message as { type?: string };
      if (message.type !== 'job/refresh') return { ok: true, data: {} };
      return worker.deliver({ v: 1, type: 'job/lookup' }, sender);
    };
    await hello(worker, sender, false);
    await settle();
    expect(refreshes(worker)).toHaveLength(0);
    expect((await pageOf(worker))?.posting).toBeUndefined();
    await wall(worker, sender, { entry: true });
    await vi.waitFor(() => expect(worker.tailorit.count('POST /api/autofill/lookup')).toBe(1));
    expect(await pageOf(worker)).toMatchObject({ support: 'no-form', posting: true, entry: true });
    // Said again, entering, then its consent (a choice) in place: one lookup, and the card stays.
    await wall(worker, sender, { entry: true, entering: true });
    await wall(worker, sender, { choice: true });
    await hello(worker, sender, false);
    await settle();
    expect(worker.tailorit.count('POST /api/autofill/lookup')).toBe(1);
    expect(await pageOf(worker)).toMatchObject({ support: 'no-form', posting: true, choice: true });
  });

  it('a subframe\'s entry is no card; nothing is looked up without the lookup on load', async () => {
    const worker = await applyWorker();
    const sender = at(DETAILS, 'doc-details');
    await hello(worker, sender, false);
    await wall(worker, sender, { entry: true });
    await settle();
    expect(refreshes(worker)).toHaveLength(0);
    // The card shows all the same (the panel reads it through this frame).
    expect((await pageOf(worker))?.posting).toBe(true);
    const sub = await applyWorker({ lookupOnLoad: true });
    await hello(sub, at(DETAILS, 'doc-top'), false);
    const frame = at(DETAILS, 'doc-sub', TAB, { frameId: 4, parentFrameId: 0 });
    await hello(sub, frame, false);
    await wall(sub, frame, { entry: true });
    await settle();
    expect(refreshes(sub)).toHaveLength(0);
    expect((await pageOf(sub))?.posting).toBeUndefined();
  });
});

describe('the owner\'s chains still start their next form (ported from the apply audit)', () => {
  it('Jobvite: posting, then /apply in the same tab', async () => {
    const POSTING = 'https://jobs.jobvite.com/acme-careers/job/oAbCdEfG';
    const worker = await applyWorker();
    const posting = await postingTab(worker, POSTING);
    expect(await pageOf(worker)).toMatchObject({ support: 'no-form', posting: true, entry: true });
    expect(await fill(worker)).toEqual({ ok: true, data: { frames: 1 } });
    await press(worker, posting);
    expect(await formStarted(worker, `${POSTING}/apply`, 'doc-apply', 1)).toBe(true);
    expect(startsAt(worker)[1]).toEqual({ frameId: 0, documentId: 'doc-apply', signIn: false });
  });

  it('iCIMS careers portal: posting, then its email gate (a form root) as the top page', async () => {
    const POSTING = 'https://careers-acme.icims.com/jobs/1234/job?mobile=true&needsRedirect=false';
    const worker = await applyWorker();
    const posting = await postingTab(worker, POSTING);
    await fill(worker);
    await press(worker, posting);
    expect(await formStarted(worker, 'https://careers-acme.icims.com/jobs/1234/engineer/login', 'doc-gate', 1)).toBe(true);
  });

  describe('iCIMS company wrapper: the wrapper and its claimed frame', () => {
    const TOP = 'https://careers-acme.icims.com/jobs/1234/job?mobile=false&needsRedirect=false';
    const FRAME = `${TOP}&in_iframe=1`;
    const GATE_TOP = 'https://careers-acme.icims.com/jobs/1234/x/login';
    const GATE_FRAME = `${GATE_TOP}?in_iframe=1`;
    const framed = (url: string, documentId: string, frameId = 5) => at(url, documentId, TAB, { frameId, parentFrameId: 0 });

    async function wrapped() {
      const worker = await applyWorker();
      await hello(worker, at(TOP, 'doc-top'), false, { wraps: true });
      await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false, claimed: true },
        framed(FRAME, 'doc-frame'));
      await wall(worker, framed(FRAME, 'doc-frame'), { entry: true });
      return worker;
    }

    it('PageState.entry comes from the claimed frame; Autofill reaches it alone, and only it may say it pressed', async () => {
      const worker = await wrapped();
      expect(await pageOf(worker)).toMatchObject({ entry: true });
      expect(await fill(worker)).toEqual({ ok: true, data: { frames: 1 } });
      expect(startsAt(worker)).toEqual([{ frameId: 5, documentId: 'doc-frame', signIn: false }]);
      expect(await press(worker, at(TOP, 'doc-top'))).toEqual({ ok: false, error: 'bad_sender' });
      expect(await press(worker, framed(FRAME, 'doc-frame'))).toEqual({ ok: true, data: {} });
    });

    it('the frame moves to the gate (the top keeps its document): the gate\'s run starts in the frame', async () => {
      const worker = await wrapped();
      await fill(worker);
      await press(worker, framed(FRAME, 'doc-frame'));
      await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true, claimed: true },
        framed(GATE_FRAME, 'doc-gate'));
      expect(await startsAfter(worker, 2)).toBe(2);
      expect(startsAt(worker)[1]).toEqual({ frameId: 5, documentId: 'doc-gate', signIn: false });
    });

    it('the top reloads at /login and a new frame shows the gate once the old one is swept: started', async () => {
      const worker = await wrapped();
      const gone = new Set<string>();
      worker.fakes.frameAnswers = ({ options }) => {
        if (options?.documentId !== undefined && gone.has(options.documentId)) throw new Error(NO_RECEIVER);
        return { ok: true, data: { pong: true } };
      };
      await fill(worker);
      await press(worker, framed(FRAME, 'doc-frame'));
      gone.add('doc-top');
      gone.add('doc-frame');
      await hello(worker, at(GATE_TOP, 'doc-top-2'), false, { wraps: true });
      await settle();
      worker.timers.advance(FRAME_PROBE_GRACE_MS);
      await settle();
      await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true, claimed: true },
        framed(GATE_FRAME, 'doc-gate', 6));
      expect(await startsAfter(worker, 2)).toBe(2);
      expect(startsAt(worker)[1]).toEqual({ frameId: 6, documentId: 'doc-gate', signIn: false });
    });
  });

  it('another origin in the same tab ends the grant; a new tab holds none', async () => {
    const moved = await applyWorker();
    const posting = await postingTab(moved, LEVER_POSTING);
    await fill(moved);
    await press(moved, posting);
    expect(await formStarted(moved, GREENHOUSE_FORM, 'doc-gh', 1)).toBe(false);
    expect(await formStarted(moved, LEVER_FORM, 'doc-form', 1)).toBe(false);

    const tabbed = await applyWorker();
    const sender = await postingTab(tabbed, LEVER_POSTING);
    await fill(tabbed);
    await press(tabbed, sender);
    await hello(tabbed, at(LEVER_FORM, 'doc-new-tab', 13), true);
    await settle();
    expect(starts(tabbed)).toHaveLength(1);
  });
});
