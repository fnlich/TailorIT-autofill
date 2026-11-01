/*
 * The visible labels each served page defines, which are the only labels its report may show (the invariants' check
 * 5): the synthetic pages' own (fixtures/synthetic, read from their markup), and a converted snapshot's from its
 * hand-written <case>.expect.json, which lists every control's label as the page shows it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The sensitive page's two legal questions, as its legends read. */
export const AUTHORIZED = 'Are you legally authorized to work in the United States?';
export const SPONSORSHIP = 'Will you now or in the future require sponsorship for employment visa status in the United States?';

/** Each synthetic page's labels. */
export const SYNTHETIC_LABELS = {
  'policy-apply': ['Full name', 'Email', 'Phone'],
  'resume-upload': ['Full name', 'Email', 'Resume'],
  'cover-letter-upload': ['Full name', 'Email', 'Resume', 'Cover letter'],
  'sensitive-questions': ['Full name', 'Email', AUTHORIZED, SPONSORSHIP, 'Gender'],
  'react-controlled': ['First name', 'Last name', 'Email', 'Phone', 'Degree', 'How did you hear about us?',
    'Which of these skills have you used?'],
} as const;

/** One control of a <case>.expect.json. */
export interface ExpectedField {
  label: string;
  kind: string;
  fillable: boolean;
  control: string;
}

/** A converted snapshot's expectations: its address and its controls. */
export function expectation(name: string): { source: string; fields: ExpectedField[] } {
  return JSON.parse(readFileSync(resolve(`fixtures/${name}.expect.json`), 'utf8')) as { source: string; fields: ExpectedField[] };
}

/** A converted snapshot's labels, as its expectations list them. */
export const snapshotLabels = (name: string) => [...new Set(expectation(name).fields.map((field) => field.label))];
