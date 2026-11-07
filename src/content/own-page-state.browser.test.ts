/*
 * The behaviour review of 2026-11-06 (M3): where the address's own adapter finds no form root but reads a page state
 * (authState), the generic adapter never takes the page (content/runtime.ts pickAdapter). Its state's rules decide: a
 * state with no root of its own is no form (adapters/configured/types.ts PageState.root).
 * - ClearCompany's account step (fixtures/clearcompany/vafb-account: form#personal-info-form, state 'account', auth
 *   'create-account', no root): nothing is filled from the profile (the generic adapter filled its names, both emails and
 *   its phone), and the agent's entry reads the account's creation, Sign-in mode's.
 * - Jobvite's Data Consent (fixtures/jobvite/ninjaone-consent: state 'consent', auth 'entry-choice', no root): the page
 *   is no form, so the agent's entry door presses its "I Accept" (the generic adapter took its residence select, and
 *   the entry then answered not-offered).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import clearcompanyHtml from '../../fixtures/clearcompany/vafb-account.html?raw';
import clearcompanyRoutes from '../../fixtures/clearcompany/vafb-account.routes.json';
import jobviteHtml from '../../fixtures/jobvite/ninjaone-consent.html?raw';
import jobviteRoutes from '../../fixtures/jobvite/ninjaone-consent.routes.json';
import { adaptersFor } from '../adapters';
import { clearCompanyAdapter } from '../adapters/clearcompany';
import { genericAdapter } from '../adapters/generic';
import { jobviteAdapter } from '../adapters/jobvite';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab } from './content.testkit';
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

/** The address a route map gives a fixture page. */
const addressOf = (routes: Record<string, string>, page: string) =>
  Object.entries(routes).find(([, path]) => path === page)![0];

/** Every value the page's own controls hold now. */
const values = (fixture: Fixture) => Array.from(fixture.doc.querySelectorAll<HTMLInputElement>('input, select, textarea'))
  .map((el) => (el.type === 'checkbox' || el.type === 'radio' ? String(el.checked) : el.value));

async function start(html: string, href: string, signIn: 'auto' | 'manual' = 'manual') {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  fixture.doc.getAnimations().forEach((animation) => animation.finish());
  const pressed: Element[] = [];
  // Nothing leaves the page: a press is recorded and held.
  fixture.doc.addEventListener('click', (event) => {
    pressed.push(event.target as Element);
    event.preventDefault();
  }, true);
  fixture.doc.addEventListener('submit', (event) => event.preventDefault(), true);
  const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn } };
  const worker = createFakeWorker({ settings });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => href, isTop: true,
    adapters: (url) => adaptersFor(url), settle: { quietMs: 40 } });
  runtimes.push(runtime);
  return { fixture, worker, runtime, pressed };
}

describe('the own adapter’s page state holds the page (M3)', () => {
  it('ClearCompany’s account step: its own account form, never the generic adapter, nothing filled; the entry reads the account',
    async () => {
      const href = addressOf(clearcompanyRoutes, 'fixtures/clearcompany/vafb-account.html');
      const own = adaptersFor(new URL(href));
      expect(own).toEqual([clearCompanyAdapter, genericAdapter]);
      const { fixture, worker, runtime, pressed } = await start(clearcompanyHtml, href);
      expect(clearCompanyAdapter.authState?.(fixture.doc)).toBe('create-account');
      // The generic adapter would read a form here: it is never asked. Since the behaviour fix B2 the account state has
      // its own root (form#personal-info-form), so the page is ClearCompany's own form, held as an account page.
      expect(genericAdapter.detect(fixture.doc)).not.toBeNull();
      const before = values(fixture);
      expect(runtime.page).not.toBeNull();
      expect(clearCompanyAdapter.detect(fixture.doc)?.formRoot).toBe(fixture.doc.querySelector('form#personal-info-form'));
      // A fill rests at the account page's pause: nothing in the form changes.
      await runtime.fill();
      expect(values(fixture)).toEqual(before);
      // The page is a form (the account's), so the entry door offers nothing to press; a run there rests at the pause.
      expect(await worker.platform.deliver({ v: 1, type: 'agent/enter' }))
        .toEqual({ ok: true, data: { outcome: 'not-offered' } });
      expect(pressed).toEqual([]);
      expect(values(fixture)).toEqual(before);
    });

  it('Jobvite’s Data Consent: no form for the generic adapter; the agent’s entry presses its "I Accept"', async () => {
    const href = addressOf(jobviteRoutes, 'fixtures/jobvite/ninjaone-consent.html');
    expect(adaptersFor(new URL(href))).toEqual([jobviteAdapter, genericAdapter]);
    const { fixture, worker, runtime, pressed } = await start(jobviteHtml, href);
    expect(jobviteAdapter.authState?.(fixture.doc)).toBe('entry-choice');
    expect(genericAdapter.detect(fixture.doc)).not.toBeNull();
    expect(runtime.page).toBeNull();
    expect(runtime.fill()).toBeNull();
    const accept = jobviteAdapter.entryControl!(fixture.doc)!;
    expect(accept.textContent?.trim()).toBe('I Accept');
    expect(await worker.platform.deliver({ v: 1, type: 'agent/enter' }))
      .toEqual({ ok: true, data: { outcome: 'pressed' } });
    expect(pressed).toEqual([accept]);
  });
});
