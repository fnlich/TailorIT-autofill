/*
 * The name and id attributes as a classifier (docs/design/core.md §8.3), the second of the three rule sources. Only
 * the generic patterns live here. Platform tables (Greenhouse's `job_application[...]`, Lever's `urls[...]`) come in
 * Phase 2 from the owner's HTML snapshots and are never guessed. One refinement from the resolver review (2026-10-30)
 * sits beside the design's patterns: the phone pattern says nothing about a part of the phone that is not its number.
 */
import { CLASSIFY_NAME_ID_EXACT, CLASSIFY_NAME_ID_PARTIAL } from '../confidence';
import type { FieldKind } from '../enums';
import type { FieldCategory } from '../types/intent';
import { kindAllowed } from './categories';

/** One generic pattern. */
export interface NameIdRule {
  id: string;
  /** The design's alternation over the attribute text, in which `_` stands for any separator (see nameIdText). */
  pattern: string;
  /** The category, or a function of the field's kind; null means the pattern says nothing about this kind. */
  category: FieldCategory | ((kind: FieldKind) => FieldCategory | null);
}

/** §8.3's generic patterns, in order. */
export const NAME_ID_RULES: readonly NameIdRule[] = [
  { id: 'name-id.first-name', pattern: 'first_?name|fname|given_?name', category: 'identity.firstName' },
  { id: 'name-id.last-name', pattern: 'last_?name|lname|surname|family_?name', category: 'identity.lastName' },
  { id: 'name-id.email', pattern: 'e_?mail', category: 'contact.email' },
  { id: 'name-id.phone', pattern: 'phone|mobile|tel', category: 'contact.phone' },
  { id: 'name-id.linkedin', pattern: 'linkedin', category: 'links.linkedin' },
  { id: 'name-id.github', pattern: 'github', category: 'links.github' },
  // s2 core-wd: Workday's "X" box, name="twitterAccount" (formField-twitterAccount in
  // fixtures/workday/s2-verily-field-of-study-open), whose one-letter label no label rule reads.
  { id: 'name-id.twitter', pattern: 'twitter', category: 'links.twitter' },
  { id: 'name-id.resume', pattern: 'resume|cv', category: (kind) => (kind === 'file' ? 'file.resume' : null) },
  { id: 'name-id.cover-letter', pattern: 'cover_?letter',
    category: (kind) => (kind === 'file' ? 'file.coverLetter' : 'freeText.coverLetter') },
  // jr6 RULES (WD-09, fixtures jr6-resolvetech- and jr6-travelers-voluntary-disclosures): Workday's agreement box,
  // name="acceptTermsAndAgreements" whatever its label says ("Please confirm your consent.", "You must AGREE to
  // proceed."), as Jobright's remote rules recognise it (AGREEMENT_CHECKBOX_NAMES, cited as a fact). A label that reads
  // as a consent kind of its own decides (classifyRules GENERIC_TOKEN_CATEGORIES).
  { id: 'name-id.accept-terms', pattern: 'accepttermsandagreements', category: 'consent.terms' },
  // jr6 RULES (ICIMS-08, fixtures jr6-ars-profile: name "…PersonProfileFields.AddressStreet1"): iCIMS's address search,
  // drawn as its dropdown, is a lookup whose "Enter manually" is chosen (values.ts addressLookupValue); the text box that
  // replaces it is the street.
  { id: 'name-id.address-street1', pattern: 'addressstreet1',
    category: (kind) => (kind === 'select' || kind === 'combobox' ? 'address.lookup' : kind === 'text' ? 'address.line1'
      : null) },
  // jr6 RULES R3 (ICIMS-12, fixtures jr6-ars-profile: name "-1_PersonProfileFields.PhoneType", labelled only "Type"):
  // the phone's type (Mobile by default: values.ts phoneTypeValue). PHONE_PART keeps the phone pattern off it.
  { id: 'name-id.phone-type', pattern: 'phone_?type', category: 'contact.phoneType' },
  // jr6 RULES R3 (ICIMS-13, fixtures jr6-sentinel-profile: name "-1_PersonProfileFields.AddressType", labelled only
  // "Type"; Jobright's normalizeIcimsAddressTypeLabel reads it by its id: cited): the address's type.
  { id: 'name-id.address-type', pattern: 'address_?type', category: 'address.type' },
  // jr6 RULES R3 (ICIMS-19, fixtures jr6-ars-profile-filled: select#rcf3049 "Please specify", which iCIMS fills once
  // "How did you hear about us?" is chosen): the source specified further. Its text twin (rcf3049_Text) is no list.
  { id: 'name-id.referral-detail', pattern: 'rcf3049',
    category: (kind) => (kind === 'select' || kind === 'combobox' ? 'referral.detail' : null) },
  // jr6 RULES R4 (O13, fixtures/oracle/hjf-apply-section: Oracle's "Link 1", name="siteLink-1", by the label contract of
  // FIXPLAN §3.2): a numbered link box, the profile's links in order (values.ts numberedLinkValue).
  { id: 'name-id.site-link', pattern: 'site_?link_?\\d{1,2}', category: 'links.numbered' },
];

/**
 * Abbreviations that count only as a whole token. Inside a longer token they are usually part of another word:
 * "lname" in "fullname", "tel" in "hotel", "cv" in a generated id.
 */
export const WHOLE_TOKEN_ONLY: readonly string[] = ['fname', 'lname', 'tel', 'cv'];

/**
 * A part of the phone that is not its number (the resolver review): an extension, a phone type, a country or dialling
 * code ("phone_extension", "phoneExtension", "phone_country_code"). The phone pattern says nothing about such a field,
 * so the person's number is never typed into it.
 */
export const PHONE_PART = /extension|(?:^|[_ ]|phone|mobile|tel)extn?(?:[_ \d]|$)|(?:^|[_ ]|phone|mobile|tel)(?:type|kind|country|countrycode|dialcode|dial|callingcode|prefix)(?:[_ ]|$)|(?:^|[_ ])(?:country|dial|calling)_?code(?:[_ ]|$)/;

/**
 * The text the patterns run over: `${nameAttr} ${idAttr}` in lower case, with every run of the separators `_`, `-`,
 * `[`, `]` and `.` made one `_` ("job_application[first_name]" becomes "job_application_first_name"). The space between
 * the two attributes stays a space, so no pattern joins the end of one to the start of the other.
 */
export function nameIdText(nameAttr: string, idAttr: string): string {
  return [nameAttr, idAttr]
    .map((attribute) => attribute.toLowerCase().replace(/[\s_\-[\].]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter((attribute) => attribute !== '')
    .join(' ');
}

interface CompiledRule {
  rule: NameIdRule;
  /** The pattern as whole tokens: bounded by a separator, the space or an end on both sides. */
  exact: RegExp;
  /** The pattern anywhere, without the whole-token-only abbreviations; null when nothing is left. */
  partial: RegExp | null;
}

const COMPILED: readonly CompiledRule[] = NAME_ID_RULES.map((rule) => {
  const partial = rule.pattern.split('|').filter((alternative) => !WHOLE_TOKEN_ONLY.includes(alternative)).join('|');
  return {
    rule,
    exact: new RegExp(`(?:^|[_ ])(?:${rule.pattern})(?=[_ ]|$)`),
    partial: partial === '' ? null : new RegExp(partial),
  };
});

/** What the name and id attributes say a field is. */
export interface NameIdHit {
  category: FieldCategory;
  confidence: number;
  /** The pattern's id ('name-id.first-name'): the review panel shows it. */
  rule: string;
  /** The pattern matched whole tokens (0.95) rather than part of one (0.85). */
  exact: boolean;
}

/**
 * The category the field's name and id attributes give, or null. Whole-token matches score 0.95 and are tried first,
 * over every pattern in order; a pattern found inside a token scores 0.85. A pattern whose category the field's kind
 * cannot hold (CATEGORY_KINDS) is no match, and the next one is tried; so is the phone pattern on a PHONE_PART.
 */
export function nameIdRule(nameAttr: string, idAttr: string, kind: FieldKind): NameIdHit | null {
  const text = nameIdText(nameAttr, idAttr);
  if (text === '') return null;
  const phonePart = PHONE_PART.test(text);
  for (const exact of [true, false]) {
    for (const { rule, exact: whole, partial } of COMPILED) {
      const re = exact ? whole : partial;
      if (re === null || !re.test(text)) continue;
      const category = typeof rule.category === 'function' ? rule.category(kind) : rule.category;
      if (category === null || !kindAllowed(category, kind)) continue;
      if (category === 'contact.phone' && phonePart) continue;
      return { category, confidence: exact ? CLASSIFY_NAME_ID_EXACT : CLASSIFY_NAME_ID_PARTIAL, rule: rule.id, exact };
    }
  }
  return null;
}
