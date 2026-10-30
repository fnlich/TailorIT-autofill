import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { genericAdapter } from './generic';
import { greenhouseAdapter } from './greenhouse';
import { adaptersFor, applicationOf } from './index';
import { leverAdapter } from './lever';
import { E2E_TEST_ADAPTER_MARKER, TRAP_09_URL } from './test';

const LEVER_JOB = 'https://jobs.lever.co/tailorit-fixture/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00';

describe('adaptersFor', () => {
  it('always ends with the generic adapter, so any form gets standard semantics', () => {
    for (const address of [`${LEVER_JOB}/apply`, 'https://job-boards.greenhouse.io/acme/jobs/4012345',
      'https://jobs.ashbyhq.com/acme/1b2c', 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x']) {
      expect(adaptersFor(new URL(address)).at(-1)).toBe(genericAdapter);
    }
  });

  it("puts the platform's own adapter first on its hosts, and only the generic one elsewhere", () => {
    for (const address of [`${LEVER_JOB}/apply`, LEVER_JOB, 'https://jobs.eu.lever.co/acme/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00/apply',
      'https://jobs.lever.co/tailorit-fixture/trap-01/apply']) {
      expect(adaptersFor(new URL(address)), address).toEqual([leverAdapter, genericAdapter]);
    }
    for (const address of ['https://job-boards.greenhouse.io/gitlab/jobs/8857185002',
      'https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002', 'https://boards.greenhouse.io/figma/jobs/5426468004']) {
      expect(adaptersFor(new URL(address)), address).toEqual([greenhouseAdapter, genericAdapter]);
    }
    for (const address of ['https://jobs.ashbyhq.com/acme/1b2c', 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x',
      'https://example.com/careers/apply', 'http://jobs.lever.co/acme/x/apply']) {
      expect(adaptersFor(new URL(address)), address).toEqual([genericAdapter]);
    }
  });
});

describe('adaptersFor in e2e builds (__E2E__)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offers no test adapter with the switch off, as in every production build', () => {
    expect(__E2E__).toBe(false);
    expect(adaptersFor(new URL(TRAP_09_URL))).toEqual([leverAdapter, genericAdapter]);
  });

  it("puts trap 09's test adapter first on the trap's page with the switch on, and nowhere else", () => {
    vi.stubGlobal('__E2E__', true);
    const [first, ...rest] = adaptersFor(new URL(`${TRAP_09_URL}?lever-source=e2e`));
    expect(first).toMatchObject({ id: 'generic', testOnly: E2E_TEST_ADAPTER_MARKER });
    expect(rest).toEqual([leverAdapter, genericAdapter]);
    for (const address of ['https://jobs.lever.co/tailorit-fixture/trap-01/apply', `${LEVER_JOB}/apply`,
      'https://job-boards.greenhouse.io/gitlab/jobs/8857185002']) {
      expect(adaptersFor(new URL(address)).some((adapter) => 'testOnly' in adapter), address).toBe(false);
    }
  });

  it('names its marker among the strings check-build refuses in a production bundle', () => {
    const script = readFileSync(fileURLToPath(new URL('../../scripts/check-build.mjs', import.meta.url)), 'utf8');
    const list = /const E2E_ONLY = \[([^\]]*)\]/.exec(script)?.[1] ?? '';
    expect(list).toContain(`'${E2E_TEST_ADAPTER_MARKER}'`);
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

  it('gives a Greenhouse job page and its embed one key', () => {
    const job = applicationOf(new URL('https://job-boards.greenhouse.io/gitlab/jobs/8857185002'))!;
    const embed = applicationOf(new URL('https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002'))!;
    expect(embed.applicationKey).toBe(job.applicationKey);
    expect(job.applicationKey).toMatch(/^greenhouse:[0-9a-f]{16}$/);
  });

  it('knows no application on a host outside the ATS list', () => {
    expect(applicationOf(new URL('https://example.com/careers/apply'))).toBeNull();
  });
});
