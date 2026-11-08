/*
 * v5 p1-shell (PLAN decision 1, Jobright's page push, read for behaviour only): while the sidebar is open the page is
 * pushed left by its width: the body padded, and the visible fixed elements the padding cannot move marked (a header
 * reaching under the sidebar held within the page's part, a small one on the right moved left, an in-flow element wider
 * than the body held to it); nothing hidden or tiny is ever marked (a honeypot never is), nor our own host. The marks
 * are read again after the page's changes, never while a fill runs; closing takes every mark and the stylesheet away.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deadline } from '../../dom/time';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { SIDEBAR_WIDTH_PX } from '../../shared/sidebar';
import { createPagePush, PUSH_ATTR, PUSH_SCAN_CAP, PUSH_SYNC_MS, PUSHED_ATTR, type PagePush } from './push';

const PAGE = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="style-src 'none'"></head>
<body data-style="margin:0">
  <header id="header" data-style="position:fixed;top:0;left:0;right:0;height:56px;background:#eee">Acme careers</header>
  <button id="chat" data-style="position:fixed;right:20px;bottom:20px;width:64px;height:64px">Chat</button>
  <main id="main" data-style="padding-top:60px"><p>Apply below.</p><form><label>Email <input id="email"></label></form></main>
  <section id="wide" data-style="width:100vw;height:80px;background:#ddd">Our values</section>
  <input id="wideinput" name="note" data-style="display:block;width:100vw;height:24px">
  <div id="honeypot" data-style="position:fixed;right:0;top:300px;width:1px;height:1px;overflow:hidden">
    <input name="website" tabindex="-1">
  </div>
  <div id="hidden" data-style="position:fixed;right:0;top:400px;width:200px;height:100px;display:none">Hidden</div>
  <div id="sticky" data-style="position:sticky;top:0;height:20px">Sticky</div>
</body></html>`;

let fixture: Fixture | null = null;
let push: PagePush | null = null;
afterEach(() => {
  push?.destroy();
  push = null;
  removeFixtures(document);
  fixture = null;
});

const byId = (id: string) => fixture!.doc.getElementById(id)!;
const markOf = (id: string) => byId(id).getAttribute(PUSH_ATTR);

/** The fixture, its elements styled through the CSSOM: the page's CSP refuses its style attributes and <style>, as a
 *  strict page's does, and the push must still apply (an adopted stylesheet, which a CSP does not govern). */
async function load(): Promise<Fixture> {
  const loaded = await loadFixture(document, PAGE, { width: 1280, height: 800 });
  for (const el of Array.from(loaded.doc.querySelectorAll<HTMLElement>('[data-style]'))) el.style.cssText = el.dataset.style!;
  return loaded;
}

async function pushed(): Promise<PagePush> {
  fixture = await load();
  push = createPagePush(fixture.doc, SIDEBAR_WIDTH_PX, () => null);
  push.start();
  return push;
}

describe('the page push (v5 p1-shell)', () => {
  it('pads the body by the sidebar\'s width, under a page CSP that refuses inline styles, and marks what the padding cannot move', async () => {
    await pushed();
    const doc = fixture!.doc;
    const edge = doc.documentElement.clientWidth - SIDEBAR_WIDTH_PX;
    expect(doc.documentElement.hasAttribute(PUSHED_ATTR)).toBe(true);
    expect(fixture!.view.getComputedStyle(doc.body).paddingRight).toBe(`${SIDEBAR_WIDTH_PX}px`);
    expect([markOf('header'), markOf('chat'), markOf('wide')]).toEqual(['span', 'shift', 'wide']);
    for (const id of ['header', 'chat', 'wide', 'main']) {
      expect(byId(id).getBoundingClientRect().right, id).toBeLessThanOrEqual(edge + 1);
    }
    // Held, the header still starts at the left edge; the chat button keeps its own place from the edge.
    expect(byId('header').getBoundingClientRect().left).toBe(0);
    expect(Math.round(edge - byId('chat').getBoundingClientRect().right)).toBe(20);
    // Nothing hidden or tiny, nothing in flow that fits, nothing sticky is marked.
    // Nor any form control, however wide (the push never touches a field the run fills or a trap).
    for (const id of ['honeypot', 'hidden', 'main', 'sticky', 'wideinput']) expect(markOf(id), id).toBeNull();
    expect(byId('honeypot').querySelector(`[${PUSH_ATTR}]`)).toBeNull();
    expect(push!.marked).toBe(3);
  });

  it('takes every mark and the stylesheet away once the sidebar closes', async () => {
    await pushed();
    const doc = fixture!.doc;
    push!.stop();
    expect(doc.documentElement.hasAttribute(PUSHED_ATTR)).toBe(false);
    expect(doc.querySelectorAll(`[${PUSH_ATTR}]`)).toHaveLength(0);
    expect(fixture!.view.getComputedStyle(doc.body).paddingRight).toBe('0px');
    expect(byId('header').getBoundingClientRect().right).toBe(doc.documentElement.clientWidth);
    expect(push!.marked).toBe(0);
  });

  it('reads the page again after its changes, and never while a fill runs', async () => {
    await pushed();
    const doc = fixture!.doc;
    push!.setBusy(true);
    const banner = doc.createElement('div');
    banner.id = 'banner';
    banner.style.cssText = 'position:fixed;left:0;bottom:0;width:100%;height:40px;background:#fc0';
    doc.body.append(banner);
    await deadline(PUSH_SYNC_MS + 200);
    expect(markOf('banner')).toBeNull();
    push!.setBusy(false);
    await vi.waitFor(() => expect(markOf('banner')).toBe('span'), { timeout: 3_000 });
    // An element that goes loses its mark from the books.
    byId('chat').remove();
    banner.remove();
    await vi.waitFor(() => expect(push!.marked).toBe(2), { timeout: 3_000 });
  });

  it('pads the body at once when the sidebar opens during a fill, and reads the page once the fill ends', async () => {
    fixture = await load();
    push = createPagePush(fixture.doc, SIDEBAR_WIDTH_PX, () => null);
    push.setBusy(true);
    push.start();
    expect(fixture.view.getComputedStyle(fixture.doc.body).paddingRight).toBe(`${SIDEBAR_WIDTH_PX}px`);
    expect(push.marked).toBe(0);
    push.setBusy(false);
    await vi.waitFor(() => expect(push!.marked).toBe(3), { timeout: 3_000 });
  });

  it('never marks what the shift would bring into view, what an overflow clips away, nor what holds a CAPTCHA (the review, S5)', async () => {
    fixture = await load();
    const doc = fixture.doc;
    const add = (id: string, css: string, parent: Element = doc.body, tag = 'div') => {
      const el = doc.createElement(tag);
      el.id = id;
      el.style.cssText = css;
      parent.append(el);
      return el;
    };
    // An off-canvas drawer, wholly past the window's right edge: shifted left by the sidebar's width, it would show.
    add('drawer', 'position:fixed;top:0;left:100vw;width:300px;height:400px;background:#fff');
    // In flow, too wide, but clipped away by its container's overflow.
    const box = add('box', 'position:relative;width:200px;height:60px;overflow:hidden');
    add('clipped', 'position:relative;left:400px;width:1500px;height:40px', box);
    // A wide fixed banner that holds a CAPTCHA widget, and one that holds a vendor's frame.
    const widget = add('widget', 'width:300px;height:76px', add('captcha', 'position:fixed;left:0;right:0;bottom:0;height:80px'));
    widget.className = 'g-recaptcha';
    widget.dataset.sitekey = 'x';
    const frame = add('frame', 'width:300px;height:76px', add('vendor', 'position:fixed;left:0;right:0;top:100px;height:80px'),
      'iframe') as HTMLIFrameElement;
    frame.src = 'https://www.google.com/recaptcha/api2/anchor?k=x';
    push = createPagePush(doc, SIDEBAR_WIDTH_PX, () => null);
    push.start();
    for (const id of ['drawer', 'clipped', 'captcha', 'vendor']) expect(markOf(id), id).toBeNull();
    expect(byId('captcha').querySelector(`[${PUSH_ATTR}]`)).toBeNull();
    // What the push is for still moves.
    expect([markOf('header'), markOf('chat')]).toEqual(['span', 'shift']);
  });

  it('reads a busy page less often, and no more than PUSH_SCAN_CAP elements at a time (the review, F6)', async () => {
    fixture = await load();
    const doc = fixture.doc;
    const many = doc.createElement('div');
    for (let at = 0; at < 2_500; at += 1) {
      const line = doc.createElement('p');
      line.textContent = `Line ${at}`;
      many.append(line);
    }
    doc.body.append(many);
    const looked: number[] = [];
    const info = vi.spyOn(console, 'info').mockImplementation((code: unknown, data?: unknown) => {
      if (String(code).includes('sidebar.pushed')) looked.push((data as { looked: number }).looked);
    });
    try {
      push = createPagePush(doc, SIDEBAR_WIDTH_PX, () => null);
      push.start();
      // At most 1,500 a read (4,000 before the review), however many the page holds.
      expect(PUSH_SCAN_CAP).toBeLessThanOrEqual(1500);
      expect(looked.at(-1)).toBe(PUSH_SCAN_CAP);
    } finally {
      info.mockRestore();
    }
  });

  it('never marks our own host', async () => {
    fixture = await load();
    const host = fixture.doc.createElement('div');
    host.style.cssText = 'position:fixed;top:0;right:0;width:384px;height:800px';
    fixture.doc.body.append(host);
    push = createPagePush(fixture.doc, SIDEBAR_WIDTH_PX, () => host);
    push.start();
    expect(host.hasAttribute(PUSH_ATTR)).toBe(false);
  });
});
