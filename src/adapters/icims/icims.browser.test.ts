/*
 * The iCIMS adapter on the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors
 * and Oracle capture"): its hooks on each snapshot (the company's wrapper, the posting in its frame, the email gate in
 * its frame), held against the case's hand-written expectations, and Sign-in Auto's reading of the gate: the email, the
 * GDPR box where the portal asks for it, Next; never in the wrapper's frame (a top frame only).
 */
import { afterEach, describe, expect, it } from 'vitest';
import eastwestbankPostingExpect from '../../../fixtures/icims/eastwestbank-posting.expect.json';
import eastwestbankPostingHtml from '../../../fixtures/icims/eastwestbank-posting.html?raw';
import eastwestbankPostingFrame1Expect from '../../../fixtures/icims/eastwestbank-posting.frame-1.expect.json';
import eastwestbankPostingFrame1Html from '../../../fixtures/icims/eastwestbank-posting.frame-1.html?raw';
import eastwestbankEmailGateFrame1Expect from '../../../fixtures/icims/eastwestbank-email-gate.frame-1.expect.json';
import eastwestbankEmailGateFrame1Html from '../../../fixtures/icims/eastwestbank-email-gate.frame-1.html?raw';
import gdmsEmailGateFrame1Expect from '../../../fixtures/icims/gdms-email-gate.frame-1.expect.json';
import gdmsEmailGateFrame1Html from '../../../fixtures/icims/gdms-email-gate.frame-1.html?raw';
import eastwestbankEmailGateHtml from '../../../fixtures/icims/eastwestbank-email-gate.html?raw';
import gdmsEmailGateHtml from '../../../fixtures/icims/gdms-email-gate.html?raw';
import { genericAdapter } from '../generic';
import { signInFormOf, signInRefusal } from '../../dom/sign-in-form';
import { pressEntry } from '../../content/press';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import { ICIMS_SNAPSHOTS, icimsAdapter } from './index';

const CASES = [
  { name: 'eastwestbank-posting', html: eastwestbankPostingHtml, json: eastwestbankPostingExpect, address: 'https://careers-eastwestbank.icims.com/jobs/13634/credit-reviewer-ii/job' },
  { name: 'eastwestbank-posting.frame-1', html: eastwestbankPostingFrame1Html, json: eastwestbankPostingFrame1Expect, address: 'https://careers-eastwestbank.icims.com/jobs/13634/credit-reviewer-ii/job?in_iframe=1' },
  { name: 'eastwestbank-email-gate.frame-1', html: eastwestbankEmailGateFrame1Html, json: eastwestbankEmailGateFrame1Expect, address: 'https://careers-eastwestbank.icims.com/jobs/13634/credit-reviewer-ii/login?in_iframe=1' },
  { name: 'gdms-email-gate.frame-1', html: gdmsEmailGateFrame1Html, json: gdmsEmailGateFrame1Expect, address: 'https://careers-gdms.icims.com/jobs/78183/senior-advanced-quality-inspector/login?in_iframe=1' },
] as const;

/** A page's own base address (a srcdoc page's is about:srcdoc), after it loaded: its forms and links resolve there. */
function setBase(doc: Document, address: string): void {
  const base = doc.createElement('base');
  base.href = address;
  doc.head.prepend(base);
}

async function load(html: string, address: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  setBase(fixture.doc, address);
  return fixture;
}

afterEach(() => removeFixtures(document));

describe('the iCIMS adapter: its hooks on the snapshots', () => {
  it('names each snapshot it was written from', () => {
    expect([...new Set(CASES.map((each) => `fixtures/icims/${each.name.replace(/\.frame-\d+$/, '')}.html`))].sort())
      .toEqual([...ICIMS_SNAPSHOTS].sort());
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ html, json, address }) => {
    const fixture = await load(html, address);
    expect(compareHooks(fixture.doc, icimsAdapter, readHooks(json))).toEqual([]);
  });

  it.each(CASES.filter((each) => readHooks(each.json).detect !== null))('$name: the scan of its root is the expectation',
    async ({ html, json, address }) => {
      const scanned = await scanCase(document, html, address);
      expect(scanned.adapter).toBe(icimsAdapter);
      expect(compareWithExpectation(scanned.doc, scanned.result, readExpectation(json))).toEqual([]);
    });
});

describe('the email gate (v3 Phase 7b)', () => {
  it('passes the refusal rules as served (a POST to the portal itself), its Next read before the GDPR box enables it', async () => {
    for (const { html, address } of CASES.filter((each) => each.name.includes('email-gate'))) {
      const fixture = await load(html, address);
      // As iCIMS serves it (the converter wrote action="/__submitted"): a POST to the portal's own gate.
      const gate = fixture.doc.querySelector<HTMLFormElement>('form#enterEmailForm')!;
      gate.setAttribute('action', address.replace('?in_iframe=1', '?step=email&in_iframe=1&hashed=REDACTED'));
      gate.setAttribute('method', 'post');
      const form = signInFormOf(icimsAdapter, fixture.doc, 'email-gate')!;
      expect(form.password).toBeNull();
      expect(form.form).toBe(gate);
      expect(signInRefusal(form, new URL(address)), address).toBeNull();
      gate.setAttribute('action', 'https://collector.example/login');
      expect(signInRefusal(form, new URL(address))).toBe('cross-origin');
      gate.setAttribute('action', address);
      expect(signInRefusal(form, new URL(address.replace('https:', 'http:')))).toBe('not-https');
    }
  });

  it('never reads the gate’s wrapper (the company’s page around its frame) as a root or a form, by either adapter', async () => {
    for (const [html, address] of [[eastwestbankEmailGateHtml, CASES[2].address.replace('?in_iframe=1', '')],
      [gdmsEmailGateHtml, CASES[3].address.replace('?in_iframe=1', '')]] as const) {
      const wrapper = await load(html, address);
      expect(icimsAdapter.detect(wrapper.doc), address).toBeNull();
      expect(genericAdapter.detect(wrapper.doc), address).toBeNull();
      expect(icimsAdapter.authState!(wrapper.doc), address).toBeNull();
      for (const wall of ['sign-in', 'create-account', 'email-gate'] as const) {
        expect(signInFormOf(icimsAdapter, wrapper.doc, wall), wall).toBeNull();
      }
      removeFixtures(document);
    }
  });

  it('never reads the wrapper as a form, nor the gate as any other wall', async () => {
    const wrapper = await load(CASES[0].html, CASES[0].address);
    expect(icimsAdapter.detect(wrapper.doc)).toBeNull();
    const gate = await load(CASES[3].html, CASES[3].address);
    expect(signInFormOf(icimsAdapter, gate.doc, 'sign-in')).toBeNull();
    expect(signInFormOf(icimsAdapter, gate.doc, 'create-account')).toBeNull();
  });
});

describe("the agent's entry (v3 Phase 7b)", () => {
  it('presses the visible Apply for this job online in the posting’s frame, once', async () => {
    const { html, address } = CASES[1];
    const fixture = await load(html, address);
    const pressed: Element[] = [];
    // Nothing navigates: a link's click is held, and the page's own scripts are gone from the snapshot.
    fixture.doc.addEventListener('click', (event) => {
      pressed.push(event.target as Element);
      event.preventDefault();
    });
    expect(await pressEntry(fixture.doc, [icimsAdapter], new AbortController().signal, 300, 300)).toEqual({ outcome: 'pressed' });
    expect(pressed).toEqual([fixture.doc.querySelector('#jobOptionsMobile a.iCIMS_ApplyOnlineButton')]);
  });
});
