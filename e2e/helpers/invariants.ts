/*
 * What every trap run must leave true (docs/ARCHITECTURE.md "Testing", after the trap table; docs/design/runtime.md
 * §11.d), checked from outside the extension: the page's spies, the route log, the mock's request log, the console of
 * every context, and the extension's reports and storage as its own pages read them.
 * 1. No submission: no request to /__submitted and no submit event.
 * 2. Every event on a form control is untrusted, with two exceptions the lead decided, stated the same way by the DOM
 *    testkit's untrustedViolations(), which this reuses: after the extension's untrusted click() on a checkbox or radio,
 *    Chromium fires that control's input and change itself, as trusted events; and the browser's own pointer and mouse
 *    boundary and move events (over, out, enter, leave, move), which it fires when the page changes under a cursor
 *    that sits still and no extension can cause. A trusted scroll counts too, except on a listbox (the spies mark it
 *    scrollTopSet): the widget helpers set a list's scrollTop to read it, and nothing else (the Phase 4 review, R8).
 *    A spec that clicks as the person (Phase 5: a wizard's Next, with Playwright's trusted click) names those controls
 *    in `personClicked`: their trusted events are the person's and are left out of this check, and none of them may
 *    be a control that could submit. Nothing else is excused, and their untrusted events are still checked here and
 *    in 3.
 * 3. The extension's own (untrusted) events are only the fillers' (input, change, focusout, blur, click, and any
 *    single activation event an adapter declares), and none is a click on a control assertNotSubmit refuses.
 * 4. No hidden marker or canary in a request to TailorIT, a report, RunState (its checked canarySet aside, which holds
 *    canaries by design), storage, a console message, or a form control's final value; canaries of 8 or more
 *    characters are also looked for with spaces and punctuation removed, as the Guard does.
 * 5. No free-text value of the golden profile, case-insensitively, anywhere but a report row's label: reports (each
 *    row's label set aside), RunState, storage (its stored reports' labels set aside), console messages and requests to
 *    TailorIT, in full. Among them the free text a follow-up box takes (the referral source, a self-description: the
 *    Phase 3 review, L-S6). A row's label is page text, and a page may show a profile value as one (trap 5's checkbox
 *    labelled "TypeScript"), so the labels are proven to be the page's instead: each is one of the labels the fixture
 *    defines, and each row's key is built from its own label and section (the key carries the label's slug, which is
 *    set aside with the label, as is the slug in the key of the field that revealed it, detail.revealedBy, and the
 *    row's category, a closed enum such as links.linkedin). RunState sets nothing aside: its reveal edges carry each
 *    section and label slug hashed (L-S3). An AI request (Phase 4) sets aside, by the contract's design, the page text
 *    it quotes (an item's label, hint, section and options: hidden markers and canaries are still looked for there, and
 *    the AI spec checks those bodies field by field), a pick's intended value and aliases (the one place profile text
 *    goes to TailorIT's AI), and an item key that is a report row's (proven built from its page label).
 * 6. Every filled or verified row has a provenance.
 * 7. The run never reaches done.
 * 8. No request went anywhere the routes do not answer.
 */
import { expect, type Page } from '@playwright/test';
import { labelSlug, qualifiedLabel } from '../../src/core/text/keys';
import { ALLOWED_EVENTS } from '../../src/dom/fillers/events';
import { SUBMIT_WORDS } from '../../src/dom/fillers/not-submit';
import { untrustedViolations } from '../../src/dom/fixture.testkit';
import type { FrameReport } from '../../src/shared/report';
import type { RouteLog } from '../routes';
import type { ConsoleEntry } from './console';
import type { Extension } from './extension';
import { profileSentinels } from './golden';
import { mock, type MockRequest } from './mock';
import { spyRecords } from './spies';

export interface TrapRun {
  page: Page;
  ext: Extension;
  tabId: number;
  routeLog: RouteLog;
  /** This test's console messages. */
  console: readonly ConsoleEntry[];
  markers: readonly string[];
  canaries: readonly string[];
  /** The visible labels the fixture defines (its expectations, or the trap's own list), '' for a control with none:
   *  every report row's label must be one of them. */
  labels: readonly string[];
  applicationKey: string | null;
  /** Single activation events an adapter declared for a widget on the page (none in Phase 2). */
  activation?: readonly string[];
  /** The controls the spec clicked as the person (Playwright's trusted click), by their spy identity (#id): a wizard's
   *  Next (Phase 5). Their trusted events are the person's, never a violation; none may be a control that submits. */
  personClicked?: readonly string[];
}

type Row = FrameReport['fields'][number];

const lower = (text: string) => text.toLowerCase();
/** Letters and digits only, lower case: how the Guard matches a long canary written without its spaces. */
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** A value with every `canarySet` removed: RunState holds its checked canaries by design. */
function withoutCanarySets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCanarySets);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'canarySet')
    .map(([key, inner]) => [key, withoutCanarySets(inner)]));
}

/** Whether a row's key carries the slug of the row's own label: the core's labelSlug of it. An empty label's slug is
 *  built from the control's name or id, which a row does not carry, so only its shape is known. */
const slugMatches = (row: Row, slug: string) => (qualifiedLabel(row.label) === ''
  ? /^~[a-z-]+~[a-z0-9&~-]+$/.test(slug)
  : slug === labelSlug({ label: row.label, kind: row.kind, nameAttr: '', idAttr: '' }));

/** Why a row's key is not `${platform}|${its section}|${its label's slug}|${hash}|${ordinal}`, or null when it is. */
export function keyFault(report: FrameReport, row: Row): string | null {
  const parts = row.key.split('|');
  if (parts.length !== 5) return `${parts.length} parts`;
  const [platform, section, slug, hash, ordinal] = parts as [string, string, string, string, string];
  if (platform !== report.platform) return `platform ${platform}`;
  if (section !== row.section) return `section ${section}, not the row's ${row.section}`;
  if (!slugMatches(row, slug)) return `label slug ${slug}, not its label's`;
  if (!/^(?:[a-f0-9]{16}|none|lazy)$/.test(hash)) return `option-set hash ${hash}`;
  return /^\d+$/.test(ordinal) ? null : `ordinal ${ordinal}`;
}

/** A key with its label slug set aside: a field key's or a base key's. */
function slugAside(key: string): string {
  const parts = key.split('|');
  if (parts.length === 5 || parts.length === 4) parts[2] = '<label>';
  return parts.join('|');
}

/** A report with what is page text set aside: each row's label, the label's slug in its key, and the slug in the key
 *  of the field that revealed it; and each row's category, a closed enum that names the question, never its answer
 *  ("links.linkedin" holds the referral source's word). */
function withoutLabels(report: unknown): unknown {
  const value = report as Partial<FrameReport> | null;
  if (value === null || typeof value !== 'object' || !Array.isArray(value.fields)) return report;
  return {
    ...value,
    fields: value.fields.map(({ label: _label, category: _category, ...row }) => ({
      ...row,
      key: slugAside(row.key),
      ...(row.detail === undefined ? {} : { detail: { ...row.detail,
        ...(row.detail.revealedBy === undefined ? {} : { revealedBy: slugAside(row.detail.revealedBy) }) } }),
    })),
  };
}

/** The AI routes' page-text fields (each item's) and the pick's profile-text fields. */
const AI_PAGE_TEXT = ['label', 'hint', 'section', 'options'];
const AI_PROFILE_TEXT = ['intendedValue', 'aliases'];

/**
 * A request's body as the profile-value search reads it. An AI request (POST /api/autofill/ai/pick or /classify) has
 * set aside what the contract gives page text (each item's label, hint, section and options, which a page may write
 * as a profile value says it: trap 5's "TypeScript"; the marker test proves them visible text) and the pick's intended
 * value and aliases (the one place profile text goes to TailorIT's AI, by design), and an item's key when it is one of
 * the reports' row keys (proven built from the page's own label and section). What is left (categories, hashes,
 * kinds, a key no row has) is searched. Any other body is read whole.
 */
function sentinelBody(request: MockRequest, rowKeys: ReadonlySet<string>): string {
  if (request.method !== 'POST' || !/^\/api\/autofill\/ai\/(?:pick|classify)$/.test(request.path)) return request.body;
  try {
    const body = JSON.parse(request.body) as { items?: Array<Record<string, unknown>> };
    const items = (body.items ?? []).map((item) => Object.fromEntries(Object.entries(item).filter(([name, value]) =>
      !AI_PAGE_TEXT.includes(name) && !AI_PROFILE_TEXT.includes(name) && !(name === 'key' && rowKeys.has(String(value))))));
    return JSON.stringify({ ...body, items });
  } catch {
    return request.body;
  }
}

/** Every form control's final value in every frame of the page: text, a select's chosen options (value and text), a
 *  file input's file names. */
export async function controlValues(page: Page): Promise<string[]> {
  const values: string[] = [];
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    try {
      values.push(...await frame.evaluate(() => Array.from(document.querySelectorAll('input, textarea, select')).flatMap((el) => {
        if (el instanceof HTMLSelectElement) return Array.from(el.selectedOptions).flatMap((option) => [option.value, option.text]);
        if (el instanceof HTMLInputElement) {
          if (el.type === 'file') return Array.from(el.files ?? []).map((file) => file.name);
          if (el.type === 'checkbox' || el.type === 'radio') return [];
        }
        return [(el as HTMLInputElement | HTMLTextAreaElement).value];
      }).filter((value) => value !== '')));
    } catch {
      // A frame that navigated away mid-read holds nothing of this run.
    }
  }
  return values;
}

export async function assertTrapInvariants(run: TrapRun): Promise<void> {
  const records = await spyRecords(run.page);
  const events = records.flatMap((record) => record.events);

  // 1. Nothing submitted.
  expect(run.routeLog.submitted, 'a form was submitted').toEqual([]);
  expect(events.filter((event) => event.type === 'submit'), 'a submit event').toEqual([]);

  // 2. Untrusted events only, Chromium's own input and change after an untrusted click on a box aside, and the
  //    person's own on the controls the spec clicked as them (none of which may submit).
  const personal = new Set(run.personClicked ?? []);
  const theirs = (event: (typeof events)[number]) => event.trusted && personal.has(event.control);
  expect(events.filter((event) => theirs(event) && (event.submits || SUBMIT_WORDS.test(event.words))),
    "the person's clicks the spec made on a control that could submit").toEqual([]);
  for (const record of records) {
    expect(untrustedViolations(record.events.filter((event) => !theirs(event))),
      `trusted events on form controls in ${record.url}`).toEqual([]);
  }

  // 3. Only the fillers' events, and no click on a submit control.
  const allowed = new Set<string>([...ALLOWED_EVENTS, ...(run.activation ?? [])]);
  const ours = events.filter((event) => !event.trusted);
  expect(ours.filter((event) => !allowed.has(event.type)), 'events the fillers never cause').toEqual([]);
  expect(ours.filter((event) => event.type === 'click' && (event.submits || SUBMIT_WORDS.test(event.words))),
    'a click on a control that could submit').toEqual([]);

  // 4. Hidden markers and canaries nowhere.
  const reports = await run.ext.reports(run.tabId);
  const storage = await run.ext.storage();
  const runState = run.applicationKey === null ? null : storage.local[`run:${run.applicationKey}`] ?? null;
  const requests = await mock.requests();
  const values = await controlValues(run.page);
  const consoleText = run.console.map((entry) => entry.text).join('\n');
  const requestText = requests.map((request) => `${request.path}${request.query} ${request.body}`).join('\n');
  const places: Record<string, string> = {
    'a request to TailorIT': requestText,
    'a report': JSON.stringify(reports),
    RunState: JSON.stringify(withoutCanarySets(runState)),
    "the extension's storage": JSON.stringify(withoutCanarySets(storage)),
    'a console message': consoleText,
    "a form control's value": values.join('\n'),
  };
  for (const needle of [...run.markers, ...run.canaries]) {
    for (const [where, haystack] of Object.entries(places)) {
      expect(lower(haystack).includes(lower(needle)), `${JSON.stringify(needle)} in ${where}`).toBe(false);
    }
  }
  for (const canary of run.canaries.filter((text) => squash(text).length >= 8)) {
    expect(values.some((value) => squash(value).includes(squash(canary))), `${canary}, written without spaces, in a value`).toBe(false);
  }

  // 5. The profile's free-text values nowhere but in a row's label, and every label the page's own.
  const pageLabels = new Set(run.labels);
  for (const report of reports) {
    expect(report.fields.filter((row) => !pageLabels.has(row.label)).map((row) => row.label),
      'rows whose label is not one the fixture shows').toEqual([]);
    expect(report.fields.map((row) => ({ label: row.label, fault: keyFault(report, row) })).filter((entry) => entry.fault !== null),
      'rows whose key is not built from their own label and section').toEqual([]);
  }
  const reportsAside = (area: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(area).map(([key, value]) => [key, key.startsWith('report:') ? withoutLabels(value) : value]));
  // The rows' keys, each proven above to be built from its own (page) label: an AI request's item key may be one.
  const rowKeys = new Set(reports.flatMap((report) => report.fields.map((row) => row.key)));
  const anywhere: Record<string, string> = {
    'a report (its labels aside)': JSON.stringify(reports.map(withoutLabels)),
    RunState: JSON.stringify(runState),
    "the extension's storage (its reports' labels aside)": JSON.stringify({ session: reportsAside(storage.session), local: storage.local }),
    'a console message': consoleText,
    'a request to TailorIT (an AI request’s page text, its keys of rows and a pick’s value aside)': requests
      .map((request) => `${request.path}${request.query} ${sentinelBody(request, rowKeys)}`).join('\n'),
  };
  for (const sentinel of profileSentinels()) {
    for (const [where, haystack] of Object.entries(anywhere)) {
      expect(lower(haystack).includes(lower(sentinel)), `the profile value ${JSON.stringify(sentinel)} in ${where}`).toBe(false);
    }
  }

  // 6. Provenance on every written value.
  for (const report of reports) {
    const missing = report.fields.filter((row) => (row.status === 'filled' || row.status === 'verified') && row.provenance === null);
    expect(missing.map((row) => row.label), 'filled or verified rows without a provenance').toEqual([]);
  }

  // 7. Never done.
  expect(reports.map((report) => report.status), 'a report reached done').not.toContain('done');
  expect((runState as { status?: string } | null)?.status, 'RunState reached done').not.toBe('done');

  // 8. Nothing else on the network.
  expect(run.routeLog.unexpected, 'requests nothing answers').toEqual([]);
}
