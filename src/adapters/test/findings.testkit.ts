/*
 * The scanner findings the Lever and Greenhouse expectations wait on (the adapters builder's Phase 2 report, "Scanner
 * changes"). Each is a place where the scan of a snapshot differs from its hand-written <case>.expect.json for a
 * reason no adapter hook can reach, so the expectation tests pin these exact differences: a new difference fails, and
 * so does a finding the scanner has since fixed, which then comes out of this table. The expect files are never
 * edited to match the scanner.
 * The three findings of Phase 2 are fixed in the scanner (src/dom, 2026-10-30), so their entries are gone:
 * 1. Lever's resume (both snapshots): a wrapping <label> now leaves out the text of an upload widget the adapter
 *    declares inside it (the ATTACH RESUME/CV link), giving "Resume/CV" and its required mark.
 * 2. Lever's Current location (both snapshots): the scanner now asks adapter.widgetFor(), so the location search is
 *    reported as the remote typeahead the adapter declares, with options 'lazy', never as text.
 * 3. Greenhouse's native text inputs and textareas (all four snapshots): a box an ancestor inside the field container
 *    draws around the control (Greenhouse's outlined div.input-wrapper) now counts as the control's own, so they are
 *    no longer called camouflaged. DRAWN_BY_WRAPPER stays: greenhouse.browser.test.ts checks it lists exactly those
 *    controls.
 * A testkit, not a test: it imports no test runner.
 */
import type { Expectation, Mismatch } from './expectations.testkit';

/** The differences both Lever snapshots still show: none since findings 1 and 2 were fixed. */
const LEVER: readonly Mismatch[] = [];

/** Finding 3's controls (fixed): each Greenhouse snapshot's native text inputs and textareas, drawn by their wrapper. */
export const DRAWN_BY_WRAPPER: Readonly<Record<string, readonly string[]>> = {
  'greenhouse/gitlab-job': ['#first_name', '#last_name', '#email', '#phone', '#question_38599927002',
    '#question_38599928002', '#question_38599931002'],
  'greenhouse/discord-job': ['#first_name', '#last_name', '#preferred_name', '#email', '#phone', '#question_38318888002',
    '#question_38318889002', '#question_38318891002'],
  'greenhouse/figma-legacy-host': ['#first_name', '#last_name', '#email', '#phone', '#question_12497118004',
    '#question_12497119004', '#question_12497120004', '#question_12497122004', '#question_12497123004',
    '#question_12497124004'],
  'greenhouse/gitlab-embed': ['#first_name', '#last_name', '#email', '#phone', '#question_38599927002',
    '#question_38599928002', '#question_38599931002'],
};

/** The differences a scan of this case's snapshot is known to show until the scanner changes, in the order
 *  compareWithExpectation reports them. */
export function awaitingScanner(expectation: Expectation): Mismatch[] {
  if (expectation.fixture.startsWith('lever/')) return [...LEVER];
  return [];
}
