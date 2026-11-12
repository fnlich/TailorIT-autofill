/*
 * The Jibe adapter on the owner's snapshot7 of 2026-11-11 (F:\Develop\Refer\snapshot7\icims2: oneblood.jibeapply.com's
 * posting, converted as fixtures/jibe/jr7-icims2-jibe-posting.html with jr7-tooling-done's converter, its description
 * and its category given synthetic text, fixtures/synthetic/jr7-icims/; and the iCIMS gate its Apply leads to,
 * fixtures/icims/jr7-icims2-login), the jr7 build's ICIMS-7 package (ICIMS7-11, FIX7PLAN §5 D-6 and §6.7 item 4):
 * - the posting is Jibe's (its adapter, then the generic one), a posting alone: no form root, its description read;
 * - its Apply is the entry only where it is the same job's iCIMS gate, and the entry door refuses it 'elsewhere' (another
 *   origin: APPLYPLAN OQ4, the owner's Q7-13 by default), pressing nothing;
 * - TailorIT is given the job's iCIMS posting, built from that link, the very application the gate reads;
 * - every other control of the page is never pressed.
 * Nothing here prints or reads a snapshot's value: ids, classes, the site's addresses and counts only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { servedAdapter, served } from '../../content/apply.testkit';
import { pressEntry } from '../../content/press';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { genericAdapter } from '../generic';
import { parseIcimsUrl } from '../icims/url';
import { adaptersFor, applicationOf } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { jibeAdapter, JIBE_SNAPSHOTS } from './index';
import { checkedIcimsPosting } from './url';

const PAGES = import.meta.glob('../../../fixtures/jibe/*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
const ROUTES = import.meta.glob('../../../fixtures/jibe/*.routes.json', { import: 'default', eager: true }) as
  Record<string, Record<string, string>>;
const GATE_ROUTES = import.meta.glob('../../../fixtures/icims/jr7-icims2-login.routes.json',
  { import: 'default', eager: true }) as Record<string, Record<string, string>>;

const CASE = 'jr7-icims2-jibe-posting';
const html = Object.entries(PAGES).find(([path]) => path.endsWith(`/${CASE}.html`))![1];
const ADDRESS = Object.keys(Object.values(ROUTES)[0]!)[0]!;
/** The job's iCIMS posting, as iCIMS's own parser reads the gate the Apply leads to. */
const ICIMS_POSTING = 'https://arc-onesolutions.icims.com/jobs/17204/job';

/** The posting loaded and read as served at its own address (served: its location says it). */
async function open(address = ADDRESS) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const clicks: Element[] = [];
  fixture.doc.addEventListener('click', (event) => {
    clicks.push(event.target as Element);
    event.preventDefault();
  }, true);
  return { ...fixture, page: served(fixture.doc, address), clicks };
}

const apply = (doc: Document) => doc.querySelector<HTMLElement>('a#link-apply')!;

afterEach(() => removeFixtures(document));

describe('the Jibe posting (ICIMS7-11, D-6)', () => {
  it('is the adapter’s snapshot, a Jibe posting alone: the Jibe adapter then the generic one, no application form',
    async () => {
      expect([...JIBE_SNAPSHOTS]).toEqual([`fixtures/jibe/${CASE}.html`]);
      const url = new URL(ADDRESS);
      expect(url.hostname).toBe('oneblood.jibeapply.com');
      expect(adaptersFor(url)).toEqual([jibeAdapter, genericAdapter]);
      const ref = applicationOf(url)!;
      expect([ref.platform, ref.page, ref.applicationUrl]).toEqual(['jibe', 'posting', 'https://oneblood.jibeapply.com/jobs/17204']);
      expect(jibeAdapter.canonicalApplicationUrl(url)).toBeNull();
      const { page, doc } = await open();
      expect(jibeAdapter.detect(page)).toBeNull();
      expect(genericAdapter.detect(doc)).toBeNull();
      // Its description, the synthetic text the converter gave it.
      const text = jibeAdapter.postingText!(page)!;
      expect(text).toBe(doc.querySelector('article#description-body'));
      expect(text.textContent).toContain('synthetic posting text');
    });

  it('offers its Apply as the entry only where it is the same job’s iCIMS gate a person sees', async () => {
    const { page, doc } = await open();
    const link = apply(doc);
    expect(jibeAdapter.entryControl!(page)).toBe(link);
    // Unread address (a srcdoc page), another Jibe page, another job: none.
    expect(jibeAdapter.entryControl!(doc)).toBeNull();
    expect(jibeAdapter.entryControl!(served(doc, 'https://oneblood.jibeapply.com/jobs/17205'))).toBeNull();
    expect(jibeAdapter.entryControl!(served(doc, 'https://oneblood.jibeapply.com/'))).toBeNull();
    const href = link.getAttribute('href')!;
    for (const other of ['https://arc-onesolutions.icims.com/jobs/17205/login', 'https://arc-onesolutions.icims.com/jobs/17204/job',
      'https://arc-onesolutions.icims.com/jobs/17204/x/login', 'http://arc-onesolutions.icims.com/jobs/17204/login',
      'https://login.icims.com/jobs/17204/login', 'https://evil.example/jobs/17204/login', '/jobs/17204/login',
      'jobs/17204/login']) {
      link.setAttribute('href', other);
      expect(jibeAdapter.entryControl!(page), other).toBeNull();
    }
    link.setAttribute('href', href);
    link.style.display = 'none';
    expect(jibeAdapter.entryControl!(page)).toBeNull();
    link.style.display = '';
    // A second Apply a person sees that leads elsewhere makes neither the entry.
    const copy = link.cloneNode(true) as HTMLElement;
    copy.setAttribute('href', 'https://arc-onesolutions.icims.com/jobs/17205/login');
    link.after(copy);
    expect(jibeAdapter.entryControl!(page)).toBeNull();
    copy.setAttribute('href', href);
    expect(jibeAdapter.entryControl!(page)).toBe(link);
  });

  it('is refused by the entry door as leading elsewhere: nothing is pressed (OQ4, Q7-13)', async () => {
    const { doc, clicks } = await open();
    const answer = await pressEntry(doc, [servedAdapter(jibeAdapter, ADDRESS), genericAdapter],
      new AbortController().signal, 300, 300, undefined, { address: new URL(ADDRESS) });
    expect(answer).toEqual({ outcome: 'not-offered', refusal: 'elsewhere' });
    expect(clicks).toEqual([]);
  });

  it('gives TailorIT the job’s iCIMS posting, built from the Apply’s parts: the application the gate reads', async () => {
    const { page, doc } = await open();
    const here = new URL(ADDRESS);
    expect(jibeAdapter.tailoritAddress!(page, here)).toBe(ICIMS_POSTING);
    expect(jibeAdapter.tailoritAddress!(page, new URL(`${ADDRESS}?lang=en-us`))).toBe(ICIMS_POSTING);
    // The gate Jibe's Apply opened (icims2's capture) is that posting's application, under the same key.
    const gate = Object.keys(Object.values(GATE_ROUTES)[0]!).find((address) => !address.includes('in_iframe'))!;
    const read = parseIcimsUrl(new URL(gate))!;
    expect([read.page, read.applicationUrl]).toEqual(['application', ICIMS_POSTING]);
    // The worker's re-check takes it, and names the same posting.
    expect(checkedIcimsPosting(here, new URL(ICIMS_POSTING))).toBe(ICIMS_POSTING);
    // Another job's page, no Jibe posting, a hidden Apply, one leading elsewhere: the page's own address goes.
    expect(jibeAdapter.tailoritAddress!(page, new URL('https://oneblood.jibeapply.com/jobs/17205'))).toBeNull();
    expect(jibeAdapter.tailoritAddress!(page, new URL('https://oneblood.jibeapply.com/'))).toBeNull();
    const link = apply(doc);
    link.style.display = 'none';
    expect(jibeAdapter.tailoritAddress!(page, here)).toBeNull();
    link.style.display = '';
    link.setAttribute('href', 'https://arc-onesolutions.icims.com/jobs/17204/login?_sp=x&next=https://evil.example/');
    // The query is never read: the answer is built from the host and the id alone.
    expect(jibeAdapter.tailoritAddress!(page, here)).toBe(ICIMS_POSTING);
    link.setAttribute('href', 'https://arc-onesolutions.icims.com/jobs/17204/login#x');
    expect(jibeAdapter.tailoritAddress!(page, here)).toBeNull();
  });

  it('never presses any other control of the page: every link and button, Apply only by the entry door', async () => {
    const { page, doc } = await open();
    const never = jibeAdapter.neverPress!(doc.documentElement);
    const pressable = Array.from(doc.querySelectorAll('a, button, [role="button"], [role="link"]'));
    expect(pressable.length).toBeGreaterThan(100);
    expect(pressable.filter((el) => !never.includes(el))).toEqual([]);
    expect(never).toContain(apply(doc));
    expect(jibeAdapter.entryNeverPressed).toBe(true);
    // The page's other controls the audit named: Donate Now, the cookie banner's close, the share buttons.
    expect(never).toContain(doc.querySelector('#cookie-consent-x'));
    expect(never).toContain(doc.querySelector('a[href$="/donate-now.html"]'));
    expect(never).toContain(doc.querySelector('a#fb-social-media'));
    expect(jibeAdapter.entryControl!(page)).toBe(apply(doc));
  });
});
