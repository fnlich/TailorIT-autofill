/*
 * The behaviour review of 2026-11-06 (minor 17): the top frame's chain (background/chain.ts), its two cheap guards
 * pinned on its own (the worker's wiring is core-x-worker.test.ts's): a referrer two of the tab's claimed records answer
 * with different applications gives none (C5), and a closed tab's chain goes with it (C14).
 */
import { describe, expect, it } from 'vitest';
import { applicationOf } from '../adapters';
import { hrefHash } from '../adapters/chain';
import type { StorageArea } from '../platform/types';
import { CHAIN_PREFIX, createChains } from './chain';

/** storage.session in memory. */
function memorySession(): StorageArea & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    get: async (key) => entries.get(key),
    getMany: async (prefix) => Object.fromEntries([...entries].filter(([key]) => key.startsWith(prefix))),
    set: async (values) => {
      for (const [key, value] of Object.entries(values)) entries.set(key, value);
    },
    remove: async (keys) => {
      for (const key of keys) entries.delete(key);
    },
    restrictToTrustedContexts: async () => undefined,
  };
}

const TAB = 4;
const ACCOUNT = 'https://career8.successfactors.com/career?company=donnelleyf&login_ns=register&career_job_req_id=4984&_s.crb=T1';
const POST_BACK = 'https://career8.successfactors.com/career?_s.crb=T2';

describe('a top frame’s chain (minor 17: C5, C14)', () => {
  it('control: a post-back takes its account page’s application', async () => {
    const session = memorySession();
    const chains = createChains({ session, now: () => 1_000 });
    const key = applicationOf(new URL(ACCOUNT))!.applicationKey;
    await chains.noteTop(TAB, { url: ACCOUNT, documentId: 'doc-account', applicationKey: key });
    expect(await chains.inheritTop(TAB, { url: POST_BACK, documentId: 'doc-form' }, hrefHash(ACCOUNT)!))
      .toMatchObject({ applicationKey: key });
  });

  it('gives none where two records the referrer names hold different applications (C5)', async () => {
    const session = memorySession();
    const chains = createChains({ session, now: () => 1_000 });
    const record = (applicationKey: string, documentId: string) => ({ hash: hrefHash(ACCOUNT)!, applicationKey,
      url: 'https://career8.successfactors.com/career?career_job_req_id=4984', family: 'successfactors:career8.successfactors.com',
      documentId, at: 1_000 });
    await session.set({ [`${CHAIN_PREFIX}${TAB}`]: [record('successfactors:00000000000000aa', 'doc-a'),
      record('successfactors:00000000000000bb', 'doc-b')] });
    expect(await chains.inheritTop(TAB, { url: POST_BACK, documentId: 'doc-form' }, hrefHash(ACCOUNT)!)).toBeNull();
  });

  it('forgets a closed tab’s chain: its post-back takes nothing after (C14)', async () => {
    const session = memorySession();
    const chains = createChains({ session, now: () => 1_000 });
    const key = applicationOf(new URL(ACCOUNT))!.applicationKey;
    await chains.noteTop(TAB, { url: ACCOUNT, documentId: 'doc-account', applicationKey: key });
    await chains.forgetTab(TAB);
    expect(session.entries.has(`${CHAIN_PREFIX}${TAB}`)).toBe(false);
    expect(await chains.inheritTop(TAB, { url: POST_BACK, documentId: 'doc-form' }, hrefHash(ACCOUNT)!)).toBeNull();
  });
});

// ── jr7 CHAIN-7 (PC7-03): a pair page is never keyed by its referrer, whatever the tab's top records hold ──
describe('jr7 CHAIN-7: a pair page and the top chain', () => {
  it('inheritTop refuses Paycom’s application by its posting’s referrer; inheritPair alone keys it', async () => {
    const session = memorySession();
    const chains = createChains({ session, now: () => 1_000 });
    const portal = 'https://www.paycomonline.net/v4/ats/web.php/portal/0123456789ABCDEF0123456789ABCDEF';
    const posting = `${portal}/jobs/4321`;
    const key = 'paycom:00000000000000aa';
    await chains.noteTop(TAB, { url: posting, documentId: 'doc-posting', applicationKey: key, applicationUrl: posting });
    expect(await chains.inheritTop(TAB, { url: `${portal}/applications#/applications/1`, documentId: 'doc-app' },
      hrefHash(posting)!)).toBeNull();
  });
});
