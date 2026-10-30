import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldKind } from '../enums';
import type { FieldCategory } from '../types/intent';
import { AUTOCOMPLETE_RULES, autocompleteRule } from './autocomplete';

/** §8.3's autocomplete table, read from the design: one row per category, tokens in backticks. */
function designTable(): Array<{ tokens: string[]; category: string; confidence: number }> {
  const design = readFileSync(new URL('../../../docs/design/core.md', import.meta.url), 'utf8');
  const section = design.slice(design.indexOf('**Autocomplete**'), design.indexOf('**Name and id**'));
  return section.split('\n').filter((line) => line.startsWith('| `') && !line.includes('ignored')).map((line) => {
    const [tokens = '', target = ''] = line.split('|').slice(1, 3);
    const weak = /\((0\.\d+)\)/.exec(target);
    return {
      tokens: [...tokens.matchAll(/`([^`]+)`/g)].map((match) => match[1]!),
      category: target.replace(/\(.*\)/, '').trim(),
      confidence: weak ? Number(weak[1]) : 0.98,
    };
  });
}

describe('AUTOCOMPLETE_RULES (§8.3)', () => {
  it('is the design’s table, in its order and with its confidences', () => {
    const table = designTable();
    expect(table.length).toBe(18);
    expect(AUTOCOMPLETE_RULES.map((rule) => ({ ...rule, tokens: [...rule.tokens] }))).toEqual(table);
  });
});

describe('autocompleteRule', () => {
  it.each<[string[], FieldKind, FieldCategory, number]>([
    [['name'], 'text', 'identity.fullName', 0.98],
    [['given-name'], 'text', 'identity.firstName', 0.98],
    [['additional-name'], 'text', 'identity.middleName', 0.98],
    [['family-name'], 'text', 'identity.lastName', 0.98],
    [['nickname'], 'text', 'identity.preferredName', 0.98],
    [['email'], 'text', 'contact.email', 0.98],
    [['tel'], 'text', 'contact.phone', 0.98],
    [['tel-national'], 'text', 'contact.phone', 0.98],
    [['tel-country-code'], 'select', 'contact.phoneCountry', 0.98],
    [['street-address'], 'textarea', 'address.line1', 0.98],
    [['address-line1'], 'text', 'address.line1', 0.98],
    [['address-line2'], 'text', 'address.line2', 0.98],
    [['address-level2'], 'text', 'address.city', 0.98],
    [['address-level1'], 'select', 'address.region', 0.98],
    [['postal-code'], 'text', 'address.postalCode', 0.98],
    [['country'], 'select', 'address.country', 0.98],
    [['country-name'], 'text', 'address.country', 0.98],
    [['organization'], 'text', 'experience.currentCompany', 0.85],
    [['organization-title'], 'text', 'experience.currentTitle', 0.85],
    [['url'], 'text', 'links.website', 0.85],
    [['sex'], 'select', 'eeo.gender', 0.98],
    // Contact types and the webauthn marker are not field names: they are skipped.
    [['home', 'tel'], 'text', 'contact.phone', 0.98],
    [['mobile', 'tel'], 'text', 'contact.phone', 0.98],
    [['work', 'email'], 'text', 'contact.email', 0.98],
    [['email', 'webauthn'], 'text', 'contact.email', 0.98],
    // Two tokens of one category are not a conflict.
    [['tel', 'tel-national'], 'text', 'contact.phone', 0.98],
  ])('%j on a %s field gives %s at %s', (tokens, kind, category, confidence) => {
    expect(autocompleteRule(tokens, kind)).toEqual({ category, confidence, rule: `autocomplete.${tokens.find(
      (token) => !['home', 'mobile', 'work', 'webauthn'].includes(token))}` });
  });

  it.each<[string[], FieldKind]>([
    [[], 'text'],
    [['on'], 'text'],
    [['off'], 'text'],
    [['bday'], 'date'],
    [['bday-year'], 'text'],
    [['cc-number'], 'text'],
    [['new-password'], 'text'],
    [['username'], 'text'],
    [['tel-extension'], 'text'],
    [['home'], 'text'],
    // A fax or pager number is not the person's phone.
    [['fax', 'tel'], 'text'],
    [['pager', 'tel-national'], 'text'],
    // Two field names make a malformed attribute, which browsers ignore too.
    [['given-name', 'family-name'], 'text'],
    // A category the kind cannot hold is no match.
    [['email'], 'checkbox'],
    [['tel'], 'select'],
    [['sex'], 'text'],
    [['given-name'], 'file'],
  ])('%j on a %s field gives nothing', (tokens, kind) => {
    expect(autocompleteRule(tokens, kind)).toBeNull();
  });

  it('reads only the phone tokens as someone else’s number on a fax line', () => {
    expect(autocompleteRule(['fax', 'email'], 'text')?.category).toBe('contact.email');
  });
});
