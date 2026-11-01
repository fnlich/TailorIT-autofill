/*
 * TailorIT's mark, wordmark and the extension's icons in React (src/ui/brand), and the options page's header: drawings
 * hidden from assistive technology with only the attributes src/shared/icons.ts allows, and the name read as words.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { COPY } from '../../shared/copy';
import { LOGO_MARK, type IconDef } from '../../shared/icons';
import { Options } from '../options/Options';
import { adoptPageStyles } from '../page/styles';
import { createFakeWorker, mount, settle, unmountAll } from '../ui.testkit';
import { Icon, SvgIcon } from './Icon';
import { Brand, LogoMark } from './Logo';

describe("TailorIT's brand in the extension's pages", () => {
  afterEach(() => unmountAll());

  it('draws an icon hidden from assistive technology, with only the shapes and attributes icons.ts allows', async () => {
    const hostile = { viewBox: '0 0 20 20', stroked: true, parts: [
      { tag: 'path', attrs: { d: 'M0 0h20', onclick: 'alert(1)', style: 'fill:red', href: '#x', 'stroke-width': '2' } },
      { tag: 'image' as 'path', attrs: { href: 'https://example.com/x.png' } },
    ] } as const satisfies IconDef;
    const root = await mount(<><Icon name="check" size={18} /><SvgIcon def={hostile} size={20} /></>);
    const [check, drawn] = [...root.querySelectorAll('svg')];
    expect([check!.getAttribute('aria-hidden'), check!.getAttribute('focusable'), check!.getAttribute('width'),
      check!.querySelector('title')]).toEqual(['true', 'false', '18', null]);
    expect(drawn!.querySelectorAll('*')).toHaveLength(1);
    const path = drawn!.querySelector('path')!;
    expect(path.getAttributeNames().sort()).toEqual(['d', 'stroke-width']);
  });

  it('reads as "TailorIT Autofill", the mark beside it hidden, the "IT" in the ink on the canvas', async () => {
    adoptPageStyles(document);
    // Inside a page of the extension, whose root carries the tokens.
    const root = await mount(<main className="tia-page"><h1 className="tia-brand"><Brand markSize={28} large /></h1></main>);
    expect(root.textContent).toBe(COPY.appName);
    const mark = root.querySelector('svg.tia-mark')!;
    expect([mark.getAttribute('aria-hidden'), mark.querySelectorAll('rect, path').length]).toEqual(['true', LOGO_MARK.parts.length]);
    expect(mark.querySelector('rect')?.getAttribute('fill')).toBe('#14a1c0');
    expect(getComputedStyle(root.querySelector('.tia-wordmark__it')!).color).toBe('rgb(8, 117, 140)');
    const lone = await mount(<LogoMark size={16} />);
    expect(lone.querySelector('svg')?.getAttribute('width')).toBe('16');
  });

  it("heads the options page with TailorIT's mark and its own title, word for word", async () => {
    adoptPageStyles(document);
    const root = await mount(<Options platform={createFakeWorker().platform} />);
    await settle();
    const head = root.querySelector('header.tia-options__head')!;
    expect(head.querySelector('svg.tia-mark')).not.toBeNull();
    expect(head.querySelector('h1')?.textContent).toBe(COPY.optionsTitle);
    // Native checkboxes in TailorIT's ink.
    const box = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(getComputedStyle(box).accentColor).toBe('rgb(8, 117, 140)');
  });
});
