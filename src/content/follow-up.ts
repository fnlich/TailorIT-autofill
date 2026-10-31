/*
 * The follow-up write (docs/design/core.md §10.1 "Follow-ups", §4.7 stage e): a choice written with free text, "Other"
 * for an answer the list lacks or an EEO self-describe option, reveals a box, and the free text goes there. The core
 * names the box at the scan after the choice's write (follow-up-found), only on an edge the DOM attributed to that
 * write and only for a box whose label asks for it; the text itself never leaves this frame's memory: it is the
 * choice's own planned write's freeText, held from that write until the next scan.
 * The box's write is the choice's answer completed, so it is checked as the choice was, and then as any write is (the
 * Phase 3 review, L-S1, decided by the lead):
 * - the box's label must ask to specify, describe or explain, or name "other" (isFollowUpLabel): there is no "only
 *   box" fallback;
 * - the box's own category, as the worker planned it, must be unknown or a free-text kind: never legal, eeo,
 *   sensitive, consent, an attention check, a file, or a profile answer of its own;
 * - its origin is rule other.free-text (with the choice's profile path when it has one); the category policy and the
 *   rule's scope must allow it for the choice's category and for the box's own, or nothing is typed;
 * - the one exception is the plan's eeo.self-describe (the coordinator's ruling after the review): a gender question's
 *   self-describe option, chosen from the profile's explicit self-description, types the person's own words, with the
 *   choice's own origin (profile, eeo.self-describe), into a box that is unknown, a free-text kind or of the choice's
 *   own EEO category ("Please describe your gender"), never another EEO question's, a legal, sensitive or consent
 *   one. The origin is checked against the choice's category, which is the box's too when the box is its own
 *   question's. That box's row is flagged, never done: the words are the person's to check;
 * - the worker's own row for the box must let it be written: not blocked, not an attention check, no tripwire in its
 *   label, a visible label, and not a question only the person answers;
 * - a box that already holds other text keeps it (the person's, or the page's), at the pass's scan here and again at
 *   the DOM guard's fresh scan right before the write (pass.ts: the box's own row stands then, L-S7);
 * - then the DOM guard and guardWriteInFrame (honeypot, the value fits, the canary scan), the fill and the read-back,
 *   in pass.ts, as for every write.
 * The box's row is the worker's, with the write's provenance; the fill settles it.
 */
import { checkCategoryPolicy, RULE_SCOPES } from '../core/guard/provenance';
import { isFollowUpLabel } from '../core/loop/bookkeeping';
import { policyClassOf, USER_ONLY_CATEGORIES } from '../core/resolver/categories';
import type { FillResult, PlannedWrite, ReasonCode } from '../core/types/fill';
import type { FieldCategory, ValueOrigin } from '../core/types/intent';
import type { ScannedField } from '../dom/types';

/** A choice written with free text, held until the next scan names its box. Memory only. */
export interface FollowUpSource {
  /** The text to type into the box (the planned write's freeText). Memory only: never sent, stored or logged. */
  freeText: string;
  /** The choice's own origin and category, as the worker planned them. */
  origin: ValueOrigin;
  category: FieldCategory;
  confidence: number;
}

/** A planned write and the row it settles. */
export interface QueuedWrite {
  write: PlannedWrite;
  planned: FillResult;
  /** A follow-up's box row as the worker planned it: it stands when the box holds other text by the time the write
   *  comes (the DOM guard's fresh scan), and nothing is typed. */
  keep?: FillResult;
}

/** The box rows that never take the free text, besides blocked ones. */
const REFUSED_BOX_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['attention-check', 'tripwire-in-label',
  'no-visible-label']);

/** The kinds a box can be. */
const BOX_KINDS: ReadonlySet<ScannedField['kind']> = new Set<ScannedField['kind']>(['text', 'textarea']);

/** The match a follow-up write carries: no option was matched for it. */
const NOT_MATCHED: PlannedWrite['match'] = { stage: 'not-applicable', optionIndex: null, rule: null, confidence: 1,
  flags: [], suggestions: [], reason: 'ok' };

/** Whether the choice's answer is the EEO self-describe one: the profile's own words, through eeo.self-describe. */
function isSelfDescribe(origin: ValueOrigin): boolean {
  return (origin.provenance === 'profile' && origin.transform === 'eeo.self-describe')
    || (origin.provenance === 'rule' && origin.ruleId === 'eeo.self-describe');
}

/** Whether the choice is an EEO answer from the profile's explicit self-description (never a rule's). */
function explicitSelfDescription(source: Pick<FollowUpSource, 'origin' | 'category'>): boolean {
  const { origin } = source;
  return origin.provenance === 'profile' && origin.transform === 'eeo.self-describe'
    && policyClassOf(source.category) === 'eeo';
}

/** The origin of the box's write: the choice's, for a self-described answer, else rule other.free-text. */
export function followUpOrigin(source: Pick<FollowUpSource, 'origin'>): ValueOrigin {
  if (isSelfDescribe(source.origin)) return source.origin;
  return { provenance: 'rule', ruleId: 'other.free-text',
    ...(source.origin.provenance === 'profile' ? { path: source.origin.path } : {}) };
}

/** Whether an origin may fill an answer of this category: the category policy, and the scope of the rule it names. */
export function originAllowed(origin: ValueOrigin, category: FieldCategory): boolean {
  if (!checkCategoryPolicy(origin, category).ok) return false;
  if (origin.provenance === 'rule') return RULE_SCOPES[origin.ruleId](category);
  if (origin.provenance === 'profile' && origin.transform !== undefined) return RULE_SCOPES[origin.transform](category);
  return true;
}

/** Whether a box of this category, as the worker classified it, may take a choice's free text: unknown, or a
 *  free-text kind. */
export function boxCategoryAllowed(category: FieldCategory): boolean {
  return category === 'unknown' || policyClassOf(category) === 'free-text';
}

/** The write that types the choice's free text into its box, with the row it settles; null when the box may not take
 *  it (see the header). `row` is the worker's row for the box, `box` the box as this pass's scan found it. */
export function followUpWrite(source: FollowUpSource, row: FillResult, box: ScannedField): QueuedWrite | null {
  if (row.key !== box.key || !BOX_KINDS.has(box.kind) || source.freeText === '') return null;
  if (!isFollowUpLabel(box.label)) return null;
  if (row.status === 'blocked' || REFUSED_BOX_REASONS.has(row.reason) || USER_ONLY_CATEGORIES.has(row.category)) {
    return null;
  }
  const selfDescribed = isSelfDescribe(source.origin);
  if (selfDescribed && !explicitSelfDescription(source)) return null;
  const ownQuestion = selfDescribed && row.category === source.category;
  if (!boxCategoryAllowed(row.category) && !ownQuestion) return null;
  if (box.current.kind === 'text' && box.current.text !== source.freeText) return null;
  const origin = followUpOrigin(source);
  if (!originAllowed(origin, source.category)) return null;
  // The self-description is the EEO choice completed: its category's policy decides (the box's, when it is the same
  // question's). Other free text must suit the box's own category as well.
  if (!selfDescribed && !originAllowed(origin, row.category)) return null;
  const write: PlannedWrite = { key: box.key, value: { kind: 'text', text: source.freeText }, origin,
    match: NOT_MATCHED };
  if (selfDescribed) {
    return { write, keep: row, planned: { ...row, status: 'flagged', provenance: origin.provenance,
      matcherStage: 'not-applicable', confidence: source.confidence, reason: 'other-option-with-free-text', wrote: false,
      verification: 'not-checked', needsUserAction: true } };
  }
  return {
    write,
    planned: { ...row, status: 'verified', provenance: origin.provenance, matcherStage: 'not-applicable',
      confidence: source.confidence, reason: 'ok', wrote: false, verification: 'not-checked', needsUserAction: false },
    keep: row,
  };
}
