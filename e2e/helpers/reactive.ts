/*
 * What the reactive loop's specs read besides the Phase 2 helpers (docs/design/runtime.md §11.e): where the synthetic
 * fixtures are served (conditional-reveal and async-options, Phase 3; widgets and remote-typeahead, Phase 4), their
 * labels (read from their own hand-written expectations, every state's, so a report may show any field a reveal
 * brings), a row's parent by base key, the extension's writes on one control, and the page scripts' own counters and
 * logs. Nothing here writes to a page.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { baseKeyOf } from '../../src/core/loop/bookkeeping';
import type { FieldKey } from '../../src/core/types/field';
import type { FrameReport } from '../../src/shared/report';
import { eventsOn } from './page-state';

/** An address on the reserved fixture board (src/adapters/index.ts FIXTURE_BOARD), read by the generic adapter. */
export const fixtureAddress = (name: string) => `https://jobs.lever.co/tailorit-fixture/${name}/apply`;

/** The conditional-reveal page, and where it is served. */
export const REVEAL = { file: 'fixtures/synthetic/conditional-reveal/index.html', url: fixtureAddress('conditional-reveal'),
  expectations: 'fixtures/synthetic/conditional-reveal/index.expect.json' } as const;

/** The LLM steps' page (Phase 4), served at one address per case so each case is an application of its own. */
export const AI_STEPS = { file: 'fixtures/synthetic/ai-steps/index.html', expectations: 'fixtures/synthetic/ai-steps/index.expect.json',
  url: (name: string) => fixtureAddress(name === '' ? 'ai-steps' : `ai-steps-${name}`) } as const;

/** The async-options page's variants (its header says what each does), each served at its own address so each has an
 *  application of its own. */
export const ASYNC_VARIANTS = ['fast', 'slow', 'never', 'failed', 'page-busy'] as const;
export type AsyncVariant = (typeof ASYNC_VARIANTS)[number];

/** The async-options page, and the address of each variant. */
export const ASYNC = { file: 'fixtures/synthetic/async-options/index.html',
  expectations: 'fixtures/synthetic/async-options/index.expect.json',
  url: (variant: AsyncVariant) => fixtureAddress(`async-options-${variant}`) } as const;

/** The labels of a synthetic page's <case>.expect.json, its first state's and every later state's, in order. */
export function syntheticLabels(expectations: string): string[] {
  const json = JSON.parse(readFileSync(resolve(expectations), 'utf8')) as { fields: Array<{ label: string }>;
    states?: Array<{ fields: Array<{ label: string }> }> };
  const all = [json.fields, ...(json.states ?? []).map((state) => state.fields)].flat().map((field) => field.label);
  return [...new Set(all)];
}

/** A row's base key: its key without the option-set hash (the core's baseKeyOf), as detail.revealedBy and
 *  RunState.revealEdges name fields. */
export const baseKeyOfRow = (row: FrameReport['fields'][number]): string => baseKeyOf(row.key as FieldKey);

/** How many times the extension wrote a control: its untrusted change events (every filler ends a write with one;
 *  a radio's comes from Chromium after the extension's click, and is trusted, so this counts text boxes and selects). */
export async function writesOn(page: Page, control: string): Promise<number> {
  return (await eventsOn(page, control)).filter((event) => !event.trusted && event.type === 'change').length;
}

/** A number the page script keeps on window (the fixtures' headers name them), or null when it has none. */
export async function pageCounter(page: Page, name: string): Promise<number | null> {
  return page.evaluate((key) => {
    const value = (window as unknown as Record<string, unknown>)[key];
    return typeof value === 'number' ? value : null;
  }, name);
}

/** The widgets page (Phase 4), and where it is served. */
export const WIDGETS = { file: 'fixtures/synthetic/widgets/index.html', url: fixtureAddress('widgets'),
  expectations: 'fixtures/synthetic/widgets/index.expect.json' } as const;

/** The remote-typeahead page's variants (its header says what its fake server answers in each), each served at its own
 *  address so each has an application of its own. */
export const TYPEAHEAD_VARIANTS = ['default', 'none', 'injected'] as const;
export type TypeaheadVariant = (typeof TYPEAHEAD_VARIANTS)[number];

/** The remote-typeahead page, and the address of each variant. */
export const TYPEAHEAD = { file: 'fixtures/synthetic/remote-typeahead/index.html',
  expectations: 'fixtures/synthetic/remote-typeahead/index.expect.json',
  url: (variant: TypeaheadVariant) => fixtureAddress(variant === 'default' ? 'remote-typeahead'
    : `remote-typeahead-${variant}`) } as const;

/** A value the page script keeps on window, read as JSON (the fixtures' headers name them). */
export async function pageValue<T>(page: Page, name: string): Promise<T> {
  return page.evaluate((key) => JSON.parse(JSON.stringify((window as unknown as Record<string, unknown>)[key] ?? null)),
    name) as Promise<T>;
}
