/*
 * The SuccessFactors adapter on the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS, Taleo,
 * SuccessFactors and Oracle capture"): its hooks on each snapshot (the posting, the sign-in, the account's creation, the
 * password help), held against the case's hand-written expectations, and Sign-in Auto's reading of the sign-in, which
 * the standard rule reads the same way; the account's creation stays the person's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import danfossPostingExpect from '../../../fixtures/successfactors/danfoss-posting.expect.json';
import danfossPostingHtml from '../../../fixtures/successfactors/danfoss-posting.html?raw';
import danfossSignInExpect from '../../../fixtures/successfactors/danfoss-sign-in.expect.json';
import danfossSignInHtml from '../../../fixtures/successfactors/danfoss-sign-in.html?raw';
import danfossCreateAccountExpect from '../../../fixtures/successfactors/danfoss-create-account.expect.json';
import danfossCreateAccountHtml from '../../../fixtures/successfactors/danfoss-create-account.html?raw';
import danfossForgotPasswordExpect from '../../../fixtures/successfactors/danfoss-forgot-password.expect.json';
import danfossForgotPasswordHtml from '../../../fixtures/successfactors/danfoss-forgot-password.html?raw';
import { signInFormOf, standardSignInForm, signInRefusal } from '../../dom/sign-in-form';
import { pressEntry } from '../../content/press';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import { SUCCESSFACTORS_SNAPSHOTS, successFactorsAdapter } from './index';

const CASES = [
  { name: 'danfoss-posting', html: danfossPostingHtml, json: danfossPostingExpect, address: 'https://career2.successfactors.eu/career?career_job_req_id=48659&career_ns=job_listing&company=danfossas' },
  { name: 'danfoss-sign-in', html: danfossSignInHtml, json: danfossSignInExpect, address: 'https://career2.successfactors.eu/career?career_company=danfossas&company=danfossas&loginFlowRequired=true&career_job_req_id=48659' },
  { name: 'danfoss-create-account', html: danfossCreateAccountHtml, json: danfossCreateAccountExpect, address: 'https://career2.successfactors.eu/career?company=danfossas&login_ns=register&career_job_req_id=48659' },
  { name: 'danfoss-forgot-password', html: danfossForgotPasswordHtml, json: danfossForgotPasswordExpect, address: 'https://career2.successfactors.eu/career?company=danfossas&login_ns=forgot_pwd&career_job_req_id=48659' },
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

describe('the SuccessFactors adapter: its hooks on the snapshots', () => {
  it('names each snapshot it was written from', () => {
    expect([...new Set(CASES.map((each) => `fixtures/successfactors/${each.name.replace(/\.frame-\d+$/, '')}.html`))].sort())
      .toEqual([...SUCCESSFACTORS_SNAPSHOTS].sort());
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ html, json, address }) => {
    const fixture = await load(html, address);
    expect(compareHooks(fixture.doc, successFactorsAdapter, readHooks(json))).toEqual([]);
  });

  it.each(CASES.filter((each) => readHooks(each.json).detect !== null))('$name: the scan of its root is the expectation',
    async ({ html, json, address }) => {
      const scanned = await scanCase(document, html, address);
      expect(scanned.adapter).toBe(successFactorsAdapter);
      expect(compareWithExpectation(scanned.doc, scanned.result, readExpectation(json))).toEqual([]);
    });
});

describe('the sign-in (v3 Phase 7b)', () => {
  /** The page as SuccessFactors serves it: the converter wrote action="/__submitted" on every form; the capture's own is
   *  a POST to /career on the page's origin (its _s.crb token redacted). */
  async function served(html: string, address: string) {
    const fixture = await load(html, address);
    const form = fixture.doc.querySelector<HTMLFormElement>('form#careerform')!;
    form.setAttribute('action', '/career?_s.crb=REDACTED');
    form.setAttribute('method', 'POST');
    return fixture;
  }

  it('declares the form the standard rule reads, and it passes the refusal rules as served', async () => {
    const { html, address } = CASES[1];
    const fixture = await served(html, address);
    const declared = signInFormOf(successFactorsAdapter, fixture.doc, 'sign-in')!;
    const standard = standardSignInForm(fixture.doc, 'sign-in')!;
    expect([declared.email, declared.password, declared.button]).toEqual([standard.email, standard.password, standard.button]);
    expect(signInRefusal(declared, new URL(address))).toBeNull();
    expect(signInRefusal(standard, new URL(address))).toBeNull();
    // Another origin is refused.
    fixture.doc.querySelector('form#careerform')!.setAttribute('action', 'https://collector.example/career');
    expect(signInRefusal(declared, new URL(address))).toBe('cross-origin');
  });

  it('types the account’s creation (the email twice) and leaves its press to the person; the password help is theirs', async () => {
    const { html, address } = CASES[2];
    const fixture = await served(html, address);
    const form = signInFormOf(successFactorsAdapter, fixture.doc, 'create-account')!;
    expect(form.confirmEmail?.id).toBe('fbclc_emailConf');
    expect(form.personPresses).toBe(true);
    expect(signInRefusal(form, new URL(address))).toBeNull();
    // Undeclared, the email typed again is no slot of a form.
    expect(signInRefusal({ ...form, declared: undefined }, new URL(address))).toBe('shape');
    expect(signInFormOf(successFactorsAdapter, fixture.doc, 'sign-in')).toBeNull();
    const forgot = await served(CASES[3].html, CASES[3].address);
    for (const wall of ['sign-in', 'create-account', 'email-gate'] as const) {
      expect(signInFormOf(successFactorsAdapter, forgot.doc, wall)).toBeNull();
    }
  });
});

describe("the agent's entry (v3 Phase 7b)", () => {
  it('never presses Apply: a typeless button in the page’s form, which would submit it', async () => {
    const { html, address } = CASES[0];
    const fixture = await load(html, address);
    const pressed: Element[] = [];
    // Nothing navigates: a link's click is held, and the page's own scripts are gone from the snapshot.
    fixture.doc.addEventListener('click', (event) => {
      pressed.push(event.target as Element);
      event.preventDefault();
    });
    expect(await pressEntry(fixture.doc, [successFactorsAdapter], new AbortController().signal, 300, 300)).toEqual({ outcome: 'not-offered' });
    expect(pressed).toEqual([]);
  });
});
