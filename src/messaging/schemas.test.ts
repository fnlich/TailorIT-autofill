import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { answerSchema } from './envelope';
import {
  AuthStatusSchema,
  ContentMessageSchema,
  DoneAnswerSchema,
  FieldDescribeAnswerSchema,
  PageMessageSchema,
  PanelPortMessageSchema,
  PanelSentAnswerSchema,
  RunsClearAnswerSchema,
  RunStateGetAnswerSchema,
  RunStatePutAnswerSchema,
  SettingsAnswerSchema,
  StartPairingAnswerSchema,
  TabReportsAnswerSchema,
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
