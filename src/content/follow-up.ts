/*
 * The follow-up write (docs/design/core.md §10.1 "Follow-ups", §4.7 stage e): a choice written with free text, "Other"
 * for an answer the list lacks or an EEO self-describe option, reveals a box, and the free text goes there. The core
 * names the box at the scan after the choice's write (follow-up-found); the text itself never leaves this frame's
 * memory: it is the choice's own planned write's freeText, held from that write until the next scan.
 * The box's write is the choice's answer completed, so it is checked as the choice was, and then as any write is:
 * - its origin is the choice's own when that is the EEO self-describe answer (the profile's gender, through the
 *   eeo.self-describe rule), else rule other.free-text (with the choice's profile path when it has one); the category
 *   policy and the rule's scope must allow that origin for the choice's category, or nothing is typed;
 * - the worker's own row for the box must let it be written: not blocked, not an attention check, no tripwire in its
 *   label, a visible label, and not a question only the person answers;
 * - a box that already holds other text keeps it (the person's, or the page's);
 * - then the DOM guard and guardWriteInFrame (honeypot, the value fits, the canary scan), the fill and the read-back,
 *   in pass.ts, as for every write.
 * The box's row is the worker's, with the write's provenance; the fill settles it.
 */
import { checkCategoryPolicy, RULE_SCOPES } from '../core/guard/provenance';
import { USER_ONLY_CATEGORIES } from '../core/resolver/categories';
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

/** The write that types the choice's free text into its box, with the row it settles; null when the box may not take
 *  it (see the header). `row` is the worker's row for the box, `box` the box as this pass's scan found it. */
export function followUpWrite(source: FollowUpSource, row: FillResult, box: ScannedField): QueuedWrite | null {
  if (row.key !== box.key || !BOX_KINDS.has(box.kind) || source.freeText === '') return null;
  if (row.status === 'blocked' || REFUSED_BOX_REASONS.has(row.reason) || USER_ONLY_CATEGORIES.has(row.category)) {
    return null;
  }
  if (box.current.kind === 'text' && box.current.text !== source.freeText) return null;
  const origin = followUpOrigin(source);
  if (!originAllowed(origin, source.category)) return null;
  return {
    write: { key: box.key, value: { kind: 'text', text: source.freeText }, origin, match: NOT_MATCHED },
    planned: { ...row, status: 'verified', provenance: origin.provenance, matcherStage: 'not-applicable',
      confidence: source.confidence, reason: 'ok', wrote: false, verification: 'not-checked', needsUserAction: false },
  };
}
