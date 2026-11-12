/*
 * jr7 ULTIPRO-7 P1 (FIX7PLAN §6.8): the UltiPro adapter on the owner's snapshot7 captures (ultipro1: recruiting2.ultipro.com
 * through UKG's sign-in on signin-us.ultipro.com; ultipro2: recruiting.ultipro.com, the same sign-in), converted as
 * fixtures/ultipro/jr7-ultipro{1,2}-*.html, each page loaded as captured (its header names its address), and a synthetic
 * page of our own for the confirmation's other branch (fixtures/synthetic/jr7-ultipro/success.html). Each rule is held
 * against the page read without it (src/adapters/ultipro/jr7 undo proofs, SP\jr7\up7\undo-*.json). Outcomes come from
 * the pages' own markup and the golden synthetic profile's rules; nothing here prints or holds a value of a page.
 * - UP7-01, UP7-V2: the page after submitting: its address read as the board's confirmation, the Submit armed on its
 *   form confirmed by it (confirmationAfter), its sign #ApplicationSubmitted shown whatever words it draws, and no sign
 *   on any other UltiPro page;
 * - UP7-02: UKG's sign-in hosts (identityHosts), where no adapter of ours runs;
 * - UP7-03: the declined EEO lists leave the scan and Submit Auto's required count while their box is ticked;
 * - UP7-04, UP7-V1: the account step's boxes, drawn by their ukg-field's shadow container, and its privacy box, the
 *   sign-in container's term; Create account enabled once filled;
 * - UP7-07: the documents dialog after Submit: nothing filled, nothing pressed, its buttons never pressed;
 * - UP7-09: the posting's Apply now, the agent's entry door's alone, pressed once by Autofill;
 * - UP7-12: the data-use consent radios labelled by their question;
 * - UP7-13 (jr6 REVC-5, asserted): the start date fillable once a wrapper draws its box, counted only while empty.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import successHtml from '../../../fixtures/synthetic/jr7-ultipro/success.html?raw';
import { openAt, runtimeAt, servedAdapter, sourceOf, wallsOf } from '../../content/apply.testkit';
import { requiredLeftOf } from '../../content/press';
import { signsOf } from '../../content/submitted';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan } from '../../dom/scan';
import { signInContainerOf } from '../../dom/sign-in-form';
import type { ScanResult, ScannedField } from '../../dom/types';
import { visibleText } from '../../dom/visible-text';
import { isHrHost, onAtsMatch, platformOfUrl } from '../../shared/hosts';
import { adaptersFor, applicationOf } from '../index';
import { fillabilityOf, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import type { Adapter } from '../types';
import { ULTIPRO_CONFIG, ULTIPRO_IDENTITY_HOSTS, ultiproAdapter } from './index';
import { parseUltiproUrl } from './url';

const HTML = import.meta.glob('../../../fixtures/ultipro/*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
/** Every UltiPro page captured (not its frames), by case name, with the address its header names. */
const PAGES = Object.entries(HTML).filter(([path]) => !/\.(?:frame-\d+|third-party-frame)\.html$/.test(path))
  .map(([path, html]) => ({ name: /ultipro\/(.+)\.html$/.exec(path)![1]!, html, address: sourceOf(html) }));
const page = (name: string) => {
  const found = PAGES.find((each) => each.name === name);
  if (found === undefined) throw new Error(`no fixture ${name}`);
  return found;
};
const addressOf = (name: string) => page(name).address!;
const JR7 = PAGES.filter((each) => each.name.startsWith('jr7-'));
const SUBMITTED = ['jr7-ultipro1-submitted', 'jr7-ultipro2-submitted'];
const APPLY_BLANK = ['jr7-ultipro1-apply-1', 'jr7-ultipro2-apply-1'];

afterEach(() => removeFixtures(document));

async function open(name: string) {
  return (await loadFixture(document, page(name).html, SNAPSHOT_VIEWPORT)).doc;
}

function scanOf(doc: Document, adapter: Adapter = ultiproAdapter): ScanResult {
  return scan(adapter.detect(doc)!.formRoot, adapter, { platform: 'ultipro' });
}

/** The field whose control (or a member of its group) matches `css`. */
function fieldOf(result: ScanResult, css: string): ScannedField | undefined {
  return result.fields.find((field) => {
    const target = result.target(field.key);
    return target !== null && (target.control.matches(css) || target.members.some((member) => member.matches(css)));
  });
}

describe('jr7 UP7-01, UP7-V2: the page after submitting', () => {
  it('reads both captures as their board\'s confirmation, confirming the Submit armed on that board\'s form alone', () => {
    for (const [form, done] of [['jr7-ultipro1-apply-11', SUBMITTED[0]!], ['jr7-ultipro2-apply-8', SUBMITTED[1]!]] as const) {
      const here = new URL(addressOf(done));
      const read = parseUltiproUrl(here)!;
      expect(read).toMatchObject({ platform: 'ultipro', jobId: '', page: 'confirmation' });
      // No per-person id is held: no query, and the key is the board's page, the same for every application of it.
      expect(read.applicationUrl).not.toContain('?');
      expect(applicationOf(here)).toMatchObject({ page: 'confirmation' });
      expect(ultiproAdapter.confirmationAfter!(new URL(addressOf(form)), here)).toBe(true);
    }
    // Another tenant's form (the other capture) is not confirmed by it.
    expect(ultiproAdapter.confirmationAfter!(new URL(addressOf('jr7-ultipro1-apply-11')), new URL(addressOf(SUBMITTED[1]!))))
      .toBe(false);
    expect(ultiproAdapter.confirmationAfter!(new URL(addressOf('jr7-ultipro2-apply-8')), new URL(addressOf(SUBMITTED[0]!))))
      .toBe(false);
  });

  it('confirms by either armed address AUTO-7 passes: the address at the press, or the arm\'s canonical posting', () => {
    for (const [form, posting, done] of [['jr7-ultipro1-apply-11', 'jr7-ultipro1-posting', SUBMITTED[0]!],
      ['jr7-ultipro2-apply-8', 'jr7-ultipro2-posting', SUBMITTED[1]!]] as const) {
      const here = new URL(addressOf(done));
      const press = new URL(addressOf(form));
      // The worker's: the canonical posting address (OpportunityDetail, tenant and ids in lower case), as the contract
      // writes it; and the captured posting's own address.
      const canonical = parseUltiproUrl(press)!.applicationUrl.replace('/OpportunityApply?', '/OpportunityDetail?');
      for (const armed of [press, new URL(canonical), new URL(addressOf(posting))]) {
        expect(ultiproAdapter.confirmationAfter!(armed, here), `${form} ${armed.pathname.split('/').at(-1)}`).toBe(true);
      }
      // The tenant written in upper case at the press (as the account step's returnUrl writes it) still reads.
      const upper = new URL(press.href.replace(press.pathname.split('/')[1]!, press.pathname.split('/')[1]!.toUpperCase()));
      expect(ultiproAdapter.confirmationAfter!(upper, here)).toBe(true);
    }
  });

  it.each(SUBMITTED)('%s: its sign is #ApplicationSubmitted shown; no form there', async (name) => {
    const doc = await open(name);
    expect(signsOf(doc, 'ultipro').map((sign) => sign.id)).toEqual(['ApplicationSubmitted']);
    expect(ultiproAdapter.detect(doc)).toBeNull();
    // Hidden, it is none.
    doc.getElementById('ApplicationSubmitted')!.style.display = 'none';
    expect(signsOf(doc, 'ultipro')).toEqual([]);
  });

  it('shows no sign on any other UltiPro page (the 27 other snapshot7 pages and the 2026-11-06 ones)', async () => {
    const others = PAGES.filter((each) => !SUBMITTED.includes(each.name));
    expect(others.length).toBe(30);
    for (const other of others) {
      const doc = await open(other.name);
      expect(signsOf(doc, 'ultipro'), other.name).toEqual([]);
      removeFixtures(document);
    }
  }, 240_000);

  it("reads the assessment branch's view by the view, whatever words it draws (UP7-V2; synthetic)", async () => {
    const { doc } = await loadFixture(document, successHtml, SNAPSHOT_VIEWPORT);
    expect(signsOf(doc, 'ultipro').map((sign) => sign.id)).toEqual(['ApplicationSubmitted']);
    // Its words are no sign: the same words outside the view, with the view gone, are none.
    doc.getElementById('ApplicationSubmitted')!.remove();
    expect(doc.getElementById('decoy-words')).not.toBeNull();
    expect(signsOf(doc, 'ultipro')).toEqual([]);
  });
});

describe('jr7 UP7-02: UKG\'s sign-in hosts', () => {
  const SIGN_IN = ['jr7-ultipro1-signin', 'jr7-ultipro1-signup', 'jr7-ultipro2-signin', 'jr7-ultipro2-signup'];

  it('names the host both tenants\' sign-in and sign-up pages were on, where nothing of ours runs', () => {
    expect(ultiproAdapter.identityHosts).toBe(ULTIPRO_IDENTITY_HOSTS);
    for (const name of SIGN_IN) {
      const url = new URL(addressOf(name));
      expect(ULTIPRO_IDENTITY_HOSTS.some((host) => host.test(url.hostname)), name).toBe(true);
      // No adapter of ours, no static content script, no application read there; an HR host (no sentinel either).
      expect([platformOfUrl(url.href), onAtsMatch(url.href), applicationOf(url), isHrHost(url.hostname)])
        .toEqual([null, false, null, true]);
    }
  });

  it('names no other host: the candidate hosts, another UKG host, a look-alike', () => {
    const named = (host: string) => ULTIPRO_IDENTITY_HOSTS.some((pattern) => pattern.test(host));
    expect(named('signin-eu.ultipro.com')).toBe(true);
    expect(named('signin.ultipro.com')).toBe(true);
    for (const host of ['recruiting.ultipro.com', 'recruiting2.ultipro.com', 'n12.ultipro.com', 'signin-us.ultipro.com.example',
      'xsignin-us.ultipro.com', 'signin-us.ultipro.ca', 'signin-us-ultipro.com']) {
      expect(named(host), host).toBe(false);
    }
  });
});

describe('jr7 UP7-03: a declined EEO list holds no question while its box is ticked', () => {
  const BOXES = '#CountryQuestions input[type="checkbox"][data-automation$="-decline-checkbox"]';
  const EEO = /^(?:Gender|Ethnic Origin|Race)$/;

  it.each(APPLY_BLANK)('%s', async (name) => {
    const doc = await open(name);
    const eeo = (result: ScanResult) => result.fields.filter((field) => field.kind === 'select' && EEO.test(field.label));
    const declines = (result: ScanResult) => result.fields.filter((field) => / I decline to say$/.test(field.label));
    const before = scanOf(doc);
    expect(eeo(before)).toHaveLength(3);
    expect(requiredLeftOf({ ...before, fields: eeo(before) })).toBe(3);
    const boxes = Array.from(doc.querySelectorAll<HTMLInputElement>(BOXES))
      .filter((box) => !/us-federal-contractor/.test(box.getAttribute('data-automation') ?? ''));
    expect(boxes).toHaveLength(3);
    for (const box of boxes) box.checked = true;
    const after = scanOf(doc);
    // Ticked: the three lists leave the scan, so Submit Auto counts none of them; every decline box stays a field.
    expect(eeo(after)).toEqual([]);
    expect(requiredLeftOf(after)).toBe(requiredLeftOf(before) - 3);
    expect(declines(after)).toHaveLength(declines(before).length);
    expect(declines(after).length).toBeGreaterThanOrEqual(3);
    // Unticked again, read at the next scan: the lists are back.
    for (const box of boxes) box.checked = false;
    expect(eeo(scanOf(doc))).toHaveLength(3);
  });
});

describe('jr7 UP7-V1, UP7-04: the account step', () => {
  const FIELDS = 'form#registrationDetailsForm ukg-field';
  /** Every account-step box's reading, with a 1 px border staged on `where` of each field. */
  async function boxes(name: string, where: 'none' | 'shadow' | 'light', adapter: Adapter = ultiproAdapter) {
    const doc = await open(name);
    for (const field of Array.from(doc.querySelectorAll(FIELDS))) {
      const target = where === 'shadow' ? field.shadowRoot?.querySelector<HTMLElement>('.ukg-field-container')
        : where === 'light' ? field.querySelector<HTMLElement>('div.input-inner-container') : null;
      if (target) target.style.border = '1px solid rgb(120, 120, 120)';
    }
    const result = scanOf(doc, adapter);
    removeFixtures(document);
    return result.fields.map((field) => ({ camouflaged: field.camouflaged, fillable: fillabilityOf(field).fillable }));
  }

  it.each(['jr7-ultipro1-register', 'jr7-ultipro2-register', 'register'])(
    '%s: its boxes are fillable once their ukg-field draws the box, camouflaged while nothing does', async (name) => {
      const drawn = await boxes(name, 'shadow');
      expect(drawn).toHaveLength(3);
      expect(drawn).toEqual(drawn.map(() => ({ camouflaged: false, fillable: true })));
      // Fail-closed: the captures keep none of UKG's component styles, so as captured nothing draws them.
      expect(await boxes(name, 'none')).toEqual(drawn.map(() => ({ camouflaged: true, fillable: false })));
    }, 60_000);

  it('declares the privacy box the account\'s term where the tenant draws one, and Create account enabled once filled',
    async () => {
      const doc = await open('jr7-ultipro1-register');
      const privacy = doc.querySelector('ukg-checkbox[data-automation="registrationDetails-privacy-checkbox"]')!;
      expect([privacy.getAttribute('role'), privacy.getAttribute('aria-checked')]).toEqual(['checkbox', 'false']);
      // Disabled with the step empty, as captured; no native input inside the box.
      const host = doc.querySelector('ukg-button[data-automation="registrationDetails-submit-button"]')!;
      expect(host.hasAttribute('disabled')).toBe(true);
      expect(privacy.querySelector('input')).toBeNull();
      const form = signInContainerOf(ultiproAdapter, doc)!;
      expect(form.terms).toEqual([privacy]);
      expect(form.enablesWhenFilled).toBe(true);
      expect(form.container).toBe(doc.querySelector('form#registrationDetailsForm'));
      expect(form.container!.contains(privacy)).toBe(true);
      // It is no field of the step (no plan writes it): the step's fields are its three boxes.
      expect(scanOf(doc).fields).toHaveLength(3);
      removeFixtures(document);
      const other = await open('jr7-ultipro2-register');
      expect(other.querySelector('ukg-checkbox')).toBeNull();
      expect(signInContainerOf(ultiproAdapter, other)).toMatchObject({ terms: [], enablesWhenFilled: true });
    });
});

describe('jr7 UP7-07: the documents dialog after Submit (owner question Q7-8: the person\'s)', () => {
  it('fills nothing and presses nothing while it shows; its Yes and No are never pressed', async () => {
    const doc = await open('jr7-ultipro1-apply-11');
    const dialog = doc.getElementById('AttachmentsChangedModal')!;
    expect(dialog.checkVisibility()).toBe(true);
    expect(ultiproAdapter.detect(doc)).toBeNull();
    expect(ultiproAdapter.isFinalStep?.(doc)).toBe('unknown');
    expect(ultiproAdapter.stepSignature?.(doc)).toEqual({ anchors: ['state:documents-dialog'] });
    const never = ultiproAdapter.neverPress?.(doc.body) ?? [];
    for (const answer of ['attachments-modal-yes', 'attachments-modal-no']) {
      const button = doc.querySelector(`button[data-automation="${answer}"]`)!;
      expect(never.some((el) => el.contains(button)), answer).toBe(true);
    }
    // Answered (gone), the application is the page again, its Submit the same host.
    dialog.remove();
    expect(ultiproAdapter.detect(doc)?.formRoot).toBe(doc.getElementById('OpportunityApply'));
  });

  it('is no state on any other application capture', async () => {
    for (const each of JR7.filter((one) => /-apply-\d+$/.test(one.name) && one.name !== 'jr7-ultipro1-apply-11')) {
      const doc = await open(each.name);
      expect(ultiproAdapter.detect(doc)?.formRoot.id, each.name).toBe('OpportunityApply');
      removeFixtures(document);
    }
  }, 240_000);
});

describe('jr7 UP7-09: the posting\'s Apply now', () => {
  const POSTINGS = ['jr7-ultipro1-posting', 'jr7-ultipro2-posting'];

  it.each(POSTINGS)('%s: the one entry control, the agent\'s door\'s alone; LinkedIn\'s widget never pressed', async (name) => {
    const doc = await open(name);
    const hosts = Array.from(doc.querySelectorAll('ukg-button[data-automation="apply-now-button"]'));
    expect(hosts).toHaveLength(1);
    expect(ultiproAdapter.entryControl?.(doc)).toBe(hosts[0]);
    expect(ultiproAdapter.entryNeverPressed).toBe(true);
    expect(ultiproAdapter.detect(doc)).toBeNull();
    // Never pressed by a run (its entry, as every declared entry is), nor LinkedIn's widget.
    const never = ultiproAdapter.neverPress?.(doc.body) ?? [];
    expect(never).toContain(doc.querySelector('[data-automation="awli-widget-container"]'));
    expect(never.some((el) => el.contains(hosts[0]!))).toBe(true);
    // A disabled host is none.
    hosts[0]!.setAttribute('disabled', '');
    expect(ultiproAdapter.entryControl?.(doc) ?? null).toBeNull();
    hosts[0]!.removeAttribute('disabled');
    hosts[0]!.setAttribute('aria-disabled', 'true');
    expect(ultiproAdapter.entryControl?.(doc) ?? null).toBeNull();
  });

  it.each(POSTINGS)('%s: Autofill presses it once (the runtime)', async (name) => {
    const address = addressOf(name);
    const { doc, clicks } = await openAt(page(name).html, address);
    const host = doc.querySelector('ukg-button[data-automation="apply-now-button"]')!;
    const pressed: boolean[] = [];
    doc.addEventListener('click', (event) => pressed.push(event.composedPath().includes(host)), true);
    const { worker, runtime } = await runtimeAt(doc, address, (url) => adaptersFor(url, doc)
      .map((adapter) => (adapter.id === 'generic' ? adapter : servedAdapter(adapter, address))));
    try {
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entry).toBe(true), { timeout: 10_000 });
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(worker.of('entry/pressed')).toHaveLength(1), { timeout: 15_000 });
      expect(clicks).toHaveLength(1);
      expect(pressed).toEqual([true]);
    } finally {
      runtime.stop();
    }
  }, 60_000);
});

describe('jr7 UP7-12: the data-use consent radios', () => {
  it('reads their question as their label (jr7-ultipro2-apply-1)', async () => {
    const doc = await open('jr7-ultipro2-apply-1');
    const question = doc.getElementById('CopyApplicantsConsentQuestion')!;
    const field = fieldOf(scanOf(doc), 'input[name="copyApplicantsConsent"]')!;
    expect(field.kind).toBe('radio');
    expect(field.label).toBe(visibleText(question, { singleLine: true }).trim());
    expect(field.label.length).toBeGreaterThan(20);
    expect(field.labelVisible).toBe(true);
    expect(field.options).toHaveLength(2);
  });
});

describe('jr7 UP7-13 (jr6 REVC-5, asserted): the start date on both blank applications', () => {
  it.each(APPLY_BLANK)('%s: fillable as captured (its box drawn by a wrapper), counted by Submit Auto only while empty',
    async (name) => {
    const doc = await open(name);
    const date = (result: ScanResult) => result.fields.find((field) => field.kind === 'date')!;
    // As captured: required, its box drawn by the wrapper jr6's dateBoxOf finds (ukg-item's scoped style), fillable.
    const drawn = scanOf(doc);
    expect([date(drawn).required, date(drawn).camouflaged]).toEqual([true, false]);
    expect(fillabilityOf(date(drawn)).fillable).toBe(true);
    expect(requiredLeftOf({ ...drawn, fields: [date(drawn)] })).toBe(1);
    // Its three boxes written: no longer counted.
    const shadow = doc.querySelector('ukg-date-input-text')!.shadowRoot!;
    for (const [part, text] of [['month', '07'], ['day', '15'], ['year', '2027']] as const) {
      shadow.querySelector<HTMLInputElement>(`input[data-automation="ukg-date-input-text-${part}"]`)!.value = text;
    }
    const written = scanOf(doc);
    expect(requiredLeftOf({ ...written, fields: [date(written)] })).toBe(0);
  });
});

describe('jr7 ULTIPRO-7: the config stays sound', () => {
  it('names each new rule\'s capture', () => {
    expect(ULTIPRO_CONFIG.success?.from).toContain('jr7-ultipro1-submitted');
    expect(ULTIPRO_CONFIG.posting?.from).toContain('jr7-ultipro1-posting');
    expect(ULTIPRO_CONFIG.states?.[0]?.name).toBe('documents-dialog');
    expect(detectPause(document, null, ultiproAdapter)).toBeNull();
  });
});
