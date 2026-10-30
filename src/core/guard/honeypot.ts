/*
 * The honeypot policy (docs/design/core.md §7.11, docs/ARCHITECTURE.md "Honeypots"), repeated in the core as defence
 * in depth: the scanner already gives no field to a control a person cannot see. A field may be written only when it is
 * visible, or is one of the owner's two exceptions: a visually hidden native radio or checkbox tied to a visible,
 * clear label, or a visually hidden file input tied to a visible upload control. Anything else is a honeypot, blocked.
 * A field with no visible label at all (labelSource 'none') is never filled either, even when its autocomplete or name
 * would place it: that catches the visible honeypot marked autocomplete="email". It is skipped, since it may be no
 * question at all. A field named only by a label nobody sees (labelVisible false: an aria-label whose words are not
 * beside the control) is never filled for the same reason, as the frame's own guard refuses it; the planner flags it,
 * since it names a question. A label known only from aria-label may drive the rules, but never reaches an LLM
 * (llmMaySeeLabel).
 */
import type { FieldKind, LabelSource } from '../enums';
import type { FieldSpec } from '../types/field';

/** The kinds a hidden native control tied to a visible label may be. */
const HIDDEN_NATIVE_KINDS: readonly FieldKind[] = ['radio', 'checkbox', 'checkbox-group'];

/** Why a field may not be written: a honeypot (blocked), or no visible label (skipped, or flagged when a hidden label
 *  names it). */
export type HoneypotVerdict = { ok: true } | { ok: false; reason: 'honeypot' | 'no-visible-label' };

/** Whether a field's visibility lets it be written (§7.11), and whether a visible label names it. */
export function checkHoneypot(spec: Pick<FieldSpec, 'visibility' | 'kind' | 'labelSource' | 'labelVisible'>):
  HoneypotVerdict {
  const allowed = spec.visibility === 'visible'
    || (spec.visibility === 'hidden-native-with-visible-label' && HIDDEN_NATIVE_KINDS.includes(spec.kind))
    || (spec.visibility === 'hidden-file-with-visible-control' && spec.kind === 'file');
  if (!allowed) return { ok: false, reason: 'honeypot' };
  if (spec.labelSource === 'none' || !spec.labelVisible) return { ok: false, reason: 'no-visible-label' };
  return { ok: true };
}

/** Label sources an LLM may never see: one read only from aria-label (not shown to the person), or none. */
const HIDDEN_LABEL_SOURCES: readonly LabelSource[] = ['aria-label', 'none'];

/** Whether a field's label may reach an LLM: it was shown to the person. */
export function llmMaySeeLabel(labelSource: LabelSource): boolean {
  return !HIDDEN_LABEL_SOURCES.includes(labelSource);
}
