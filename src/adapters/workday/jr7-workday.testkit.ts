/*
 * jr7 WORKDAY-7: the snapshot7 Workday captures as test cases (fixtures/workday/jr7-workday{1,2,3}-*), shared by
 * jr7-workday.browser.test.ts (P1, the adapter's hooks) and jr7-workday-p2.browser.test.ts (P2, the shared outcomes).
 * Each case is a page's markup, the address its header says it was captured at, its folder (workday1 aristocrat.wd3,
 * workday2 republic.wd5, workday3 unitytech.wd1) and its step. A testkit, not a test: it imports no test runner.
 */
import { loadFixture, type Fixture } from '../../dom/fixture.testkit';
import { deadline } from '../../dom/time';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';

const RAW = import.meta.glob('../../../fixtures/workday/jr7-workday*.html', { query: '?raw', import: 'default',
  eager: true }) as Record<string, string>;

/** One captured page: its case name, its markup, the address it was captured at, its folder and step. */
export interface Case { name: string; html: string; source: URL; folder: 'workday1' | 'workday2' | 'workday3'; step: string }

export const CASES: readonly Case[] = Object.entries(RAW).filter(([path]) => !path.includes('.third-party-frame'))
  .map(([path, html]) => {
    const name = path.split('/').pop()!.replace(/\.html$/, '');
    const header = /<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(html);
    const source = new URL((JSON.parse(header![1]!) as { source: string }).source);
    const [, folder, step] = /^jr7-(workday[123])-(.+)$/.exec(name)!;
    return { name, html, source, folder: folder as Case['folder'], step: step! };
  }).sort((a, b) => a.name.localeCompare(b.name));

/** The case of that name, or a failure. */
export function byName(name: string): Case {
  const found = CASES.find((each) => each.name === name);
  if (found === undefined) throw new Error(`no case ${name}`);
  return found;
}

export const FOLDERS = ['workday1', 'workday2', 'workday3'] as const;
/** Each folder's employer, as its postings name it (the posting's company for a plan). */
export const COMPANY: Record<Case['folder'], string> = { workday1: 'Aristocrat', workday2: 'Republic Services',
  workday3: 'Unity' };

/** A capture loaded, its entrance animations run to their end (Workday's dialogs fade in for 150 ms). */
export async function load(item: Case): Promise<Fixture> {
  const fixture = await loadFixture(document, item.html, SNAPSHOT_VIEWPORT);
  const running = fixture.doc.getAnimations().map((each) => each.finished.catch(() => undefined));
  await Promise.race([Promise.all(running), deadline(1_500)]);
  return fixture;
}

/** `url` with its parts changed. */
export function variant(url: URL, change: (copy: URL) => void): URL {
  const copy = new URL(url.href);
  change(copy);
  return copy;
}
