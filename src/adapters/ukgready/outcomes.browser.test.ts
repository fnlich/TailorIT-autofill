/*
 * UKG Ready's shared outcomes (jr7 FIX7PLAN §6.14, P2): what the scan and the plan make of the owner's snapshot7 pages
 * once ENGINE-7 E1/E2 (the declared box's drawn edge, UKGR-5; a select at opacity 0 inside its box, UKGR-6; the inner
 * scroller, UKGR-7) and RULES-7 R1/R2 (UKGR-13, 14, 15, 16, 18, V2) are merged, with the golden synthetic profile
 * (fixtures/profiles/alex-rivera.*): which fields a run fills, under which category, and which it never fills. The
 * editors are planned with the repeatable request the orchestrator sends (the saved summaries' words: readEntries).
 * UKGR-7: on these captures html and body are overflow hidden and the page scrolls inside div.l-page-layout-content,
 * below div#_layout's overflow: hidden. ENGINE-7 E4-1 (jr7-engine-e4) lifts that clip for a scroller in a page that
 * never scrolls itself, so the boxes below about 900 px (the required "Eligible For Work in the USA", the
 * questionnaire's questions 3 to 10) are fields (flipped by INT-7 once e4 merged).
 * Facts only: the fixtures' personal text is REDACTED; every planned value is the golden profile's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { planFrame } from '../../core/plan/frame';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import { deadline } from '../../dom/time';
import type { ScanResult } from '../../dom/types';
import { configuredAdapter } from '../configured';
import { fillabilityOf, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import type { Adapter } from '../types';
import { UKGREADY_CONFIG, ukgReadyAdapter } from './index';

const HTML = import.meta.glob('../../../fixtures/ukgready/*.html', { query: '?raw', import: 'default' }) as
  Record<string, () => Promise<string>>;

afterEach(() => removeFixtures(document));

/** One field's outcome: its label, kind, whether a run can write it, its category, status, reason and planned value. */
interface Outcome {
  label: string;
  kind: string;
  fillable: boolean;
  camouflaged: boolean;
  section: string;
  /** The repeatable block the field sits in (the saved entries first, the open editor after them), or null. */
  block: number | null;
  category: string | undefined;
  status: string | undefined;
  reason: string | undefined;
  /** The planned write: its text, its option's label, 'check', 'file', or null for none. */
  plan: string | null;
}

/** A case scanned and planned (module header), its outcomes by the control each field writes. */
async function planned(name: string, adapter: Adapter = ukgReadyAdapter) {
  const { doc } = await loadFixture(document, await HTML[`../../../fixtures/ukgready/${name}.html`]!(), SNAPSHOT_VIEWPORT);
  const finite = doc.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
  await Promise.race([Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))), deadline(3_000)]);
  const root = adapter.detect(doc)!.formRoot;
  const result: ScanResult = scan(root, adapter, { platform: 'ukgready' });
  const repeatables = (adapter.repeatables?.(root) ?? []).map((section) => ({ kind: section.kind, entries: null,
    shown: adapter.prefill?.readEntries?.(section.kind, section.blocks()) ?? [] }));
  const out = planFrame({ repeatables, specs: result.fields.map(toFieldSpec), canaries: [], profile: goldenProfile(),
    sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company: 'Northwind', location: 'Austin, TX, USA' } });
  const outcomes: Outcome[] = result.fields.map((field) => {
    const target = result.target(field.key);
    const row = out.results.find((each) => each.key === field.key);
    const write = out.writes.find((each) => each.key === field.key);
    const plan = write === undefined ? null : write.value.kind === 'text' ? write.value.text
      : write.value.kind === 'option' ? write.value.cleanLabel : write.value.kind;
    return { label: field.label, kind: field.kind, fillable: fillabilityOf(field, target?.widget).fillable,
      camouflaged: field.camouflaged, section: field.section.id, block: field.section.block ?? null, category: row?.category, status: row?.status,
      reason: row?.reason, plan };
  });
  /** The outcome of the field whose control (or member) matches `css`. */
  const at = (css: string): Outcome | undefined => {
    const el = doc.querySelector(css);
    const index = result.fields.findIndex((field) => {
      const target = result.target(field.key);
      return target !== null && (target.control === el || target.members.includes(el as HTMLInputElement));
    });
    return index < 0 ? undefined : outcomes[index];
  };
  return { doc, result, outcomes, at };
}

const golden = goldenProfile();

describe('UKG Ready: what a run fills (UKGR-5, UKGR-6, RULES-7)', () => {
  it('the start form: First, Last and Personal Email, none camouflaged any more (UKGR-5)', async () => {
    const { outcomes } = await planned('jr7-saashr-start-filled');
    expect(outcomes.map((each) => [each.label, each.camouflaged, each.fillable, each.category, each.status, each.plan]))
      .toEqual([['First', false, true, 'identity.firstName', 'verified', golden.identity.firstName],
        ['Last', false, true, 'identity.lastName', 'verified', golden.identity.lastName],
        ['Personal Email', false, true, 'contact.email', 'verified', golden.contact.email]]);
  });

  it('Personal Information: the names, the email, the phones and their country codes (UKGR-6, UKGR-16)', async () => {
    const { outcomes, at } = await planned('jr7-saashr-contact');
    expect(outcomes.filter((each) => each.camouflaged)).toEqual([]);
    for (const css of ['input[name="firstName"]', 'input[name="lastName"]', 'input[name="personalEmail"]']) {
      expect(at(css), css).toMatchObject({ fillable: true, status: 'verified' });
    }
    // The three "Code" selects, drawn at opacity 0 inside their field box, are fields now, each its phone's country.
    const codes = outcomes.filter((each) => each.label.endsWith('country code'));
    expect(codes.map((each) => [each.label, each.kind, each.fillable, each.category]))
      .toEqual(['Home Phone', 'Work Phone', 'Cell Phone'].map((phone) => [`${phone} country code`, 'select', true,
        'contact.phoneCountry']));
    expect(codes.every((each) => each.status === 'verified' && each.plan !== null)).toBe(true);
    // "Primary National ID" is an identifier, never filled (UKGR-14); the SSN box is no field at all.
    const nationalId = outcomes.find((each) => each.label === 'Primary National ID');
    expect(nationalId).toMatchObject({ category: 'identity.nationalId', plan: null });
    expect(at('input[name="SSN"]')).toBeUndefined();
  });

  it('the Address: Country, Street (address.line1) and Zip; City and State are the person\'s (UKGR-16, UKGR-17 gated)',
    async () => {
      const { at } = await planned('jr7-saashr-contact-address-filled');
      expect(at('select[name="country"]')).toMatchObject({ kind: 'select', fillable: true, category: 'address.country',
        status: 'verified' });
      expect(at('input[name="address_line_1"]')).toMatchObject({ fillable: true, category: 'address.line1',
        status: 'verified', plan: golden.address?.line1 });
      expect(at('input[name="zip"]')).toMatchObject({ fillable: true, category: 'address.postalCode', status: 'verified' });
      // UKGR-17 (gated Q7-1: no capture of an open list): the lazy comboboxes are never written.
      for (const css of ['input[name="city"]', 'input[name="state"]']) {
        expect(at(css), css).toMatchObject({ kind: 'combobox', fillable: false, plan: null });
      }
    });

  it('a work entry\'s editor: its fields in the experience block, Job title #1 and Present read (UKGR-15)', async () => {
    const { at } = await planned('jr7-saashr-work-entry-filled');
    const current = golden.experience.find((entry) => entry.current === true);
    // The editor is the fourth block, after the three saved entries.
    expect(at('#react_popup input[name="Company Name"]')).toMatchObject({ section: 'experience', block: 3,
      category: 'experience.company', status: 'verified', plan: current?.company });
    expect(at('#react_popup input[name="Job title"]')).toMatchObject({ section: 'experience',
      category: 'experience.title', status: 'verified', plan: current?.title });
    expect(at('#react_popup input[name="Present"]')).toMatchObject({ category: 'experience.current', plan: 'check' });
    expect(at('#react_popup input[name="Job To"]')).toMatchObject({ category: 'experience.endDate', plan: null });
    // The supervisor's name and phone are another person's: never the applicant's own.
    for (const css of ['#react_popup input[name="Supervisor Name"]', '#react_popup input[name="Supervisor Phone"]']) {
      expect(at(css)?.plan, css).toBeNull();
      expect(at(css)?.category, css).not.toMatch(/^(?:identity|contact)\./);
    }
  });

  it('an education entry\'s editor: the school, the degree and the major in the education block', async () => {
    const { at } = await planned('jr7-saashr-education-entry-filled');
    expect(at('#react_popup input[name="schoolName"]')).toMatchObject({ section: 'education', block: 1,
      category: 'education.school', status: 'verified' });
    expect(at('#react_popup select[name="degreeLevelId"]')).toMatchObject({ kind: 'select', category: 'education.degree',
      status: 'verified' });
    expect(at('#react_popup input[name="major"]')).toMatchObject({ category: 'education.field', status: 'verified' });
    expect(at('select[name="highestEducation"]')).toMatchObject({ kind: 'select', category: 'education.highestLevel',
      status: 'verified' });
  });

  it('the reference editor, were it read, plans none of the applicant\'s own details (UKGR-13, RULES-7)', async () => {
    const unexcluded = configuredAdapter({ ...UKGREADY_CONFIG, excluded: [] });
    const { at } = await planned('jr7-saashr-reference-entry', unexcluded);
    for (const name of ['refCompany', 'refEmail', 'refPhone', 'contactPerson']) {
      const outcome = at(`#react_popup input[name="${name}"]`);
      expect(outcome?.section, name).toBe('professional-references');
      expect(outcome?.plan, name).toBeNull();
      expect(outcome?.category, name).not.toMatch(/^(?:contact\.|identity\.|experience\.company$)/);
    }
  });

  it('the e-signature: consent.signature, typed as the first and last name the start form took (UKGR-18, UKGR-V2)',
    async () => {
      const { at } = await planned('jr7-saashr-review-sign');
      expect(at('input#signature')).toMatchObject({ label: 'Full Name to confirm', fillable: true,
        category: 'consent.signature', status: 'verified',
        plan: `${golden.identity.firstName} ${golden.identity.lastName}` });
    });

  it('the questionnaire\'s first questions in view: its selects drawn at opacity 0 are fields (UKGR-6)', async () => {
    const { outcomes } = await planned('jr7-saashr-questionnaire');
    expect(outcomes.slice(0, 3).map((each) => [each.kind, each.fillable, each.camouflaged]))
      .toEqual([['checkbox-group', true, false], ['select', true, false], ['select', true, false]]);
  });
});

describe('UKG Ready: below the inner scroller (UKGR-7, ENGINE-7 E4-1)', () => {
  it('the required "Eligible For Work in the USA" and the custom questions of Resume & Cover Letter are fields',
    async () => {
      const { at, outcomes } = await planned('jr7-saashr-documents');
      expect(at('input[name="usaWorkEligibility"]')).toMatchObject({ kind: 'checkbox', fillable: true,
        category: 'workAuth.authorized', plan: 'check' });
      expect(outcomes.map((each) => each.label)).toEqual(expect.arrayContaining(['Required salary', 'Summary']));
    });

  it('every question of the questionnaire is a field, its salary box at the bottom too', async () => {
    const { outcomes } = await planned('jr7-saashr-questionnaire');
    expect(outcomes).toHaveLength(11);
  });
});
