/*
 * Which matcher stages may run for a value (docs/design/core.md §4.0, docs/ARCHITECTURE.md "Matcher"). The domain
 * table decides first: countries and regions are closed, complete lists, so they get no fuzzy matching and no LLM;
 * EEO and legal answers get neither either. Then the field's policy class: outside profile, free-text and unknown,
 * fuzzy matching and the LLM play no part (§8.2), and nothing is cached. The LLM also needs the person's tiebreak
 * setting. Stages stop at the first success.
 */
import { OPEN_CLASSES } from '../resolver/categories';
import type { PolicyClass } from '../types/intent';
import type { MatchDomain } from './types';

/** The rows of §4.0's table. 'polarity-legal' is a yes/no question of the legal class; 'number' is salary and
 *  years. */
export const DOMAIN_ROWS = ['institution', 'degree', 'field', 'country', 'region', 'language', 'proficiency',
  'referral', 'eeo', 'polarity-legal', 'polarity', 'number', 'generic'] as const;
export type DomainRow = (typeof DOMAIN_ROWS)[number];

/**
 * The alias-stage rules (§4.3): spellings by tier, the option's own entity id, the degree rules (§4.9), the CIP title
 * and parent, a vocabulary mention, yes/no polarity, and numeric ranges. A decline is matched to decline options in
 * any row: it is the person's explicit answer, not a spelling.
 */
export const ALIAS_RULE_KINDS = ['tiered', 'entity-id', 'degree', 'cip', 'mention', 'polarity', 'range'] as const;
export type AliasRuleKind = (typeof ALIAS_RULE_KINDS)[number];

/** One row: which stages may run. */
export interface StagePolicy {
  exact: boolean;
  alias: readonly AliasRuleKind[];
  fuzzy: boolean;
  llm: boolean;
  /** "Other" plus free text (§4.7). */
  other: boolean;
}

/** §4.0's table. */
export const STAGE_POLICY: Readonly<Record<DomainRow, StagePolicy>> = {
  institution: { exact: true, alias: ['tiered', 'entity-id'], fuzzy: true, llm: true, other: true },
  degree: { exact: true, alias: ['degree'], fuzzy: false, llm: true, other: true },
  field: { exact: true, alias: ['tiered', 'cip'], fuzzy: true, llm: true, other: true },
  country: { exact: true, alias: ['tiered', 'entity-id'], fuzzy: false, llm: false, other: false },
  region: { exact: true, alias: ['tiered', 'entity-id'], fuzzy: false, llm: false, other: false },
  language: { exact: true, alias: ['tiered', 'entity-id'], fuzzy: false, llm: true, other: true },
  proficiency: { exact: true, alias: ['tiered', 'entity-id'], fuzzy: false, llm: true, other: false },
  referral: { exact: true, alias: ['tiered', 'mention', 'entity-id'], fuzzy: true, llm: true, other: true },
  eeo: { exact: true, alias: ['tiered', 'mention', 'polarity'], fuzzy: false, llm: false, other: false },
  'polarity-legal': { exact: true, alias: ['tiered', 'polarity'], fuzzy: false, llm: false, other: false },
  polarity: { exact: true, alias: ['tiered', 'polarity'], fuzzy: false, llm: false, other: false },
  number: { exact: false, alias: ['range'], fuzzy: false, llm: false, other: false },
  generic: { exact: true, alias: [], fuzzy: true, llm: true, other: true },
};

/** The row of a domain, for a field of a policy class. */
export function domainRow(domain: MatchDomain, policy: PolicyClass): DomainRow {
  if (domain.startsWith('eeo.')) return 'eeo';
  if (domain === 'polarity') return policy === 'legal' ? 'polarity-legal' : 'polarity';
  return domain as DomainRow;
}

/** The stages that run for one value. */
export interface StagePlan extends StagePolicy {
  row: DomainRow;
  /** The accepted-match cache may be read (and the match later written). */
  cache: boolean;
}

/** Whether a policy class lets fuzzy matching, the LLM tiebreak and the cache play a part (§8.2, §4.10). */
export function openClass(policy: PolicyClass): boolean {
  return OPEN_CLASSES.includes(policy);
}

/** The stages for a value of `domain` in a field of `policy`, with the tiebreak setting `llmAllowed`. */
export function stagePlan(domain: MatchDomain, policy: PolicyClass, llmAllowed: boolean): StagePlan {
  const row = domainRow(domain, policy);
  const table = STAGE_POLICY[row];
  const open = openClass(policy);
  return {
    row,
    exact: table.exact,
    alias: table.alias,
    fuzzy: table.fuzzy && open,
    llm: table.llm && open && llmAllowed,
    other: table.other,
    cache: open,
  };
}
