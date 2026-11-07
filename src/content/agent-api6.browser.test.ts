/*
 * The snapshot build of 2026-11-06 (contract6): TailorIT's API 6 puts iCIMS and Pinpoint among the auto-apply agent's
 * platforms (AUTOFILL_AGENT_ATS). For each, on the owner's snapshots (the fixtures and their route maps' addresses):
 * - the address TailorIT's agentApplicationUrl gives is the page the agent begins on, its platform's adapter's: iCIMS's
 *   posting (eastwestbank-posting.frame-1), whose "Apply for this job online" is the agent's entry, which opens the email
 *   gate; Pinpoint's form at /applications/new (prophetx-form), which its adapter detects, no entry needed;
 * - every page the walk shows, from the posting to the page after submitting, is the task's own application (one key);
 * - the page after submitting shows the sign submissions.ts takes: iCIMS's .iCIMS_SuccessMessage on
 *   /job?mode=submit_apply (nyu-submitted.frame-1), Pinpoint's section#application-thanks on /applications/thanks
 *   (prophetx-thanks).
 * The worker's half (the task accepted, the address opened, the entry asked for, the run started, the sign taken) is
 * src/background/agent.test.ts's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import icimsPostingHtml from '../../fixtures/icims/eastwestbank-posting.frame-1.html?raw';
import icimsPostingRoutes from '../../fixtures/icims/eastwestbank-posting.routes.json';
import icimsGateRoutes from '../../fixtures/icims/eastwestbank-email-gate.routes.json';
import icimsSubmittedHtml from '../../fixtures/icims/nyu-submitted.frame-1.html?raw';
import icimsSubmittedRoutes from '../../fixtures/icims/nyu-submitted.routes.json';
import pinpointFormHtml from '../../fixtures/pinpoint/prophetx-form.html?raw';
import pinpointFormRoutes from '../../fixtures/pinpoint/prophetx-form.routes.json';
import pinpointPostingHtml from '../../fixtures/pinpoint/prophetx-posting.html?raw';
import pinpointPostingRoutes from '../../fixtures/pinpoint/prophetx-posting.routes.json';
import pinpointThanksHtml from '../../fixtures/pinpoint/prophetx-thanks.html?raw';
import pinpointThanksRoutes from '../../fixtures/pinpoint/prophetx-thanks.routes.json';
import { adaptersFor, applicationOf } from '../adapters';
import { icimsAdapter } from '../adapters/icims';
import { parseIcimsUrl } from '../adapters/icims/url';
import { pinpointAdapter } from '../adapters/pinpoint';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import { agentApplicationUrl, AUTOFILL_AGENT_ATS } from '../contract/tailorit';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { signsOf, successShown } from './submitted';

afterEach(() => removeFixtures(document));

/** The address a route map gives a fixture page. */
function addressOf(routes: Record<string, string>, page: string): string {
  const found = Object.entries(routes).find(([, path]) => path === page)?.[0];
  if (found === undefined) throw new Error(`no address for ${page}`);
  return found;
}

/** A snapshot at its own address (a srcdoc page's is about:srcdoc), its fade-ins finished. */
async function open(html: string, address: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  fixture.doc.getAnimations().forEach((animation) => animation.finish());
  return fixture.doc;
}

const keyOf = (address: string) => applicationOf(new URL(address))?.applicationKey ?? null;

it('TailorIT’s API 6 lists iCIMS and Pinpoint among the agent’s platforms', () => {
  expect(AUTOFILL_AGENT_ATS).toEqual(['greenhouse', 'lever', 'ashby', 'workable', 'icims', 'pinpoint']);
});

describe('iCIMS (the agent opens the posting; its entry, then the gate)', () => {
  const posting = addressOf(icimsPostingRoutes, 'fixtures/icims/eastwestbank-posting.frame-1.html');
  const top = addressOf(icimsPostingRoutes, 'fixtures/icims/eastwestbank-posting.html');
  const gate = addressOf(icimsGateRoutes, 'fixtures/icims/eastwestbank-email-gate.frame-1.html');
  const submitted = addressOf(icimsSubmittedRoutes, 'fixtures/icims/nyu-submitted.frame-1.html');

  it('opens the posting’s own page, the adapter’s, whose "Apply for this job online" is the entry to the gate', async () => {
    const opened = agentApplicationUrl(top)!;
    expect(opened).toBe('https://careers-eastwestbank.icims.com/jobs/13634/job');
    expect([agentApplicationUrl(posting), agentApplicationUrl(gate)]).toEqual([opened, opened]);
    expect(adaptersFor(new URL(opened))[0]).toBe(icimsAdapter);
    expect(parseIcimsUrl(new URL(opened))?.page).toBe('posting');
    const doc = await open(icimsPostingHtml, posting);
    const entry = icimsAdapter.entryControl!(doc)!;
    expect(entry.getAttribute('title')).toBe('Apply for this job online');
    // Its link is the posting's own apply, which opens the email gate (url.ts: the gate is the application).
    expect(parseIcimsUrl(new URL(entry.getAttribute('href')!, posting))).toMatchObject({ page: 'posting' });
    expect(new URL(entry.getAttribute('href')!, posting).searchParams.get('mode')).toBe('apply');
    expect(parseIcimsUrl(new URL(gate))?.page).toBe('application');
    // The wrapper, its frame, the gate: one application, the task's.
    expect(new Set([opened, top, posting, gate].map(keyOf))).toEqual(new Set([keyOf(opened)]));
  });

  it('shows .iCIMS_SuccessMessage on /job?mode=submit_apply, the sign the worker takes', async () => {
    expect(parseIcimsUrl(new URL(submitted))?.page).toBe('confirmation');
    expect(keyOf(submitted)).toBe(keyOf(agentApplicationUrl(submitted)!));
    const doc = await open(icimsSubmittedHtml, submitted);
    expect(successShown(doc, 'icims')).toBe(true);
    expect(signsOf(doc, 'icims').map((sign) => sign.matches('.iCIMS_SuccessMessage'))).toEqual([true]);
  });
});

describe('Pinpoint (the agent opens the form at /applications/new)', () => {
  const posting = addressOf(pinpointPostingRoutes, 'fixtures/pinpoint/prophetx-posting.html');
  const form = addressOf(pinpointFormRoutes, 'fixtures/pinpoint/prophetx-form.html');
  const thanks = addressOf(pinpointThanksRoutes, 'fixtures/pinpoint/prophetx-thanks.html');

  it('opens the form, the adapter’s, from the posting, the form or the page after submitting', async () => {
    const opened = agentApplicationUrl(posting)!;
    expect(opened).toMatch(/^https:\/\/prophetexchange\.pinpointhq\.com\/en\/postings\/[0-9a-f-]{36}\/applications\/new$/);
    expect([agentApplicationUrl(form), agentApplicationUrl(thanks)]).toEqual([opened, opened]);
    expect(adaptersFor(new URL(opened))[0]).toBe(pinpointAdapter);
    expect(applicationOf(new URL(opened))?.page).toBe('application');
    const doc = await open(pinpointFormHtml, form);
    expect(pinpointAdapter.detect(doc)).not.toBeNull();
    expect(new Set([opened, posting, form, thanks].map(keyOf))).toEqual(new Set([keyOf(opened)]));
    // The posting's Apply Now is its entry too, should the agent ever be on the posting.
    const postingDoc = await open(pinpointPostingHtml, posting);
    expect(pinpointAdapter.entryControl!(postingDoc)).not.toBeNull();
  });

  it('shows section#application-thanks on /applications/thanks, the sign the worker takes', async () => {
    expect(applicationOf(new URL(thanks))?.page).toBe('confirmation');
    const doc = await open(pinpointThanksHtml, thanks);
    expect(successShown(doc, 'pinpoint')).toBe(true);
    expect(signsOf(doc, 'pinpoint').map((sign) => sign.matches('section#application-thanks'))).toEqual([true]);
  });
});
