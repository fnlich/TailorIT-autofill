import { describe, expect, it } from 'vitest';
import { bundledVocab } from '../vocab/bundled.testkit';
import { EEO_QUESTIONS } from '../vocab/types';
import { isLoadingRow, isLoadingText, LOADING_OPTION_LEADS, LOADING_OPTION_PHRASES } from './loading';
import { normalize } from './normalize';

describe('loading rows', () => {
  it.each([
    'Loading', 'Loading...', 'Loading\u{2026}', 'LOADING', ' loading ', 'Fetching', 'Retrieving...', 'Searching...',
    'Updating', 'Updating...', 'Please wait', 'Please wait...', 'One moment', 'One moment please', 'Just a moment...',
    'Loading states...', 'Fetching cities\u{2026}', 'Retrieving options...', 'Searching for matches... ',
    'Loading states \u{2026}',
  ])('%s is one', (text) => {
    expect(isLoadingText(text)).toBe(true);
  });

  it.each([
    '', 'Texas', 'Select a state', 'Lodging', 'Load balancer', 'Loaded', 'Downloading', 'Searchlight', 'Wait',
    'Moment', 'Please select', 'Updated', 'Fetch', 'Searching for a new role', 'Updating my skills',
    'Loading dock supervisor', 'Fetching cities', 'Loading states', 'Loading states..', 'Searchlight...',
    'Updating my skills...',
  ])('%s is not', (text) => {
    expect(isLoadingText(text)).toBe(false);
  });

  it('takes a lead with an ellipsis anywhere after it, not only at the end (LC-7)', () => {
    for (const text of ['Loading... please wait', 'Loading\u{2026} please wait', 'Fetching... one moment',
      'Searching\u{2026} (this may take a while)', 'Retrieving states... Please wait']) {
      expect(isLoadingText(text), text).toBe(true);
    }
    for (const text of ['... Loading dock supervisor', 'Searching for a new role', 'Load... balancer']) {
      expect(isLoadingText(text), text).toBe(false);
    }
  });

  it('compares whole phrases with the words of their brackets kept (LC-12)', () => {
    for (const text of ['Searching (Actively)', 'Updating (my skills)', 'Searching [open to offers]']) {
      expect(isLoadingText(text), text).toBe(false);
      expect(isLoadingRow(text, normalize(text, 'answer').key), text).toBe(false);
    }
    for (const text of ['(Loading...)', '[Loading]', '(Please wait)', 'Loading (...)']) {
      expect(isLoadingText(text), text).toBe(true);
    }
  });

  it('reads a whole phrase by its key, and a lead only with a closing ellipsis on the label itself', () => {
    // Normalization drops the ellipsis, so isLoadingRow reads it from the label beside the caller's key.
    expect(normalize('Loading states...', 'answer').key).toBe(normalize('Loading states', 'answer').key);
    expect(isLoadingRow('Loading states...', 'loading states')).toBe(true);
    expect(isLoadingRow('Loading states', 'loading states')).toBe(false);
    expect(isLoadingRow('Please wait', 'please wait')).toBe(true);
    expect(isLoadingRow('Loading...', '')).toBe(false);
  });

  it('counts a lead only as a whole first word, and a lead alone as a phrase', () => {
    for (const lead of LOADING_OPTION_LEADS) {
      const key = normalize(lead, 'answer').key;
      expect(key, lead).toMatch(/^\S+$/);
      expect(LOADING_OPTION_PHRASES as readonly string[], lead).toContain(lead);
    }
    for (const phrase of LOADING_OPTION_PHRASES) expect(normalize(phrase, 'answer').key, phrase).not.toBe('');
  });

  it('never takes an answer the vocabulary knows, so marking loading rows unusable hides no real answer', () => {
    const { answers } = bundledVocab();
    const phrases = [answers.polarity.yes, answers.polarity.no, answers.decline, answers.exclusive, answers.other,
      ...EEO_QUESTIONS.map((question) => answers.eeo[question].decline)].flatMap((set) => set.phrases);
    const surfaces = [...answers.referral, ...EEO_QUESTIONS.flatMap((question) => answers.eeo[question].values)]
      .flatMap((entity) => entity.surfaces);
    expect(phrases.length + surfaces.length).toBeGreaterThan(100);
    expect([...phrases, ...surfaces].map((phrase) => phrase.text).filter(isLoadingText)).toEqual([]);
  });
});
