/*
 * The Oracle Recruiting Cloud adapter on the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS,
 * Taleo, SuccessFactors and Oracle capture"): its hooks on each snapshot (a posting, the email gate), held against the
 * case's hand-written expectations, and Sign-in Auto's reading of the gate: its email, its required terms box and its
 * NEXT, in a form the page's own script sends (no method, no action), taken only on a host the every-site sign-in
 * covers; its honeypot is never one of them.
 * The snapshot build of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): the owner's snapshots of Fortive's code page
 * (fixtures/oracle/fortive-email-code.html) and of a section page of a tenant on Oracle's government cloud
 * (fixtures/oracle/hjf-apply-section.html): the code page is an email-code pause; the section page's flow form, its
 * labels, its upload, its Submit and its never-pressed controls, and the scanner's reading of it, which equals the
 * expectation as captured since the core pass of 2026-11-06 (its form is a translucent panel over the tenant's cover
 * image, which bounds what shows behind its words: dom/camouflage.ts opaqueLayerUnder), and fails closed again under a
 * thinner panel a page could hide words behind.
 */
import { afterEach, describe, expect, it } from 'vitest';
import jpmcPostingExpect from '../../../fixtures/oracle/jpmc-posting.expect.json';
import jpmcPostingHtml from '../../../fixtures/oracle/jpmc-posting.html?raw';
import elhrEmailGateExpect from '../../../fixtures/oracle/elhr-email-gate.expect.json';
import elhrEmailGateHtml from '../../../fixtures/oracle/elhr-email-gate.html?raw';
import fortiveEmailCodeExpect from '../../../fixtures/oracle/fortive-email-code.expect.json';
import fortiveEmailCodeHtml from '../../../fixtures/oracle/fortive-email-code.html?raw';
import hjfApplySectionExpect from '../../../fixtures/oracle/hjf-apply-section.expect.json';
import hjfApplySectionHtml from '../../../fixtures/oracle/hjf-apply-section.html?raw';
import hjfAfterSubmitExpect from '../../../fixtures/oracle/hjf-after-submit.expect.json';
import hjfAfterSubmitHtml from '../../../fixtures/oracle/hjf-after-submit.html?raw';
import caesarsPostingExpect from '../../../fixtures/oracle/jr6-caesars-posting.expect.json';
import caesarsPostingHtml from '../../../fixtures/oracle/jr6-caesars-posting.html?raw';
import caesarsGateExpect from '../../../fixtures/oracle/jr6-caesars-email-gate.expect.json';
import caesarsGateHtml from '../../../fixtures/oracle/jr6-caesars-email-gate.html?raw';
import { isUserVisible } from '../../dom/visibility';
// The P2 review (security 1)
import { oracleCandidateExperienceShown, oracleShellShown } from '../../dom/page-signals';
import { detectPause } from '../../dom/pause-detect';
import { scan } from '../../dom/scan';
import { signInFormOf, signInRefusal } from '../../dom/sign-in-form';
import { pressEntry } from '../../content/press';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { compareWithExpectation, fillabilityOf, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import { ORACLE_SNAPSHOTS, oracleAdapter } from './index';

const CASES = [
  { name: 'jpmc-posting', html: jpmcPostingHtml, json: jpmcPostingExpect, address: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210734835' },
  { name: 'elhr-email-gate', html: elhrEmailGateHtml, json: elhrEmailGateExpect, address: 'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946/apply/email' },
  // ── snapshot build 2026-11-06 (oracle-sf-sr) ──
  { name: 'fortive-email-code', html: fortiveEmailCodeHtml, json: fortiveEmailCodeExpect, address: 'https://ejta.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/job/10672/apply/email' },
  { name: 'hjf-apply-section', html: hjfApplySectionHtml, json: hjfApplySectionExpect, address: 'https://iaaxmg.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/job/11551/apply/section/1' },
  // ── behaviour review 2026-11-06 (M4): the same flow 12 s after its Submit ──
  { name: 'hjf-after-submit', html: hjfAfterSubmitHtml, json: hjfAfterSubmitExpect, address: 'https://iaaxmg.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/job/11551/apply/section/1' },
  // ── jr6 ORACLE (FIXPLAN §6.11): the owner's snapshots of a us2 tenant's posting and its email gate ──
  { name: 'jr6-caesars-posting', html: caesarsPostingHtml, json: caesarsPostingExpect, address: 'https://edmn.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/78569' },
  { name: 'jr6-caesars-email-gate', html: caesarsGateHtml, json: caesarsGateExpect, address: 'https://edmn.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/78569/apply/email' },
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
 * What the scanner reads differently from the page on these snapshots, and why. Oracle draws its gate and its code page
 * on a translucent panel (rgba(248, 248, 247, 0.75)) over the flow's background image; until the core pass of
 * 2026-11-06 the trap rules could not work out those colours and read every box there as camouflaged (the gate's email
 * box with no visible label, its terms box and the code page's "Keep me signed in" no field). The panel now bounds
 * what shows behind its words (dom/camouflage.ts opaqueLayerUnder), so they read. Left: the code page's six boxes,
 * named by an aria-label alone (no visible label), are no field a fill writes (the page is the person's anyway: an
 * email-code pause). Each listed difference must still be there, so the list is emptied once the scanner reads them.
 */
const KNOWN: Record<string, ReadonlyArray<{ control: string; property: string }>> = {
  // ── snapshot build 2026-11-06 (oracle-sf-sr) ──
  'fortive-email-code': [1, 2, 3, 4, 5, 6].map((n) => ({ control: `input#pin-code-${n}`, property: 'fillable' })),
};

/** The flow's panel made thinner (a white veil of alpha 0.2), as a page hiding words behind it would draw it: its words
 *  then lie between the veil's darkest and lightest, where some image under it may match them (the core pass of
 *  2026-11-06's adversarial case, fixtures/synthetic/translucent-veil.html, on the real page). */
function thinPanel(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('.apply-flow__content'))) {
    el.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
  }
}

/** The flow drawn on plain white (its cover image taken away): its words and boxes then read clear. */
function plain(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('.apply-flow'))) el.style.backgroundImage = 'none';
}

/** The page once its fade-ins have run (each upload's drop zone fades in over 0.4 s: [dir="ltr"]
 *  .attachment-upload-button__upload-button { animation: 0.4s ... fade-in-animation }), as a person sees it: every
 *  finite animation finished. */
function faded(doc: Document): void {
  for (const animation of doc.getAnimations()) {
    const end = animation.effect?.getComputedTiming().endTime;
    if (typeof end === 'number' && Number.isFinite(end)) animation.finish();
  }
}

/** What the scanner reads differently from hjf-apply-section.expect.json once the image is taken away, and why: the
 *  read-only email box and the phone's number box (borderless inside its composite row) read as camouflaged. jr6 O4:
 *  the adapter declares the row's bordered group as the number box's (controlBox), which the camouflage check reads
 *  from ENGINE E2 (jr6-engine-e2) on: the phone's entry goes once this branch holds that tag (ORACLE P2). */
const KNOWN_PLAIN: ReadonlyArray<{ control: string; property: string }> = [
  { control: 'input#email-22', property: 'fillable' }, { control: 'input.phone-row__input', property: 'fillable' }];

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

  it.each(CASES.filter((each) => readHooks(each.json).detect !== null && each.name !== 'hjf-apply-section'))(
    '$name: the scan of its root is the expectation',
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

// ── snapshot build 2026-11-06 (oracle-sf-sr) ──
describe("a section page on Oracle's government cloud (the owner's snapshot of 2026-11-06)", () => {
  const { html, json, address } = CASES[3];

  // The core pass of 2026-11-06: as captured, the form is a panel of rgba(248, 248, 247, 0.75) over the cover image, its
  // words rgb(90, 108, 119): over any image the panel lies between itself over black and over white, and its words and
  // boxes read clear against every colour between, so the page reads as it does on plain white.
  it('reads as the expectation as captured: its translucent panel bounds the cover image under it', async () => {
    const fixture = await load(html, address);
    faded(fixture.doc);
    const result = scan(oracleAdapter.detect(fixture.doc)!.formRoot, oracleAdapter, { platform: 'oracle' });
    const found = compareWithExpectation(fixture.doc, result, readExpectation(json));
    for (const each of KNOWN_PLAIN) expect(found, `${each.control} ${each.property}`).toContainEqual(expect.objectContaining(each));
    expect(found.filter((each) => !KNOWN_PLAIN.some((one) => one.control === each.control && one.property === each.property)))
      .toEqual([]);
  });

  it('fails closed under a thinner panel, whose grey words an image under it may hide; black words read on any', async () => {
    const fixture = await load(html, address);
    faded(fixture.doc);
    thinPanel(fixture.doc);
    const result = scan(oracleAdapter.detect(fixture.doc)!.formRoot, oracleAdapter, { platform: 'oracle' });
    expect(result.fields.length).toBeGreaterThan(20);
    const fillable = result.fields.filter((field) => fillabilityOf(field, result.target(field.key)?.widget).fillable);
    // Every row's label is rgb(90, 108, 119), between the veil's darkest (51) and lightest (255): refused. Three are
    // worded in black (the drop zone's words and the two agreements), which read even on the veil over black. jr6 O5,
    // O1: the phone's country code is labelled by its own sub-label, grey too but drawn inside the phone row's opaque
    // white group (rgb(255, 255, 255)), which no image shows through, and declared a widget: it reads.
    expect(fillable.map((field) => field.label)).toEqual(['Country code', 'Drop Cover Letter Here',
      'I agree to receive updates about new job opportunities.', 'I agree to receive marketing communications']);
  });

  it('reads as the expectation once the image is taken away (labels from the rows, the upload, required pills)', async () => {
    const fixture = await load(html, address);
    plain(fixture.doc);
    faded(fixture.doc);
    const root = oracleAdapter.detect(fixture.doc)!.formRoot;
    const result = scan(root, oracleAdapter, { platform: 'oracle' });
    const found = compareWithExpectation(fixture.doc, result, readExpectation(json));
    for (const each of KNOWN_PLAIN) expect(found, `${each.control} ${each.property}`).toContainEqual(expect.objectContaining(each));
    expect(found.filter((each) => !KNOWN_PLAIN.some((one) => one.control === each.control && one.property === each.property)))
      .toEqual([]);
  });

  it('is its final step: Submit is its one pagination button, never a Next', async () => {
    const fixture = await load(html, address);
    expect(oracleAdapter.isFinalStep!(fixture.doc)).toBe('final');
    expect(oracleAdapter.submitButton!(fixture.doc.documentElement)).toBe(
      fixture.doc.querySelector('button.apply-flow-pagination__submit-button'));
    // jr6 O8: a Next is read where a section shows one (jr6-oracle.browser.test.ts); this one-page flow shows none.
    expect(oracleAdapter.nextButton!(fixture.doc.documentElement)).toBeNull();
    // The behaviour review of 2026-11-06 (O08): a Submit the page hides is no Submit a person sees, so the step is not
    // read as final by it.
    const submit = fixture.doc.querySelector<HTMLElement>('button.apply-flow-pagination__submit-button')!;
    submit.style.display = 'none';
    expect(oracleAdapter.submitButton!(fixture.doc.documentElement)).toBeNull();
    expect(oracleAdapter.isFinalStep!(fixture.doc)).toBe('unknown');
    submit.style.display = '';
    expect(oracleAdapter.isFinalStep!(fixture.doc)).toBe('final');
    // Without its Submit (the gate, the code page) the step says nothing.
    fixture.doc.querySelector('.apply-flow-pagination')!.remove();
    expect(oracleAdapter.isFinalStep!(fixture.doc)).toBe('unknown');
  });

  it("reads the timeline's invalid entry as an error the page shows, and no notification before the Submit", async () => {
    const fixture = await load(html, address);
    const root = oracleAdapter.detect(fixture.doc)!.formRoot;
    const marks = fixture.doc.querySelectorAll('.beautiful-timeline-item--invalid-block');
    expect(marks.length).toBe(1);
    // The page's notifications hold no item before a Submit (<notifications><div role="alert" ...> with no list).
    expect(fixture.doc.querySelectorAll('.notifications').length).toBe(1);
    expect(fixture.doc.querySelectorAll('li.notifications__item').length).toBe(0);
    expect(oracleAdapter.errors!(root).map((each) => each.el)).toEqual([marks[0]]);
  });
});

// ── behaviour review 2026-11-06 (M4) ──
describe("the same flow 12 s after its Submit (the owner's later snapshot of 2026-11-06)", () => {
  const { html, address } = CASES[4];
  const NOTIFIED = 'li.notifications__item.cx-notifications__item--error';

  /** The Submit's checklist dialog closed, as the page draws it closed before the Submit (hjf-apply-section.html: the
   *  oj-dialog.apply-flow-checklist-dialog at display none, and no aria-hidden on div.app, which the open modal dialog
   *  sets). */
  function closeChecklist(doc: Document): void {
    for (const dialog of Array.from(doc.querySelectorAll<HTMLElement>('oj-dialog.apply-flow-checklist-dialog'))) {
      dialog.style.display = 'none';
    }
    doc.querySelector('div.app')!.removeAttribute('aria-hidden');
  }

  it('as captured: the checklist dialog is open over the page, so no form shows and the notification reads as nothing',
    async () => {
      const fixture = await load(html, address);
      const doc = fixture.doc;
      expect(isUserVisible(doc.querySelector('oj-dialog.apply-flow-checklist-dialog')!)).toBe(true);
      expect(doc.querySelector('div.app')!.getAttribute('aria-hidden')).toBe('true');
      expect(oracleAdapter.detect(doc)).toBeNull();
      expect(oracleAdapter.isFinalStep!(doc)).toBe('unknown');
      const notified = doc.querySelectorAll(NOTIFIED);
      expect(notified.length).toBe(1);
      expect(isUserVisible(notified[0]!)).toBe(false);
      expect(oracleAdapter.errors!(doc.documentElement).map((each) => each.el)).not.toContain(notified[0]);
    });

  it('reads the page’s error notification once the dialog closes: no aria-invalid and no timeline mark there', async () => {
    const fixture = await load(html, address);
    const doc = fixture.doc;
    closeChecklist(doc);
    const root = oracleAdapter.detect(doc)!.formRoot;
    expect(root.matches('form.apply-flow__content-form')).toBe(true);
    const notified = doc.querySelector(NOTIFIED)!;
    expect(notified.querySelector('.notifications__item-message')!.textContent).toBe(
      'You have 1 issue that needs to be fixed before you can submit your application.');
    // What the page shows besides: no field marked invalid, the timeline's invalid mark gone.
    expect(doc.querySelectorAll('[aria-invalid="true"]').length).toBe(0);
    expect(doc.querySelectorAll('.beautiful-timeline-item--invalid-block').length).toBe(0);
    expect(oracleAdapter.errors!(root).map((each) => each.el)).toEqual([notified]);
  });

  it('reads no notification the page hides or took away', async () => {
    const fixture = await load(html, address);
    const doc = fixture.doc;
    closeChecklist(doc);
    const root = oracleAdapter.detect(doc)!.formRoot;
    const notified = doc.querySelector<HTMLElement>(NOTIFIED)!;
    notified.style.display = 'none';
    expect(oracleAdapter.errors!(root)).toEqual([]);
    notified.style.display = '';
    notified.remove();
    expect(oracleAdapter.errors!(root)).toEqual([]);
  });
});

describe("the code page (the owner's snapshot of 2026-11-06)", () => {
  it('is an email-code pause by its six boxes, at the gate’s own address, and no gate', async () => {
    const { html, address } = CASES[2];
    const fixture = await load(html, address);
    expect(oracleAdapter.authState!(fixture.doc)).toBe('email-code');
    expect(signInFormOf(oracleAdapter, fixture.doc, 'email-gate')).toBeNull();
    const root = oracleAdapter.detect(fixture.doc)!.formRoot;
    expect(detectPause(fixture.doc, root, oracleAdapter)?.kind).toBe('email-code');
    // The boxes are the sign: without them, no code page.
    for (const box of Array.from(fixture.doc.querySelectorAll('input.pin-code-input__input'))) box.remove();
    expect(oracleAdapter.authState!(fixture.doc)).toBeNull();
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

  // The core pass of 2026-11-06: the gate's panel over the flow's image bounds what shows behind its words, so its terms
  // label reads as captured; under a thinner panel it cannot be read, and the gate is refused as before (S6).
  it('takes the gate as captured, its terms label read through the panel; refuses it where the label cannot be read (S6)',
    async () => {
      const { fixture, address } = await served();
      const form = signInFormOf(oracleAdapter, fixture.doc, 'email-gate')!;
      expect(form.colourUnknown).toEqual([form.email]);
      expect(signInRefusal(form, new URL(address))).toBeNull();
      thinPanel(fixture.doc);
      expect(signInRefusal(signInFormOf(oracleAdapter, fixture.doc, 'email-gate')!, new URL(address))).toBe('hidden');
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

// ── v5 p2-detect, the P2 review (security 1): Oracle's Candidate Experience on an employer's own domain ──
/** The Oracle app's shell tags (dom/page-signals.ts) renamed to plain divs: the same page without the app's markup. */
const withoutShell = (html: string) => html
  .replace(/<(oj-dialog|minimal-dialog|skip-navigation-link|sitemap-link)(?=[\s>])/g, '<div data-was="$1"')
  .replace(/<\/(?:oj-dialog|minimal-dialog|skip-navigation-link|sitemap-link)>/g, '</div>');
const OWN_ROOT = 'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_2001/job/11551';

describe("an employer's own domain (the P2 review, security 1)", () => {
  it('every snapshot holds the app’s own markup, the shell alone after it, and a page without it holds none', async () => {
    for (const { name, html, address } of CASES) {
      const fixture = await load(html, address);
      expect(oracleCandidateExperienceShown(fixture.doc), name).toBe(true);
      expect(oracleShellShown(fixture.doc), name).toBe(true);
      removeFixtures(document);
      const stripped = await load(withoutShell(html), address);
      expect(oracleCandidateExperienceShown(stripped.doc), name).toBe(false);
      expect(oracleShellShown(stripped.doc), name).toBe(false);
      removeFixtures(document);
    }
  });

  it('presses nothing at the address without the app’s markup: no Submit, no final step, no APPLY NOW', async () => {
    const section = await load(withoutShell(hjfApplySectionHtml), `${OWN_ROOT}/apply/section/1`);
    const root = oracleAdapter.detect(section.doc)!.formRoot;
    expect(oracleAdapter.submitButton!(root)).toBeNull();
    expect(oracleAdapter.isFinalStep!(section.doc)).toBe('unknown');
    removeFixtures(document);
    const posting = await load(withoutShell(jpmcPostingHtml), OWN_ROOT);
    expect(oracleAdapter.entryControl!(posting.doc)).toBeNull();
    expect(await pressEntry(posting.doc, [oracleAdapter], new AbortController().signal, 300, 300))
      .not.toEqual({ outcome: 'pressed' });
  });

  it('reads the genuine app on the employer’s domain as on Oracle’s own hosts', async () => {
    const section = await load(hjfApplySectionHtml, `${OWN_ROOT}/apply/section/1`);
    const root = oracleAdapter.detect(section.doc)!.formRoot;
    expect(oracleAdapter.submitButton!(root)?.textContent?.trim()).toBe('Submit');
    expect(oracleAdapter.isFinalStep!(section.doc)).toBe('final');
    removeFixtures(document);
    const posting = await load(jpmcPostingHtml, OWN_ROOT);
    expect(oracleAdapter.entryControl!(posting.doc)).not.toBeNull();
    // Oracle's own hosts keep every hook whatever the markup (their static match is the proof).
    removeFixtures(document);
    const tenant = await load(withoutShell(hjfApplySectionHtml), CASES[3].address);
    expect(oracleAdapter.submitButton!(oracleAdapter.detect(tenant.doc)!.formRoot)).not.toBeNull();
  });
});
// ── end v5 p2-detect ──
