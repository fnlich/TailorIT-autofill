import { describe, expect, it } from 'vitest';
import { POLICY_CLASSES } from '../types/intent';
import { DOMAIN_ROWS, domainRow, STAGE_POLICY, stagePlan } from './domains';

describe('the domain table (§4.0)', () => {
  it('has the design’s rows', () => {
    expect(DOMAIN_ROWS).toEqual(['institution', 'degree', 'field', 'country', 'region', 'language', 'proficiency',
      'referral', 'eeo', 'polarity-legal', 'polarity', 'number', 'generic']);
  });

  it.each([
    ['institution', true, true, true, true], ['degree', true, false, true, true], ['field', true, true, true, true],
    ['country', true, false, false, false], ['region', true, false, false, false], ['language', true, false, true, true],
    ['proficiency', true, false, true, false], ['referral', true, true, true, true], ['eeo', true, false, false, false],
    ['polarity-legal', true, false, false, false], ['polarity', true, false, false, false],
    ['number', false, false, false, false], ['generic', true, true, true, true],
  ] as const)('%s: exact %s, fuzzy %s, LLM %s, Other %s', (row, exact, fuzzy, llm, other) => {
    expect(STAGE_POLICY[row]).toMatchObject({ exact, fuzzy, llm, other });
  });

  it('gives each row its alias rules', () => {
    expect(STAGE_POLICY.institution.alias).toEqual(['tiered', 'entity-id']);
    expect(STAGE_POLICY.degree.alias).toEqual(['degree']);
    expect(STAGE_POLICY.field.alias).toEqual(['tiered', 'cip']);
    expect(STAGE_POLICY.referral.alias).toEqual(['tiered', 'mention', 'entity-id']);
    expect(STAGE_POLICY.eeo.alias).toEqual(['tiered', 'mention', 'polarity']);
    expect(STAGE_POLICY['polarity-legal'].alias).toEqual(['tiered', 'polarity']);
    expect(STAGE_POLICY.number.alias).toEqual(['range']);
    expect(STAGE_POLICY.generic.alias).toEqual([]);
  });

  it('reads every EEO domain as the eeo row, and a legal yes/no as the legal row', () => {
    for (const domain of ['eeo.gender', 'eeo.race', 'eeo.hispanicLatino', 'eeo.veteran', 'eeo.disability'] as const) {
      expect(domainRow(domain, 'eeo')).toBe('eeo');
    }
    expect(domainRow('polarity', 'legal')).toBe('polarity-legal');
    expect(domainRow('polarity', 'profile')).toBe('polarity');
    expect(domainRow('institution', 'profile')).toBe('institution');
  });
});

describe('stagePlan', () => {
  it('turns fuzzy matching, the LLM and the cache off outside profile, free-text and unknown', () => {
    for (const policy of POLICY_CLASSES) {
      const plan = stagePlan('institution', policy, true);
      const open = policy === 'profile' || policy === 'free-text' || policy === 'unknown';
      expect([plan.fuzzy, plan.llm, plan.cache], policy).toEqual([open, open, open]);
      expect(plan.exact, policy).toBe(true);
    }
  });

  // CORE-3 (Phase 2 review): a legal or sensitive answer fell through to "Other" plus free text ("Citizen" typed into
  // a citizenship question's Other box), so the person's own words reached a box the policy never lets fill.
  it('lets "Other" plus free text play a part only in profile, free-text and unknown, where its row allows it', () => {
    for (const policy of POLICY_CLASSES) {
      const open = policy === 'profile' || policy === 'free-text' || policy === 'unknown';
      expect(stagePlan('generic', policy, true).other, policy).toBe(open);
      expect(stagePlan('institution', policy, true).other, policy).toBe(open);
      expect(stagePlan('country', policy, true).other, policy).toBe(false);
    }
  });

  it('asks the LLM only when the setting allows it and the row does', () => {
    expect(stagePlan('referral', 'profile', false).llm).toBe(false);
    expect(stagePlan('referral', 'profile', true).llm).toBe(true);
    expect(stagePlan('country', 'profile', true).llm).toBe(false);
    expect(stagePlan('region', 'profile', true).llm).toBe(false);
    expect(stagePlan('eeo.gender', 'eeo', true)).toMatchObject({ llm: false, fuzzy: false, cache: false });
    expect(stagePlan('polarity', 'legal', true)).toMatchObject({ row: 'polarity-legal', llm: false, cache: false });
  });
});
