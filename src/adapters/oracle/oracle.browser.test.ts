/*
 * The Oracle Recruiting Cloud adapter on the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS,
 * Taleo, SuccessFactors and Oracle capture"): its hooks on each snapshot (a posting, the email gate), held against the
 * case's hand-written expectations, and Sign-in Auto's reading of the gate: its email, its required terms box and its
 * NEXT, in a form the page's own script sends (no method, no action), taken only on a host the every-site sign-in
 * covers; its honeypot is never one of them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import jpmcPostingExpect from '../../../fixtures/oracle/jpmc-posting.expect.json';
import jpmcPostingHtml from '../../../fixtures/oracle/jpmc-posting.html?raw';
import elhrEmailGateExpect from '../../../fixtures/oracle/elhr-email-gate.expect.json';
import elhrEmailGateHtml from '../../../fixtures/oracle/elhr-email-gate.html?raw';
import { signInFormOf, signInRefusal } from '../../dom/sign-in-form';
import { pressEntry } from '../../content/press';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import { ORACLE_SNAPSHOTS, oracleAdapter } from './index';

const CASES = [
  { name: 'jpmc-posting', html: jpmcPostingHtml, json: jpmcPostingExpect, address: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210734835' },
  { name: 'elhr-email-gate', html: elhrEmailGateHtml, json: elhrEmailGateExpect, address: 'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946/apply/email' },
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

/**
 * What the scanner reads differently from the page on these snapshots, and why: Oracle draws its gate in front of the
 * flow's background image, whose colours the trap rules cannot work out, so they read its boxes as camouflaged (failing
 * closed): the email box gets no visible label, and the terms box behind its label no field. The gate is an email gate
 * (a pause): a run fills nothing on it, and Sign-in Auto reads its boxes as the adapter declares them (signInFormOf),
 * held to every honeypot rule but that colour test. Each listed difference must still be there, so the list is emptied
 * once the scanner reads these boxes.
 */
const KNOWN: Record<string, ReadonlyArray<{ control: string; property: string }>> = {
  'elhr-email-gate': [{ control: 'input#primary-email-0', property: 'label' },
    { control: 'input#primary-email-0', property: 'fillable' },
    { control: 'input#legal-disclaimer-checkbox', property: 'field' }],
};

afterEach(() => removeFixtures(document));

describe('the Oracle Recruiting Cloud adapter: its hooks on the snapshots', () => {
  it('names each snapshot it was written from', () => {
    expect([...new Set(CASES.map((each) => `fixtures/oracle/${each.name.replace(/\.frame-\d+$/, '')}.html`))].sort())
      .toEqual([...ORACLE_SNAPSHOTS].sort());
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ html, json, address }) => {
    const fixture = await load(html, address);
    expect(compareHooks(fixture.doc, oracleAdapter, readHooks(json))).toEqual([]);
  });

  it.each(CASES.filter((each) => readHooks(each.json).detect !== null))('$name: the scan of its root is the expectation',
    async ({ name, html, json, address }) => {
      const scanned = await scanCase(document, html, address);
      expect(scanned.adapter).toBe(oracleAdapter);
      const known = KNOWN[name] ?? [];
      const found = compareWithExpectation(scanned.doc, scanned.result, readExpectation(json));
      for (const each of known) expect(found, `${each.control} ${each.property}`).toContainEqual(expect.objectContaining(each));
      expect(found.filter((each) => !known.some((one) => one.control === each.control && one.property === each.property)))
        .toEqual([]);
    });
});

describe('the email gate (v3 Phase 7b)', () => {
  /** The gate as Oracle serves it: the converter wrote action and method on its form, Oracle's has neither. */
  async function served() {
    const { html, address } = CASES[1];
    const fixture = await load(html, address);
    const email = fixture.doc.querySelector<HTMLInputElement>('input[name="primary-email"]')!;
    email.form!.removeAttribute('action');
    email.form!.removeAttribute('method');
    return { fixture, address };
  }

  /** The flow drawn on plain white (its background image taken away): the gate's words then read clear. */
  function plain(doc: Document): void {
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>('.apply-flow'))) el.style.backgroundImage = 'none';
  }

  it('refuses the gate as captured: its terms box is reached through a label whose words cannot be read (S6)', async () => {
    const { fixture, address } = await served();
    const form = signInFormOf(oracleAdapter, fixture.doc, 'email-gate')!;
    expect(form.colourUnknown).toEqual([form.email]);
    expect(signInRefusal(form, new URL(address))).toBe('hidden');
  });

  it('takes the gate on a covered tenant, JPMC’s region-less host included (API 5), and refuses it elsewhere and on http',
    async () => {
    const { fixture, address } = await served();
    plain(fixture.doc);
    const form = signInFormOf(oracleAdapter, fixture.doc, 'email-gate')!;
    expect(form.password).toBeNull();
    expect(form.scriptSubmits).toBe(true);
    expect(form.enablesWhenFilled).toBe(true);
    expect(signInRefusal(form, new URL(address))).toBeNull();
    // TailorIT's API 5 covers a region-less tenant (<tenant>.fa.oraclecloud.com); a host that is no Fusion tenant it does not.
    expect(signInRefusal(form, new URL('https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/1/apply/email')))
      .toBeNull();
    expect(signInRefusal(form, new URL('https://acme.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/1/apply/email')))
      .toBe('method');
    expect(signInRefusal(form, new URL(address.replace('https:', 'http:')))).toBe('not-https');
    expect(signInRefusal({ ...form, scriptSubmits: undefined }, new URL(address))).toBe('method');
    // The colour test's opt-out is the email box's alone, never another box's.
    expect(signInRefusal({ ...form, colourUnknown: [form.terms[0]!] }, new URL(address))).toBe('shape');
  });

  it('never takes its honeypot for the email box', async () => {
    const { fixture, address } = await served();
    const form = signInFormOf(oracleAdapter, fixture.doc, 'email-gate')!;
    const honeypot = fixture.doc.querySelector<HTMLInputElement>('input[name="honey-pot"]')!;
    expect(form.email).not.toBe(honeypot);
    expect(signInRefusal({ ...form, email: honeypot }, new URL(address))).not.toBeNull();
  });

  it('reads the gate by its address and the markup only it has, and its Next by its name (S2)', async () => {
    // Another address of the flow (a later section) holding the same box: no gate, no form.
    const later = await load(CASES[1].html, CASES[1].address.replace('/apply/email', '/apply/section/2'));
    expect(oracleAdapter.authState!(later.doc)).toBeNull();
    expect(signInFormOf(oracleAdapter, later.doc, 'email-gate')).toBeNull();
    removeFixtures(document);
    // At the gate's address, without its CANCEL or its honeypot: still the gate (a pause), but no form to sign in by.
    for (const marker of ['[data-qa="emailVerificationCancelButton"]', 'input[name="honey-pot"]']) {
      const { fixture } = await served();
      fixture.doc.querySelector(marker)!.remove();
      expect(oracleAdapter.authState!(fixture.doc)).toBe('email-gate');
      expect(signInFormOf(oracleAdapter, fixture.doc, 'email-gate'), marker).toBeNull();
      removeFixtures(document);
    }
    // A submit button that does not say Next (the flow's shared pagination button as Submit): no form.
    const { fixture } = await served();
    const next = fixture.doc.querySelector<HTMLButtonElement>('button[type="submit"][title="Next"]')!;
    for (const name of ['title', 'aria-label']) next.setAttribute(name, 'Submit');
    for (const label of Array.from(next.querySelectorAll('.button__label'))) label.textContent = 'Submit';
    expect(signInFormOf(oracleAdapter, fixture.doc, 'email-gate')).toBeNull();
  });
});

describe("the agent's entry (v3 Phase 7b)", () => {
  it('presses the first APPLY NOW, a button in no form, once', async () => {
    const { html, address } = CASES[0];
    const fixture = await load(html, address);
    const pressed: Element[] = [];
    // Nothing navigates: a link's click is held, and the page's own scripts are gone from the snapshot.
    fixture.doc.addEventListener('click', (event) => {
      pressed.push(event.target as Element);
      event.preventDefault();
    });
    expect(await pressEntry(fixture.doc, [oracleAdapter], new AbortController().signal, 300, 300)).toEqual({ outcome: 'pressed' });
    expect(pressed).toEqual([fixture.doc.querySelectorAll('.job-details__section-apply-button button.apply-now-button')[0]]);
  });
});
