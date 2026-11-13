/*
 * jr7 ENGINE-7 E4-1 (UKGR-7, UKGREADY-7's P2): a box below the fold of a page that never scrolls itself, inside the
 * scroller a person scrolls, under ancestors that clip at the viewport's height (UKG Ready, snapshot7 secure7.saashr:
 * html and body overflow hidden; div#_layout and div.context overflow hidden, viewport-tall; the step in
 * div.l-page-layout-content, overflow-y auto). The boxes a person scrolls to are fields; the honeypots in the same
 * scroller stay hidden. A synthetic page in that shape; every value synthetic.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { scan } from './scan';

afterEach(() => removeFixtures(document));

describe('E4-1 (UKGR-7): a box below the fold of a scroller under viewport-tall clipping ancestors', () => {
  /** `extra`: more boxes after the low one, inside the scroller. `scrollerOverflow`: the scroller's overflow-y. */
  const layout = (o: { extra?: string; scrollerOverflow?: string } = {}) => `<!doctype html>
  <html><head><style>
    html, body { margin: 0; height: 100%; overflow: hidden; background: #fff; color: #222; font: 16px/1.5 system-ui; }
    #_layout { height: 100vh; overflow: hidden; }
    .context { height: 100%; overflow: hidden; }
    #f { height: 100%; margin: 0; }
    .l-page-layout-content { height: 100%; overflow-y: ${o.scrollerOverflow ?? 'auto'}; position: relative; }
    input { display: block; width: 300px; padding: 6px; border: 1px solid #888; background: #fff; }
  </style></head><body><div id="_layout"><div class="context"><form id="f"><div class="l-page-layout-content">
    <label for="top">First name</label><input id="top">
    <div style="height:1400px"></div>
    <label for="low">Summary</label><input id="low">
    ${o.extra ?? ''}
  </div></form></div></div></body></html>`;
  const labelsOf = async (html: string) => {
    const { doc } = await loadFixture(document, html, { width: 1100, height: 800 });
    const labels = scan(doc.getElementById('f')!, genericAdapter, { platform: 'ukgready' }).fields.map((f) => f.label);
    removeFixtures(document);
    return labels;
  };

  it('reads the box a person scrolls to, below the fold', async () => {
    expect(await labelsOf(layout())).toEqual(['First name', 'Summary']);
  });

  it('a container a person cannot scroll lifts nothing', async () => {
    expect(await labelsOf(layout({ scrollerOverflow: 'hidden' }))).toEqual(['First name']);
  });

  it('honeypots in the same scroller stay hidden: off its range sideways or upwards, clipped, zero-size, '
    + 'transparent, aria-hidden', async () => {
    const traps = [
      ['Trap left', 'position:absolute;left:-9999px;top:1500px'],
      ['Trap above', 'position:absolute;left:0;top:-3000px'],
      ['Trap clip', 'position:absolute;top:1500px;clip:rect(0 0 0 0);width:1px;height:1px;overflow:hidden'],
      ['Trap clip-path', 'clip-path:inset(50%)'],
      ['Trap opacity', 'opacity:0'],
    ] as const;
    const extra = traps.map(([label, style], at) => `<div style="${style}"><label for="t${at}">${label}</label>`
      + `<input id="t${at}"></div>`).join('')
      // A box of no size itself, its label shown.
      + '<label for="t-zero">Trap zero</label><input id="t-zero" style="width:0;height:0;padding:0;border:0">'
      + '<div aria-hidden="true"><label for="t-hidden">Trap aria</label><input id="t-hidden"></div>';
    const labels = await labelsOf(layout({ extra }));
    expect(labels).toContain('Summary');
    expect(labels.filter((label) => label.startsWith('Trap'))).toEqual([]);
  });
});
