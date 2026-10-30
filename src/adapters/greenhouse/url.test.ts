/*
 * Greenhouse's URL parser on its own: which addresses are Greenhouse's, the job page, the embedded form and the legacy
 * host as one posting, and the canonical application URL. src/adapters/url.test.ts holds the table shared with Lever
 * and the contract's parseAtsUrl, and the application key.
 */
import { describe, expect, it } from 'vitest';
import { canonicalApplicationUrl, matchesUrl, parseGreenhouseUrl } from './url';

const GITLAB = 'https://job-boards.greenhouse.io/gitlab/jobs/8857185002';
const at = (address: string) => new URL(address);

describe('matchesUrl', () => {
  it.each([
    GITLAB, 'https://boards.greenhouse.io/figma/jobs/5426468004', 'https://job-boards.greenhouse.io/gitlab',
    'https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002', 'https://Job-Boards.GreenHouse.io/x',
  ])('takes every page on a Greenhouse host: %s', (address) => {
    expect(matchesUrl(at(address))).toBe(true);
  });

  it.each([
    'http://job-boards.greenhouse.io/gitlab/jobs/8857185002', 'https://about.gitlab.com/jobs/apply/?gh_jid=8857185002',
    'https://job-boards.eu.greenhouse.io/gitlab/jobs/8857185002', 'https://boards.eu.greenhouse.io/gitlab/jobs/8857185002',
    'https://greenhouse.io/gitlab/jobs/8857185002', 'https://api.greenhouse.io/v1/boards/gitlab/jobs/8857185002',
    'https://job-boards.greenhouse.io.tailorit-fixture.example/gitlab/jobs/1', 'https://job-boards.greenhouse.io:8443/x',
    'https://user:secret@job-boards.greenhouse.io/gitlab/jobs/8857185002', 'https://jobs.lever.co/spotify',
  ])('refuses %s', (address) => {
    expect(matchesUrl(at(address))).toBe(false);
  });
});

describe('parseGreenhouseUrl', () => {
  it('reads the job page and the embedded form as one posting, with one application URL', () => {
    const posting = { platform: 'greenhouse', jobId: '8857185002', page: 'application', applicationUrl: GITLAB };
    expect(parseGreenhouseUrl(at(GITLAB))).toEqual({ ...posting, board: 'gitlab' });
    expect(parseGreenhouseUrl(at('https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002')))
      .toEqual({ ...posting, board: 'gitlab' });
  });

  it('reads the legacy host as job-boards, which it redirects to', () => {
    expect(parseGreenhouseUrl(at('https://boards.greenhouse.io/figma/jobs/5426468004'))).toEqual({ platform: 'greenhouse',
      board: 'figma', jobId: '5426468004', page: 'application',
      applicationUrl: 'https://job-boards.greenhouse.io/figma/jobs/5426468004' });
    expect(parseGreenhouseUrl(at('https://boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002'))?.applicationUrl)
      .toBe(GITLAB);
  });

  it('ignores the query, the fragment and one trailing slash, and folds the board in the application URL', () => {
    for (const address of [`${GITLAB}?gh_src=8c3a3c4f1us&utm_source=LinkedIn`, `${GITLAB}#app`, `${GITLAB}/`,
      'https://Job-Boards.GreenHouse.io/GitLab/jobs/8857185002']) {
      expect(parseGreenhouseUrl(at(address))?.applicationUrl, address).toBe(GITLAB);
    }
    expect(parseGreenhouseUrl(at('https://job-boards.greenhouse.io/GitLab/jobs/8857185002'))?.board).toBe('GitLab');
  });

  it("reads the embed's parameters in any order and case, and keys an embed that names no board by its id", () => {
    expect(parseGreenhouseUrl(at('https://job-boards.greenhouse.io/embed/job_app?Token=8857185002&FOR=gitlab')))
      .toMatchObject({ board: 'gitlab', jobId: '8857185002', applicationUrl: GITLAB });
    for (const query of ['token=8857185002', 'for=git%20lab&token=8857185002', 'for=&token=8857185002']) {
      expect(parseGreenhouseUrl(at(`https://job-boards.greenhouse.io/embed/job_app?${query}`)), query).toEqual({
        platform: 'greenhouse', board: null, jobId: '8857185002', page: 'application',
        applicationUrl: 'https://job-boards.greenhouse.io/embed/job_app?token=8857185002' });
    }
    expect(parseGreenhouseUrl(at('https://job-boards.greenhouse.io/embed/job_app?token=1&token=2'))?.jobId).toBe('1');
  });

  it.each([
    'https://job-boards.greenhouse.io/gitlab', 'https://job-boards.greenhouse.io/gitlab?gh_jid=8857185002',
    'https://job-boards.greenhouse.io/gitlab/jobs/abc', 'https://job-boards.greenhouse.io/gitlab/jobs',
    `${GITLAB}/confirmation`, 'https://job-boards.greenhouse.io/gitlab/job/8857185002',
    'https://job-boards.greenhouse.io/embed/job_app?for=gitlab', 'https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=12a',
    'https://job-boards.greenhouse.io/embed/job_board?for=gitlab', 'https://job-boards.greenhouse.io/git.lab/jobs/1',
    'https://about.gitlab.com/jobs/apply/?gh_jid=8857185002', 'https://job-boards.eu.greenhouse.io/gitlab/jobs/8857185002',
  ])('reads no posting from %s', (address) => {
    expect(parseGreenhouseUrl(at(address))).toBeNull();
  });
});

describe('canonicalApplicationUrl', () => {
  it('is the job page address for the job page and the embed, and null elsewhere', () => {
    expect(canonicalApplicationUrl(at(`${GITLAB}?gh_src=x`))).toBe(GITLAB);
    expect(canonicalApplicationUrl(at('https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002'))).toBe(GITLAB);
    expect(canonicalApplicationUrl(at('https://job-boards.greenhouse.io/gitlab'))).toBeNull();
    expect(canonicalApplicationUrl(at('https://about.gitlab.com/jobs/apply/?gh_jid=8857185002'))).toBeNull();
  });
});
