/*
 * jr7 FIX-content (the jr7 review's fixes in the content area), pinned on the owner's converted captures:
 * - D-5: Paycom's Voluntary Information closing "Full Name" (its disability form's name, beside its "Date") is that
 *   form's signature (Decision 16), so it follows the Consents mode (fixtures/paycom/jr7-paycomonline1-apply-2, -3).
 * Planned with the golden synthetic profile; no value of the capture is read or printed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import apply2 from '../../fixtures/paycom/jr7-paycomonline1-apply-2.html?raw';
import apply3 from '../../fixtures/paycom/jr7-paycomonline1-apply-3.html?raw';
import { paycomAdapter } from '../adapters/paycom';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import { goldenProfile, NOW, testVocab } from '../content/content.testkit';
import { planFrame } from '../core/plan/frame';
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { scan, toFieldSpec } from './scan';

afterEach(() => removeFixtures(document));

/** The Voluntary Information "Full Name" row and write of a capture, planned under `settings`. */
async function voluntaryName(html: string, settings: Settings) {
  const { doc } = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const result = scan(paycomAdapter.detect(doc)!.formRoot, paycomAdapter, { platform: 'paycom' });
  const control = doc.getElementById('voluntary-information-full-name-field');
  const field = result.fields.find((each) => result.target(each.key)?.control === control);
  const output = planFrame({ specs: result.fields.map(toFieldSpec), canaries: [], profile: goldenProfile(),
    sensitiveState: 'loaded', savedAnswers: [], settings, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company: 'Example Employer', location: 'Remote, US' },
    repeatables: [{ kind: 'experience', entries: null }, { kind: 'education', entries: null }] });
  removeFixtures(document);
  if (field === undefined) throw new Error('no Voluntary Information Full Name');
  return { field, row: output.results.find((each) => each.key === field.key)!,
    write: output.writes.find((each) => each.key === field.key) };
}

describe("D-5: Paycom's Voluntary Information closing Full Name is the form's signature", () => {
  const requiredOnly: Settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, consents: 'required' },
    preapprovedConsent: DEFAULT_SETTINGS.preapprovedConsent.filter((kind) => kind !== 'signature') };

  for (const [name, html] of [['apply-2', apply2], ['apply-3', apply3]] as const) {
    it(`${name}: consent.signature, typed under the signature's pre-approval only`, async () => {
      const typed = await voluntaryName(html, DEFAULT_SETTINGS);
      expect(typed.field).toMatchObject({ label: 'Full Name', section: { id: 'voluntary-information' } });
      expect(typed.row.category).toBe('consent.signature');
      expect(typed.write?.value).toEqual({ kind: 'text', text: goldenProfile().identity.fullName });
      expect(typed.write?.origin).toMatchObject({ provenance: 'rule', ruleId: 'consent.signature-preapproved' });
      // Required only, the signature not pre-approved: the box (optional in both captures) is left, decided.
      const left = await voluntaryName(html, requiredOnly);
      expect(left.field.required).toBe(false);
      expect(left.row).toMatchObject({ category: 'consent.signature', reason: 'consent-optional-unticked' });
      expect(left.write).toBeUndefined();
    });
  }
});
