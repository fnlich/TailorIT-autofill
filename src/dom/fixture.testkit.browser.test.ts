import { afterEach, describe, expect, it } from 'vitest';
import {
  framesOnTheNetwork, loadFixture, logEvents, offlineFixture, remoteResources, removeFixtures, untrustedViolations,
  type LoggedEvent,
} from './fixture.testkit';

/** The converted snapshots (fixtures/<platform>/<case>.html), which keep their frames' captured addresses. */
const CONVERTED = import.meta.glob<string>(['../../fixtures/lever/*.html', '../../fixtures/greenhouse/*.html'],
  { query: '?raw', import: 'default', eager: true });

const FRAMES = `<!doctype html><body>
  <iframe id="hcaptcha" src="https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html#frame=checkbox"></iframe>
  <iframe id="recaptcha" src="https://www.recaptcha.net/recaptcha/enterprise/anchor?ar=1&amp;k=x&amp;size=normal"></iframe>
  <iframe id="proxy" src="https://content.googleapis.com/static/proxy.html?usegapi=1"></iframe>
  <iframe id="relative" src="/never-requested"></iframe>
  <iframe id="nested" srcdoc="&lt;iframe id=&quot;inner&quot; src=&quot;https://js.hcaptcha.com/1/api.js&quot;&gt;&lt;/iframe&gt;"></iframe>
  <iframe id="blank"></iframe>
  <img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
  <link rel="canonical" href="https://job-boards.greenhouse.io/acme/jobs/1">
  <a href="https://www.example.com/">A link is only followed when clicked</a>
</body>`;

describe('loadFixture keeps fixtures off the network', () => {
  afterEach(() => removeFixtures(document));

  it('loads every frame from an empty srcdoc, its captured address still readable', async () => {
    const fixture = await loadFixture(document, FRAMES);
    expect(framesOnTheNetwork(fixture.doc)).toEqual([]);
    expect(remoteResources(fixture.view)).toEqual([]);
    expect(fixture.doc.getElementById('hcaptcha')!.getAttribute('src'))
      .toBe('https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html#frame=checkbox');
    const nested = (fixture.doc.getElementById('nested') as HTMLIFrameElement).contentDocument!;
    expect(nested.getElementById('inner')!.getAttribute('src')).toBe('https://js.hcaptcha.com/1/api.js');
  });

  it('would notice a frame that loaded an address', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body></body>');
    // Built after loading, so offlineFixture never saw it: it loads the test server's own root, which is local.
    const frame = fixture.doc.createElement('iframe');
    const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    frame.src = new URL('/', location.href).href;
    fixture.doc.body.append(frame);
    await loaded;
    expect(framesOnTheNetwork(fixture.doc)).toHaveLength(1);
  });

  it('loads every converted snapshot without one frame or resource reaching the network', async () => {
    const files = Object.entries(CONVERTED);
    expect(files.length).toBeGreaterThan(0);
    for (const [path, html] of files) {
      const fixture = await loadFixture(document, html);
      expect([path, framesOnTheNetwork(fixture.doc), remoteResources(fixture.view)]).toEqual([path, [], []]);
      removeFixtures(document);
    }
  });

  it.each([
    ['an image', '<img src="https://cdn.example.com/a.png">', 'img[src] from cdn.example.com'],
    ['a srcset', '<img src="data:," srcset="data:, 1x, //cdn.example.com/b.png 2x">', 'img[srcset] from cdn.example.com'],
    ['a stylesheet', '<link rel="stylesheet" href="https://fonts.example.com/c.css">', 'link[rel=stylesheet] from fonts.example.com'],
    ['a preload', '<link rel="preload" as="font" href="//fonts.example.com/d.woff2">', 'link[rel=preload] from fonts.example.com'],
    ['a CSS url()', '<div style="background:url(\'https://img.example.com/e.png\')"></div>', 'from img.example.com'],
    ['an @import', '<style>@import "https://css.example.com/f.css";</style>', 'from css.example.com'],
    ['a script', '<script src="https://js.example.com/g.js"></script>', 'script[src] from js.example.com'],
    ['a poster', '<video poster="https://img.example.com/h.png"></video>', 'video[poster] from img.example.com'],
    ['an SVG image', '<svg><image href="https://img.example.com/i.png"></image></svg>', 'image[href] from img.example.com'],
    ['a meta refresh', '<meta http-equiv="refresh" content="0;url=https://example.com/">', 'meta refresh'],
    ['a remote base', '<base href="https://example.com/">', 'base from example.com'],
  ])('refuses a fixture with %s', (_, markup, named) => {
    expect(() => offlineFixture(document, `<!doctype html><head></head><body>${markup}</body>`))
      .toThrow(named);
  });

  it('keeps the doctype, the comments around the root, and quirks mode when there is no doctype', () => {
    expect(offlineFixture(document, '<!doctype html>\n<!-- header -->\n<html><body><p>x</p></body></html>'))
      .toBe('<!DOCTYPE html>\n<!-- header -->\n<html><head></head><body><p>x</p></body></html>');
    expect(offlineFixture(document, '<p>quirks</p>')).toBe('<html><head></head><body><p>quirks</p></body></html>');
  });
});

describe('untrustedViolations', () => {
  const event = (type: string, trusted: boolean, target = 'skill-a'): LoggedEvent => ({ type, trusted, target });

  it('allows the trusted input and change Chromium fires after our untrusted click on a box', () => {
    expect(untrustedViolations([event('click', false), event('input', true), event('change', true)])).toEqual([]);
  });

  it('allows the trusted boundary and move events a still cursor gets when the page changes under it', () => {
    const hovers = ['pointerover', 'pointerenter', 'pointermove', 'pointerout', 'pointerleave', 'mouseover',
      'mouseenter', 'mousemove', 'mouseout', 'mouseleave'].map((type) => event(type, true, 'h1'));
    expect(untrustedViolations(hovers)).toEqual([]);
  });

  it('counts every other trusted event, and a trusted input or change that follows no untrusted click', () => {
    const trusted = ['click', 'pointerdown', 'mousedown', 'keydown', 'focus', 'focusin', 'submit']
      .map((type) => event(type, true));
    expect(untrustedViolations(trusted)).toEqual(trusted);
    const stray = [event('input', true), event('click', true), event('change', true)];
    expect(untrustedViolations(stray)).toEqual(stray);
  });

  // The Phase 4 review, R8: only the browser's scroll after a scrollTop set as a property is set aside.
  const SCROLLING = `<!doctype html><body><form id="f">
    <div id="box" style="height:80px;overflow:auto"><div style="height:600px"></div>
    <label for="t">Name</label><input id="t" name="t"></div>
    <ul id="list" role="listbox" style="height:80px;overflow:auto;margin:0"><li style="height:600px">One</li></ul>
    </form></body>`;
  const frames = (view: Window) => new Promise((resolve) => view.requestAnimationFrame(() =>
    view.requestAnimationFrame(resolve)));

  it('counts a trusted scroll that no scrollTop set caused (a scrollIntoView on a form box)', async () => {
    const fixture = await loadFixture(document, SCROLLING);
    const log = logEvents(fixture.doc);
    fixture.doc.getElementById('t')!.scrollIntoView();
    await frames(fixture.view);
    const scrolls = log.events.filter((logged) => logged.type === 'scroll');
    expect(scrolls.length).toBeGreaterThan(0);
    expect(scrolls.every((logged) => logged.trusted)).toBe(true);
    expect(untrustedViolations(log.events)).toEqual(scrolls);
    log.stop();
    removeFixtures(document);
  });

  it('sets aside the browser’s scroll on an element whose scrollTop the code set, and only there', async () => {
    const fixture = await loadFixture(document, SCROLLING);
    const original = Object.getOwnPropertyDescriptor(fixture.view.Element.prototype, 'scrollTop')!.set;
    const log = logEvents(fixture.doc);
    fixture.doc.getElementById('list')!.scrollTop = 200;
    await frames(fixture.view);
    expect(log.on('list').map((logged) => [logged.type, logged.trusted])).toEqual([['scroll', true]]);
    expect(untrustedViolations(log.events)).toEqual([]);
    // The box beside it, scrolled another way, still counts.
    fixture.doc.getElementById('box')!.scrollBy(0, 100);
    await frames(fixture.view);
    expect(untrustedViolations(log.events).map((logged) => logged.target)).toEqual(['box']);
    // Once the log stops, the realm's own scrollTop is back.
    log.stop();
    expect(Object.getOwnPropertyDescriptor(fixture.view.Element.prototype, 'scrollTop')!.set).toBe(original);
    removeFixtures(document);
  });

  it('sets aside a scroll marked as one the code caused (the e2e spies mark a listbox’s), and no other', () => {
    expect(untrustedViolations([{ ...event('scroll', true, 'lb'), scrollTopSet: true }])).toEqual([]);
    expect(untrustedViolations([event('scroll', true, 'lb')])).toHaveLength(1);
  });
});
