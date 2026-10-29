/*
 * An answer the person saved after fixing a flagged field (Requirement F). It is stored on TailorIT, fetched once per
 * run into the worker's memory, and wins over the profile and rules on its exact key. Never for EEO, legal, pay,
 * consent or attention-check questions: those live only in the profile.
 */
import type { FieldKind, Platform } from '../enums';
import type { OptionSetHash } from './field';

export interface SavedAnswer {
  id: string;
  /** normalizeLabel(question). */
  labelKey: string;
  /** The observed hash; 'none' for a question without options. */
  optionSetHash: OptionSetHash;
  kind: FieldKind;
  /** Free-text answers apply only to the company they were written for ("Why do you want to work here?"). */
  scope: { kind: 'global' } | { kind: 'company'; platform: Platform; board: string };
  /** The visible question, for the settings list. */
  question: string;
  answer: { kind: 'options'; labels: string[] } | { kind: 'text'; text: string } | { kind: 'checked'; checked: boolean };
  updatedAt: number;
}
