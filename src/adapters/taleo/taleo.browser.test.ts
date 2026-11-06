/*
 * The Taleo adapter on the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors
 * and Oracle capture"): its hooks on each snapshot (a posting, two sign-ins, the password help, the Privacy Agreement),
 * held against the case's hand-written expectations, and Sign-in Auto's reading of the login: its user-name box, its
 * password, its type=button Login, which the standard rule cannot read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import hdrPostingExpect from '../../../fixtures/taleo/hdr-posting.expect.json';
import hdrPostingHtml from '../../../fixtures/taleo/hdr-posting.html?raw';
import hdrLoginExpect from '../../../fixtures/taleo/hdr-login.expect.json';
import hdrLoginHtml from '../../../fixtures/taleo/hdr-login.html?raw';
import cpsLoginExpect from '../../../fixtures/taleo/cps-login.expect.json';
import cpsLoginHtml from '../../../fixtures/taleo/cps-login.html?raw';
import hdrForgotPasswordExpect from '../../../fixtures/taleo/hdr-forgot-password.expect.json';
import hdrForgotPasswordHtml from '../../../fixtures/taleo/hdr-forgot-password.html?raw';
import massanfPrivacyAgreementExpect from '../../../fixtures/taleo/massanf-privacy-agreement.expect.json';
import massanfPrivacyAgreementHtml from '../../../fixtures/taleo/massanf-privacy-agreement.html?raw';
import { signInFormOf, standardSignInForm, signInRefusal } from '../../dom/sign-in-form';
import { pressEntry } from '../../content/press';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import { TALEO_SNAPSHOTS, taleoAdapter } from './index';

const CASES = [
  { name: 'hdr-posting', html: hdrPostingHtml, json: hdrPostingExpect, address: 'https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=197675&lang=en' },
  { name: 'hdr-login', html: hdrLoginHtml, json: hdrLoginExpect, address: 'https://hdr.taleo.net/careersection/iam/accessmanagement/login.jsf?lang=en&redirectionURI=https%3A%2F%2Fhdr.taleo.net%2Fcareersection%2Fex%2Fjobapply.ftl%3Fjob%3D197675%26lang%3Den' },
  { name: 'cps-login', html: cpsLoginHtml, json: cpsLoginExpect, address: 'https://cpsk12il.taleo.net/careersection/iam/accessmanagement/login.jsf?lang=en&redirectionURI=https%3A%2F%2Fcpsk12il.taleo.net%2Fcareersection%2F3%2Fjobapply.ftl%3Fjob%3DP177162%26lang%3Den' },
  { name: 'hdr-forgot-password', html: hdrForgotPasswordHtml, json: hdrForgotPasswordExpect, address: 'https://hdr.taleo.net/careersection/iam/accessmanagement/forgotPasswordAccessCode.jsf?redirectionURI=https%3A%2F%2Fhdr.taleo.net%2Fcareersection%2Fex%2Fjobapply.ftl%3Fjob%3D197675%26lang%3Den' },
  { name: 'massanf-privacy-agreement', html: massanfPrivacyAgreementHtml, json: massanfPrivacyAgreementExpect, address: 'https://massanf.taleo.net/careersection/ex/jobapply.ftl?job=260007QL&lang=en' },
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

describe('the Taleo adapter: its hooks on the snapshots', () => {
  it('names each snapshot it was written from', () => {
    expect([...new Set(CASES.map((each) => `fixtures/taleo/${each.name.replace(/\.frame-\d+$/, '')}.html`))].sort())
      .toEqual([...TALEO_SNAPSHOTS].sort());
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ html, json, address }) => {
    const fixture = await load(html, address);
    expect(compareHooks(fixture.doc, taleoAdapter, readHooks(json))).toEqual([]);
  });

  it.each(CASES.filter((each) => readHooks(each.json).detect !== null))('$name: the scan of its root is the expectation',
    async ({ html, json, address }) => {
      const scanned = await scanCase(document, html, address);
      expect(scanned.adapter).toBe(taleoAdapter);
      expect(compareWithExpectation(scanned.doc, scanned.result, readExpectation(json))).toEqual([]);
    });
});

describe('the login (v3 Phase 7b)', () => {
  it('passes the refusal rules as served, where the standard rule reads no form at all', async () => {
    for (const { html, address } of CASES.filter((each) => each.name.endsWith('-login'))) {
      const fixture = await load(html, address);
      // As Taleo serves it (the converter wrote action="/__submitted"): a POST to its own login.jsf.
      const owner = fixture.doc.querySelector<HTMLFormElement>('form#dialogTemplate-dialogForm')!;
      owner.setAttribute('action', '/careersection/iam/accessmanagement/login.jsf');
      owner.setAttribute('method', 'post');
      expect(standardSignInForm(fixture.doc, 'sign-in')).toBeNull();
      const form = signInFormOf(taleoAdapter, fixture.doc, 'sign-in')!;
      expect(signInRefusal(form, new URL(address)), address).toBeNull();
      expect(signInFormOf(taleoAdapter, fixture.doc, 'create-account')).toBeNull();
    }
  });

  it('reads no wall on the password help or the Privacy Agreement: nothing is typed there', async () => {
    for (const { html, address } of CASES.filter((each) => each.name.includes('forgot') || each.name.includes('privacy'))) {
      const fixture = await load(html, address);
      for (const wall of ['sign-in', 'create-account', 'email-gate'] as const) {
        expect(signInFormOf(taleoAdapter, fixture.doc, wall)).toBeNull();
      }
    }
  });
});

describe("the agent's entry (v3 Phase 7b)", () => {
  it('presses the posting’s visible Apply Online, an input type=button, once', async () => {
    const { html, address } = CASES[0];
    const fixture = await load(html, address);
    const pressed: Element[] = [];
    // Nothing navigates: a link's click is held, and the page's own scripts are gone from the snapshot.
    fixture.doc.addEventListener('click', (event) => {
      pressed.push(event.target as Element);
      event.preventDefault();
    });
    expect(await pressEntry(fixture.doc, [taleoAdapter], new AbortController().signal, 300, 300)).toEqual({ outcome: 'pressed' });
    expect(pressed).toEqual([fixture.doc.querySelector('[id="requisitionDescriptionInterface.UP_APPLY_ON_REQ.row1"]')]);
  });

  it('accepts the Privacy Agreement as the entry, a required consent to apply; never declines it', async () => {
    const privacy = CASES.find((each) => each.name.includes('privacy'))!;
    const fixture = await load(privacy.html, privacy.address);
    const pressed: Element[] = [];
    fixture.doc.addEventListener('click', (event) => {
      pressed.push(event.target as Element);
      event.preventDefault();
    });
    expect(taleoAdapter.detect(fixture.doc)).toBeNull();
    expect(await pressEntry(fixture.doc, [taleoAdapter], new AbortController().signal, 300, 300)).toEqual({ outcome: 'pressed' });
    expect(pressed).toEqual([fixture.doc.querySelector('[id$="StatementBeforeAuthentificationContent-ContinueButton"]')]);
    expect(taleoAdapter.neverPress!(fixture.doc.documentElement))
      .toContain(fixture.doc.querySelector('[id$="StatementBeforeAuthentificationContent-CancelButton"]'));
  });
});
