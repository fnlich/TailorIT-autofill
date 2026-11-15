/*
 * v3.0 X1-EXT (autofill API 9; TailorIT docs/design/part2/14-extension-reports.md §2.3-2.5): the closed check's in-page
 * function (closed-check.ts closedProbe) in a real layout engine, against the extension's own fixtures: SmartRecruiters'
 * expired posting (its marker, the only platform marker with a fixture), a JobPosting's validThrough in JSON-LD
 * (Netflix's careers page), live postings (nothing), and the contract's own samples. It returns ids, one date and one
 * yes or no only, and it runs from its own source text, as Chrome serialises it.
 * Undo proofs: drop the microdata read and the SmartRecruiters test's validThrough fails; return the area's text and
 * every expectNoText fails; read textContent for innerText and the hidden-phrase case fails.
 */
import { afterEach, describe, expect, it } from 'vitest';
import bertelsmannExpiredHtml from '../../fixtures/smartrecruiters/bertelsmann-expired.html?raw';
import bertelsmannExpiredExpect from '../../fixtures/smartrecruiters/bertelsmann-expired.expect.json';
import srPostingHtml from '../../fixtures/smartrecruiters/jr7-smartrecruiter1-posting.html?raw';
import netflixJobHtml from '../../fixtures/sites/netflix-eightfold-job.html?raw';
import {
  AUTOFILL_CLOSED_MARKERS, AutofillClosedProbeResultSchema, closedMarkerMatches, type AutofillClosedMarker,
} from '../contract/tailorit';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { CLOSED_POSTING_MAX_CHARS, closedFindingOf, closedProbe, probeMarkersFor, type ProbeMarker } from './closed-check';

const ALL: readonly AutofillClosedMarker[] = AUTOFILL_CLOSED_MARKERS;
/** Every title and posting marker, as a look on any platform could be given them. */
const EVERY: ProbeMarker[] = ALL.filter((marker) => marker.where !== 'address')
  .map((marker) => ({ id: marker.id as ProbeMarker['id'], where: marker.where as ProbeMarker['where'], match: marker.match,
    pattern: marker.pattern }));

afterEach(() => removeFixtures(document));

/** The page's words that must never come back from the page (the posting's own text). */
function expectNoText(result: unknown, words: readonly string[]): void {
  const said = JSON.stringify(result);
  for (const word of words) expect(said, word).not.toContain(word);
  expect(Object.keys(result as object).sort()).toEqual(['hasPosting', 'markers', 'validThrough']);
  expect(AutofillClosedProbeResultSchema.parse(result)).toEqual(result);
}

describe('the closed check’s in-page function (closedProbe)', () => {
  it('finds SmartRecruiters’ expired marker on its disabled Apply, its microdata end date, and no open posting', async () => {
    const { doc } = await loadFixture(document, bertelsmannExpiredHtml);
    const result = closedProbe(probeMarkersFor('smartrecruiters'), CLOSED_POSTING_MAX_CHARS, doc);
    expect(result.markers).toContain('smartrecruiters.expired');
    // "Sorry, this job has expired" holds the generic phrase too; the strong platform marker is the finding.
    expect(result.markers).toContain('generic.job_expired');
    expect(result.validThrough).toBe('2026-11-05T23:27:19.018Z');
    expect(result.hasPosting).toBe(false);
    const captured = Date.parse(bertelsmannExpiredExpect.captured);
    expect(closedFindingOf(result, captured, probeMarkersFor('smartrecruiters')))
      .toEqual({ signal: 'marker', marker: 'smartrecruiters.expired' });
    expectNoText(result, ['Senior Infrastructure Engineer', 'Penguin Random House', 'Bertelsmann', 'smartrecruiters.com',
      'Sorry, this job has expired']);
  });

  it('reads a JobPosting’s validThrough from JSON-LD (Netflix’s careers page): passed after it, nothing before', async () => {
    const { doc } = await loadFixture(document, netflixJobHtml);
    const result = closedProbe(probeMarkersFor('site'), CLOSED_POSTING_MAX_CHARS, doc);
    expect(result).toEqual({ markers: [], validThrough: '2027-05-02T00:00:00', hasPosting: true });
    expect(closedFindingOf(result, Date.parse('2027-06-01T00:00:00Z'))).toEqual({ signal: 'valid_through_past' });
    expect(closedFindingOf(result, Date.parse('2026-11-14T12:00:00Z'))).toBeNull();
    expectNoText(result, ['Security Software Engineer', 'Netflix', 'Poland']);
  });

  it('finds nothing on a live posting, which shows its posting', async () => {
    const { doc } = await loadFixture(document, srPostingHtml);
    const result = closedProbe(probeMarkersFor('smartrecruiters'), CLOSED_POSTING_MAX_CHARS, doc);
    expect(result.markers).toEqual([]);
    expect(result.hasPosting).toBe(true);
    expect(closedFindingOf(result, Date.parse('2026-11-14T12:00:00Z'), probeMarkersFor('smartrecruiters'))).toBeNull();
  });

  it('matches each marker of the contract on its sample, as closedMarkerMatches does, and nothing on a page without it', async () => {
    for (const marker of ALL) {
      if (marker.where === 'address') continue;
      expect(closedMarkerMatches(marker, marker.sample), marker.id).toBe(true);
      const page = marker.where === 'title'
        ? `<!doctype html><title>${marker.sample}</title><main><p>Apply for this role.</p></main>`
        : `<!doctype html><title>Careers</title><main><h1>Engineer</h1><p>${marker.sample}</p></main>`;
      const { doc } = await loadFixture(document, page);
      expect(closedProbe(EVERY, CLOSED_POSTING_MAX_CHARS, doc).markers, marker.id).toContain(marker.id);
      removeFixtures(document);
    }
    const { doc } = await loadFixture(document, '<!doctype html><title>Engineer | Careers</title><main><h1>Engineer</h1>'
      + '<p>We are hiring. Apply below.</p><button>Apply now</button></main>');
    expect(closedProbe(EVERY, CLOSED_POSTING_MAX_CHARS, doc)).toEqual({ markers: [], validThrough: null, hasPosting: false });
  });

  it('reads the posting area’s shown text alone, at most CLOSED_POSTING_MAX_CHARS of it', async () => {
    const filler = 'Lorem ipsum dolor sit amet. '.repeat(Math.ceil(CLOSED_POSTING_MAX_CHARS / 28) + 10);
    const late = await loadFixture(document, `<!doctype html><main><p>${filler}</p><p>This job has expired.</p></main>`);
    expect(closedProbe(EVERY, CLOSED_POSTING_MAX_CHARS, late.doc).markers).toEqual([]);
    removeFixtures(document);
    const early = await loadFixture(document, `<!doctype html><main><p>This job has expired.</p><p>${filler}</p></main>`);
    expect(closedProbe(EVERY, CLOSED_POSTING_MAX_CHARS, early.doc).markers).toEqual(['generic.job_expired']);
    removeFixtures(document);
    // A phrase the page keeps hidden (a template, another state) is not shown, so not read.
    const hidden = await loadFixture(document, '<!doctype html><main><p>Engineer</p><p hidden>This job has expired.</p>'
      + '<template><p>This position has been filled.</p></template></main>');
    expect(closedProbe(EVERY, CLOSED_POSTING_MAX_CHARS, hidden.doc).markers).toEqual([]);
  });

  it('says a page with a disabled Apply shows no open posting, and one with a JobPosting block or text does', async () => {
    const text = 'We build tools for teams. '.repeat(20);
    const open = await loadFixture(document, `<!doctype html><main><p>${text}</p><button>Apply</button></main>`);
    expect(closedProbe(EVERY, CLOSED_POSTING_MAX_CHARS, open.doc).hasPosting).toBe(true);
    removeFixtures(document);
    const shut = await loadFixture(document, `<!doctype html><main><p>${text}</p><button disabled>Apply</button></main>`);
    expect(closedProbe(EVERY, CLOSED_POSTING_MAX_CHARS, shut.doc).hasPosting).toBe(false);
    removeFixtures(document);
    const block = await loadFixture(document, '<!doctype html><script type="application/ld+json">{"@context":"https://schema.org",'
      + '"@graph":[{"@type":"Organization"},{"@type":["JobPosting"],"validThrough":"2026-01-31"}]}</script><main>Engineer</main>');
    expect(closedProbe(EVERY, CLOSED_POSTING_MAX_CHARS, block.doc)).toEqual({ markers: [], validThrough: '2026-01-31',
      hasPosting: true });
  });

  it('runs from its own source text, as Chrome serialises it: no closure, the same answer', async () => {
    const { doc } = await loadFixture(document, bertelsmannExpiredHtml);
    // eslint-disable-next-line no-restricted-syntax -- rebuilt from its source text, as Chrome serialises it for executeScript
    const fresh = new Function(`return (${closedProbe.toString()});`)() as typeof closedProbe;
    const markers = JSON.parse(JSON.stringify(probeMarkersFor('smartrecruiters'))) as ProbeMarker[];
    expect(fresh(markers, CLOSED_POSTING_MAX_CHARS, doc)).toEqual(closedProbe(markers, CLOSED_POSTING_MAX_CHARS, doc));
  });
});
