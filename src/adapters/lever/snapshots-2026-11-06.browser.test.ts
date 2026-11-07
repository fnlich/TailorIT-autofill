/*
 * The Lever adapter on the owner's capture of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): a posting page without its form
 * (fixtures/lever/ahead-posting.html, from "[jobs.lever.co] AHEAD - Senior DevOps Engineer.mht"), the page Phase 2 asked
 * for (the policy check reads it; the agent's entry presses its Apply).
 */
import { afterEach, describe, expect, it } from 'vitest';
import postingHtml from '../../../fixtures/lever/ahead-posting.html?raw';
import postingRoutes from '../../../fixtures/lever/ahead-posting.routes.json';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { applicationOf } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { leverAdapter } from './index';

const POSTING = Object.keys(postingRoutes)[0]!;

describe('the Lever adapter on the capture of 2026-11-06', () => {
  afterEach(() => removeFixtures(document));

  it('reads a posting page as the posting, with no form, and its Apply as the agent\'s entry', async () => {
    const url = new URL(POSTING);
    expect(applicationOf(url)).toMatchObject({ platform: 'lever', page: 'posting', applicationUrl: `${POSTING}/apply` });
    const { doc } = await loadFixture(document, postingHtml, SNAPSHOT_VIEWPORT);
    // (Elements are compared, never printed: a failure would print the page.)
    expect(leverAdapter.detect(doc) === null).toBe(true);
    expect(leverAdapter.isFinalStep!(doc)).toBe('unknown');
    expect(leverAdapter.isBusy!(doc)).toBe(false);
    // Two Apply links, at the top and at the foot of the posting; the entry is one the person sees.
    const applies: Element[] = Array.from(doc.querySelectorAll('a.postings-btn[href$="/apply"]'));
    expect(applies).toHaveLength(2);
    // The entry reads the document's own address, which a fixture's frame has not got (about:srcdoc): the document is
    // read as served at the posting's address.
    const served = new Proxy(doc, { get(target, property) {
      if (property === 'location') return { href: POSTING };
      if (property === 'baseURI') return POSTING;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    } });
    expect(leverAdapter.entryControl!(doc) === null).toBe(true);
    const entry = leverAdapter.entryControl!(served);
    expect(entry !== null && applies.includes(entry)).toBe(true);
    expect(entry!.getAttribute('href')).toBe(`${POSTING}/apply`);
  });
});
