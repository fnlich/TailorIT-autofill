/*
 * jr7 ENGINE-7 E0 (FIX7PLAN §3.2; AUTO7-12, UKGR-1, PC7-01, JDEF-1 stage 1, ICIMS7-11): the snapshot7 platforms' ids,
 * names and stub adapters, as the registry reads them before their packages build them.
 * - Each stub is its candidate pages' adapter (adaptersFor: the stub, then the generic one), reads no form root and no
 *   address, so a candidate page is no application (applicationOf null): the static content script stays dormant there,
 *   as on any address its platform's parser does not read, never the generic rule's origin and path.
 * - The employee pages of UKG Ready, Paycom, JobDiva and Eightfold are no application and no company page; a Jibe page
 *   off its postings stays a company page.
 * - Ahead of TailorIT's contract (PLATFORMS_AHEAD_OF_CONTRACT): their fields are never classified by TailorIT's AI, as
 *   a company page's are not (background/ai-tasks.ts).
 * Made-up ids in the audited shapes; no snapshot value.
 */
import { describe, expect, it } from 'vitest';
import { classifyBatches } from '../background/ai-tasks';
import { PLATFORMS, PLATFORMS_AHEAD_OF_CONTRACT, type Platform } from '../core/enums';
import type { ClassifyItem } from '../core/resolver/classify';
import type { FieldKey } from '../core/types/field';
import type { UntrustedText } from '../core/types/text';
import { parseAtsUrl } from '../contract/tailorit/lookup';
import { COPY } from '../shared/copy';
import { eightfoldAdapter } from './eightfold';
import { parseEightfoldUrl } from './eightfold/url';
import { genericAdapter } from './generic';
import { adaptersFor, applicationOf } from './index';
import { jibeAdapter } from './jibe';
import { parseJibeUrl } from './jibe/url';
import { jobDivaAdapter } from './jobdiva';
import { parseJobDivaUrl } from './jobdiva/url';
import { paycomAdapter } from './paycom';
import { parsePaycomUrl } from './paycom/url';
import { siteAdapter } from './site';
import { HAND_OVER_KINDS, type Adapter, type HandOverKind } from './types';
import { ukgReadyAdapter } from './ukgready';
import { parseUkgReadyUrl } from './ukgready/url';

/** A Paycom client key's shape (32 hex digits; made up). */
const KEY = '0123456789abcdef'.repeat(2);

/** Each platform: its stub, its parser, its name, a candidate page and an employee (or, for Jibe, a company) page. */
const STUBS: Array<{ platform: Platform; adapter: Adapter; parse: (url: URL) => unknown; name: string;
  candidate: string[]; other: string }> = [
  { platform: 'ukgready', adapter: ukgReadyAdapter, parse: parseUkgReadyUrl, name: 'UKG Ready',
    candidate: ['https://secure7.saashr.com/ta/1234567.careers?ShowJob=987654321',
      'https://secure7.saashr.com/ta/1234567.careers?ActiveSessionId=1'],
    other: 'https://secure7.saashr.com/ta/1234567.login' },
  { platform: 'paycom', adapter: paycomAdapter, parse: parsePaycomUrl, name: 'Paycom',
    candidate: [`https://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/jobs/123456`,
      `https://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/applications#/applications/7654321`],
    other: 'https://www.paycomonline.net/v4/ee/web.php/app/login' },
  { platform: 'jobdiva', adapter: jobDivaAdapter, parse: parseJobDivaUrl, name: 'JobDiva',
    candidate: ['https://www2.jobdiva.com/portal/?a=abcdefghij0123456789#/jobs/12345'],
    other: 'https://www2.jobdiva.com/candidates/myjobs/openjob.jsp?a=x&id=1' },
  { platform: 'eightfold', adapter: eightfoldAdapter, parse: parseEightfoldUrl, name: 'Eightfold',
    candidate: ['https://acme.eightfold.ai/careers?pid=123456789', 'https://acme.eightfold.ai/careers/apply?pid=123456789'],
    other: 'https://acme.eightfold.ai/careerhub/explore' },
  { platform: 'jibe', adapter: jibeAdapter, parse: parseJibeUrl, name: 'Jibe',
    candidate: ['https://acme.jibeapply.com/jobs/12345'],
    other: 'https://acme.jibeapply.com/' },
];

// ── jr7 INT-7: the stubs whose packages' parsers read their candidate pages now, one set joined from each package's
// line: ICIMS-7 ('jibe': src/adapters/jibe/url.test.ts, jr7-jibe.browser.test.ts), DFPC-7 ('paycom':
// src/adapters/paycom/url.test.ts), UKGREADY-7 ('ukgready': src/adapters/ukgready/url.test.ts) and JDEF-7 ('jobdiva',
// 'eightfold': src/adapters/{jobdiva,eightfold}/url.test.ts). Each is read under its platform as its parser says,
// instead of nothing. ──
const READING: ReadonlySet<Platform> = new Set<Platform>(['ukgready', 'paycom', 'jobdiva', 'eightfold', 'jibe']);
// ── end jr7 INT-7 ──

describe('the snapshot7 platforms (jr7 ENGINE-7 E0, FIX7PLAN §3.2)', () => {
  it('appends their ids in order, the four ATSs in TailorIT’s contract since its API 7, Jibe ahead of it for good, each named as the panel and the report show it', () => {
    expect(PLATFORMS.slice(-5)).toEqual(STUBS.map((each) => each.platform));
    for (const { platform, name } of STUBS) {
      // jr7 INT-7 round 2: TailorIT's API 7 (7b) lists UKG Ready, Paycom, JobDiva and Eightfold; Jibe stays ahead (D-6).
      if (platform === 'jibe') expect(PLATFORMS_AHEAD_OF_CONTRACT, platform).toContain(platform);
      else expect(PLATFORMS_AHEAD_OF_CONTRACT, platform).not.toContain(platform);
      expect(COPY.platforms[platform], platform).toBe(name);
    }
    // The panel's list of sites names the four ATSs; Jibe is iCIMS's front, its application on iCIMS. v3.2 EXT (E5):
    // the unsupported view's list (the strip says it in one line).
    const listed = COPY.panel.unsupported.sites.map((site) => site.name);
    for (const name of ['UKG Ready', 'Paycom', 'JobDiva', 'Eightfold']) expect(listed, name).toContain(name);
    expect(listed).not.toContain('Jibe');
  });

  it('gives each candidate page its stub, then the generic adapter, and no application: the page stays dormant', () => {
    for (const { platform, adapter, parse, candidate } of STUBS) {
      expect(adapter.id).toBe(platform);
      expect(adapter.detect({} as Document), platform).toBeNull();
      for (const url of candidate) {
        expect(adapter.matchesUrl(new URL(url)), url).toBe(true);
        expect(adaptersFor(new URL(url)), url).toEqual([adapter, genericAdapter]);
        // ── jr7 INT-7 (joined: JDEF-7's and UKGREADY-7's check holds for every reading parser; ICIMS-7's and
        // DFPC-7's rows add their platform's own) ──
        if (READING.has(platform)) {
          // jr7 JDEF-7 / UKGREADY-7: a reading parser's page is its application's, keyed by its own reading.
          const read = parse(new URL(url)) as { page: string; applicationUrl: string } | null;
          expect(read, url).not.toBeNull();
          expect(applicationOf(new URL(url)), url).toMatchObject({ platform, page: read!.page,
            applicationUrl: read!.applicationUrl });
          expect(adapter.canonicalApplicationUrl(new URL(url)), url)
            .toBe(read!.page === 'application' ? read!.applicationUrl : null);
          // jr7 ICIMS-7: Jibe's postings, each a posting alone, never an application form.
          if (platform === 'jibe') {
            expect(adapter.canonicalApplicationUrl(new URL(url)), url).toBeNull();
            expect(applicationOf(new URL(url))?.page, url).toBe('posting');
          }
          // jr7 DFPC-7: Paycom's posting, and its tenant's application page, never by the application's number.
          if (platform === 'paycom') {
            expect(read!.page, url).toBe(url.includes('/applications') ? 'application' : 'posting');
            expect(JSON.stringify(read), url).not.toContain('7654321');
          }
          continue;
        }
        // ── end jr7 INT-7 ──
        expect(parse(new URL(url)), url).toBeNull();
        expect(adapter.canonicalApplicationUrl(new URL(url)), url).toBeNull();
        // Its own parser reads it (address.ts URL_PARSERS), so it is no application yet: never the generic rule's
        // origin and path, which would key every posting of a host as one and let the generic adapter run.
        expect(applicationOf(new URL(url)), url).toBeNull();
      }
    }
  });

  it("gives an employee page of UKG Ready, Paycom, JobDiva or Eightfold no application, and a Jibe page off its postings the site's", () => {
    for (const { platform, adapter, other } of STUBS) {
      expect(adapter.matchesUrl(new URL(other)), other).toBe(false);
      if (platform === 'jibe') {
        expect(adaptersFor(new URL(other)), other).toEqual([siteAdapter]);
        expect(applicationOf(new URL(other))?.platform, other).toBe('site');
      } else {
        expect(adaptersFor(new URL(other)), other).toEqual([genericAdapter]);
        expect(applicationOf(new URL(other)), other).toBeNull();
      }
    }
  });

  // jr7 INT-7 round 2: since TailorIT's API 7 the four ATSs' fields are classified as any ATS's; a Jibe page's never
  // (ahead of the contract for good, as a company page is).
  it("asks TailorIT's AI to classify the four ATSs' fields since its API 7, never a Jibe page's (ahead of the contract)", () => {
    const item = (key: string, platform: Platform): ClassifyItem => ({ key: key as FieldKey, platform, kind: 'text',
      label: 'Where do you work today?' as UntrustedText, hint: '' as UntrustedText, section: '' as UntrustedText,
      options: [] });
    const { batches, withheld } = classifyBatches([item('k-lever', 'lever'),
      ...STUBS.map(({ platform }) => item(`k-${platform}`, platform))]);
    expect(batches.flatMap((batch) => batch.items.map((each) => each.key))).toEqual(['k-lever', 'k-ukgready', 'k-paycom',
      'k-jobdiva', 'k-eightfold']);
    expect(withheld).toEqual([{ key: 'k-jibe', category: null, why: 'unknown-field' }]);
  });
});

// jr7 INT-7 round 2 (TAILORIT-7 7b's notes): TailorIT's API 7 reads the four ATSs' pages as their parsers do. A posting
// (and Eightfold's form) is the same platform, board and job on both sides; the pages TailorIT reads as no job on
// purpose are UKG Ready's applicant session and Paycom's /applications (an application page that names no job: its
// number is the person's own, D-10), JobDiva's routes other than a job, and Eightfold's pages without exactly one
// numeric pid. Jibe is no TailorIT kind: its job goes to TailorIT as the iCIMS posting its Apply leads to (D-6).
describe('the four ATSs in TailorIT’s API 7 (jr7 INT-7 round 2)', () => {
  it('reads each candidate posting as the extension does, and on purpose no job from an application page that names none', () => {
    for (const { platform, parse, candidate } of STUBS.filter((each) => each.platform !== 'jibe')) {
      for (const url of candidate) {
        const read = parse(new URL(url)) as { board: string; jobId: string; page: string } | null;
        expect(read, url).not.toBeNull();
        if (read!.jobId === '') {
          expect(parseAtsUrl(url), url).toBeNull();
          continue;
        }
        expect(parseAtsUrl(url), url).toMatchObject({ kind: platform, board: read!.board, externalId: read!.jobId });
      }
    }
    for (const url of ['https://www2.jobdiva.com/portal/?a=abcdefghij0123456789#/jobs',
      'https://acme.eightfold.ai/careers?pid=123&pid=456', 'https://acme.eightfold.ai/careers']) {
      expect(parseAtsUrl(url), url).toBeNull();
    }
    expect(parseAtsUrl('https://acme.jibeapply.com/jobs/12345')).toBeNull();
  });
});

// jr7 ENGINE-7 E2 (ULTIPRO-7's UP7-07, gated Q7-8): the E0 contract's hand-over kinds name UltiPro's documents dialog.
describe('jr7 ENGINE-7 E2: Adapter.handOver\'s kinds (UP7-07)', () => {
  it('include the documents the site asks to save to the profile after the Submit, beside the assessment', () => {
    expect(HAND_OVER_KINDS).toEqual(['assessment', 'documents']);
    const ultipro: Pick<Adapter, 'handOver'> = { handOver: () => 'documents' };
    const kind: HandOverKind | null = ultipro.handOver!({} as Document);
    expect(kind).toBe('documents');
  });
});
