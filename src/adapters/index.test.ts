import { describe, expect, it } from 'vitest';
import { genericAdapter } from './generic';
import { adaptersFor, applicationOf } from './index';

const LEVER_JOB = 'https://jobs.lever.co/tailorit-fixture/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00';

describe('adaptersFor', () => {
  it('always ends with the generic adapter, so any form gets standard semantics', () => {
    for (const address of [`${LEVER_JOB}/apply`, 'https://job-boards.greenhouse.io/acme/jobs/4012345',
      'https://jobs.ashbyhq.com/acme/1b2c', 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x']) {
      expect(adaptersFor(new URL(address)).at(-1)).toBe(genericAdapter);
    }
  });
});

describe('applicationOf', () => {
  it('gives a Lever posting page and its form one key', () => {
    const form = applicationOf(new URL(`${LEVER_JOB}/apply`))!;
    const posting = applicationOf(new URL(LEVER_JOB))!;
    expect(form.page).toBe('application');
    expect(posting.page).toBe('posting');
    expect(posting.applicationKey).toBe(form.applicationKey);
    expect(form.applicationKey).toMatch(/^lever:[0-9a-f]{16}$/);
  });

  it('keys an address its platform parser does not read by origin and path (a trap fixture)', () => {
    const trap = applicationOf(new URL('https://jobs.lever.co/tailorit-fixture/trap-01/apply?x=1#y'))!;
    expect(trap.page).toBe('application');
    expect(trap.applicationUrl).toBe('https://jobs.lever.co/tailorit-fixture/trap-01/apply');
    expect(trap.applicationKey).not.toBe(applicationOf(new URL('https://jobs.lever.co/tailorit-fixture/trap-02/apply'))!.applicationKey);
  });

  it('knows no application on a host outside the ATS list', () => {
    expect(applicationOf(new URL('https://example.com/careers/apply'))).toBeNull();
  });
});
