/*
 * What the 4-step wizard's spec reads (Phase 5; e2e/specs/31-wizard.spec.ts; docs/FIXTURES.md "wizard-4-step"): where
 * the wizard fixture is served (one address per case, so each case is an application of its own, with its own
 * RunState), the labels its report may show, what the page script records, the extension's clicks and the person's
 * on the wizard's buttons, the run between steps as the extension's own pages read it, and the check that RunState
 * holds no value. Nothing here writes to a page or to the extension's storage.
 * - RunState is read from storage.local through an extension page, which never wakes the worker; the report is read
 *   through the worker (panel/reports), which does. So a spec that stopped the worker reads RunState first, to see what
 *   the content script's own messages did.
 * - A step is told apart from the one before by its signature: RunState.stepSignature changes, and stepAttempts gains
 *   the new step's entry.
 */
import { expect, type Page } from '@playwright/test';
import { isWizardUrl } from '../../src/adapters/test/wizard-url';
import type { RunState, RunStatus } from '../../src/core/types/run';
import type { FrameReport } from '../../src/shared/report';
import { RESTING, type Extension } from './extension';
import { profileSentinels } from './golden';
import { controlValues } from './invariants';
import { eventsOn } from './page-state';
import { fixtureAddress, syntheticLabels } from './reactive';
import type { SpyEvent } from './spies';

/** The wizard page, and the address of each case: wizard-4-step, or wizard-4-step-<case>, the e2e-only test adapter's
 *  addresses (src/adapters/test/wizard.ts). */
export const WIZARD = {
  file: 'fixtures/synthetic/wizard-4-step/index.html',
  expectations: 'fixtures/synthetic/wizard-4-step/index.expect.json',
  url(name: string): string {
    const address = fixtureAddress(name === '' ? 'wizard-4-step' : `wizard-4-step-${name}`);
    if (!isWizardUrl(new URL(address))) throw new Error(`${address} is not one of the wizard adapter's addresses`);
    return address;
  },
} as const;

/** The wizard's buttons, by spy identity (index.html). */
export const NEXT = { details: '#next-details', experience: '#next-experience', education: '#next-education' } as const;
export const BACK = ['#back-experience', '#back-education', '#back-review'] as const;
export const ADD = { experience: '#add-experience', education: '#add-education' } as const;
export const SUBMIT = '#submit';

/** The "Add education" button's text: a report row for the refused Add, if the runtime gives it one, shows it. */
export const ADD_EDUCATION_LABEL = 'Add education';

/** The labels the wizard's report may show: every state's fields (index.expect.json), and the refused Add's text. */
export const WIZARD_LABELS: readonly string[] = [...syntheticLabels(WIZARD.expectations), ADD_EDUCATION_LABEL];

/** What the page script keeps on window.__wizard (index.html's header). */
export interface WizardRecord {
  step: number;
  shown: number[];
  next: Array<{ step: number; trusted: boolean }>;
  back: Array<{ step: number; trusted: boolean }>;
  added: { experience: number; education: number };
  ignored: { education: number };
}

/** The page's own record of its steps and buttons. */
export async function wizardRecord(page: Page): Promise<WizardRecord> {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __wizard: unknown }).__wizard)) as WizardRecord);
}

/** The untrusted clicks (the extension's) the spies saw on a control. */
export async function extensionClicks(page: Page, control: string): Promise<SpyEvent[]> {
  return (await eventsOn(page, control)).filter((event) => event.type === 'click' && !event.trusted);
}

/** Every event of any kind, trusted or not, on the wizard's Submit: a run must leave none. */
export const submitEvents = (page: Page): Promise<SpyEvent[]> => eventsOn(page, SUBMIT);

/** The statuses a run rests at between steps: RESTING, or waiting for the person's Next (auto-advance off, or a step
 *  it may not press). */
export const BETWEEN_STEPS: readonly RunStatus[] = [...RESTING, 'wait-transition'];

/** Where the run is: its stored RunState, and the tab's report (null when not read). */
export interface RunAt {
  runState: RunState;
  report: FrameReport | null;
}

/**
 * Waits until the application's stored RunState satisfies `until` and rests at one of `statuses`, and then, unless
 * `report` is false, until the tab's top-frame report (fill mode) rests at the same status and satisfies `report`.
 * RunState is polled from storage alone; only the report wakes the worker.
 */
export async function runAt(ext: Extension, tabId: number, applicationKey: string, want: {
  until: (runState: RunState) => boolean;
  statuses?: readonly RunStatus[];
  report?: ((report: FrameReport) => boolean) | false;
  timeout?: number;
}): Promise<RunAt> {
  const { until, statuses = BETWEEN_STEPS, report: reportCheck = () => true, timeout = 45_000 } = want;
  const held: { runState: RunState | null; report: FrameReport | null } = { runState: null, report: null };
  await expect.poll(async () => {
    const runState = await ext.runState(applicationKey);
    held.runState = runState !== null && statuses.includes(runState.status) && until(runState) ? runState : null;
    return held.runState === null ? `not yet (RunState ${runState === null ? 'none' : `${runState.status}, step ${runState.stepIndex}`})`
      : 'there';
  }, { timeout, intervals: [200, 300, 500] }).toBe('there');
  if (reportCheck === false) return { runState: held.runState!, report: null };
  await expect.poll(async () => {
    const report = (await ext.reports(tabId)).find((candidate) => candidate.frameId === 0) ?? null;
    held.report = report !== null && report.mode === 'fill' && report.status === held.runState!.status && reportCheck(report)
      ? report : null;
    return held.report === null ? `not yet (${report === null ? 'no report' : `${report.mode} ${report.status}`})` : 'there';
  }, { timeout, intervals: [200, 300, 500] }).toBe('there');
  // RunState again, now that the report is in: the step it names is the one the report shows.
  const runState = await ext.runState(applicationKey);
  expect(runState?.stepSignature, 'the step moved on while its report was read').toBe(held.runState!.stepSignature);
  return { runState: runState!, report: held.report };
}

/** Waits until the run has reached a step it had not seen (a signature not in `seen`) and rests there; adds the new
 *  signature to `seen`. */
export async function nextStepAt(ext: Extension, tabId: number, applicationKey: string, seen: Set<string>, want: {
  statuses?: readonly RunStatus[];
  report?: ((report: FrameReport) => boolean) | false;
  timeout?: number;
} = {}): Promise<RunAt> {
  const at = await runAt(ext, tabId, applicationKey, { ...want,
    until: (runState) => runState.stepSignature !== null && !seen.has(runState.stepSignature) });
  seen.add(at.runState.stepSignature!);
  return at;
}

/** A report's row by its section ('experience[1]') and exact label; a missing row fails the test. */
export function rowIn(report: FrameReport, section: string, label: string): FrameReport['fields'][number] {
  const found = report.fields.find((candidate) => candidate.section === section && candidate.label === label);
  expect(found, `the report has no row ${JSON.stringify(label)} in ${section}; its rows: ${report.fields
    .map((candidate) => `${candidate.section} ${candidate.label}`).join(' | ')}`).toBeDefined();
  return found!;
}

/** Every string in a value, object keys included, depth first. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...stringsIn(inner)]);
}

const SIGNATURE = /^[0-9a-f]{16}$/;

/**
 * RunState holds no field value (docs/SPEC.md Requirement C): no string in it, record keys included, holds a value of
 * the golden profile or a value a form control on the page holds now (four characters or more, case-insensitively),
 * and its step identities are hashes. Its canarySet is page text the worker checked, and this page has none.
 */
export async function expectValueFree(runState: RunState, page: Page): Promise<void> {
  const strings = stringsIn(runState).map((text) => text.toLowerCase());
  const values = (await controlValues(page)).filter((value) => value.trim().length >= 4);
  for (const needle of [...new Set([...profileSentinels(), ...values])]) {
    expect(strings.filter((text) => text.includes(needle.toLowerCase())), `RunState holds ${JSON.stringify(needle)}`)
      .toEqual([]);
  }
  expect(runState.stepSignature).toMatch(SIGNATURE);
  for (const record of [runState.stepAttempts, runState.filledFieldKeys]) {
    expect(Object.keys(record).filter((signature) => !SIGNATURE.test(signature)), 'a step key that is not a signature')
      .toEqual([]);
  }
  expect(Object.values(runState.stepAttempts).filter((attempts) => !Number.isInteger(attempts) || attempts < 1 || attempts > 2),
    'step attempts outside 1 and 2').toEqual([]);
  expect(runState.canarySet).toEqual([]);
}
