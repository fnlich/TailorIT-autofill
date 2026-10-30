/*
 * Helpers for the planner's, the resolver's and the Guard's tests: the golden "Alex Rivera" profile read from
 * fixtures/profiles and canonicalized, field specs built the way the scanner builds them (keys, option-set hashes,
 * ordinals), and one call that runs planFrame with the defaults. A testkit: it reads the fixtures through node:fs, so
 * the pure program and its lint leave it out, and no non-test code imports it.
 */
import { readFileSync } from 'node:fs';
import type { AutofillProfile, AutofillSensitive } from '../../contract/tailorit';
import type { FieldKind } from '../enums';
import { cutInjected } from '../guard/injected';
import { attachResume, canonicalizeProfile } from '../profile/canonicalize';
import { fieldKey, baseKey, labelSlug, OPTION_SET_NONE, optionSetHash } from '../text/keys';
import type { FieldSpec, Option, OptionSetHash } from '../types/field';
import type { Profile, Ymd } from '../types/profile';
import { DEFAULT_SETTINGS, type Settings } from '../types/settings';
import { bundledVocab } from '../vocab/bundled.testkit';
import type { Vocab } from '../vocab/types';
import { planFrame } from './frame';
import type { PlanInput, PlanOutput } from './types';

/** The bundled vocabulary, shared by every test. */
export const vocab: Vocab = bundledVocab();

/** The day every planner test runs on. */
export const NOW: Ymd = { y: 2026, m: 10, d: 30 };

const FIXTURES = new URL('../../../fixtures/profiles/', import.meta.url);

/** The golden profile's two wire parts, as TailorIT serves them. */
export function goldenWire(): { profile: AutofillProfile; sensitive: AutofillSensitive } {
  const read = (name: string) => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as unknown;
  return { profile: read('alex-rivera.profile.json') as AutofillProfile,
    sensitive: read('alex-rivera.sensitive.json') as AutofillSensitive };
}

/** The golden resume, as the lookup's suggestedResume names it. */
export const GOLDEN_RESUME = { id: 'resume-alex-rivera', fileName: 'Alex Rivera Resume.pdf', fileKind: 'pdf' } as const;

/** The golden profile canonicalized, with its sensitive part (unless `sensitive` is false) and the resume the worker
 *  attaches (unless `resume` is false). */
export function goldenProfile(options: { sensitive?: boolean; resume?: boolean } = {}): Profile {
  const wire = goldenWire();
  const { profile } = canonicalizeProfile(wire.profile, options.sensitive === false ? null : wire.sensitive, vocab, NOW);
  return options.resume === false ? profile : attachResume(profile, GOLDEN_RESUME, 48_213);
}

/** Options from labels: a leading '!' disables one, a leading '*' selects it. */
export function optionsOf(labels: readonly string[]): Option[] {
  return labels.map((raw, index) => {
    const disabled = raw.startsWith('!');
    const selected = raw.startsWith('*');
    return { index, label: raw.replace(/^[!*]/, ''), disabled, selected };
  });
}

const OPTION_KINDS: readonly FieldKind[] = ['select', 'radio', 'checkbox-group', 'combobox', 'multiselect'];

/** What a test may set on a spec besides the label and kind; `optionLabels` builds the options. */
export type SpecExtra = Partial<FieldSpec> & { optionLabels?: readonly string[] };

/** A field as the scanner would describe it: a visible field in 'main' on Lever, labelled by `for`, with its keys and
 *  option-set hash built by the core's own key functions. */
export function specOf(label: string, kind: FieldKind, extra: SpecExtra = {}): FieldSpec {
  const { optionLabels, ...rest } = extra;
  const options: Option[] | 'lazy' = rest.options ?? (optionLabels ? optionsOf(optionLabels) : []);
  const platform = rest.platform ?? 'lever';
  const section = rest.section ?? { id: 'main' };
  const nameAttr = rest.nameAttr ?? '';
  const idAttr = rest.idAttr ?? '';
  const ordinal = rest.ordinal ?? 0;
  const hash: OptionSetHash = options === 'lazy' ? 'lazy' as OptionSetHash
    : OPTION_KINDS.includes(kind) ? optionSetHash(options.map((option) => cutInjected(option.label).clean)
      .filter((clean) => clean !== '')) : OPTION_SET_NONE;
  const slug = labelSlug({ label, kind, nameAttr, idAttr });
  return {
    key: fieldKey({ platform, section, labelSlug: slug, ordinal, optionSetHash: hash }),
    baseKey: baseKey({ platform, section, labelSlug: slug, ordinal }),
    platform, section, kind, label, labelSource: label === '' ? 'none' : 'for', description: '', required: false,
    options, optionSetHash: hash, constraints: {}, autocomplete: [], nameAttr, idAttr, ordinal, domOrder: 0,
    visibility: 'visible', disabled: false, readOnly: false, current: { kind: 'empty' },
    ...rest,
  };
}

/** Specs in DOM order: each gets its position as its domOrder. */
export function inOrder(specs: readonly FieldSpec[]): FieldSpec[] {
  return specs.map((spec, domOrder) => ({ ...spec, domOrder }));
}

/** The settings, with the consent categories given pre-approved. */
export function settingsWith(extra: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...extra };
}

/** A plan input over `specs` with the golden profile, its sensitive part loaded, and the default settings. */
export function inputOf(specs: readonly FieldSpec[], extra: Partial<PlanInput> = {}): PlanInput {
  return { specs: inOrder(specs), canaries: [], profile: goldenProfile(), sensitiveState: 'loaded', savedAnswers: [],
    settings: DEFAULT_SETTINGS, vocab, dryRun: false, now: NOW, ...extra };
}

/** planFrame over `specs` (inputOf's defaults). */
export function planOf(specs: readonly FieldSpec[], extra: Partial<PlanInput> = {}): PlanOutput {
  return planFrame(inputOf(specs, extra));
}

/** The planned write and the row of one field, by its label. */
export function fieldOf(output: PlanOutput, spec: FieldSpec) {
  return { write: output.writes.find((write) => write.key === spec.key),
    row: output.results.find((row) => row.key === spec.key)! };
}
