/*
 * Eightfold's address reading (./url.ts; jr7 FIX7PLAN §6.15, Eightfold item 1: EFA-2), on the shapes of the owner's
 * snapshot7 capture twillio, with a made-up company and pid (no capture value): the posting, its form and the page
 * after submitting it share one key, two postings never do, and every page that names no posting reads as none.
 */
import { describe, expect, it } from 'vitest';
import { applicationKey } from '../application-key';
import { canonicalApplicationUrl, parseEightfoldUrl } from './url';

const PID = '1234567890123';
const FORM = `https://acme.eightfold.ai/careers/apply?pid=${PID}`;

describe('Eightfold addresses (EFA-2)', () => {
  it('reads the posting, the form and the page after submitting as one posting, keyed by its form', () => {
    const read = (at: string) => parseEightfoldUrl(new URL(at));
    expect(read(`https://acme.eightfold.ai/careers?start=0&pid=${PID}&sort_by=match&jr_id=x`)).toEqual({
      platform: 'eightfold', board: 'acme', jobId: PID, page: 'posting', applicationUrl: FORM });
    expect(read(`https://acme.eightfold.ai/careers/?pid=${PID}`)?.page).toBe('posting');
    expect(read(`https://acme.eightfold.ai/careers/job/${PID}`)).toEqual({
      platform: 'eightfold', board: 'acme', jobId: PID, page: 'posting', applicationUrl: FORM });
    expect(read(`${FORM}&jr_id=x`)).toEqual({ platform: 'eightfold', board: 'acme', jobId: PID, page: 'application',
      applicationUrl: FORM });
    expect(read(`https://acme.eightfold.ai/careers/apply/success?domain=acme.example&pid=${PID}`)).toEqual({
      platform: 'eightfold', board: 'acme', jobId: PID, page: 'confirmation', applicationUrl: FORM });
    expect(canonicalApplicationUrl(new URL(`${FORM}#main`))).toBe(FORM);
    expect(canonicalApplicationUrl(new URL(`https://acme.eightfold.ai/careers?pid=${PID}`))).toBeNull();
    expect(canonicalApplicationUrl(new URL(`https://acme.eightfold.ai/careers/apply/success?pid=${PID}`))).toBeNull();
  });

  it('never shares a key between two postings or two companies', () => {
    const keyOf = (at: string) => applicationKey('eightfold', parseEightfoldUrl(new URL(at))!.applicationUrl);
    const one = keyOf(FORM);
    expect(keyOf(`https://acme.eightfold.ai/careers?pid=${PID}`)).toBe(one);
    expect(keyOf('https://acme.eightfold.ai/careers/apply?pid=1234567890124')).not.toBe(one);
    expect(keyOf(`https://other.eightfold.ai/careers/apply?pid=${PID}`)).not.toBe(one);
  });

  it('reads no posting where the address names none or is no company career site', () => {
    for (const at of [
      'https://acme.eightfold.ai/careers', // the job list
      'https://acme.eightfold.ai/careers?query=engineer',
      'https://acme.eightfold.ai/careers/apply',
      `https://acme.eightfold.ai/careers/apply?pid=${PID}&pid=1`, // two postings
      'https://acme.eightfold.ai/careers/apply?pid=abc',
      `https://acme.eightfold.ai/careers/apply/other?pid=${PID}`,
      `https://acme.eightfold.ai/careers/dashboard?pid=${PID}`,
      `https://acme.eightfold.ai/careers/profile?pid=${PID}`,
      'https://acme.eightfold.ai/careers/job/abc',
      `https://acme.eightfold.ai/careerhub/explore?pid=${PID}`, // the employees' internal mobility
      `https://app.eightfold.ai/careers/apply?pid=${PID}`, // the recruiters' app
      `https://www.eightfold.ai/careers/apply?pid=${PID}`,
      `https://eightfold.ai/careers/apply?pid=${PID}`,
      `http://acme.eightfold.ai/careers/apply?pid=${PID}`,
      `https://acme.eightfold.ai:8443/careers/apply?pid=${PID}`,
      `https://u:p@acme.eightfold.ai/careers/apply?pid=${PID}`,
      `https://acme.eightfold.ai.example/careers/apply?pid=${PID}`,
    ]) {
      expect(parseEightfoldUrl(new URL(at)), at).toBeNull();
    }
  });
});
