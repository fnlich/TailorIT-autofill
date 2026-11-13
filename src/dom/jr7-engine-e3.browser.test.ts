/*
 * jr7 ENGINE-7 E3-1 (DFPC-7's edit 5, PC7-04): a declared proxy's radio whose words sit in an aria-hidden part of its
 * own label, which a person sees drawn (Paycom's radio, snapshot7 paycomonline1 prescreen: label > p[aria-hidden]
 * "Yes", the input's aria-label "Yes 1 of 2."). A synthetic page in that shape; every value synthetic. Eightfold's
 * shape (the label itself aria-hidden) is E1 item 5's test (jr7-engine-e1.browser.test.ts), unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { scan } from './scan';

afterEach(() => removeFixtures(document));

describe("E3-1 (PC7-04): a declared proxy's radio whose words sit in an aria-hidden part of its own shown label", () => {
  /** Paycom's radio as DFPC-7 measured it: the input at opacity 0 in its proxy (the drawn circle and its words), its
   *  own label (`tie`: label[for], or the label wrapping it) drawing the words in a <p aria-hidden="true">, the input's
   *  aria-label "<word> <n> of 2.". `labelStyle` hides the label itself (a honeypot's way); `sibling`: the words sit
   *  instead in the other radio's label. */
  const option = (word: string, at: number,
    o: { tie?: 'for' | 'wrap'; labelStyle?: string; sibling?: boolean; partStyle?: string; shown?: string } = {}) => {
    const tie = o.tie ?? 'for';
    const words = `<p aria-hidden="true" style="margin:0;display:inline;${o.partStyle ?? ''}">${word}</p>`;
    const input = `<input type="radio" id="q-${word}" name="q" value="${at}" aria-label="${word} ${at} of 2."
        style="opacity:0;position:absolute;left:0;top:0;width:100%;height:100%;margin:0">`;
    const other = word === 'Yes' ? 'No' : 'Yes';
    const forId = o.sibling === true ? `q-${other}` : `q-${word}`;
    const style = `style="position:relative;display:inline-block;padding:6px 12px;border:1px solid #888;${o.labelStyle ?? ''}"`;
    return tie === 'for'
      ? `<span class="pc-radio" style="position:relative;display:inline-block">${input}
          <label for="${forId}" ${style}>${words}</label>${o.shown ?? ''}</span>`
      : `<span class="pc-radio" style="display:inline-block"><label ${style}>${input}${words}</label>${o.shown ?? ''}</span>`;
  };
  const question = (options: string) => `<!doctype html><html><head><style>
    body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
  </style></head><body><form id="f"><div role="radiogroup" id="group">
    <p id="title">Are you legally authorized to work here?</p>${options}</div></form></body></html>`;
  /** The adapter DFPC-7 declares: the radio's proxy its wrapper, its words the aria-hidden part, the group's title. */
  const paycom = (proxies = true): Adapter => ({ ...genericAdapter, id: 'generic',
    ...(proxies ? { proxyFor: (input: HTMLInputElement) => input.closest('.pc-radio') } : {}),
    optionTextFor: (input) => input.closest('.pc-radio')?.querySelector('p[aria-hidden]')?.textContent ?? null,
    labelFor: (control) => (control.id === 'group' ? control.ownerDocument.getElementById('title') : null) });
  const optionsOf = async (html: string, adapter: Adapter) => {
    const { doc } = await loadFixture(document, html);
    const field = scan(doc.getElementById('f')!, adapter, { platform: 'paycom' }).fields
      .find((each) => each.kind === 'radio');
    removeFixtures(document);
    return field === undefined || field.options === 'lazy' ? null : field.options.map((each) => each.label);
  };

  it('reads its words through its own label, label[for] or wrapping', async () => {
    expect(await optionsOf(question(option('Yes', 1) + option('No', 2)), paycom())).toEqual(['Yes', 'No']);
    expect(await optionsOf(question(option('Yes', 1, { tie: 'wrap' }) + option('No', 2, { tie: 'wrap' })), paycom()))
      .toEqual(['Yes', 'No']);
  });

  it('never where the label itself is hidden (display none, visibility hidden), no proxy is declared, or the label is '
    + 'another radio\'s', async () => {
    const yes = ['Yes', 'No'];
    for (const labelStyle of ['display:none', 'visibility:hidden']) {
      expect(await optionsOf(question(option('Yes', 1, { labelStyle }) + option('No', 2, { labelStyle })), paycom()),
        labelStyle).not.toEqual(yes);
    }
    expect(await optionsOf(question(option('Yes', 1) + option('No', 2)), paycom(false))).not.toEqual(yes);
    expect(await optionsOf(question(option('Yes', 1, { sibling: true }) + option('No', 2, { sibling: true })), paycom()))
      .not.toEqual(yes);
  });

  // jr7 FIX-content A-1 (review A's probe): a part a person cannot see never names the option, whether nothing else is
  // drawn beside it or the page draws the other answer there (the hidden "Yes" beside a drawn "No", and back).
  it('never words its part hides otherwise: transparent or white-on-white ink, off screen, font size 0', async () => {
    /** Each radio's hidden word (by its value) with the words read for it. */
    const hidden: Record<string, string> = { 1: 'Yes', 2: 'No' };
    const readsOf = async (html: string) => {
      const { doc } = await loadFixture(document, html);
      const field = scan(doc.getElementById('f')!, paycom(), { platform: 'paycom' }).fields
        .find((each) => each.kind === 'radio');
      removeFixtures(document);
      return field === undefined || field.options === 'lazy' ? [] : field.options.map((each) => [each.value ?? '', each.label]);
    };
    for (const partStyle of ['color:transparent', 'position:absolute;left:-9999px', 'font-size:0', 'color:#fff']) {
      for (const tie of ['for', 'wrap'] as const) {
        for (const swapped of [false, true]) {
          const reads = await readsOf(question(option('Yes', 1, { tie, partStyle, shown: swapped ? '<span>No</span>' : '' })
            + option('No', 2, { tie, partStyle, shown: swapped ? '<span>Yes</span>' : '' })));
          // No radio reads the word its part hides.
          expect(reads.filter(([value, label]) => hidden[value!] === label),
            `${partStyle} (${tie})${swapped ? ', the other answer beside it' : ''}`).toEqual([]);
        }
      }
    }
    // Drawn, the same words still read.
    expect(await optionsOf(question(option('Yes', 1, { partStyle: 'color:#222' }) + option('No', 2,
      { partStyle: 'color:#222' })), paycom())).toEqual(['Yes', 'No']);
  });
});
