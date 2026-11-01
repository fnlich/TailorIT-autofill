/*
 * The scanner-versus-expectation comparison for the platform adapters' browser tests (docs/FIXTURES.md
 * "Expectations"). A converted Lever or Greenhouse snapshot loads through the DOM testkit, with its captured frames
 * blanked so nothing reaches the network, at the size the converter checked it (1280 x 900). Its form root comes from
 * the first adapter the registry offers for the snapshot's address whose detect() finds one, and the scan runs with
 * that adapter. The scan is then held against the case's hand-written <case>.expect.json:
 * - every entry's control must be on the page;
 * - an entry the page hides from a person ('not-user-visible') must not be part of any field;
 * - every other entry must be exactly one field, with the entry's label and required, and fillable as the entry says.
 *   A fillable entry must be a field the Phase 2 fillers write, or a widget its adapter declares that the widget
 *   helpers act on (Greenhouse's react-selects), of the entry's kind (kinds are compared only there: a widget's kind is
 *   otherwise descriptive), shown with a visible label, neither camouflaged, disabled nor read-only. A
 *   'widget-phase-4' entry must be a field the fillers refuse as widget-unsupported (a lazy combobox or a typeahead no
 *   adapter declares, or one it declares that no helper acts on);
 * - its section must be the slug of the entry's heading, and its options the entry's count (or 'lazy');
 * - every field the scan reports must belong to exactly one entry.
 * Differences come back as data, so a test shows them all at once and can name the ones a scanner change is waiting
 * on. A testkit, not a test: it imports no test runner.
 */
import { FIELD_KINDS, type FieldKind } from '../../core/enums';
import { capCodePoints } from '../../core/text/fold';
import { headingSlug } from '../../core/text/keys';
import { loadFixture, type Fixture } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { TEXT_CAP_SECTION } from '../../dom/thresholds';
import type { ScannedField, ScanResult, WidgetTarget } from '../../dom/types';
import { isActionable } from '../../dom/widgets';
import { platformOfUrl } from '../../shared/hosts';
import { adaptersFor } from '../index';
import type { Adapter } from '../types';

/** The size the snapshot converter compared visibility at (test/mhtml-to-fixture.test.ts). */
export const SNAPSHOT_VIEWPORT = { width: 1280, height: 900 } as const;

/** Why an entry is not fillable (docs/FIXTURES.md). 'disabled-or-readonly' (Phase 5): a control a synthetic page's
 *  state disabled, such as the wizard's End date while "I currently work here" is ticked. */
export const NOT_FILLABLE_REASONS = ['widget-phase-4', 'not-user-visible', 'disabled-or-readonly'] as const;
export type NotFillableReason = (typeof NOT_FILLABLE_REASONS)[number];

/** One entry of a <case>.expect.json. */
export interface ExpectedField {
  label: string;
  kind: FieldKind;
  required: boolean;
  section: string;
  fillable: boolean;
  reason?: NotFillableReason;
  options?: number | 'lazy';
  control: string;
  note?: string;
}

/** A <case>.expect.json. */
export interface Expectation {
  fixture: string;
  source: string;
  captured: string;
  fields: ExpectedField[];
}

/** A parsed <case>.expect.json, its shape checked (a JSON import types every kind as a plain string). */
export function readExpectation(json: unknown): Expectation {
  const value = json as Partial<Expectation> | null;
  if (value === null || typeof value !== 'object' || !Array.isArray(value.fields) || typeof value.fixture !== 'string'
    || typeof value.source !== 'string') throw new Error('not an expectation file');
  for (const entry of value.fields as unknown[]) {
    const field = entry as Partial<ExpectedField>;
    const fine = typeof field.label === 'string' && (FIELD_KINDS as readonly unknown[]).includes(field.kind)
      && typeof field.required === 'boolean' && typeof field.section === 'string' && typeof field.fillable === 'boolean'
      && typeof field.control === 'string' && (field.fillable ? field.reason === undefined
        : (NOT_FILLABLE_REASONS as readonly unknown[]).includes(field.reason));
    if (!fine) throw new Error(`${value.fixture}: a malformed entry ${JSON.stringify(entry)}`);
  }
  return value as Expectation;
}

/** What a comparison checks. */
export const MISMATCH_PROPERTIES = ['present', 'field', 'label', 'required', 'fillable', 'kind', 'section', 'options',
  'listed'] as const;
export type MismatchProperty = (typeof MISMATCH_PROPERTIES)[number];

/** One difference between the scan and the expectations. `control` is the entry's selector, or, for a field no entry
 *  lists, the field's key. */
export interface Mismatch {
  control: string;
  property: MismatchProperty;
  expected: string;
  actual: string;
}

/** A snapshot, loaded and scanned as the content runtime would scan it. */
export interface ScannedCase extends Fixture {
  adapter: Adapter;
  root: Element;
  result: ScanResult;
}

/** Loads a snapshot and scans its form root with the first of the registry's adapters for `address` that finds one. */
export async function scanCase(host: Document, html: string, address: string): Promise<ScannedCase> {
  const url = new URL(address);
  const platform = platformOfUrl(url.href);
  if (platform === null) throw new Error(`${address} is not on an ATS host`);
  const fixture = await loadFixture(host, html, SNAPSHOT_VIEWPORT);
  for (const adapter of adaptersFor(url)) {
    const found = adapter.detect(fixture.doc);
    if (found !== null) {
      return { ...fixture, adapter, root: found.formRoot, result: scan(found.formRoot, adapter, { platform }) };
    }
  }
  throw new Error(`no adapter found a form root on ${address}`);
}

/** The field kinds the Phase 2 fillers write; the fillers refuse every other kind as widget-unsupported. */
const FILLED_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['text', 'textarea', 'select', 'multiselect', 'radio',
  'checkbox', 'checkbox-group', 'date', 'file']);

/** Whether the scan makes a field the fillers would write, and if not, why: 'widget-phase-4', 'no-visible-label',
 *  'camouflaged' (the DOM guard refuses it as not-user-visible) or 'disabled-or-readonly'. A widget its adapter
 *  declares (`widget`, the scan's) that the widget helpers act on is written by them. */
export function fillabilityOf(field: ScannedField, widget?: WidgetTarget): { fillable: true } | { fillable: false;
  reason: string } {
  const helped = widget !== undefined && widget.declared && widget.kind !== 'checkbox' && isActionable(widget);
  if (!FILLED_KINDS.has(field.kind) && !helped) return { fillable: false, reason: 'widget-phase-4' };
  if (field.labelSource === 'none' || !field.labelVisible) return { fillable: false, reason: 'no-visible-label' };
  if (field.camouflaged) return { fillable: false, reason: 'camouflaged' };
  if (field.disabled || field.readOnly) return { fillable: false, reason: 'disabled-or-readonly' };
  return { fillable: true };
}

/** The section id the scanner gives a heading's text (sections.ts slugs headings the same way). */
export function sectionIdOf(heading: string): string {
  return capCodePoints(headingSlug(heading), TEXT_CAP_SECTION);
}

const fillableText = (fillable: boolean, reason?: string) => (fillable ? 'fillable' : `not fillable (${reason ?? '?'})`);

/** A field as a mismatch names it. */
function described(field: ScannedField, widget?: WidgetTarget): string {
  const verdict = fillabilityOf(field, widget);
  return `a ${field.kind} field "${field.label}", ${fillableText(verdict.fillable, verdict.fillable ? undefined : verdict.reason)}`;
}

/** The differences between a scan of `doc`'s form and its expectations, in the expectation's order, then the fields no
 *  entry lists. [] when they agree. */
export function compareWithExpectation(doc: Document, result: ScanResult, expectation: Expectation): Mismatch[] {
  const mismatches: Mismatch[] = [];
  const push = (control: string, property: MismatchProperty, expected: unknown, actual: unknown) =>
    mismatches.push({ control, property, expected: String(expected), actual: String(actual) });

  const fieldOf = new Map<Element, ScannedField>();
  for (const field of result.fields) {
    const target = result.target(field.key);
    if (target === null) continue;
    for (const el of [target.control, ...target.members]) fieldOf.set(el, field);
  }

  const widgetOf = (field: ScannedField) => result.target(field.key)?.widget;

  const claims = new Map<ScannedField, number>();
  for (const entry of expectation.fields) {
    const elements = Array.from(doc.querySelectorAll(entry.control));
    if (elements.length === 0) {
      push(entry.control, 'present', 'on the page', 'no element');
      continue;
    }
    const fields = [...new Set(elements.flatMap((el) => fieldOf.get(el) ?? []))];
    for (const field of fields) claims.set(field, (claims.get(field) ?? 0) + 1);
    if (entry.reason === 'not-user-visible') {
      if (fields.length > 0) {
        push(entry.control, 'fillable', 'no field (not-user-visible)', described(fields[0]!, widgetOf(fields[0]!)));
      }
      continue;
    }
    if (fields.length !== 1) {
      push(entry.control, 'field', 'one field', `${fields.length} fields`);
      continue;
    }
    const field = fields[0]!;
    const verdict = fillabilityOf(field, widgetOf(field));
    if (field.label !== entry.label) push(entry.control, 'label', JSON.stringify(entry.label), JSON.stringify(field.label));
    if (field.required !== entry.required) push(entry.control, 'required', entry.required, field.required);
    const actualReason = verdict.fillable ? undefined : verdict.reason;
    if (verdict.fillable !== entry.fillable || actualReason !== entry.reason) {
      push(entry.control, 'fillable', fillableText(entry.fillable, entry.reason),
        `${fillableText(verdict.fillable, actualReason)}, as a ${field.kind}`);
    }
    if (entry.fillable && field.kind !== entry.kind) push(entry.control, 'kind', entry.kind, field.kind);
    const section = sectionIdOf(entry.section);
    if (field.section.id !== section) push(entry.control, 'section', section, field.section.id);
    if (entry.options !== undefined) {
      const options = field.options === 'lazy' ? 'lazy' : field.options.length;
      if (options !== entry.options) push(entry.control, 'options', entry.options, options);
    }
  }

  for (const field of result.fields) {
    const count = claims.get(field) ?? 0;
    if (count !== 1) {
      push(field.key, 'listed', 'by one entry', count === 0 ? `by none: ${described(field, widgetOf(field))}` : `by ${count}`);
    }
  }
  return mismatches;
}
