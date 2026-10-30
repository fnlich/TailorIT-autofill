import { describe, expect, it } from 'vitest';
import { createProfileCache, PROFILE_IDLE_MS } from './profile-cache';
import { createServerClient } from './server-client';
import { manualTimers } from './timers';
import { createFakeTailorIT, fakeCore, goldens, GOLDEN_TOKEN, ORIGIN, START_MS } from './worker.testkit';

const PROFILE = 'GET /api/autofill/profile';
const SENSITIVE = 'GET /api/autofill/profile/sensitive';

function cache(options: { token?: string | null; core?: Parameters<typeof fakeCore>[0]; gate?: Promise<void> } = {}) {
  const tailorit = createFakeTailorIT();
  const timers = manualTimers();
  const core = fakeCore(options.core);
  const fetch: typeof tailorit.fetch = async (url, init) => {
    await options.gate;
    return tailorit.fetch(url, init);
  };
  const server = createServerClient({
    origin: ORIGIN,
    platform: { fetch, timeout: () => new AbortController().signal, now: () => START_MS },
    token: async () => (options.token === undefined ? GOLDEN_TOKEN : options.token),
    onUnauthorized: async () => undefined,
    onVersion: () => undefined,
  });
  return { profiles: createProfileCache({ server, timers, core, now: () => START_MS }), tailorit, timers, core };
}

describe('the profile cache', () => {
  it('fetches the profile, canonicalizes it, and serves it from memory after that', async () => {
    const { profiles, tailorit, core } = cache();
    const loaded = await profiles.refresh();
    expect(loaded).toMatchObject({ ok: true, value: { sensitiveState: 'not-loaded', revision: goldens.profile.revision, resumeId: null } });
    expect(loaded.ok && loaded.value.profile.identity.firstName).toBe(goldens.profile.profile.name.first);
    expect(await profiles.get()).toEqual(loaded);
    expect(tailorit.count(PROFILE)).toBe(1);
    expect(core.calls.canonicalize).toEqual([{ sensitive: false }]);
  });

  it('shares one request among callers that ask at once', async () => {
    const { profiles, tailorit } = cache();
    const [a, b] = await Promise.all([profiles.refresh(), profiles.get()]);
    expect(a).toEqual(b);
    expect(tailorit.count(PROFILE)).toBe(1);
  });

  it('drops everything after 5 idle minutes; each use restarts the wait', async () => {
    const { profiles, tailorit, timers } = cache();
    await profiles.refresh();
    timers.advance(PROFILE_IDLE_MS - 1);
    await profiles.get();
    timers.advance(PROFILE_IDLE_MS - 1);
    expect(profiles.holding).toBe(true);
    timers.advance(1);
    expect(profiles.holding).toBe(false);
    await profiles.get();
    expect(tailorit.count(PROFILE)).toBe(2);
  });

  it('fetches the sensitive part on demand: loaded, not shared (403), or unavailable', async () => {
    const loaded = cache();
    await loaded.profiles.refresh();
    expect(await loaded.profiles.loadSensitive()).toBe('loaded');
    expect(await loaded.profiles.get()).toMatchObject({ ok: true, value: { sensitiveState: 'loaded' } });
    expect(loaded.core.calls.canonicalize.at(-1)).toEqual({ sensitive: true });

    const refused = cache();
    refused.tailorit.reply(SENSITIVE, { status: 403, json: { error: { code: 'forbidden', message: 'x' } } });
    await refused.profiles.refresh();
    expect(await refused.profiles.loadSensitive()).toBe('not-shared');
    expect(await refused.profiles.get()).toMatchObject({ ok: true, value: { sensitiveState: 'not-shared' } });
    // The token's scope is the same at the next run/begin.
    await refused.profiles.refresh();
    expect(await refused.profiles.get()).toMatchObject({ ok: true, value: { sensitiveState: 'not-shared' } });

    const down = cache();
    down.tailorit.reply(SENSITIVE, { status: 500, json: { error: { code: 'internal', message: 'x' } } });
    await down.profiles.refresh();
    expect(await down.profiles.loadSensitive()).toBe('unavailable');
    expect(await down.profiles.get()).toMatchObject({ ok: true, value: { sensitiveState: 'not-loaded' } });
  });

  it('asks for the sensitive part only with a profile in memory', async () => {
    const { profiles, tailorit } = cache();
    expect(await profiles.loadSensitive()).toBe('unavailable');
    expect(tailorit.requests).toHaveLength(0);
  });

  it('keeps the sensitive part with a profile of the same revision, and drops it with a new one', async () => {
    const { profiles, tailorit } = cache();
    await profiles.refresh();
    await profiles.loadSensitive();
    await profiles.refresh();
    expect(await profiles.get()).toMatchObject({ ok: true, value: { sensitiveState: 'loaded' } });
    tailorit.reply(PROFILE, { json: { ...goldens.profile, revision: goldens.profile.revision + 1 } });
    await profiles.refresh();
    expect(await profiles.get()).toMatchObject({ ok: true, value: { sensitiveState: 'not-loaded', revision: goldens.profile.revision + 1 } });
  });

  it('keeps nothing that arrives after it was dropped (a token that changed meanwhile)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { profiles } = cache({ gate });
    const pending = profiles.refresh();
    profiles.drop();
    release();
    expect(await pending).toEqual({ ok: false, failure: 'unavailable' });
    expect(profiles.holding).toBe(false);
  });

  it('answers why it has no profile', async () => {
    expect(await cache({ token: null }).profiles.refresh()).toEqual({ ok: false, failure: 'not-connected' });

    const refused = cache();
    refused.tailorit.reply(PROFILE, { status: 401, json: { error: { code: 'not_signed_in', message: 'x' } } });
    expect(await refused.profiles.refresh()).toEqual({ ok: false, failure: 'not-connected' });

    const down = cache();
    down.tailorit.reply(PROFILE, { status: 502 });
    expect(await down.profiles.refresh()).toEqual({ ok: false, failure: 'unavailable' });

    const broken = cache({ core: { canonicalizeProfile: () => { throw new Error('bug'); } } });
    expect(await broken.profiles.refresh()).toEqual({ ok: false, failure: 'internal' });
    expect(broken.profiles.holding).toBe(false);
  });
});
