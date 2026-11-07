import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { TELEMETRY_FIELDS } from '../core/telemetry/events';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import type { FrameReport } from '../shared/report';
import { TELEMETRY_KEY } from './telemetry';
import { beginRun, contentSender, frameReport, pageSender, startTestWorker, tokenRecord, type TestWorker } from './worker.testkit';

type Row = FrameReport['fields'][number];

/** A row the run wrote and read back, carrying everything a row carries: label, key, section, reason, suggestions. */
const written = (key: string, overrides: Partial<Row> = {}): Row => ({
  key, label: `Label ${key}`, kind: 'text', category: 'contact.email', section: 'contact', required: true,
  status: 'verified', provenance: 'profile', matcherStage: 'not-applicable', confidence: 1, reason: 'ok', wrote: true,
  verification: 'verified', needsUserAction: false, detail: { suggestions: [{ index: 1, score: 0.8 }] }, ...overrides,
});

const optIn = (worker: TestWorker, on: boolean) => worker.deliver({ v: 1, type: 'settings/save',
  settings: { ...DEFAULT_SETTINGS, telemetry: { optIn: on } } }, pageSender('options.html'));

const put = (worker: TestWorker, runId: string, overrides: Partial<FrameReport>) =>
  worker.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId, 0, overrides) }, contentSender());

const counts = async (worker: TestWorker) =>
  ((await worker.deliver({ v: 1, type: 'telemetry/get' }, pageSender('options.html'))) as { data: { counts: unknown[] } }).data.counts;

const stored = async () => (await fakeBrowser.storage.local.get(TELEMETRY_KEY))[TELEMETRY_KEY];

describe('the anonymous counters', () => {
  it('count nothing until the person opts in', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    await put(worker, runId, { fields: [written('lever|contact|email|none|0')] });
    expect(await stored()).toBeUndefined();
    expect(await counts(worker)).toEqual([]);
  });

  it('hold exactly the five fields and a count per combination, derived from the rows, and nothing else', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await optIn(worker, true);
    const runId = await beginRun(worker);
    await put(worker, runId, {
      notices: [{ code: 'tripwire', count: 2 }],
      fields: [
        written('lever|contact|email|none|0'),
        written('lever|contact|phone|none|0'),
        written('lever|edu|degree|abcdef0123456789|0', { kind: 'select', matcherStage: 'alias', status: 'flagged',
          reason: 'filled-low-confidence' }),
        written('lever|contact|city|none|0', { status: 'skipped', provenance: null, reason: 'no-profile-value', wrote: false }),
      ],
    });
    const expected = [
      { platform: 'lever', fieldKind: 'text', matcherStage: 'not-applicable', outcome: 'success', tripwireTriggered: true, count: 2 },
      { platform: 'lever', fieldKind: 'select', matcherStage: 'alias', outcome: 'fail', tripwireTriggered: true, count: 1 },
    ];
    expect(await counts(worker)).toEqual(expected);
    const kept = await stored();
    expect(kept).toEqual({ counts: expected });
    for (const entry of (kept as { counts: object[] }).counts) {
      expect(Object.keys(entry).sort()).toEqual([...TELEMETRY_FIELDS, 'count'].sort());
    }
    // Nothing of the rows but kind, stage and status, and nothing of the frame but its platform and the tripwire.
    const text = JSON.stringify(kept);
    for (const carried of ['Label', 'contact', 'email', 'degree', 'abcdef', 'runId', runId, 'reason', 'suggestions', 'doc-1', '7']) {
      expect(text, carried).not.toContain(carried);
    }
  });

  it('count a row once per run, a dry run never, and a new run afresh', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await optIn(worker, true);
    const runId = await beginRun(worker);
    const email = written('lever|contact|email|none|0');
    await put(worker, runId, { fields: [email] });
    // The run reports again at its next rest: the same key is not counted twice, a new one is.
    await put(worker, runId, { status: 'done', fields: [{ ...email, status: 'filled' }, written('lever|contact|phone|none|0')] });
    expect(await counts(worker)).toEqual([
      { platform: 'lever', fieldKind: 'text', matcherStage: 'not-applicable', outcome: 'success', tripwireTriggered: false, count: 2 },
    ]);

    const dry = await beginRun(worker, { dryRun: true });
    await put(worker, dry, { mode: 'dry-run', fields: [written('lever|contact|other|none|0')] });
    expect(await counts(worker)).toEqual([expect.objectContaining({ count: 2 })]);

    const again = await beginRun(worker);
    await put(worker, again, { fields: [email] });
    expect(await counts(worker)).toEqual([expect.objectContaining({ count: 3 })]);
  });

  it('stop counting when the person opts out, keep what was counted until cleared, and clear it', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await optIn(worker, true);
    const runId = await beginRun(worker);
    await put(worker, runId, { fields: [written('lever|contact|email|none|0')] });
    await optIn(worker, false);
    await put(worker, runId, { fields: [written('lever|contact|phone|none|0')] });
    expect(await counts(worker)).toEqual([expect.objectContaining({ count: 1 })]);

    expect(await worker.deliver({ v: 1, type: 'telemetry/clear' }, pageSender('options.html'))).toEqual({ ok: true, data: { counts: [] } });
    expect(await stored()).toBeUndefined();
    expect(await counts(worker)).toEqual([]);
  });

  it('drop a stored entry that holds anything more than the five fields and a count', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await fakeBrowser.storage.local.set({ [TELEMETRY_KEY]: { counts: [
      { platform: 'lever', fieldKind: 'text', matcherStage: 'exact', outcome: 'success', tripwireTriggered: false, count: 4 },
      { platform: 'lever', fieldKind: 'text', matcherStage: 'exact', outcome: 'fail', tripwireTriggered: false, count: 1, label: 'Email' },
      // ── snapshot build 2026-11-06 (oracle-sf-sr): a platform with no adapter (SmartRecruiters and BambooHR are platforms
      // now) ──
      { platform: 'teamtailor', fieldKind: 'text', matcherStage: 'exact', outcome: 'fail', tripwireTriggered: false, count: 1 },
    ] } });
    expect(await counts(worker)).toEqual([
      { platform: 'lever', fieldKind: 'text', matcherStage: 'exact', outcome: 'success', tripwireTriggered: false, count: 4 },
    ]);
  });

  it('are read and cleared by the extension\'s pages only, and sent nowhere', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await optIn(worker, true);
    const runId = await beginRun(worker);
    await put(worker, runId, { fields: [written('lever|contact|email|none|0')] });
    expect(await worker.deliver({ v: 1, type: 'telemetry/get' }, contentSender())).toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'telemetry/clear' }, contentSender())).toEqual({ ok: false, error: 'bad_sender' });
    // No request to TailorIT and no message to a frame ever carries them.
    const everywhere = JSON.stringify({ requests: worker.tailorit.requests, frames: worker.fakes.tabMessages });
    expect(everywhere).not.toContain('tripwireTriggered');
    expect(everywhere).not.toContain('matcherStage');
  });
});

describe('the anonymous counters and Phase 6 rows', () => {
  it('count a saved answer as any written field, and an AI draft only once the person confirmed or edited it', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await optIn(worker, true);
    const runId = await beginRun(worker);
    const saved = written('lever|main|office|none|0', { provenance: 'saved', category: 'unknown' });
    const draft = written('lever|main|why|none|0', { kind: 'textarea', category: 'freeText.whyCompany', status: 'flagged',
      provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation', needsUserAction: true });
    await put(worker, runId, { fields: [saved, draft] });
    expect(await counts(worker)).toEqual([
      { platform: 'lever', fieldKind: 'text', matcherStage: 'not-applicable', outcome: 'success', tripwireTriggered: false, count: 1 },
    ]);
    // Confirmed: a success, counted once, as the report that says so arrives.
    const confirmed = { ...draft, status: 'verified' as const, reason: 'ok' as const, needsUserAction: false };
    await put(worker, runId, { fields: [saved, confirmed] });
    await put(worker, runId, { fields: [saved, confirmed] });
    expect(await counts(worker)).toEqual(expect.arrayContaining([
      { platform: 'lever', fieldKind: 'textarea', matcherStage: 'not-applicable', outcome: 'success', tripwireTriggered: false,
        count: 1 },
    ]));
    expect(await counts(worker)).toHaveLength(2);
  });
});
