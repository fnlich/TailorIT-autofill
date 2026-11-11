/*
 * jr6 apply A0: the contract of "Autofill presses the site's own Apply" (the owner, 2026-11-10; the session's jr6
 * APPLYPLAN §5 A0, "Tests"). frame/wall and PageState take `entering` and `refusal`; entry/pressed carries the
 * destination's application key at most; a refusal rides only beside entryRefused; nothing else rides along.
 */
import { describe, expect, it } from 'vitest';
import { LOG_CODES } from '../shared/log';
import { answerSchema } from './envelope';
import { TabReportsAnswerSchema, PageMessageSchema } from './page-schemas';
import {
  CONTENT_ANSWER_SCHEMAS, ContentMessageSchema, DoneAnswerSchema, ENTRY_REFUSALS, PageStateSchema, WorkerToContentSchema,
} from './schemas';

const parses = (message: unknown) => ContentMessageSchema.safeParse(message).success;
const wall = { v: 1, type: 'frame/wall', wall: null } as const;
const posting = { support: 'no-form', platform: 'workday', formKey: null, posting: true, entry: true } as const;

describe('ENTRY_REFUSALS (jr6 apply A0)', () => {
  it('names the six reasons the panel says, in the plan\'s order', () => {
    expect(ENTRY_REFUSALS).toEqual(['none', 'ambiguous', 'blocked', 'new-tab', 'elsewhere', 'nothing-followed']);
  });
});

describe('frame/wall\'s entering and refusal (jr6 apply A0)', () => {
  it('takes entering while the frame presses or waits, beside entry or alone', () => {
    expect(parses({ ...wall, entering: true })).toBe(true);
    expect(parses({ ...wall, entry: true, entering: true })).toBe(true);
    // A flag, never a value or a reason.
    expect(parses({ ...wall, entering: false })).toBe(false);
    expect(parses({ ...wall, entering: 'pressing' })).toBe(false);
  });

  it('takes each refusal beside entryRefused', () => {
    for (const refusal of ENTRY_REFUSALS) {
      expect(parses({ ...wall, entryRefused: true, refusal }), refusal).toBe(true);
      expect(parses({ ...wall, entry: true, entryRefused: true, refusal }), `${refusal} with entry`).toBe(true);
    }
    // entryRefused alone stays as it was (v5 p2-fill review L5).
    expect(parses({ ...wall, entryRefused: true })).toBe(true);
  });

  it('refuses a refusal without entryRefused, and one the list does not name', () => {
    for (const refusal of ENTRY_REFUSALS) {
      expect(parses({ ...wall, refusal }), refusal).toBe(false);
      expect(parses({ ...wall, entering: true, refusal }), `${refusal} while entering`).toBe(false);
    }
    expect(parses({ ...wall, entryRefused: true, refusal: 'other' })).toBe(false);
    expect(parses({ ...wall, entryRefused: true, refusal: '' })).toBe(false);
    expect(parses({ ...wall, entryRefused: true, refusal: null })).toBe(false);
  });

  it('refuses unknown fields beside them', () => {
    expect(parses({ ...wall, entryRefused: true, refusal: 'new-tab', target: '_blank' })).toBe(false);
    expect(parses({ ...wall, entering: true, nextKey: 'workday:0123456789abcdef' })).toBe(false);
    expect(parses({ ...wall, entering: true, url: 'https://example.com/apply' })).toBe(false);
  });
});

describe('PageState\'s entering and refusal (jr6 apply A0)', () => {
  const page = (extra: Record<string, unknown>) => PageStateSchema.safeParse({ ...posting, ...extra }).success;

  it('takes entering, and each refusal beside entryRefused', () => {
    expect(page({})).toBe(true);
    expect(page({ entering: true })).toBe(true);
    for (const refusal of ENTRY_REFUSALS) expect(page({ entryRefused: true, refusal }), refusal).toBe(true);
    // Both at once parse (the panel's F1 decides what shows); the worker clears the refusal at the next press.
    expect(page({ entering: true, entryRefused: true, refusal: 'nothing-followed' })).toBe(true);
  });

  it('refuses a refusal without entryRefused, a flag that is not true, and unknown fields', () => {
    for (const refusal of ENTRY_REFUSALS) expect(page({ refusal }), refusal).toBe(false);
    expect(page({ entryRefused: true, refusal: 'somewhere' })).toBe(false);
    expect(page({ entering: false })).toBe(false);
    expect(page({ entryRefused: true, refusal: 'elsewhere', host: 'example.com' })).toBe(false);
    expect(page({ entering: true, pressedAt: 1 })).toBe(false);
  });

  it('reaches the panel inside a tab\'s reports, and a bad one fails the answer', () => {
    const answer = (extra: Record<string, unknown>) => answerSchema(TabReportsAnswerSchema)
      .safeParse({ ok: true, data: { tabId: 7, reports: [], page: { ...posting, ...extra } } }).success;
    expect(answer({ entering: true })).toBe(true);
    expect(answer({ entryRefused: true, refusal: 'elsewhere' })).toBe(true);
    expect(answer({ refusal: 'elsewhere' })).toBe(false);
  });
});

describe('entry/pressed (jr6 apply A0)', () => {
  const pressed = { v: 1, type: 'entry/pressed' } as const;

  it('takes the press with and without the destination\'s application key', () => {
    expect(parses(pressed)).toBe(true);
    expect(parses({ ...pressed, nextKey: 'smartrecruiters:0123456789abcdef' })).toBe(true);
    expect(parses({ ...pressed, nextKey: 'site:fedcba9876543210' })).toBe(true);
  });

  it('refuses a nextKey that is no key', () => {
    for (const nextKey of ['', 'workday', 'workday:', 'workday:0123456789abcde', 'workday:0123456789abcdef0',
      'workday:0123456789ABCDEF', 'workday:0123456789abcdeg', 'nowhere:0123456789abcdef', 'Workday:0123456789abcdef',
      ' workday:0123456789abcdef', 'workday:0123456789abcdef\n', 'https://example.myworkdayjobs.com/apply',
      '/en-US/careers/job/apply', 'doc:1:2:x']) {
      expect(parses({ ...pressed, nextKey }), JSON.stringify(nextKey)).toBe(false);
    }
    expect(parses({ ...pressed, nextKey: null })).toBe(false);
    expect(parses({ ...pressed, nextKey: 7 })).toBe(false);
  });

  it('refuses unknown fields: never an address, a frame, a reason or a word', () => {
    const key = { ...pressed, nextKey: 'lever:0123456789abcdef' };
    expect(parses({ ...key, url: 'https://jobs.lever.co/x/y/apply' })).toBe(false);
    expect(parses({ ...key, frameId: 0 })).toBe(false);
    expect(parses({ ...key, refusal: 'new-tab' })).toBe(false);
    expect(parses({ ...key, label: 'Apply' })).toBe(false);
    expect(parses({ ...pressed, v: 2 })).toBe(false);
  });

  it('is answered {} and rides the content channel only', () => {
    expect(CONTENT_ANSWER_SCHEMAS['entry/pressed']).toBe(DoneAnswerSchema);
    expect(answerSchema(CONTENT_ANSWER_SCHEMAS['entry/pressed']).safeParse({ ok: true, data: {} }).success).toBe(true);
    expect(answerSchema(CONTENT_ANSWER_SCHEMAS['entry/pressed']).safeParse({ ok: false, error: 'not_implemented' })
      .success).toBe(true);
    expect(answerSchema(CONTENT_ANSWER_SCHEMAS['entry/pressed']).safeParse({ ok: true, data: { armed: true } }).success)
      .toBe(false);
    expect(WorkerToContentSchema.safeParse(pressed).success).toBe(false);
    expect(PageMessageSchema.safeParse(pressed).success).toBe(false);
  });
});

describe('the log codes (jr6 apply A0)', () => {
  it('hold the entry\'s, the grant\'s and the queue\'s codes, and keep content.open-application until integration', () => {
    for (const code of ['content.entry', 'content.entry-step', 'grant.armed', 'grant.step', 'grant.ended',
      'queue.entry-timeout', 'content.open-application']) {
      expect(LOG_CODES, code).toContain(code);
    }
    expect(new Set(LOG_CODES).size).toBe(LOG_CODES.length);
  });
});
