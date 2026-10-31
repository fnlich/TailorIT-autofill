import { describe, expect, it } from 'vitest';
import type { BaseKey, FieldKey } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import type { ProfilePath, ValueOrigin } from '../core/types/intent';
import type { ScannedField } from '../dom/types';
import { followUpOrigin, followUpWrite, originAllowed, type FollowUpSource } from './follow-up';

const KEY = 'lever|main|please-specify|none|0' as FieldKey;
const referral: FollowUpSource = { freeText: 'LinkedIn', category: 'referral.source', confidence: 0.7,
  origin: { provenance: 'profile', path: 'referralSource' as ProfilePath } };
const selfDescribed: FollowUpSource = { freeText: 'Genderqueer', category: 'eeo.gender', confidence: 0.99,
  origin: { provenance: 'profile', path: 'eeo.gender' as ProfilePath, transform: 'eeo.self-describe' } };

/** The worker's row for the box: nothing it could answer. */
const boxRow = (extra: Partial<FillResult> = {}): FillResult => ({
  key: KEY, label: 'Please specify', kind: 'text', category: 'unknown', section: 'main', required: false,
  status: 'flagged', provenance: null, matcherStage: 'not-applicable', confidence: 0, reason: 'unknown-field',
  wrote: false, verification: 'not-applicable', needsUserAction: true, ...extra,
});

/** The box as a scan found it. */
const box = (extra: Partial<ScannedField> = {}): ScannedField => ({
  key: KEY, baseKey: 'lever|main|please-specify|0' as BaseKey, platform: 'lever', section: { id: 'main' }, kind: 'text',
  label: 'Please specify', labelSource: 'for', labelVisible: true, description: '', required: false, options: [],
  optionSetHash: 'none' as ScannedField['optionSetHash'], constraints: {}, autocomplete: [], nameAttr: '', idAttr: '',
  ordinal: 0, domOrder: 9, visibility: 'visible', disabled: false, readOnly: false, current: { kind: 'empty' },
  el: { key: KEY, frameId: 0 }, proxy: null, camouflaged: false, ...extra,
});

describe('the follow-up write', () => {
  it('types an Other choice\'s free text with rule other.free-text, keeping the choice\'s profile path', () => {
    const queued = followUpWrite(referral, boxRow(), box());
    expect(queued?.write).toEqual({ key: KEY, value: { kind: 'text', text: 'LinkedIn' },
      origin: { provenance: 'rule', ruleId: 'other.free-text', path: 'referralSource' },
      match: { stage: 'not-applicable', optionIndex: null, rule: null, confidence: 1, flags: [], suggestions: [],
        reason: 'ok' } });
    // The row the fill settles: the worker's, with the write's provenance, not written yet.
    expect(queued?.planned).toMatchObject({ key: KEY, label: 'Please specify', category: 'unknown', status: 'verified',
      provenance: 'rule', reason: 'ok', wrote: false, verification: 'not-checked', needsUserAction: false });
  });

  it('types a self-described gender with the choice\'s own origin, flagged for the person (the plan, L-S1)', () => {
    expect(followUpOrigin(selfDescribed)).toEqual(selfDescribed.origin);
    // An unknown or free-text box, or one of the choice's own EEO category ("Please describe your gender").
    for (const category of ['unknown', 'freeText.other', 'eeo.gender'] as const) {
      const queued = followUpWrite(selfDescribed, boxRow({ category, label: 'Please describe' }),
        box({ label: 'Please describe' }));
      expect(queued?.write, category).toEqual({ key: KEY, value: { kind: 'text', text: 'Genderqueer' },
        origin: selfDescribed.origin, match: { stage: 'not-applicable', optionIndex: null, rule: null, confidence: 1,
          flags: [], suggestions: [], reason: 'ok' } });
      // Never verified-and-done: the person's own words, typed by us, are theirs to check.
      expect(queued?.planned, category).toMatchObject({ category, status: 'flagged', provenance: 'profile',
        reason: 'other-option-with-free-text', wrote: false, verification: 'not-checked', needsUserAction: true });
    }
    // Only the profile's own self-description, of an EEO choice: not a rule's, and not another question's.
    const byRule: ValueOrigin = { provenance: 'rule', ruleId: 'eeo.self-describe' };
    expect(followUpWrite({ ...selfDescribed, origin: byRule }, boxRow(), box())).toBeNull();
    expect(followUpWrite({ ...selfDescribed, category: 'referral.source' }, boxRow(), box())).toBeNull();
    expect(followUpOrigin({ origin: byRule })).toEqual(byRule);
    expect(followUpOrigin({ origin: { provenance: 'saved', savedAnswerId: 's1' } }))
      .toEqual({ provenance: 'rule', ruleId: 'other.free-text' });
  });

  it('types nothing where the category policy or the rule\'s scope refuses the origin for the choice', () => {
    expect(originAllowed({ provenance: 'rule', ruleId: 'other.free-text' }, 'referral.source')).toBe(true);
    expect(originAllowed({ provenance: 'rule', ruleId: 'other.free-text' }, 'eeo.race')).toBe(false);
    expect(originAllowed({ provenance: 'rule', ruleId: 'other.free-text' }, 'workAuth.visaType')).toBe(false);
    expect(originAllowed({ provenance: 'rule', ruleId: 'other.free-text' }, 'consent.other')).toBe(false);
    expect(originAllowed(selfDescribed.origin, 'eeo.gender')).toBe(true);
    expect(originAllowed(selfDescribed.origin, 'eeo.race')).toBe(false);
    expect(followUpWrite({ ...referral, category: 'eeo.race' }, boxRow(), box())).toBeNull();
  });

  it('leaves a box the worker blocked, an attention check, a label with a tripwire, an unseen label, a question only '
    + 'the person answers, and a box that is no text box', () => {
    expect(followUpWrite(referral, boxRow({ status: 'blocked', reason: 'honeypot' }), box())).toBeNull();
    for (const reason of ['attention-check', 'tripwire-in-label', 'no-visible-label'] as const) {
      expect(followUpWrite(referral, boxRow({ reason }), box()), reason).toBeNull();
    }
    expect(followUpWrite(referral, boxRow({ category: 'attentionCheck' }), box())).toBeNull();
    expect(followUpWrite(referral, boxRow({ category: 'consent.aiAttestation' }), box())).toBeNull();
    expect(followUpWrite(referral, boxRow(), box({ kind: 'select' }))).toBeNull();
    expect(followUpWrite({ ...referral, freeText: '' }, boxRow(), box())).toBeNull();
  });

  it('keeps what a box already holds, unless it is the free text itself', () => {
    expect(followUpWrite(referral, boxRow(), box({ current: { kind: 'text', text: 'A friend' } }))).toBeNull();
    expect(followUpWrite(referral, boxRow(), box({ current: { kind: 'text', text: 'LinkedIn' } }))).not.toBeNull();
    expect(followUpWrite(referral, boxRow(), box({ current: { kind: 'empty' } }))).not.toBeNull();
  });

  it('carries the box\'s own row, which stands if the box holds other text when the write comes (L-S7)', () => {
    const own = boxRow();
    expect(followUpWrite(referral, own, box())?.keep).toEqual(own);
  });
});

describe('the box\'s own category (L-S1, L-S6)', () => {
  /** A box the worker classified, as its row says, with a label that asks for the choice's free text. */
  const classified = (category: FillResult['category'], reason: FillResult['reason'] = 'unknown-field') =>
    boxRow({ category, reason });

  it.each([
    ['legal', 'workAuth.visaType'], ['legal', 'screening.criminalHistory'], ['eeo', 'eeo.race'],
    ['eeo', 'eeo.disability'], ['sensitive', 'identity.pronouns'], ['sensitive', 'salary.expected'],
    ['consent', 'consent.signature'], ['consent', 'consent.certify'], ['attention', 'attentionCheck'],
    ['file', 'file.other'], ['profile', 'identity.preferredName'], ['profile', 'links.other'],
  ] as const)('types nothing into a %s box (%s), neither the referral nor a self-description', (_, category) => {
    expect(followUpWrite(referral, classified(category), box())).toBeNull();
    expect(followUpWrite(selfDescribed, classified(category), box())).toBeNull();
  });

  it('types the referral into no EEO box at all, its own question\'s included', () => {
    expect(followUpWrite(referral, classified('eeo.gender'), box())).toBeNull();
  });

  it('types the referral\'s free text only into a box of unknown or free-text category', () => {
    for (const category of ['unknown', 'freeText.other', 'freeText.additionalInfo'] as const) {
      expect(followUpWrite(referral, classified(category), box())?.write.value, category)
        .toEqual({ kind: 'text', text: 'LinkedIn' });
    }
  });

  it('types nothing into a box whose label does not ask to specify, describe or explain', () => {
    for (const label of ['What visa type do you hold?', 'Expected salary', 'Pronouns',
      'Type your full name as your electronic signature', 'Additional information']) {
      expect(followUpWrite(referral, boxRow({ label }), box({ label })), label).toBeNull();
    }
    for (const label of ['If other, please specify', 'Other (please describe)', 'Please explain']) {
      expect(followUpWrite(referral, boxRow({ label }), box({ label })), label).not.toBeNull();
    }
  });
});
