/*
 * The autocomplete attribute as a classifier (docs/design/core.md §8.3), the first of the three rule sources. The
 * token names what the site's own developers say the field holds, so it scores highest; three generic tokens
 * (organization, organization-title, url) score lower because a site uses them for any organisation or link.
 */
import { CLASSIFY_AUTOCOMPLETE, CLASSIFY_AUTOCOMPLETE_WEAK } from '../confidence';
import type { FieldKind } from '../enums';
import type { FieldCategory } from '../types/intent';
import { kindAllowed } from './categories';

/** One row of §8.3's autocomplete table. */
export interface AutocompleteRule {
  tokens: readonly string[];
  category: FieldCategory;
  confidence: number;
}

/** §8.3's table. Any other token (`on`, `off`, `bday*`, `cc-*`, a contact type such as `home`) is ignored. */
export const AUTOCOMPLETE_RULES: readonly AutocompleteRule[] = [
  { tokens: ['name'], category: 'identity.fullName', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['given-name'], category: 'identity.firstName', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['additional-name'], category: 'identity.middleName', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['family-name'], category: 'identity.lastName', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['nickname'], category: 'identity.preferredName', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['email'], category: 'contact.email', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['tel', 'tel-national'], category: 'contact.phone', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['tel-country-code'], category: 'contact.phoneCountry', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['street-address', 'address-line1'], category: 'address.line1', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['address-line2'], category: 'address.line2', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['address-level2'], category: 'address.city', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['address-level1'], category: 'address.region', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['postal-code'], category: 'address.postalCode', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['country', 'country-name'], category: 'address.country', confidence: CLASSIFY_AUTOCOMPLETE },
  { tokens: ['organization'], category: 'experience.currentCompany', confidence: CLASSIFY_AUTOCOMPLETE_WEAK },
  { tokens: ['organization-title'], category: 'experience.currentTitle', confidence: CLASSIFY_AUTOCOMPLETE_WEAK },
  { tokens: ['url'], category: 'links.website', confidence: CLASSIFY_AUTOCOMPLETE_WEAK },
  { tokens: ['sex'], category: 'eeo.gender', confidence: CLASSIFY_AUTOCOMPLETE },
];

const BY_TOKEN: ReadonlyMap<string, AutocompleteRule> = new Map(
  AUTOCOMPLETE_RULES.flatMap((rule) => rule.tokens.map((token) => [token, rule] as const)));

/** Contact types that make a `tel*` token a number other than the person's phone ("fax tel"). */
const NOT_A_PHONE = new Set(['fax', 'pager']);

/** What the autocomplete attribute says a field is. */
export interface AutocompleteHit {
  category: FieldCategory;
  confidence: number;
  /** `autocomplete.${token}`: the review panel shows it. */
  rule: string;
}

/**
 * The category the field's autocomplete tokens give (lower case, section-, shipping and billing prefixes already
 * removed by the scanner), or null. Tokens outside the table are ignored. A fax or pager number is not the person's
 * phone. Two tokens naming different categories make a malformed attribute, which browsers ignore too, so it gives
 * nothing. A category the field's kind cannot hold (CATEGORY_KINDS) is no match.
 */
export function autocompleteRule(tokens: readonly string[], kind: FieldKind): AutocompleteHit | null {
  const known = tokens.filter((token) => BY_TOKEN.has(token));
  const token = known[0];
  if (token === undefined) return null;
  const rule = BY_TOKEN.get(token)!;
  if (known.some((other) => BY_TOKEN.get(other)!.category !== rule.category)) return null;
  if (token.startsWith('tel') && tokens.some((other) => NOT_A_PHONE.has(other))) return null;
  if (!kindAllowed(rule.category, kind)) return null;
  return { category: rule.category, confidence: rule.confidence, rule: `autocomplete.${token}` };
}
