import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { answerSchema } from './envelope';
import {
  AuthStatusSchema,
  ContentMessageSchema,
  DoneAnswerSchema,
  FieldDescribeAnswerSchema,
  FRAME_ANSWER_SCHEMAS,
  PAGE_ANSWER_SCHEMAS,
  PageMessageSchema,
  PanelPortMessageSchema,
  PanelSentAnswerSchema,
  RunsClearAnswerSchema,
  RunStateGetAnswerSchema,
  RunStatePutAnswerSchema,
  SettingsAnswerSchema,
  StartPairingAnswerSchema,
  TabReportsAnswerSchema,
  WorkerToContentSchema,
  WriteValueSchema,
} from './schemas';

const STATUS = {
  connection: 'connected',
  account: { name: 'Elena Ruiz', email: 'elena.ruiz@example.com' },
  scopes: ['profile:read', 'jobs:lookup'],
  expiresAt: 1_800_000_000_000,
  storageAccess: 'restricted',
  versionMismatch: false,
  pairingExpiresAt: null,
} as const;

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
