/*
 * v1.3 B (the owner, 2026-11-09; docs/SPEC-AMENDMENTS.md §16, the coordinator's decision 3): the questions of the form
 * being submitted and the person's answers to them, read in the frame as each step is left and at the Submit press,
 * and kept in the frame's memory only, until the Submit press hands them to the worker (submit/form), which sends
 * them to the person's own TailorIT only once the site confirmed the Submit (background/submissions.ts) and drops them
 * then. Nothing here is stored or logged.
 *
 * - A step's capture (captureStep) reads a fresh scan of the form, as readAnswer reads a field (orchestrator.ts): a
 *   text, the chosen options' clean labels (never their places or values), a box's state, and for an upload only its
 *   file's name ("a file was attached"), never its content or path. A question with nothing in it is still a question.
 * - Never captured, question or answer: a password or one-time code (the scanner never makes them fields); a CAPTCHA
 *   (its response field the scanner skips, the vendor's frames the content script never runs in, and any question
 *   that asks one in words: guard/attention.ts botCheckOf); a honeypot, a hidden field, a camouflaged one (drawn so it
 *   cannot be seen), or one no visible label names (guard/honeypot.ts checkHoneypot; ScannedField.camouflaged); a
 *   disabled one (a form never sends it); any field a tripwire touched (its label, help text or an option holds one)
 *   or a canary touched (the run's canaries in memory, and those its own texts carry, found in its label, help text,
 *   options or answer); our own UI (the scanner never reads inside it).
 * - Multi-step forms (Workday's) lose a step's fields once it is left, so each step is captured as it is left: the
 *   run's own Next (RunEnv.stepLeaving), the person's own activation of the adapter's Next (runtime.ts), and the step
 *   shown at the Submit press. A step captured again replaces what it held (the person went back and changed it).
 *   A step is named by the adapter's step signature; a form without steps is one step. Steps that are separate pages
 *   (a new document each) keep only the last page's.
 * - EEO, legal and pay answers are captured: they go to the person's own TailorIT only, never to an AI.
 */
import type { Adapter } from '../adapters/types';
import { botCheckOf } from '../core/guard/attention';
import { canariesIn, extractCanaries } from '../core/guard/canary';
import { checkHoneypot } from '../core/guard/honeypot';
import { cutInjected } from '../core/guard/injected';
import { hasTripwire, tripwireHits } from '../core/guard/tripwire';
import { stepSignature } from '../core/steps/signature';
import { normalizeLabel } from '../core/text/normalize';
import type { FieldSpec } from '../core/types/field';
import type { VisibleText } from '../core/types/text';
import { isUsableOption } from '../dom/option-hash';
import { toFieldSpec } from '../dom/scan';
import type { ScanResult, ScannedField } from '../dom/types';
import type { CapturedAnswer, CapturedField } from '../messaging/schemas';

/** At most this many questions a form (TailorIT's AUTOFILL_FORM_LIMITS.questions). */
export const CAPTURE_MAX_FIELDS = 300;
/** A written answer is cut to this many code points (TailorIT's AUTOFILL_FORM_LIMITS.text). */
export const CAPTURE_TEXT_MAX = 10_000;
/** A file's name is cut to this many code points (TailorIT's AUTOFILL_FORM_LIMITS.fileName). */
export const CAPTURE_FILE_NAME_MAX = 255;
/** Chosen options in one answer (TailorIT's AUTOFILL_FORM_LIMITS.chosen). */
const CAPTURE_CHOSEN_MAX = 50;
/** An option's label (TailorIT's AUTOFILL_FORM_LIMITS.optionLabel). */
const CAPTURE_OPTION_LABEL_MAX = 300;

const ONE_OR_MORE = new Set<FieldSpec['kind']>(['select', 'radio', 'combobox', 'multiselect', 'checkbox-group',
  'typeahead-remote']);

/** The texts of a field a tripwire or canary would sit in: its label, help text and options' labels. */
function textsOf(field: ScannedField): string[] {
  const options = field.options === 'lazy' ? [] : field.options.map((option) => option.label);
  return [field.label, field.description, ...options];
}

/** The canaries a field's own label and help text carry (as planFrame reads them: frame.ts labelCanaries). */
function ownCanaries(field: ScannedField): string[] {
  return [field.label, field.description].flatMap((text) => {
    const hits = tripwireHits(text as VisibleText);
    return hits.length === 0 ? [] : extractCanaries(text, hits);
  });
}

/** A text cut to `max` UTF-16 units (the contract's count), never between the two halves of a pair. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** A file's name alone: no folder, no control characters, at most CAPTURE_FILE_NAME_MAX characters. */
export function fileNameOf(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const name = cutText(base.replace(/\p{Cc}+/gu, ' ').trim(), CAPTURE_FILE_NAME_MAX).trim();
  return name === '' ? null : name;
}

/** The name of the file an upload holds: its input's first file, else the name the page shows beside one it took. */
function fileAnswer(field: ScannedField, scan: ScanResult): CapturedAnswer | null {
  if (field.current.kind !== 'files' || field.current.count === 0) return null;
  const control = scan.target(field.key)?.control ?? null;
  const input = control !== null && control.tagName === 'INPUT' ? control as HTMLInputElement : null;
  const named = input?.files?.[0]?.name ?? field.current.names?.[0] ?? null;
  const fileName = named === null ? null : fileNameOf(named);
  return fileName === null ? null : { kind: 'file', fileName };
}

/** The answer a field holds now (readAnswer's reading, orchestrator.ts), or null for none. */
export function answerOf(field: ScannedField, scan: ScanResult): CapturedAnswer | null {
  const { current, kind } = field;
  if (kind === 'file') return fileAnswer(field, scan);
  if (kind === 'checkbox') return current.kind === 'checked' ? { kind: 'checked', checked: current.checked } : null;
  if (kind === 'text' || kind === 'textarea' || kind === 'date') {
    if (current.kind !== 'text') return null;
    // A longer answer is cut to TailorIT's cap (its first CAPTURE_TEXT_MAX characters, never half a pair).
    const text = cutText(current.text, CAPTURE_TEXT_MAX);
    return text.trim() === '' ? null : { kind: 'text', text };
  }
  if (!ONE_OR_MORE.has(kind)) return null;
  // A remote search's typed choice reads as its text.
  if (kind === 'typeahead-remote' && current.kind === 'text') {
    const text = current.text.trim();
    return text === '' || text.length > CAPTURE_OPTION_LABEL_MAX ? null : { kind: 'options', labels: [text] };
  }
  const shown = field.options === 'lazy' ? [] : field.options.filter((option) => option.selected)
    .map((option) => option.label);
  const raw = shown.length > 0 ? shown : current.kind === 'selected' ? current.labels : [];
  const labels = [...new Set(raw.map((label) => cutInjected(label).clean.trim())
    .filter((label) => label !== '' && isUsableOption(label)))];
  const one = kind === 'select' || kind === 'radio' || kind === 'combobox' || kind === 'typeahead-remote';
  if (labels.length === 0 || (one && labels.length !== 1) || labels.length > CAPTURE_CHOSEN_MAX
    || labels.some((label) => label.length > CAPTURE_OPTION_LABEL_MAX)) return null;
  return { kind: 'options', labels };
}

/** Why a field is never captured (module header), or null when it may be. */
export function excluded(field: ScannedField, canaries: readonly string[]): 'trap' | 'hidden' | 'captcha' | 'canary'
  | 'unlabelled' | null {
  if (!checkHoneypot(field).ok || field.camouflaged || field.disabled) return 'hidden';
  if (normalizeLabel(field.label) === '') return 'unlabelled';
  if (textsOf(field).some((text) => hasTripwire(text as VisibleText))) return 'trap';
  if (botCheckOf(field.label, field.description, field.kind) !== null) return 'captcha';
  const all = [...canaries, ...ownCanaries(field)];
  if (all.length > 0 && canariesIn(textsOf(field), all).length > 0) return 'canary';
  return null;
}

/** A field's spec as the worker receives it: its value and its options' native values left out (the answer goes
 *  beside it, once screened). */
function questionSpec(field: ScannedField): FieldSpec {
  const spec = toFieldSpec(field);
  // Its options by their labels: never their native values, which the page alone reads.
  const options = spec.options === 'lazy' ? 'lazy' as const
    : spec.options.map(({ value: _value, ...option }) => option);
  return { ...spec, options, current: { kind: 'empty' } };
}

/** One step's questions and answers (module header): every field the step shows that may be captured, in DOM order. */
export function captureStep(scan: ScanResult, step: number, canaries: readonly string[]): CapturedField[] {
  const out: CapturedField[] = [];
  for (const field of scan.fields) {
    if (out.length >= CAPTURE_MAX_FIELDS) break;
    if (excluded(field, canaries) !== null) continue;
    const answer = answerOf(field, scan);
    // An answer holding a canary is never captured, nor its question (a trap touched it).
    if (answer !== null && canaries.length > 0) {
      const texts = answer.kind === 'text' ? [answer.text] : answer.kind === 'options' ? answer.labels : [];
      if (canariesIn(texts, [...canaries, ...ownCanaries(field)]).length > 0) continue;
    }
    out.push({ spec: questionSpec(field), step, ...(answer === null ? {} : { answer }) });
  }
  return out;
}

/** The step a page shows, by its adapter's step signature ('' for a form without steps). */
export function stepNameOf(adapter: Adapter, doc: Document): string {
  try {
    const parts = adapter.stepSignature?.(doc);
    return parts === undefined ? '' : stepSignature(parts);
  } catch {
    return '';
  }
}

/** The frame's capture of one application's form, step by step (memory only). */
export interface FormCapture {
  /** The step `name` shows these questions and answers now: they replace what it held. */
  note(applicationKey: string, name: string, read: (step: number) => CapturedField[]): void;
  /** Every step's questions and answers, in the order the steps were first seen, at most CAPTURE_MAX_FIELDS; each
   *  question once (a field seen on two steps keeps the later step's). */
  all(applicationKey: string): CapturedField[];
  /** Forgets everything. */
  clear(): void;
}

export function createFormCapture(): FormCapture {
  let held: string | null = null;
  const steps = new Map<string, { index: number; fields: CapturedField[] }>();
  const forApplication = (applicationKey: string) => {
    if (held !== applicationKey) {
      steps.clear();
      held = applicationKey;
    }
  };
  return {
    note(applicationKey, name, read) {
      forApplication(applicationKey);
      const index = steps.get(name)?.index ?? steps.size;
      steps.set(name, { index, fields: read(index) });
    },
    all(applicationKey) {
      if (held !== applicationKey) return [];
      const ordered = [...steps.values()].sort((a, b) => a.index - b.index).flatMap((step) => step.fields);
      const byKey = new Map<string, CapturedField>();
      for (const field of ordered) {
        byKey.delete(field.spec.key);
        byKey.set(field.spec.key, field);
      }
      return [...byKey.values()].slice(0, CAPTURE_MAX_FIELDS);
    },
    clear() {
      steps.clear();
      held = null;
    },
  };
}
