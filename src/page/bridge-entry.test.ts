/*
 * The page-world bridge's entry (src/entrypoints/page-bridge.content.ts), run as Chrome runs it at document_start, over
 * a document that only records its listeners: it installs where bridgeInstallsAt says, and (the audit of 2026-11-06,
 * S-9) not in a frame on a domain that also holds an employer's own pages below an ancestor of its own origin that is
 * no posting's page, which it reads through `parent` (another origin's throws).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import bridgeEntry from '../entrypoints/page-bridge.content';

/** A document at `href` in a window whose ancestors, nearest first, have these addresses (null: another origin's).
 *  Answers it and the listeners it was given. */
function documentAt(href: string, ancestors: Array<string | null> = []) {
  const listeners: string[] = [];
  const windowAt = (address: string | null, parent: Record<string, unknown> | null) => {
    const view: Record<string, unknown> = {};
    Object.defineProperty(view, 'location', { get: () => {
      if (address === null) throw new DOMException('Blocked a frame with origin', 'SecurityError');
      return { href: address };
    } });
    view.parent = parent ?? view;
    return view;
  };
  let parent: Record<string, unknown> | null = null;
  for (const address of [...ancestors].reverse()) parent = windowAt(address, parent);
  const view = windowAt(href, parent);
  const doc = { location: { href }, defaultView: view, addEventListener: (type: string) => listeners.push(type),
    removeEventListener: () => undefined };
  view.document = doc;
  return { doc, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the page-world bridge’s entry', () => {
  const POSTING = 'https://acme.taleo.net/careersection/2/jobdetail.ftl?job=123456';

  it('installs at a posting in a top frame, and below a posting’s own page or another origin’s', () => {
    for (const ancestors of [[], [POSTING], [null], [null, POSTING]]) {
      const { doc, listeners } = documentAt(POSTING, ancestors);
      vi.stubGlobal('document', doc);
      bridgeEntry.main({} as never);
      expect(listeners, JSON.stringify(ancestors)).toEqual(['tailorit:bridge']);
    }
  });

  it('installs nothing below an employer’s page of its own origin that shows no posting', () => {
    // Any ancestor of its own origin counts, past another origin's frame too; a search page is no posting's page either.
    for (const ancestors of [['https://acme.taleo.net/enterprise/home'], [null, 'https://acme.taleo.net/enterprise/home'],
      ['about:blank'], [null, 'https://acme.taleo.net/careersection/2/jobsearch.ftl']]) {
      const { doc, listeners } = documentAt(POSTING, ancestors);
      vi.stubGlobal('document', doc);
      bridgeEntry.main({} as never);
      expect(listeners, JSON.stringify(ancestors)).toEqual([]);
    }
  });
});
