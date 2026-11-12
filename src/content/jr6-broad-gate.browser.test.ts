/*
 * jr6 apply F2 item 1 (APPLYPLAN D6; B2, apply-flow-new-1, C6), the broad gate: Autofill's entry is offered on an
 * application address too (ADP's job details at its guest page's address, Workable's job site before its dialog
 * opens), so every committed fixture at an application address is read again here, at its own address, by the real
 * adapters and the real content runtime. A page that shows no form (no own adapter's detect), no state (no own
 * adapter's authState) and nothing the generic adapter would claim is where the wider gate could newly offer an entry:
 * none of them may, but the pages listed in EXPECTED_OFFERS, each a platform's declared entry on such a page. Ported
 * from the verifier's survey of 2026-11-10 (SP\jr6\verify-b\broad-gate.browser.test.ts: 167 fixtures at application
 * addresses, 0 new offers). Fixture names, counts and booleans only.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adaptersFor, applicationOf } from '../adapters';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import { removeFixtures } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import { isUserVisible } from '../dom/visibility';
import { openAt, runtimeAt, servedAdapter, sourceOf } from './apply.testkit';
import { testVocab } from './content.testkit';
import type { ContentRuntime } from './runtime';
import { WALL_LOOK_MS } from './runtime';

const PAGES = import.meta.glob('../../fixtures/**/*.html', { query: '?raw', import: 'default' }) as
  Record<string, () => Promise<string>>;
/** Pages that are no application of a platform (traps, company sites, synthetic pages, the smoke form, profiles) and
 *  frames served inside another page. */
const SKIP = /\/fixtures\/(?:traps|sites|synthetic|smoke|profiles)\/|\.frame-\d+\.html$|third-party-frame\.html$/;
/** The pages at an application address whose own adapter offers its declared entry there by design (APPLYPLAN D6).
 *  jr6 CHAINS (integration, BUILD.md 4b): ADP's job details (line W's E-ADP, fixtures/adp/jr6-posting.html): ADP
 *  Workforce Now shows a job's details at its guest page's own address, and its header's Apply is the declared entry
 *  there (ADP_CONFIG.posting.entry). No other page may offer one. */
const EXPECTED_OFFERS: ReadonlySet<string> = new Set<string>(['adp/jr6-posting.html',
  // ── jr7 ADP-7 (FIX7PLAN §6.9) ──
  // snapshot7 adp1's job details (both captures, at the guest page's address, as jr6-posting), and ADP7-10's signed-in
  // landing, whose "Complete Your Application" is its entry (owner question Q7-14, default yes).
  'adp/jr7-adp1-posting.html', 'adp/jr7-adp1-posting-2.html', 'adp/jr6-landing.html',
  // ── end jr7 ADP-7 ──
]);

const runtimes: ContentRuntime[] = [];
beforeAll(() => {
  testVocab();
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

const safe = <T>(read: () => T, fallback: T): T => {
  try {
    return read();
  } catch {
    return fallback;
  }
};

describe('jr6 apply F2 item 1: the entry gate on application addresses (D6)', () => {
  it('offers no entry on a committed fixture at an application address with no form, no state and no generic control',
    async () => {
      const tally = { pages: 0, application: 0, noForm: 0, offered: 0, told: 0 };
      const offered: string[] = [];
      const told: string[] = [];
      for (const [path, load] of Object.entries(PAGES).sort(([a], [b]) => a.localeCompare(b))) {
        if (SKIP.test(path)) continue;
        tally.pages += 1;
        const html = await load();
        const source = sourceOf(html);
        if (source === null) continue;
        const url = new URL(source);
        if (applicationOf(url)?.page !== 'application') continue;
        tally.application += 1;
        const { doc } = await openAt(html, source);
        const ownOf = (at: URL): Adapter[] => adaptersFor(at, doc).map((adapter) => (adapter.id === 'generic' ? adapter
          : servedAdapter(adapter, source)));
        const own = ownOf(url).filter((adapter) => adapter.id !== 'generic');
        const form = own.some((adapter) => safe(() => adapter.detect(doc) !== null, false));
        const state = own.some((adapter) => safe(() => (adapter.authState?.(doc) ?? null) !== null, false));
        const generic = safe(() => genericAdapter.detect(doc) !== null, false);
        if (form || state || generic) {
          removeFixtures(document);
          continue;
        }
        tally.noForm += 1;
        const name = path.replace(/^(?:\.\.\/)+fixtures\//, '');
        const control = own.map((adapter) => safe(() => adapter.entryControl?.(doc) ?? null, null))
          .find((el) => el !== null && isUserVisible(el));
        if (control !== undefined) {
          tally.offered += 1;
          offered.push(name);
        }
        // The real runtime on the page: what its frame tells the worker of an entry.
        const { worker, runtime } = await runtimeAt(doc, source, ownOf);
        runtimes.push(runtime);
        // A page whose runtime says no hello (an embed's address, read as a frame's) tells no wall either.
        await deadline(WALL_LOOK_MS * 2);
        if (worker.of('frame/wall').some((message) => message.entry === true)) {
          tally.told += 1;
          told.push(name);
        }
        runtime.stop();
        runtimes.splice(0);
        removeFixtures(document);
      }
      // The survey (2026-11-11, this branch: 167 at application addresses, 15 with no form, none offered or told) is not empty: the committed fixtures hold application pages, and some show no form.
      expect(tally.application, JSON.stringify(tally)).toBeGreaterThan(100);
      expect(tally.noForm).toBeGreaterThan(0);
      expect(offered.filter((name) => !EXPECTED_OFFERS.has(name))).toEqual([]);
      expect(told.filter((name) => !EXPECTED_OFFERS.has(name))).toEqual([]);
      // jr6 CHAINS: each page listed offers its entry, and its runtime tells it (a listed page that stopped offering is
      // a stale list, or a lost declaration).
      expect(offered.filter((name) => EXPECTED_OFFERS.has(name)).sort()).toEqual([...EXPECTED_OFFERS].sort());
      expect(told.filter((name) => EXPECTED_OFFERS.has(name)).sort()).toEqual([...EXPECTED_OFFERS].sort());
    }, 900_000);
});
