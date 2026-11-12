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
import type { Adapter } from './types';
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

// ── jr7 platform packages: a platform whose package built its parser reads its candidate pages (its own tests hold
// them), so it is no stub here any more. ──
const BUILT = new Set<Platform>([
  'jobdiva', 'eightfold', // jr7 JDEF-7 (src/adapters/{jobdiva,eightfold}/url.test.ts, *.browser.test.ts)
]);
// ── end jr7 platform packages ──

describe('the snapshot7 platforms (jr7 ENGINE-7 E0, FIX7PLAN §3.2)', () => {
  it('appends their ids in order, each ahead of the contract and named as the panel and the report show it', () => {
    expect(PLATFORMS.slice(-5)).toEqual(STUBS.map((each) => each.platform));
    for (const { platform, name } of STUBS) {
      expect(PLATFORMS_AHEAD_OF_CONTRACT, platform).toContain(platform);
      expect(COPY.platforms[platform], platform).toBe(name);
    }
    // The panel's list of sites names the four ATSs; Jibe is iCIMS's front, its application on iCIMS.
    for (const name of ['UKG Ready', 'Paycom', 'JobDiva', 'Eightfold']) expect(COPY.strip.none, name).toContain(name);
    expect(COPY.strip.none).not.toContain('Jibe');
  });

  it('gives each candidate page its stub, then the generic adapter, and no application: the page stays dormant', () => {
    for (const { platform, adapter, parse, candidate } of STUBS) {
      expect(adapter.id).toBe(platform);
      if (BUILT.has(platform)) continue; // jr7 platform packages
      expect(adapter.detect({} as Document), platform).toBeNull();
      for (const url of candidate) {
        expect(adapter.matchesUrl(new URL(url)), url).toBe(true);
        expect(adaptersFor(new URL(url)), url).toEqual([adapter, genericAdapter]);
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

  it("never asks TailorIT's AI to classify their fields, as a company page's are not (ahead of the contract)", () => {
    const item = (key: string, platform: Platform): ClassifyItem => ({ key: key as FieldKey, platform, kind: 'text',
      label: 'Where do you work today?' as UntrustedText, hint: '' as UntrustedText, section: '' as UntrustedText,
      options: [] });
    const { batches, withheld } = classifyBatches([item('k-lever', 'lever'),
      ...STUBS.map(({ platform }) => item(`k-${platform}`, platform))]);
    expect(batches.flatMap((batch) => batch.items.map((each) => each.key))).toEqual(['k-lever']);
    expect(withheld).toEqual(STUBS.map(({ platform }) => ({ key: `k-${platform}`, category: null, why: 'unknown-field' })));
  });
});
