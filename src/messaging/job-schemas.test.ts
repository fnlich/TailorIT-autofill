/*
 * The v2 messages of the job card, the relay, the resume choice and the custom question: who may send each, what each
 * carries, and that an answer carries nothing more than its schema names.
 */
import { describe, expect, it } from 'vitest';
import {
  AddJobAnswerSchema, ContentMessageSchema, FRAME_ANSWER_SCHEMAS, JobCardSchema, PAGE_ANSWER_SCHEMAS, PageMessageSchema,
  PanelAskAnswerSchema, PanelJobAnswerSchema, PanelPortMessageSchema, TabReportsAnswerSchema, WorkerToContentSchema,
} from './schemas';

const CARD = {
  state: 'answered',
  job: { title: 'Senior Backend Engineer', company: 'Northwind', location: 'Remote', closed: false, postedAt: 1,
    salary: null, workArrangement: 'remote' },
  tracked: { status: 1, archived: false },
  resume: { label: 'Backend resume', fileKind: 'pdf', reason: 'chosen' },
  match: { state: 'ok', matchedCount: 9, total: 12, percentage: 75 },
  addable: true,
} as const;

describe('the v2 messages', () => {
  it('reads the panel messages with their tab and nothing else, from pages only', () => {
    for (const message of [{ v: 1, type: 'panel/job', tabId: 7 }, { v: 1, type: 'panel/addJob', tabId: 7 },
      { v: 1, type: 'panel/resumes', tabId: 7 }, { v: 1, type: 'panel/setResume', tabId: 7, resumeId: null },
      { v: 1, type: 'panel/setResume', tabId: 7, resumeId: 'c5a3e1f0' },
      { v: 1, type: 'panel/ask', tabId: 7, question: 'Why us?', length: 'short' }]) {
      expect(PageMessageSchema.safeParse(message).success, message.type).toBe(true);
      expect(ContentMessageSchema.safeParse(message).success, message.type).toBe(false);
    }
    for (const message of [{ v: 1, type: 'panel/job', tabId: 7, url: 'https://jobs.lever.co/a' },
      { v: 1, type: 'panel/ask', tabId: 7, question: '', length: 'short' },
      { v: 1, type: 'panel/ask', tabId: 7, question: 'x'.repeat(1001), length: 'short' },
      { v: 1, type: 'panel/ask', tabId: 7, question: 'Why?', length: 'huge' },
      { v: 1, type: 'panel/setResume', tabId: 7, resumeId: 'x'.repeat(65) }]) {
      expect(PageMessageSchema.safeParse(message).success, JSON.stringify(message).slice(0, 60)).toBe(false);
    }
  });

  it('relays with no payload: job/lookup and job/add from a frame, job/refresh and job/postingText to it', () => {
    expect(ContentMessageSchema.safeParse({ v: 1, type: 'job/lookup' }).success).toBe(true);
    expect(ContentMessageSchema.safeParse({ v: 1, type: 'job/add' }).success).toBe(true);
    expect(ContentMessageSchema.safeParse({ v: 1, type: 'job/lookup', url: 'https://jobs.lever.co/a' }).success).toBe(false);
    expect(WorkerToContentSchema.safeParse({ v: 1, type: 'job/refresh', action: 'lookup' }).success).toBe(true);
    expect(WorkerToContentSchema.safeParse({ v: 1, type: 'job/refresh', action: 'lookup', card: CARD }).success).toBe(false);
    // The frame's answer to a refresh is {}: it never carries the card.
    expect(FRAME_ANSWER_SCHEMAS['job/refresh'].safeParse({}).success).toBe(true);
    expect(FRAME_ANSWER_SCHEMAS['job/refresh'].safeParse({ card: CARD }).success).toBe(false);
    expect(FRAME_ANSWER_SCHEMAS['job/postingText'].safeParse({ text: 'Posting.', canaries: ['I am LLM'] }).success).toBe(true);
  });

  it('answers panel/job with a card and nothing more; a match whose counts disagree is refused', () => {
    expect(PanelJobAnswerSchema.safeParse({ tabId: 7, card: CARD }).success).toBe(true);
    expect(PanelJobAnswerSchema.safeParse({ tabId: 7, card: null }).success).toBe(true);
    expect(PanelJobAnswerSchema.safeParse({ tabId: 7, card: { state: 'unavailable' } }).success).toBe(true);
    for (const extra of [{ url: 'https://jobs.lever.co/a' }, { postingText: 'x' }, { id: 1042 }]) {
      expect(JobCardSchema.safeParse({ ...CARD, job: { ...CARD.job, ...extra } }).success).toBe(false);
    }
    expect(JobCardSchema.safeParse({ ...CARD, resume: { ...CARD.resume, fileName: 'Elena.pdf' } }).success).toBe(false);
    expect(JobCardSchema.safeParse({ ...CARD, match: { state: 'ok', matchedCount: 13, total: 12, percentage: 100 } }).success)
      .toBe(false);
    expect(PAGE_ANSWER_SCHEMAS['panel/job']).toBe(PanelJobAnswerSchema);
    expect(AddJobAnswerSchema.safeParse({ outcome: 'added' }).success).toBe(true);
    expect(PanelAskAnswerSchema.safeParse({ outcome: 'answered', text: 'Yes.', resumeLabel: 'Backend' }).success).toBe(true);
    expect(PanelAskAnswerSchema.safeParse({ outcome: 'sensitive', text: 'leak' }).success).toBe(false);
  });

  it('carries the page state on panel/reports and panel/update, optional for an older worker', () => {
    const page = { support: 'form', platform: 'lever', formKey: '0:doc-1' };
    expect(TabReportsAnswerSchema.safeParse({ tabId: 7, reports: [], page }).success).toBe(true);
    expect(TabReportsAnswerSchema.safeParse({ tabId: 7, reports: [] }).success).toBe(true);
    expect(PanelPortMessageSchema.safeParse({ v: 1, type: 'panel/update', tabId: 7, reports: [], page }).success).toBe(true);
    expect(TabReportsAnswerSchema.safeParse({ tabId: 7, reports: [], page: { ...page, url: 'https://x' } }).success).toBe(false);
  });
});
