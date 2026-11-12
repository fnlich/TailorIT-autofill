/*
 * jr7 ENGINE-7 E1 (FIX7PLAN §6.2, reading): how the page is read, on synthetic pages shaped as the jr7 audits describe
 * each platform's markup (SP\jr7\audit\*.md), each hook declared by a test adapter as its platform package declares it.
 * Every value is synthetic. One describe per item; each rule's test fails without it (the handoff's undo proofs).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { scan } from './scan';

afterEach(() => removeFixtures(document));

const BASE_STYLE = `body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
  input, select, textarea { display: block; width: 300px; padding: 6px; border: 1px solid #888; background: #fff; }`;

/** A page of the framework's own markup with `body` inside a form#f. */
const page = (body: string, style = '') => `<!doctype html><html><head><style>${BASE_STYLE}${style}</style></head>
  <body><form id="f" method="post">${body}</form></body></html>`;

// ── item 7 (RBP7-21): labels of one control that say the same words count once ─────────────────────────────────────
describe('item 7 (RBP7-21): two labels of one control saying the same words', () => {
  /** Pinpoint's job-preference block as its verifier measured it (snapshot7 pinpointhq1): drawn twice with the same
   *  ids, so the first input of each id takes both label[for]; each input also says the words in its aria-label. */
  const BLOCK = `<div class="prefs"><label for="loc">Locations</label><input id="loc" aria-label="Locations">
    <label for="title">Job Title</label><input id="title" aria-label="Job Title"></div>`;

  it('reads them once, and two labels in other words joined as before', async () => {
    const { doc } = await loadFixture(document, page(`${BLOCK}${BLOCK}
      <label for="pair">Preferred</label><label for="pair">start date</label><input id="pair">`));
    const fields = scan(doc.getElementById('f')!, genericAdapter, { platform: 'pinpoint' }).fields;
    const labels = fields.map((field) => field.label);
    expect(labels.filter((label) => label === 'Locations Locations' || label === 'Job Title Job Title')).toEqual([]);
    expect(labels.filter((label) => label === 'Locations')).toHaveLength(2);
    expect(labels.filter((label) => label === 'Job Title')).toHaveLength(2);
    expect(labels).toContain('Preferred start date');
  });
});
