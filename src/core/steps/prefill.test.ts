import { describe, expect, it } from 'vitest';
import type { CurrentValue } from '../types/field';
import { isStructured, reconcilePrefill, type PrefillField } from './prefill';

const text = (value: string): CurrentValue => ({ kind: 'text', text: value });
const EMPTY: CurrentValue = { kind: 'empty' };
const company: PrefillField = { category: 'experience.company', kind: 'text' };
const description: PrefillField = { category: 'experience.description', kind: 'textarea' };

describe('reconcilePrefill', () => {
  it('fills an empty field', () => {
    expect(reconcilePrefill(company, EMPTY, { kind: 'text', text: 'Initech' }))
      .toEqual({ action: 'fill', reason: 'ok', flagged: false });
    expect(reconcilePrefill(company, text('   '), { kind: 'text', text: 'Initech' }).action).toBe('fill');
  });

  it('keeps a field that already holds the profile\'s answer (already-correct), as the field would show it', () => {
    expect(reconcilePrefill(company, text('  initech '), { kind: 'text', text: 'Initech' }))
      .toEqual({ action: 'keep', reason: 'already-correct', flagged: false });
    const phone: PrefillField = { category: 'contact.phone', kind: 'text' };
    expect(reconcilePrefill(phone, text('(512) 555-0123'), { kind: 'text', text: '512.555.0123' }).reason)
      .toBe('already-correct');
    const start: PrefillField = { category: 'experience.startDate', kind: 'text' };
    expect(reconcilePrefill(start, text('03/2021'), { kind: 'date', iso: '2021-03' }).reason).toBe('already-correct');
    expect(reconcilePrefill(start, text('2021-3-15'), { kind: 'date', iso: '2021-03-15' }).reason).toBe('already-correct');
  });

  it('overwrites a structured field that differs, and flags the conflict: the profile wins', () => {
    expect(reconcilePrefill(company, text('Initrode'), { kind: 'text', text: 'Initech' }))
      .toEqual({ action: 'overwrite', reason: 'prefill-conflict', flagged: true });
    const start: PrefillField = { category: 'experience.startDate', kind: 'text' };
    expect(reconcilePrefill(start, text('04/2021'), { kind: 'date', iso: '2021-03' }))
      .toEqual({ action: 'overwrite', reason: 'prefill-conflict', flagged: true });
    // A spelling it cannot read as a date is a conflict too: flagged, never taken for the same.
    expect(reconcilePrefill(start, text('Spring 2021'), { kind: 'date', iso: '2021-03' }).action).toBe('overwrite');
  });

  it('keeps prose the site filled in, and flags it', () => {
    expect(reconcilePrefill(description, text('Built the TPS report pipeline.'), { kind: 'text', text: 'Led reporting.' }))
      .toEqual({ action: 'keep', reason: 'prefill-kept', flagged: true });
    const why: PrefillField = { category: 'freeText.whyCompany', kind: 'text' };
    expect(reconcilePrefill(why, text('Because.'), { kind: 'text', text: 'Mission.' }).action).toBe('keep');
  });

  it('a single choice is structured: another choice is overwritten and flagged, the same kept', () => {
    const degree: PrefillField = { category: 'education.degree', kind: 'select' };
    expect(reconcilePrefill(degree, { kind: 'selected', labels: ["Master's"] }, { kind: 'choice', label: "Bachelor's" }))
      .toEqual({ action: 'overwrite', reason: 'prefill-conflict', flagged: true });
    expect(reconcilePrefill(degree, { kind: 'selected', labels: ["bachelor's"] }, { kind: 'choice', label: "Bachelor's" }))
      .toEqual({ action: 'keep', reason: 'already-correct', flagged: false });
    expect(reconcilePrefill(degree, { kind: 'selected', labels: [] }, { kind: 'choice', label: "Bachelor's" }).action)
      .toBe('fill');
  });

  it('never unticks: a box the profile would not tick is kept and flagged', () => {
    const box: PrefillField = { category: 'experience.current', kind: 'checkbox' };
    const ticked: CurrentValue = { kind: 'checked', checked: true };
    const clear: CurrentValue = { kind: 'checked', checked: false };
    expect(reconcilePrefill(box, ticked, { kind: 'check', checked: false }))
      .toEqual({ action: 'keep', reason: 'unexpected-selection', flagged: true });
    expect(reconcilePrefill(box, ticked, { kind: 'check', checked: true }).reason).toBe('already-correct');
    expect(reconcilePrefill(box, clear, { kind: 'check', checked: true }).action).toBe('fill');
    expect(reconcilePrefill(box, clear, { kind: 'check', checked: false })).toEqual({ action: 'keep',
      reason: 'already-correct', flagged: false });
  });

  it('adds only a set\'s missing answers, so nothing is chosen twice, and never takes one away', () => {
    const langs: PrefillField = { category: 'languages.language', kind: 'multiselect' };
    const held = (labels: string[]): CurrentValue => ({ kind: 'selected', labels });
    expect(reconcilePrefill(langs, held(['English']), { kind: 'choices', labels: ['English', 'Spanish'] }))
      .toEqual({ action: 'add', reason: 'ok', flagged: false });
    expect(reconcilePrefill(langs, held(['spanish', 'English']), { kind: 'choices', labels: ['English', 'Spanish'] }))
      .toEqual({ action: 'keep', reason: 'already-correct', flagged: false });
    expect(reconcilePrefill(langs, held(['French']), { kind: 'choices', labels: ['English'] }))
      .toEqual({ action: 'add', reason: 'unexpected-selection', flagged: true });
    expect(reconcilePrefill(langs, held(['French', 'English']), { kind: 'choices', labels: ['English'] }))
      .toEqual({ action: 'keep', reason: 'unexpected-selection', flagged: true });
    expect(reconcilePrefill(langs, held([]), { kind: 'choices', labels: ['English'] }).action).toBe('fill');
  });

  it('keeps an upload already there, and flags it', () => {
    const resume: PrefillField = { category: 'file.resume', kind: 'file' };
    expect(reconcilePrefill(resume, { kind: 'files', count: 1 }, { kind: 'file' }))
      .toEqual({ action: 'keep', reason: 'prefill-kept', flagged: true });
    expect(reconcilePrefill(resume, { kind: 'files', count: 0 }, { kind: 'file' }).action).toBe('fill');
  });

  it('decides from the field alone: its decision holds no value', () => {
    const decision = reconcilePrefill(company, text('Initrode'), { kind: 'text', text: 'Initech' });
    expect(JSON.stringify(decision)).not.toMatch(/initrode|initech/i);
  });
});

describe('isStructured', () => {
  it('is everything but prose: a textarea, a free-text question, a job\'s description', () => {
    expect(isStructured(company)).toBe(true);
    expect(isStructured({ category: 'contact.email', kind: 'text' })).toBe(true);
    expect(isStructured(description)).toBe(false);
    expect(isStructured({ category: 'experience.description', kind: 'text' })).toBe(false);
    expect(isStructured({ category: 'freeText.coverLetter', kind: 'text' })).toBe(false);
    expect(isStructured({ category: 'unknown', kind: 'textarea' })).toBe(false);
  });
});
