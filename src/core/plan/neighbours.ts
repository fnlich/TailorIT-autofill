/*
 * jr6 RULES R4 (FIXPLAN §6.3 items 65 and 76): fields settled by a neighbour across the frame, after each is planned.
 * - ICIMS-24 (NYU's iCIMS School list and its "Enter school name if not in the list above" box, fixtures
 *   jr6-nyu-profile-parsed): the school is chosen in the list when it is listed, and the box beside it is then left
 *   empty; only when the list holds no option of it (its "Other" chosen, or nothing chosen) is the school typed into the
 *   box. While the list waits for its options or its search, the box is left empty too (skipped,
 *   conditional-question): jr6 fix (RULES-R65-R24, ICIMS:stage1-3) a box is no list, and the loop's books read a
 *   waiting-for-options row as a list waiting for its own options, which a box never gets (it ended
 *   options-never-loaded, for the person, though the list took the school). A box planned in a pass that does not plan
 *   its list is decided by what the list shows.
 * - U-16 (UltiPro's "Secondary Phone" beside its primary, fixtures/ultipro/application and resume-review): a secondary,
 *   alternate or other phone is left empty where the frame has a phone of its own: it would only repeat the number.
 * Labels and attribute names are page text: nothing here reads a profile value.
 */
import { prepareOptions } from '../matcher/prepare';
import type { FieldClassification } from '../resolver/resolve';
import { nameIdText } from '../resolver/nameId';
import { sectionKey } from '../text/keys';
import { normalizeLabel } from '../text/normalize';
import type { FieldSpec } from '../types/field';
import type { FillResult, PlannedWrite } from '../types/fill';
import type { FieldCategory } from '../types/intent';
import type { Vocab } from '../vocab/types';

/** One planned field, as planFrame holds it. */
export interface PlannedField {
  spec: FieldSpec;
  write?: PlannedWrite;
  row: FillResult;
}

/** The category a field's classification gives, the rules' or the LLM's, or null. */
function categoryOf(classification: FieldClassification): FieldCategory | null {
  if (classification.by === 'rules') return classification.rules.category ?? classification.rules.asks;
  if (classification.by === 'llm' && classification.llm.kind !== 'none') return classification.llm.category;
  return null;
}

/** A field planned to stay empty: its write dropped, its row this status and reason, nothing asked of the person. */
function leftEmpty(field: PlannedField, status: FillResult['status'], reason: FillResult['reason']): PlannedField {
  const { write: _write, ...rest } = field;
  return { ...rest, row: { ...field.row, status, reason, provenance: null, wrote: false,
    needsUserAction: status === 'flagged' } };
}

// ── ICIMS-24 ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A school's companion box: "Enter school name if not in the list above", "School (if not listed)", "If other, …". */
const SCHOOL_COMPANION = /\bif\s+(?:it\s+is\s+)?not\s+(?:in|on)\s+(?:the\s+)?(?:list|dropdown|menu)\b|\bnot\s+listed\b|\bif\s+other\b|^other\s+(?:school|university|college|institution)\b/;
/** The kinds a school list is drawn as. */
const SCHOOL_LIST_KINDS: ReadonlySet<FieldSpec['kind']> = new Set<FieldSpec['kind']>(['select', 'combobox',
  'typeahead-remote']);

/** How the school list beside a companion box stands: its school chosen (or shown), its "Other" chosen or nothing of it
 *  found, or still waiting for its options or its search. */
type ListVerdict = 'school' | 'other' | 'waiting';

/** The verdict of a school list's plan (ListVerdict). */
function listVerdict(list: PlannedField, vocab: Vocab): ListVerdict {
  const value = list.write?.value;
  if (value?.kind === 'query') return 'waiting';
  if (value?.kind === 'option') {
    if (list.write!.match.stage === 'other') return 'other';
    const answerKey = list.spec.options === 'lazy' ? '' : prepareOptions(list.spec.options, 'generic', vocab).list
      .find((option) => option.index === value.index)?.answerKey ?? '';
    return vocab.answers.other.has(answerKey) ? 'other' : 'school';
  }
  if (list.row.reason === 'already-correct') return 'school';
  if (list.row.reason === 'waiting-for-options' || list.row.status === 'blocked') return 'waiting';
  return 'other';
}

/** jr6 fix (RULES-R65-R24): the verdict of a school list this pass does not plan, by what it shows: its school (or any
 *  answer but its "Other"), its "Other", or nothing (no option of the school was found: the box takes it). */
function shownVerdict(list: FieldSpec, vocab: Vocab): ListVerdict {
  const shown = list.current.kind === 'selected' ? list.current.labels
    : list.current.kind === 'text' ? [list.current.text] : [];
  const keys = shown.map((label) => prepareOptions([{ index: 0, label, disabled: false, selected: true }], 'generic',
    vocab).list[0]!.answerKey).filter((key) => key !== '');
  if (keys.length === 0) return 'other';
  return keys.every((key) => vocab.answers.other.has(key)) ? 'other' : 'school';
}

/**
 * ICIMS-24 (module header): each companion box planFrame planned the school into is settled against the school list of
 * its section's block, in place: left empty (skipped, conditional-question) where the list takes the school, and while
 * the list waits for its options or its search (jr6 fix RULES-R65-R24: never a waiting-for-options row on a box); written
 * where the list holds no option of it. The list's plan decides, else (the list not planned this pass) what it shows. A
 * box with no list beside it stands.
 */
export function settleSchoolCompanions(planned: PlannedField[],
  fields: ReadonlyArray<{ spec: FieldSpec; classification: FieldClassification }>, vocab: Vocab): void {
  const categories = new Map(fields.map(({ spec, classification }) => [spec.key, categoryOf(classification)]));
  for (const [at, field] of planned.entries()) {
    const { spec } = field;
    if ((spec.kind !== 'text' && spec.kind !== 'textarea') || field.row.category !== 'education.school'
      || !SCHOOL_COMPANION.test(normalizeLabel(spec.label)) || field.write === undefined) continue;
    const beside = (other: FieldSpec) => other.key !== spec.key && SCHOOL_LIST_KINDS.has(other.kind)
      && sectionKey(other.section) === sectionKey(spec.section) && other.section.block === spec.section.block
      && categories.get(other.key) === 'education.school';
    const list = planned.find((other) => beside(other.spec));
    const unplanned = list === undefined ? fields.find((other) => beside(other.spec))?.spec : undefined;
    if (list === undefined && unplanned === undefined) continue;
    const verdict = list !== undefined ? listVerdict(list, vocab) : shownVerdict(unplanned!, vocab);
    if (verdict !== 'other') planned[at] = leftEmpty(field, 'skipped', 'conditional-question');
  }
}

// ── U-16 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A phone that is not the person's first: secondary, alternate, other, additional, second, backup (its label). */
const SECONDARY_LABEL = /\b(?:secondary|alternate|alternative|alt|other|additional|second|2nd|backup|another)\b/;
/** The same in the name and id attributes ("SecondaryPhone", "alt_phone", "phone2"). */
const SECONDARY_ID = /secondary|alternat|(?:^|[_ ])alt_?(?:phone|mobile|tel)|(?:phone|mobile|tel)_?2(?:[_ ]|$)|other_?phone|additional_?phone|backup_?phone/;

/** Whether a phone field is a secondary one (SECONDARY_LABEL, SECONDARY_ID). */
function secondaryPhone(spec: FieldSpec): boolean {
  return SECONDARY_LABEL.test(normalizeLabel(spec.label)) || SECONDARY_ID.test(nameIdText(spec.nameAttr, spec.idAttr));
}

/**
 * U-16 (module header): each secondary phone planFrame planned the person's number into is left empty (skipped,
 * no-profile-value: the profile holds one number) where the frame classifies another phone that is no secondary one,
 * in place.
 */
export function settleSecondaryPhones(planned: PlannedField[],
  fields: ReadonlyArray<{ spec: FieldSpec; classification: FieldClassification }>): void {
  const primary = fields.some(({ spec, classification }) => categoryOf(classification) === 'contact.phone'
    && !secondaryPhone(spec));
  if (!primary) return;
  for (const [at, field] of planned.entries()) {
    if (field.write === undefined || field.row.category !== 'contact.phone' || !secondaryPhone(field.spec)) continue;
    planned[at] = leftEmpty(field, 'skipped', 'no-profile-value');
  }
}
