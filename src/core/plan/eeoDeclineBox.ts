/*
 * jr6 RULES (FIXPLAN §6.3 R1 item 24; U-09, ADP-17): an EEO decline box beside its list. UltiPro draws an "I decline to
 * say" box beside each of its EEO lists (fixtures/ultipro/application: Gender, Ethnic Origin, Race; their lists hold no
 * decline option), and ADP one box under its two lists ("I decline to identify my race and ethnicity"; its lists hold
 * one). The rules read the box as its question's (labelRules label.eeo-decline-box) and the policy ticks it for the
 * person's explicit decline (policy.ts eeoDeclineBoxValue). Here, across the frame:
 * - a box whose list offers its own decline option is not ticked: the list carries the decline (skipped,
 *   already-correct: unticked is what it should be);
 * - a box ticked for a list that lacks one leaves that list without a flag: its decline-option-missing row is skipped,
 *   since the box says it;
 * - a list whose options are not read yet keeps the box waiting for them.
 * The list a box belongs to: the one whose label the box's begins with (UltiPro: "Gender I decline to say" by the label
 * contract of FIXPLAN §3.2), else every list of its topics in its section (ADP's race and ethnicity lists). Labels are
 * page text: nothing here reads a profile value.
 */
import { prepareOptions } from '../matcher/prepare';
import type { MatchDomain } from '../matcher/types';
import { declineBoxTopics, EEO_DECLINE_BOX_RULE } from '../resolver/labelRules';
import type { FieldClassification } from '../resolver/resolve';
import { sectionKey } from '../text/keys';
import { normalizeLabel } from '../text/normalize';
import type { FieldKey, FieldSpec } from '../types/field';
import type { FillResult, PlannedWrite } from '../types/fill';
import type { FieldCategory } from '../types/intent';
import type { Resolution } from '../types/match';
import type { Vocab } from '../vocab/types';

/** The kinds a self-identification list is drawn as. */
const LIST_KINDS: ReadonlySet<FieldSpec['kind']> = new Set<FieldSpec['kind']>(['select', 'radio', 'combobox',
  'checkbox-group', 'multiselect']);

/** One planned field, as planFrame holds it. */
export interface PlannedField {
  spec: FieldSpec;
  write?: PlannedWrite;
  row: FillResult;
}

/** The category the rules gave a field, for the look across the frame. */
function categoryOf(classification: FieldClassification): FieldCategory | null {
  if (classification.by !== 'rules') return null;
  return classification.rules.category ?? classification.rules.asks;
}

/** The lists a decline box belongs to (module header). */
function listsOf(box: FieldSpec, fields: ReadonlyArray<{ spec: FieldSpec; classification: FieldClassification }>):
  FieldSpec[] {
  const section = sectionKey(box.section);
  const lists = fields.filter(({ spec }) => spec.key !== box.key && LIST_KINDS.has(spec.kind)
    && sectionKey(spec.section) === section);
  const boxLabel = normalizeLabel(box.label);
  const named = lists.filter(({ spec }) => {
    const label = normalizeLabel(spec.label);
    return label !== '' && boxLabel.startsWith(`${label} `);
  });
  if (named.length > 0) return named.map(({ spec }) => spec);
  const topics = new Set(declineBoxTopics(boxLabel));
  return lists.filter(({ classification }) => {
    const category = categoryOf(classification);
    return category !== null && topics.has(category);
  }).map(({ spec }) => spec);
}

/** Whether a list offers its own decline option (read in its question's EEO domain), or 'unread' while its options
 *  are not read. */
function offersDecline(list: FieldSpec, domain: MatchDomain, vocab: Vocab): boolean | 'unread' {
  if (list.options === 'lazy') return 'unread';
  return prepareOptions(list.options, domain, vocab).list.some((option) => option.decline && !option.unusable
    && !option.disabled);
}

/**
 * Settles each decline box planFrame ticked against the list it belongs to (module header), in place: `planned` in the
 * specs' order, `resolutions` by key, `fields` the frame's whole scan with each field's classification.
 */
export function settleDeclineBoxes(planned: PlannedField[], resolutions: ReadonlyMap<FieldKey, Resolution>,
  fields: ReadonlyArray<{ spec: FieldSpec; classification: FieldClassification }>, vocab: Vocab): void {
  for (const [at, field] of planned.entries()) {
    const resolution = resolutions.get(field.spec.key);
    if (resolution?.rule !== EEO_DECLINE_BOX_RULE.id || field.write?.value.kind !== 'check') continue;
    const lists = listsOf(field.spec, fields);
    const domain = resolution.category as MatchDomain;
    const offers = lists.map((list) => offersDecline(list, domain, vocab));
    if (offers.includes('unread') || offers.includes(true)) {
      const { write: _write, ...rest } = field;
      planned[at] = { ...rest, row: { ...field.row, status: offers.includes(true) ? 'skipped' : 'flagged',
        reason: offers.includes(true) ? 'already-correct' : 'waiting-for-options', provenance: null,
        needsUserAction: false } };
      continue;
    }
    const keys = new Set(lists.map((list) => list.key));
    for (const [index, other] of planned.entries()) {
      if (!keys.has(other.spec.key) || other.write !== undefined || other.row.reason !== 'decline-option-missing') {
        continue;
      }
      planned[index] = { ...other, row: { ...other.row, status: 'skipped', needsUserAction: false } };
    }
  }
}
