/*
 * JobDiva's address reading (./url.ts; jr7 FIX7PLAN §6.15, JobDiva item 2: JDV-2 with JDV-V4), on the shapes of the
 * owner's snapshot7 captures jobdiva1 and jobdiva2, with made-up keys and ids (no capture value): one key per job and
 * agency, the posting and its form alike, the fragment's own query and the older link's query left out, and every page
 * that names no job read as none.
 */
import { describe, expect, it } from 'vitest';
import { applicationKey } from '../application-key';
import { canonicalApplicationUrl, parseJobDivaUrl } from './url';

/** Two agencies' portal keys (made up, 64 letters and digits as the captures' are). */
const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER_KEY = '0f9e8d7c6b5a49382716f0e9d8c7b6a50f9e8d7c6b5a49382716f0e9d8c7b6a5';
const canonical = (host: string, key: string, id: string) => `https://${host}/portal/?a=${key}#/jobs/${id}`;

describe('JobDiva addresses (JDV-2, JDV-V4)', () => {
  it('reads a portal job as its application, keyed by the host, the agency and the job', () => {
    const at = `https://www1.jobdiva.com/portal/?a=${KEY}#/jobs/12345678`;
    expect(parseJobDivaUrl(new URL(at))).toEqual({ platform: 'jobdiva', board: KEY, jobId: '12345678',
      page: 'application', applicationUrl: canonical('www1.jobdiva.com', KEY, '12345678') });
    expect(canonicalApplicationUrl(new URL(at))).toBe(canonical('www1.jobdiva.com', KEY, '12345678'));
  });

  it("drops Jobright's jr_id, the fragment's own query, a later route number and the older link's query", () => {
    const want = canonical('www2.jobdiva.com', KEY, '12345678');
    for (const at of [
      `https://www2.jobdiva.com/portal/?a=${KEY}&jr_id=abc#/jobs/12345678`,
      `https://www2.jobdiva.com/portal/?a=${KEY}#/jobs/12345678?jobtitle=Some%20Role`,
      `https://www2.jobdiva.com/portal/?a=${KEY}#/jobs/12345678/2`,
      `https://www2.jobdiva.com/portal/?a=${KEY}#/jobs/12345678/`,
      // jobdiva2's shape: the older link's parameters before the fragment, its id the fragment's job.
      `https://www2.jobdiva.com/portal/?a=${KEY}&SearchString=&StatesString=&source=x&id=12345678&compid=-1#/jobs/12345678`,
      `https://www2.jobdiva.com/portal?a=${KEY}#/jobs/12345678`,
    ]) {
      expect(canonicalApplicationUrl(new URL(at)), at).toBe(want);
    }
  });

  it('JDV-V4: with no route in the fragment the query names the job; the legacy job page names its posting', () => {
    const want = canonical('www2.jobdiva.com', KEY, '12345678');
    expect(canonicalApplicationUrl(new URL(`https://www2.jobdiva.com/portal/?a=${KEY}&id=12345678&compid=-1`))).toBe(want);
    expect(canonicalApplicationUrl(new URL(`https://www2.jobdiva.com/portal/?a=${KEY}&id=12345678#`))).toBe(want);
    const legacy = parseJobDivaUrl(new URL(`https://www2.jobdiva.com/candidates/myjobs/openjob.jsp?a=${KEY}&id=12345678`));
    expect(legacy).toEqual({ platform: 'jobdiva', board: KEY, jobId: '12345678', page: 'posting', applicationUrl: want });
    expect(canonicalApplicationUrl(new URL(`https://www2.jobdiva.com/candidates/myjobs/openjob.jsp?a=${KEY}&id=12345678`)))
      .toBeNull();
  });

  it('never shares a key between two jobs, two agencies or two hosts', () => {
    const keyOf = (at: string) => applicationKey('jobdiva', canonicalApplicationUrl(new URL(at))!);
    const one = keyOf(`https://www2.jobdiva.com/portal/?a=${KEY}#/jobs/12345678`);
    expect(keyOf(`https://www2.jobdiva.com/portal/?a=${KEY}&id=12345678`)).toBe(one);
    expect(keyOf(`https://www2.jobdiva.com/portal/?a=${KEY}#/jobs/12345679`)).not.toBe(one);
    expect(keyOf(`https://www2.jobdiva.com/portal/?a=${OTHER_KEY}#/jobs/12345678`)).not.toBe(one);
    expect(keyOf(`https://www1.jobdiva.com/portal/?a=${KEY}#/jobs/12345678`)).not.toBe(one);
  });

  it('reads no job where the address names none, routes elsewhere or is no candidate portal', () => {
    for (const at of [
      `https://www2.jobdiva.com/portal/?a=${KEY}`, // the agency's job list
      `https://www2.jobdiva.com/portal/?a=${KEY}#/`,
      `https://www2.jobdiva.com/portal/?a=${KEY}#/login`,
      `https://www2.jobdiva.com/portal/?a=${KEY}&id=12345678#/signup`, // a route that is no job, whatever the query
      `https://www2.jobdiva.com/portal/?a=${KEY}#/jobs/`,
      `https://www2.jobdiva.com/portal/?a=${KEY}#/jobs/abc`,
      `https://www2.jobdiva.com/portal/?a=${KEY}&a=${OTHER_KEY}#/jobs/12345678`, // two agencies
      `https://www2.jobdiva.com/portal/?a=${KEY}&id=1&id=2`, // two jobs
      'https://www2.jobdiva.com/portal/?a=short#/jobs/12345678',
      `https://www2.jobdiva.com/portal/?a=${KEY}%21#/jobs/12345678`,
      `https://www2.jobdiva.com/portal/#/jobs/12345678`, // no agency
      `https://www2.jobdiva.com/portal/jobs?a=${KEY}#/jobs/12345678`,
      `https://www2.jobdiva.com/employers/login.jsp?a=${KEY}&id=12345678`,
      `https://app.jobdiva.com/portal/?a=${KEY}#/jobs/12345678`,
      `https://www123.jobdiva.com/portal/?a=${KEY}#/jobs/12345678`,
      `http://www2.jobdiva.com/portal/?a=${KEY}#/jobs/12345678`,
      `https://www2.jobdiva.com:8443/portal/?a=${KEY}#/jobs/12345678`,
      `https://user:pw@www2.jobdiva.com/portal/?a=${KEY}#/jobs/12345678`,
      `https://www2.jobdiva.com.example/portal/?a=${KEY}#/jobs/12345678`,
    ]) {
      expect(parseJobDivaUrl(new URL(at)), at).toBeNull();
    }
  });
});
