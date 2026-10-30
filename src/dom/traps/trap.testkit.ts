/*
 * Helpers for the trap fixtures' DOM-level tests (docs/design/runtime.md §11.d, the "DOM" lines). A trap loads like any
 * fixture; its form root comes from the generic adapter, which handles every trap page (they do not match the Lever
 * adapter's anchors), and its fields are scanned as the content script will scan them. The tripwire's patterns are
 * the core's Phase 1 table, run over the passages the raw scan hands it; canary extraction and the planner's
 * decisions are asserted end to end in the next wave.
 */
import { genericAdapter } from '../../adapters/generic';
import type { Adapter } from '../../adapters/types';
import { detectionViews } from '../../core/guard/fold';
import { TRIPWIRE_PATTERNS } from '../../core/guard/patterns';
import { classifyByRules, type RuleClassification } from '../../core/resolver/classifyRules';
import { loadFixture, type Fixture } from '../fixture.testkit';
import { rawScan, type RawPassage } from '../raw-scan';
import { scan, toFieldSpec } from '../scan';
import type { ScannedField, ScanResult } from '../types';
import { visibleText } from '../visible-text';

/** Trap fixtures are served on jobs.lever.co, so their fields carry Lever's platform. */
export const TRAP_SCAN = { platform: 'lever' as const };

/** A trap page, loaded and scanned. */
export interface LoadedTrap extends Fixture {
  root: Element;
  result: ScanResult;
  /** The field with this exact label. */
  field(label: string): ScannedField;
  /** visibleText of the whole page. */
  pageText(): string;
  passages(): Promise<RawPassage[]>;
}

/** Loads a trap page and scans its form root with `adapter` (the generic one by default). */
export async function loadTrap(host: Document, html: string, adapter: Adapter = genericAdapter): Promise<LoadedTrap> {
  const fixture = await loadFixture(host, html);
  const detected = adapter.detect(fixture.doc) ?? genericAdapter.detect(fixture.doc);
  if (detected === null) throw new Error('the trap has no form');
  const result = scan(detected.formRoot, adapter, TRAP_SCAN);
  return {
    ...fixture,
    root: detected.formRoot,
    result,
    field(label) {
      const found = result.fields.find((field) => field.label === label);
      if (found === undefined) throw new Error(`no field labelled ${JSON.stringify(label)}`);
      return found;
    },
    pageText: () => visibleText(fixture.doc),
    passages: async () => (await rawScan(fixture.doc)).passages,
  };
}

/** The ids of the tripwire patterns that match `text`, read as the core's guard reads it. */
export function tripwireHits(text: string): string[] {
  const views = detectionViews(text);
  return TRIPWIRE_PATTERNS.filter((pattern) => views.some((view) => pattern.re.test(view))).map((pattern) => pattern.id);
}

/** Phase 1's deterministic classification of a scanned field, as the worker will see it. */
export function classify(field: ScannedField): RuleClassification | null {
  return classifyByRules(toFieldSpec(field));
}

/** [label, kind, category] for each field a trap names, with the label rule deciding. */
export function labelTable(trap: LoadedTrap, labels: readonly string[]): Array<[string, string, string | null, string | null]> {
  return labels.map((label) => {
    const field = trap.field(label);
    const verdict = classify(field);
    return [label, field.kind, verdict?.category ?? verdict?.asks ?? null, verdict?.classifiedBy ?? null];
  });
}
