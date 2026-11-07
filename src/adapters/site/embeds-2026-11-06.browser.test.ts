/*
 * Company pages that embed Greenhouse, from the owner's captures of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06; converted with
 * scripts/mhtml-to-fixture.mjs --platform greenhouse --folder sites): ABC Legal's job page after a Submit
 * (fixtures/sites/abclegal-greenhouse-embed.html, ?gh_jid=, its #grnhse_app frame the Greenhouse form showing a required
 * answer missing and its email code), SeatGeek's (seatgeek-greenhouse-embed.html, ?gh_jid=, its frame sending the
 * application) and WEKA's (weka-greenhouse-board.html, its frame Greenhouse's job board, no application). v3 Phase 8's
 * rules hold on the real markup: the company's own top frame is never claimed (B3: a page that embeds an ATS claims no
 * form of its own), and the Greenhouse frame is the static ATS content script's (an ATS match, the Greenhouse adapter's
 * form), a job board's frame no application at all (W2).
 */
import { afterEach, describe, expect, it } from 'vitest';
import abclegalFrameHtml from '../../../fixtures/sites/abclegal-greenhouse-embed.frame-1.html?raw';
import abclegalHtml from '../../../fixtures/sites/abclegal-greenhouse-embed.html?raw';
import abclegalRoutes from '../../../fixtures/sites/abclegal-greenhouse-embed.routes.json';
import seatgeekFrameHtml from '../../../fixtures/sites/seatgeek-greenhouse-embed.frame-1.html?raw';
import seatgeekHtml from '../../../fixtures/sites/seatgeek-greenhouse-embed.html?raw';
import seatgeekRoutes from '../../../fixtures/sites/seatgeek-greenhouse-embed.routes.json';
import wekaFrameHtml from '../../../fixtures/sites/weka-greenhouse-board.frame-1.html?raw';
import wekaHtml from '../../../fixtures/sites/weka-greenhouse-board.html?raw';
import wekaRoutes from '../../../fixtures/sites/weka-greenhouse-board.routes.json';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { embedsAts } from '../../dom/page-signals';
import { scan } from '../../dom/scan';
import { recognisePage } from '../../sentinel/recognise';
import { onAtsMatch, platformOfUrl } from '../../shared/hosts';
import { greenhouseAdapter } from '../greenhouse';
import { adaptersFor, applicationOf } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { addressForTailorIT, siteFormOf } from './index';

interface Embed {
  name: string;
  page: string;
  frame: string;
  pageHtml: string;
  frameHtml: string;
  /** The Greenhouse board and job id the frame's address names (for=, token=), or null for a job board. */
  jobId: string | null;
  board: string | null;
}

/** The page's address and its Greenhouse frame's, in the order the converter wrote its route map. */
function addressesOf(routes: Record<string, string>): { page: string; frame: string } {
  const [page, frame] = Object.keys(routes);
  return { page: page!, frame: frame! };
}

const EMBEDS: Embed[] = [
  { name: 'abclegal', ...addressesOf(abclegalRoutes), pageHtml: abclegalHtml, frameHtml: abclegalFrameHtml,
    jobId: '8046763003', board: 'abclegalservices' },
  { name: 'seatgeek', ...addressesOf(seatgeekRoutes), pageHtml: seatgeekHtml, frameHtml: seatgeekFrameHtml,
    jobId: '8357322', board: 'seatgeek' },
  { name: 'weka', ...addressesOf(wekaRoutes), pageHtml: wekaHtml, frameHtml: wekaFrameHtml, jobId: null, board: null },
];

describe('company pages embedding Greenhouse (the captures of 2026-11-06)', () => {
  afterEach(() => removeFixtures(document));

  it.each(EMBEDS)('$name: the company\'s own top frame is never recognised nor claimed', async (embed) => {
    const { doc } = await loadFixture(document, embed.pageHtml, SNAPSHOT_VIEWPORT);
    const url = new URL(embed.page);
    expect(platformOfUrl(url.href)).toBeNull();
    expect(adaptersFor(url).map((adapter) => adapter.id)).toEqual(['site']);
    // Its Greenhouse frame, kept at its address (#grnhse_iframe), is the embed the page holds.
    const frame = doc.querySelector('iframe#grnhse_iframe')!;
    expect(frame.getAttribute('src')).toBe(embed.frame);
    expect(embedsAts(doc)).toBe(true);
    expect(siteFormOf(doc, url.href)).toBeNull();
    // The sentinel recognises none of the three as captured (no careers site of CAREER_SITES, no platform fingerprint,
    // and the score claims no form beside an embed: B3), so the content script is not injected into the company's own
    // frame. A capture holds no script (Chrome's serializer drops them, JSON-LD included), so whether the live page's
    // JSON-LD names a JobPosting is unknown; recognised so, siteFormOf above still claims nothing.
    expect(recognisePage(doc, url.href)).toBeNull();
  });

  it.each(EMBEDS)('$name: TailorIT hears of the page by its origin, its path and its gh_jid alone', (embed) => {
    const url = new URL(embed.page);
    const named = new URL(addressForTailorIT(url.href));
    expect(named.origin + named.pathname).toBe(url.origin + url.pathname);
    expect([...named.searchParams.keys()]).toEqual(url.searchParams.has('gh_jid') ? ['gh_jid'] : []);
  });

  it.each(EMBEDS)('$name: its Greenhouse frame is the static ATS script\'s', async (embed) => {
    const url = new URL(embed.frame);
    expect(onAtsMatch(url.href)).toBe(true);
    expect(platformOfUrl(url.href)).toBe('greenhouse');
    const { doc } = await loadFixture(document, embed.frameHtml, SNAPSHOT_VIEWPORT);
    const found = greenhouseAdapter.detect(doc);
    if (embed.jobId === null) {
      // A job board's frame shows openings and their filters, no application: no application key, no run (W2).
      expect(applicationOf(url)).toBeNull();
      expect(found).toBeNull();
      expect(doc.querySelector('#keyword-filter')).not.toBeNull();
      return;
    }
    expect(applicationOf(url)).toMatchObject({ platform: 'greenhouse', page: 'application',
      applicationUrl: `https://job-boards.greenhouse.io/${embed.board}/jobs/${embed.jobId}` });
    expect(found).not.toBeNull();
    const result = scan(found!.formRoot, greenhouseAdapter, { platform: 'greenhouse' });
    expect(result.fields.map((field) => field.label)).toEqual(expect.arrayContaining(['First Name', 'Last Name',
      'Email', 'Phone']));
  });
});
