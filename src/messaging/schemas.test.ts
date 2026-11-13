import { describe, expect, it } from 'vitest';
import { MAX_STEPS } from '../core/types/run';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { answerSchema } from './envelope';
import { ContentMessageSchema, DoneAnswerSchema, FieldDescribeAnswerSchema, FRAME_ANSWER_SCHEMAS, RUN_STATE_RECORD_CAPS, RunStateGetAnswerSchema, RunStatePutAnswerSchema, WorkerToContentSchema, WriteValueSchema } from './schemas';
import { AuthStatusSchema, PAGE_ANSWER_SCHEMAS, PageMessageSchema, PanelPortMessageSchema, PanelSentAnswerSchema, RunsClearAnswerSchema, SettingsAnswerSchema, StartPairingAnswerSchema, TabReportsAnswerSchema } from './page-schemas';

const STATUS = {
  connection: 'connected',
  account: { name: 'Elena Ruiz', email: 'elena.ruiz@example.com' },
  scopes: ['profile:read', 'jobs:lookup'],
  expiresAt: 1_800_000_000_000,
  storageAccess: 'restricted',
  versionMismatch: false,
  pairingExpiresAt: null,
} as const;

describe('plan/request (LC-2)', () => {
  const spec = (index: number) => ({ key: `lever|main|field-${index}|none|0`, baseKey: `lever|main|field-${index}|0`,
    platform: 'lever', section: { id: 'main' }, kind: 'text', label: `Field ${index}`, labelSource: 'for',
    labelVisible: true, description: '', required: false, options: [], optionSetHash: 'none', constraints: {},
    autocomplete: [], nameAttr: '', idAttr: '', ordinal: 0, domOrder: index, visibility: 'visible', disabled: false,
    readOnly: false, current: { kind: 'empty' } });
  const request = (planKeys: string[]) => ({ v: 1, type: 'plan/request', runId: 'run-1', pass: 1,
    specs: [spec(1), spec(2)], planKeys, canaries: [], notices: [] });

  it('carries the whole scan and the keys to plan, each one a spec\'s', () => {
    expect(ContentMessageSchema.safeParse(request([spec(2).key])).success).toBe(true);
    expect(ContentMessageSchema.safeParse(request([])).success).toBe(true);
    expect(ContentMessageSchema.safeParse(request([spec(1).key, 'lever|main|field-9|none|0'])).success).toBe(false);
    const { planKeys: _keys, ...without } = request([spec(1).key]);
    expect(ContentMessageSchema.safeParse(without).success).toBe(false);
    expect(ContentMessageSchema.safeParse(request(Array(501).fill(spec(1).key))).success).toBe(false);
  });
});

describe('the page channel\'s additions', () => {
  it('reads a tab\'s reports with panel/reports, and nothing else rides along', () => {
    expect(PageMessageSchema.safeParse({ v: 1, type: 'panel/reports', tabId: 7 }).success).toBe(true);
    expect(PageMessageSchema.safeParse({ v: 1, type: 'panel/reports', tabId: -1 }).success).toBe(false);
    expect(PageMessageSchema.safeParse({ v: 1, type: 'panel/reports', tabId: 7, frameId: 0 }).success).toBe(false);
    // A page type is not a content type.
    expect(ContentMessageSchema.safeParse({ v: 1, type: 'panel/reports', tabId: 7 }).success).toBe(false);
  });

  it('follows a tab over the panel port: panel/watch in, panel/update out', () => {
    expect(PanelPortMessageSchema.safeParse({ v: 1, type: 'panel/watch', tabId: 3 }).success).toBe(true);
    expect(PanelPortMessageSchema.safeParse({ v: 1, type: 'panel/update', tabId: 3, reports: [] }).success).toBe(true);
    expect(PanelPortMessageSchema.safeParse({ v: 1, type: 'panel/update', tabId: 3, reports: Array(21).fill(null) }).success).toBe(false);
    expect(PanelPortMessageSchema.safeParse({ v: 1, type: 'panel/watch' }).success).toBe(false);
  });

  it('carries the policy card\'s decision for one frame, apart from the toolbar\'s Continue', () => {
    const decision = { v: 1, type: 'panel/policyDecision', tabId: 7, frameId: 4, decision: 'fill' };
    expect(PageMessageSchema.safeParse(decision).success).toBe(true);
    expect(PageMessageSchema.safeParse({ ...decision, decision: 'cancel' }).success).toBe(true);
    expect(PageMessageSchema.safeParse({ ...decision, decision: 'continue' }).success).toBe(false);
    const { frameId: _frame, ...unaddressed } = decision;
    expect(PageMessageSchema.safeParse(unaddressed).success).toBe(false);
    expect(PageMessageSchema.safeParse({ ...decision, fieldKey: 'k' }).success).toBe(false);
    expect(PageMessageSchema.safeParse({ v: 1, type: 'panel/continue', tabId: 7, decision: 'fill' }).success).toBe(false);
    // The worker's message to the frame, and only on that channel.
    expect(WorkerToContentSchema.safeParse({ v: 1, type: 'run/policyDecision', decision: 'fill' }).success).toBe(true);
    expect(WorkerToContentSchema.safeParse({ v: 1, type: 'run/policyDecision', decision: 'accepted' }).success).toBe(false);
    expect(WorkerToContentSchema.safeParse({ v: 1, type: 'run/policyDecision' }).success).toBe(false);
    expect(ContentMessageSchema.safeParse(decision).success).toBe(false);
    expect(PAGE_ANSWER_SCHEMAS['panel/policyDecision']).toBe(DoneAnswerSchema);
    expect(FRAME_ANSWER_SCHEMAS['run/policyDecision']).toBe(DoneAnswerSchema);
  });

  it('push a saved change of the settings to a frame as its content settings only (the Phase 5 review, C-S2)', () => {
    const changed = { v: 1, type: 'settings/changed', settings: { panel: 'side',
      modes: { next: DEFAULT_SETTINGS.modes.next, afterPageTurn: DEFAULT_SETTINGS.modes.afterPageTurn,
        submit: DEFAULT_SETTINGS.modes.submit, agentSkip: DEFAULT_SETTINGS.modes.agentSkip,
        signIn: DEFAULT_SETTINGS.modes.signIn, noMatch: 'other', notifications: 'until-closed' },
      llm: { tiebreak: true, classify: true, drafts: false, answers: true, whenForbidden: 'profile-only' },
      offerToSaveAnswers: true } };
    expect(WorkerToContentSchema.safeParse(changed).success).toBe(true);
    // jr7 AUTO-7 (ENGINE-7 E2's edit 1: UP7-04's account terms, EFA-6's upload prompt): the Consents mode and the
    // pre-approved consents reach the content now, for the sign-in steps and the upload prompts it answers per them.
    expect(WorkerToContentSchema.safeParse({ ...changed, settings: { ...changed.settings, preapprovedConsent: ['privacy'],
      modes: { ...changed.settings.modes, consents: 'required' } } }).success).toBe(true);
    // Never the rest of the settings, never anything else.
    expect(WorkerToContentSchema.safeParse({ ...changed, settings: { ...changed.settings, telemetry: { optIn: true } } })
      .success).toBe(false);
    expect(WorkerToContentSchema.safeParse({ ...changed, settings: { ...changed.settings,
      preapprovedConsent: ['not-a-consent'] } }).success).toBe(false);
    expect(WorkerToContentSchema.safeParse({ ...changed, tabId: 7 }).success).toBe(false);
    // Only the modes a frame acts on (v3 Phase 3 review): never Consent boxes, AI answers or Record my own (Sign-in, v3
    // Phase 5, as it acts).
    expect(WorkerToContentSchema.safeParse({ ...changed, settings: { ...changed.settings,
      modes: DEFAULT_SETTINGS.modes } }).success).toBe(false);
    expect(WorkerToContentSchema.safeParse({ v: 1, type: 'settings/changed' }).success).toBe(false);
    expect(ContentMessageSchema.safeParse(changed).success).toBe(false);
    expect(PageMessageSchema.safeParse(changed).success).toBe(false);
    expect(FRAME_ANSWER_SCHEMAS['settings/changed']).toBe(DoneAnswerSchema);
  });
});

describe('the payloads', () => {
  it('make an options write name each option by its clean label, one per index, capped', () => {
    const value = { kind: 'options', indices: [2, 4], cleanLabels: ['Python', 'TypeScript'] };
    expect(WriteValueSchema.safeParse(value).success).toBe(true);
    expect(WriteValueSchema.safeParse({ kind: 'options', indices: [2, 4] }).success).toBe(false);
    expect(WriteValueSchema.safeParse({ ...value, cleanLabels: ['Python'] }).success).toBe(false);
    expect(WriteValueSchema.safeParse({ ...value, cleanLabels: ['Python', 'TypeScript', 'Go'] }).success).toBe(false);
    expect(WriteValueSchema.safeParse({ ...value, cleanLabels: ['Python', 'x'.repeat(301)] }).success).toBe(false);
    expect(WriteValueSchema.safeParse({ kind: 'options', indices: Array.from({ length: 301 }, (_, i) => i),
      cleanLabels: Array(301).fill('x') }).success).toBe(false);
    expect(WriteValueSchema.safeParse({ ...value, labels: ['Python', 'TypeScript'] }).success).toBe(false);
  });

  // S10: RunState's records took any number of entries (a runstate/put of 200,000 entries, over 8 MB, parsed).
  describe("RunState's records", () => {
    const entries = (count: number, value: (index: number) => unknown) =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [i.toString(16).padStart(16, '0'), value(i)]));
    const values = {
      stepAttempts: () => 1,
      filledFieldKeys: (i: number) => [`lever|main|field-${i}|none|0`],
      repeatableCounters: () => ({ profile: 2, rendered: 1, addClicks: 1 }),
      aiTasks: () => '0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00',
    } as const;
    const runState = {
      version: 1, applicationKey: 'lever:0123456789abcdef', platform: 'lever', status: 'review', resumeStatus: null,
      pauseReason: null, stepSignature: null, stepIndex: 0, stepAttempts: {}, filledFieldKeys: {}, repeatableCounters: {},
      canarySet: [], tripwire: { triggered: false, hits: 0 }, policyDecision: null, revealEdges: [], aiTasks: {},
      lastFill: null, startedAt: 0, updatedAt: 0,
    };
    const put = (records: Partial<Record<keyof typeof values, unknown>>) =>
      ContentMessageSchema.safeParse({ v: 1, type: 'runstate/put', runState: { ...runState, ...records } }).success;

    it('are capped by the core\'s step guard: as many entries as a run can make, and no more', () => {
      expect(RUN_STATE_RECORD_CAPS).toEqual({ stepAttempts: MAX_STEPS, filledFieldKeys: MAX_STEPS,
        repeatableCounters: MAX_STEPS * 3, aiTasks: MAX_STEPS * 8 * 4 });
      for (const [name, value] of Object.entries(values)) {
        const cap = RUN_STATE_RECORD_CAPS[name as keyof typeof values];
        expect(put({ [name]: entries(cap, value) }), `${name} at its cap`).toBe(true);
        expect(put({ [name]: entries(cap + 1, value) }), `${name} past its cap`).toBe(false);
      }
    });

    it('refuse an endless one before reading its entries', () => {
      const stepAttempts = entries(100_000, () => 1);
      const aiTasks = entries(100_000, () => 'x'.repeat(64));
      expect(put({ stepAttempts, aiTasks })).toBe(false);
      expect(put({ stepAttempts: [] })).toBe(false);
      expect(put({ aiTasks: null })).toBe(false);
    });
  });
});

describe('the answers', () => {
  it('give the connection without any token field', () => {
    expect(AuthStatusSchema.safeParse(STATUS).success).toBe(true);
    expect(AuthStatusSchema.safeParse({ ...STATUS, token: 'tia_x' }).success).toBe(false);
    expect(AuthStatusSchema.safeParse({ ...STATUS, account: { ...STATUS.account, token: 'tia_x' } }).success).toBe(false);
    expect(AuthStatusSchema.safeParse({ ...STATUS, scopes: ['admin'] }).success).toBe(false);
    expect(AuthStatusSchema.safeParse({ ...STATUS, connection: 'revoked', account: null, scopes: [], expiresAt: null }).success).toBe(true);
  });

  it('carry describe\'s labels capped, three at most', () => {
    const option = (index: number) => ({ index, label: `Option ${index}` });
    expect(FieldDescribeAnswerSchema.safeParse({ options: [option(0), option(4), option(9)] }).success).toBe(true);
    expect(FieldDescribeAnswerSchema.safeParse({ options: [option(0), option(1), option(2), option(3)] }).success).toBe(false);
    expect(FieldDescribeAnswerSchema.safeParse({ options: [{ index: 0, label: 'x'.repeat(301) }] }).success).toBe(false);
    expect(FieldDescribeAnswerSchema.safeParse({ options: [{ index: 0, label: 'x', value: 'secret' }] }).success).toBe(false);
  });

  it('have the shapes the worker answers', () => {
    const answers = [
      [SettingsAnswerSchema, { settings: DEFAULT_SETTINGS }],
      [StartPairingAnswerSchema, { expiresAt: 1 }],
      [PanelSentAnswerSchema, { frames: 2 }],
      [TabReportsAnswerSchema, { tabId: 7, reports: [] }],
      [RunsClearAnswerSchema, { cleared: 0 }],
      [RunStateGetAnswerSchema, { runState: null }],
      [RunStatePutAnswerSchema, { updatedAt: 5 }],
      [DoneAnswerSchema, {}],
    ] as const;
    for (const [schema, data] of answers) {
      expect(answerSchema(schema).safeParse({ ok: true, data }).success).toBe(true);
      expect(answerSchema(schema).safeParse({ ok: false, error: 'expired' }).success).toBe(true);
      expect(answerSchema(schema).safeParse({ ok: true, data: { ...data, extra: 1 } }).success).toBe(false);
    }
  });
});
