/*
 * Saved answers in the worker (Phase 6, wave 2): TailorIT's list mapped for the core (saved-answers.ts), read with the
 * profile into memory only and dropped with it (profile-cache.ts), and the company a frame's address names.
 */
import { describe, expect, it } from 'vitest';
import { AutofillSavedAnswerListSchema, type AutofillSavedAnswer } from '../contract/tailorit';
import { createProfileCache } from './profile-cache';
import { companyOfUrl, savedAnswerOf, savedAnswersOf, scopeOf } from './saved-answers';
import { createServerClient } from './server-client';
import { manualTimers } from './timers';
import { createFakeTailorIT, fakeCore, GOLDEN_TOKEN, ORIGIN, START_MS } from './worker.testkit';
import golden from '../contract/tailorit/v1/fixtures/AutofillSavedAnswerList/valid/golden.json';

const LIST = AutofillSavedAnswerListSchema.parse(golden);
const ANSWERS = 'GET /api/autofill/answers';
const PROFILE = 'GET /api/autofill/profile';

function cache() {
  const tailorit = createFakeTailorIT();
  const timers = manualTimers();
  const server = createServerClient({
    origin: ORIGIN,
    platform: { fetch: tailorit.fetch, timeout: () => new AbortController().signal, now: () => START_MS },
    token: async () => GOLDEN_TOKEN,
    onUnauthorized: async () => undefined,
    onVersion: () => undefined,
  });
  return { profiles: createProfileCache({ server, timers, core: fakeCore(), now: () => START_MS }), tailorit, timers };
}

describe("TailorIT's saved answers, as the core reads them", () => {
  it("maps the key, '' as 'none', the scope, labels (never indices), text and checked, and the time", () => {
    const [text, select, checked, group] = savedAnswersOf(LIST.items);
    expect(text).toEqual({ id: LIST.items[0]!.id, labelKey: 'why do you want to work at northwind', optionSetHash: 'none',
      kind: 'textarea', scope: { kind: 'company', platform: 'greenhouse', board: 'northwind' },
      question: 'Why do you want to work at Northwind?', answer: { kind: 'text', text: LIST.items[0]!.answer.kind === 'text'
        ? LIST.items[0]!.answer.text : '' }, updatedAt: Date.parse('2026-10-22T12:00:00.000Z') });
    expect(select).toMatchObject({ optionSetHash: '9f2c4e6a8b0d1357', scope: { kind: 'global' },
      answer: { kind: 'options', labels: ['Company website'] } });
    expect(checked).toMatchObject({ kind: 'checkbox', answer: { kind: 'checked', checked: true } });
    expect(group).toMatchObject({ kind: 'checkbox-group', answer: { kind: 'options', labels: ['Austin', 'Remote (US)'] } });
  });

  it('drops an answer to a sensitive or attention-check question, whatever TailorIT holds', () => {
    const base = LIST.items[1]!;
    const asked = (questionLabel: string): AutofillSavedAnswer => ({ ...base, questionLabel,
      questionKey: questionLabel.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim() });
    for (const question of ['What is your gender?', 'Will you require visa sponsorship?', 'What are your salary expectations?',
      'Please select Purple to show you read this.']) {
      expect(savedAnswerOf(asked(question)), question).toBeNull();
    }
    expect(savedAnswerOf(asked('How did you hear about this job?'))).not.toBeNull();
  });

  it('names the company of a Lever, Greenhouse or Ashby address by its board, in lower case; none for the rest', () => {
    expect(companyOfUrl('https://jobs.lever.co/Northwind/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00/apply'))
      .toEqual({ platform: 'lever', board: 'northwind' });
    expect(companyOfUrl('https://job-boards.greenhouse.io/acme/jobs/4012345')).toEqual({ platform: 'greenhouse', board: 'acme' });
    expect(scopeOf({ platform: 'greenhouse', board: 'acme' })).toBe('greenhouse:acme');
    expect(companyOfUrl('https://jobs.ashbyhq.com/OpenAI/d4780eac-03ad-4dae-861f-99af22b4287e/application?embed=js'))
      .toEqual({ platform: 'ashby', board: 'openai' });
    for (const address of ['https://job-boards.greenhouse.io/embed/job_app?token=4012345',
      'https://jobs.lever.co/tailorit-fixture/trap-01/apply', 'https://jobs.ashbyhq.com/acme/1', 'not an address']) {
      expect(companyOfUrl(address), address).toBeNull();
    }
    // Workable (TailorIT's API 4): its account, in lower case.
    expect(companyOfUrl('https://apply.workable.com/HuggingFace/j/F88446C814/apply/'))
      .toEqual({ platform: 'workable', board: 'huggingface' });
  });
});

describe('the profile cache and saved answers', () => {
  it('reads them with the profile, keeps them in memory, and drops them with it', async () => {
    const { profiles, tailorit } = cache();
    tailorit.reply(ANSWERS, { json: golden });
    const loaded = await profiles.refresh();
    expect(loaded.ok && loaded.value.savedAnswers.map((answer) => answer.id)).toEqual(LIST.items.map((item) => item.id));
    expect([tailorit.count(PROFILE), tailorit.count(ANSWERS)]).toEqual([1, 1]);
    expect(await profiles.get()).toEqual(loaded);
    expect(tailorit.count(ANSWERS)).toBe(1);
    profiles.drop();
    expect(profiles.holding).toBe(false);
    await profiles.get();
    expect(tailorit.count(ANSWERS)).toBe(2);
  });

  it('plans with none when they cannot be read, and the profile still loads', async () => {
    const { profiles, tailorit } = cache();
    tailorit.reply(ANSWERS, { status: 500, json: { error: { code: 'internal', message: 'No.' } } });
    const loaded = await profiles.refresh();
    expect(loaded).toMatchObject({ ok: true, value: { savedAnswers: [] } });
  });

  it('keeps them across the sensitive part being read', async () => {
    const { profiles, tailorit } = cache();
    tailorit.reply(ANSWERS, { json: golden });
    await profiles.refresh();
    expect(await profiles.loadSensitive()).toBe('loaded');
    const loaded = await profiles.get();
    expect(loaded.ok && loaded.value.savedAnswers).toHaveLength(LIST.items.length);
  });
});
