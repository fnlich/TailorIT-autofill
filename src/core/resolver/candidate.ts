/*
 * A field's value before it takes the shape of the field's kind (docs/design/core.md §8.5). One profile value can be
 * written several ways: a school is a name typed into a text box, an entity chosen from a list, or queries typed into
 * a search; a yes is an option chosen or a box ticked. So the value table (values.ts) and the EEO, legal and consent
 * policy (policy.ts) give each value in every shape it has, with its origin and how sure it is, and the resolver keeps
 * the shape the field's kind takes (shapeFor). A value with no shape for the kind is not written: the field is flagged
 * format-unsupported rather than filled some other way.
 */
import type { FieldKind } from '../enums';
import type { MatchDomain } from '../matcher/types';
import type { ReasonCode } from '../types/fill';
import type { IntendedValue, ValueOrigin } from '../types/intent';
import type { FieldOfStudy } from '../types/profile';
import type { DateParts } from './format';

/** A value to match onto a field's options, with what the matcher needs besides it. */
export interface Choice {
  intended: IntendedValue;
  /** The domain the field's options are prepared in. */
  domain: MatchDomain;
  /** For a degree: the entry's field of study, for combined options ("B.S. in Computer Science"). */
  degreeField?: FieldOfStudy;
  /** For a race question: the person's explicit Hispanic or Latino answer. */
  hispanicLatino?: boolean;
  /** Typed into the box the chosen option reveals: a self-described gender. */
  freeText?: string;
}

/** A value in every shape it has. */
export interface Candidate {
  origin: ValueOrigin;
  /** The value part of the final confidence (§8.6): 1 explicit, 0.97 a deterministic transform, 0.85 derived. */
  confidence: number;
  /** The value is always filled and flagged, with this reason (a self-described gender, a guessed date layout). */
  flag?: ReasonCode;
  /** For a text box. */
  text?: string;
  /** For a list that takes one answer, and the queries of a remote search. */
  choice?: Choice;
  /** For a list that takes several answers, highest priority first. */
  set?: Choice[];
  /** For a lone checkbox: tick it (true) or leave it alone (false). */
  check?: boolean;
  /** For a date control, or laid out as text for a text box. */
  date?: DateParts;
  /** The profile's resume, for an upload. */
  file?: true;
}

/** Why a field gets no value, and whether the person must see it (flagged) or it may be skipped. */
export interface NoValue {
  reason: ReasonCode;
  /** Shown to the person, blank: a candidate existed, or the question is one only they may answer. */
  flagged: boolean;
  /** Only the person may answer it: the action is needs-user. */
  needsUser?: boolean;
}

/** A value, or why there is none. */
export type ValueResult = { ok: true; candidate: Candidate } | { ok: false; none: NoValue };

/** A value result. */
export const value = (candidate: Candidate): ValueResult => ({ ok: true, candidate });
/** No value, flagged unless said otherwise. */
export const none = (reason: ReasonCode, flagged = true, needsUser = false): ValueResult =>
  ({ ok: false, none: needsUser ? { reason, flagged, needsUser } : { reason, flagged } });

/** How a field of each kind is written. */
export const KIND_SHAPES = ['text', 'choice', 'set', 'check', 'date', 'file', 'search'] as const;
export type KindShape = (typeof KIND_SHAPES)[number];

/** The shape each kind takes. */
export const SHAPE_OF_KIND: Readonly<Record<FieldKind, KindShape>> = {
  text: 'text', textarea: 'text', select: 'choice', radio: 'choice', combobox: 'choice', checkbox: 'check',
  'checkbox-group': 'set', multiselect: 'set', 'typeahead-remote': 'search', date: 'date', file: 'file',
};
