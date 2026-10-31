/*
 * Field identity (docs/design/core.md §2.3). A field key is the spec's composition, platform, section, normalized
 * label, option-set hash and ordinal; the base key leaves the hash out, so a field whose options change (a country,
 * then its state list) keeps one identity. Keys hold page text and hashes only, never an answer. The DOM layer counts
 * ordinals and builds the keys through these functions, so the worker and every frame compute the same strings.
 */
import type { FieldKind, Platform } from '../enums';
import type { BaseKey, FieldKey, OptionSetHash, SectionRef } from '../types/field';
import { normalize } from './normalize';
import { isNoiseQualifier } from './qualifiers';
import { sha256Hex } from './sha256';

/** The option-set hash of a kind without options (text, textarea, a lone checkbox, date, file). */
export const OPTION_SET_NONE = 'none' as OptionSetHash;
/** The option-set hash of a widget whose options exist only once it is opened. Once the frame has read it (Phase 4),
 *  the key carries the hash of what it read, and the reactive loop's books take that first read as no change of
 *  options (loop/bookkeeping.ts). */
export const OPTION_SET_LAZY = 'lazy' as OptionSetHash;

/** A label slug is cut to this many characters. */
export const LABEL_SLUG_MAX = 48;

/** The parts of a base key. */
export interface KeyParts {
  platform: Platform;
  section: SectionRef;
  labelSlug: string;
  ordinal: number;
}

/**
 * The normalized label (normalizeLabel) followed by the tokens of its non-noise qualifiers: "Email (work)" gives
 * "email work", "Phone (optional)" gives "phone". Label slugs and option-set hashes are built from it.
 */
export function qualifiedLabel(label: string): string {
  const normalized = normalize(label, 'label');
  const words = [...normalized.core];
  for (const qualifier of normalized.qualifiers) {
    if (!isNoiseQualifier(qualifier)) words.push(...qualifier.tokens);
  }
  return words.join(' ');
}

/** Spaces become '-', and only [a-z0-9&-] is kept, at most LABEL_SLUG_MAX characters. When anything was cut or
 *  dropped, '~' and the first 6 hex of the full text's SHA-256 are appended, so different texts keep apart. */
function slugOf(text: string): string {
  const dashed = text.replace(/ /g, '-');
  const kept = dashed.replace(/[^a-z0-9&-]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  if (kept === dashed && kept.length <= LABEL_SLUG_MAX) return kept;
  return `${kept.slice(0, LABEL_SLUG_MAX).replace(/-$/, '')}~${sha256Hex(text).slice(0, 6)}`;
}

/**
 * The label part of a key: qualifiedLabel(label) as a slug. A field with an empty label gets
 * `~${kind}~${slug of its name attribute, else its id, else 'unnamed'}`.
 */
export function labelSlug(field: { label: string; kind: FieldKind; nameAttr: string; idAttr: string }): string {
  const text = qualifiedLabel(field.label);
  if (text !== '') return slugOf(text);
  const attribute = [field.nameAttr, field.idAttr].map(qualifiedLabel).find((candidate) => candidate !== '');
  return `~${field.kind}~${slugOf(attribute ?? 'unnamed')}`;
}

/** A section heading as a section id, by the label slug's rules ('' for an empty heading). */
export function headingSlug(heading: string): string {
  const text = qualifiedLabel(heading);
  return text === '' ? '' : slugOf(text);
}

/** The section part of a key: the section id, plus `[block]` in a repeatable section ('education[1]'). A '|' in the id
 *  becomes '-', so it can never shift the key's parts. */
export function sectionKey(section: SectionRef): string {
  const id = section.id.replace(/\|/g, '-');
  return section.block === undefined ? id : `${id}[${section.block}]`;
}

/**
 * The hash of a field's usable options: hex16 of SHA-256 over their clean labels (injected text already cut),
 * normalized by qualifiedLabel, deduplicated, sorted and joined by U+001F. Shuffling the options keeps the hash.
 */
export function optionSetHash(cleanLabels: readonly string[]): OptionSetHash {
  const labels = [...new Set(cleanLabels.map(qualifiedLabel))].sort();
  return sha256Hex(labels.join('\u001f')).slice(0, 16) as OptionSetHash;
}

/** `${platform}|${sectionKey}|${labelSlug}|${ordinal}`: one field's identity while its options change. */
export function baseKey(parts: KeyParts): BaseKey {
  return `${parts.platform}|${sectionKey(parts.section)}|${parts.labelSlug}|${parts.ordinal}` as BaseKey;
}

/** `${platform}|${sectionKey}|${labelSlug}|${optionSetHash}|${ordinal}`, the spec's composition. */
export function fieldKey(parts: KeyParts & { optionSetHash: OptionSetHash }): FieldKey {
  const { platform, section, labelSlug: slug, optionSetHash: hash, ordinal } = parts;
  return `${platform}|${sectionKey(section)}|${slug}|${hash}|${ordinal}` as FieldKey;
}

/**
 * Ordinals for fields listed in DOM order: each is the number of earlier fields with the same platform, section key
 * and label slug. The option-set hash plays no part, so two same-labelled selects with different options are 0 and 1.
 */
export function assignOrdinals(fields: ReadonlyArray<{ platform: Platform; section: SectionRef; labelSlug: string }>):
  number[] {
  const seen = new Map<string, number>();
  return fields.map((field) => {
    const identity = `${field.platform}|${sectionKey(field.section)}|${field.labelSlug}`;
    const ordinal = seen.get(identity) ?? 0;
    seen.set(identity, ordinal + 1);
    return ordinal;
  });
}
