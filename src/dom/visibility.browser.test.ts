import { afterEach, describe, expect, it } from 'vitest';
import trap02 from '../../fixtures/traps/02-zero-and-offscreen.html?raw';
import { loadFixture, removeFixtures, withoutCheckVisibility, type Fixture } from './fixture.testkit';
import { registerOwnUiHost } from './own-ui';
import { newScanCache } from './scan-cache';
import { isTextVisible, isUserVisible, visibilityOf, type VisibilityRule } from './visibility';

/**
 * One positive and one negative case for every rule the walk applies. Each case's target is the element with the
 * case's id. `rule` is the rule the manual walk must name when checkVisibility is gone; the browser's own check may
 * reject a case first, which only changes the rule's name, never the verdict.
 */
const CASES: Array<{ id: string; html: string; visible: boolean; rule?: VisibilityRule }> = [
  { id: 'plain', html: '<p><span id="plain">Plain text</span></p>', visible: true },
  // hidden attribute (a page cannot undo it with CSS)
  { id: 'hidden-neg', html: '<div hidden style="display:block"><span id="hidden-neg">Hidden</span></div>', visible: false,
    rule: 'hidden-attribute' },
  { id: 'hidden-pos', html: '<div data-was-hidden="no"><span id="hidden-pos">Shown</span></div>', visible: true },
  // inert
  { id: 'inert-neg', html: '<div inert><span id="inert-neg">Inert</span></div>', visible: false, rule: 'inert' },
  { id: 'inert-pos', html: '<div data-inert="no"><span id="inert-pos">Not inert</span></div>', visible: true },
  // aria-hidden
  { id: 'aria-neg', html: '<div aria-hidden="true"><span id="aria-neg">Hidden from AT</span></div>', visible: false,
    rule: 'aria-hidden' },
  { id: 'aria-pos', html: '<div aria-hidden="false"><span id="aria-pos">Announced</span></div>', visible: true },
  // display: none, against display: contents (no box of its own, but its children render)
  { id: 'display-neg', html: '<div style="display:none"><span id="display-neg">None</span></div>', visible: false,
    rule: 'display-none' },
  { id: 'display-pos', html: '<div style="display:contents"><span id="display-pos">Contents</span></div>', visible: true },
  // content-visibility: hidden
  { id: 'cv-neg', html: '<div style="content-visibility:hidden"><span id="cv-neg">Skipped</span></div>', visible: false,
    rule: 'content-visibility' },
  { id: 'cv-pos', html: '<div style="content-visibility:visible"><span id="cv-pos">Rendered</span></div>', visible: true },
  // opacity, multiplied through the ancestors: 0.2 x 0.2 = 0.04 is under 0.05; 0.5 x 0.5 is not
  { id: 'opacity-neg', html: '<div style="opacity:0.2"><div style="opacity:0.2"><span id="opacity-neg">Faint</span></div></div>',
    visible: false, rule: 'opacity' },
  { id: 'opacity-pos', html: '<div style="opacity:0.5"><div style="opacity:0.5"><span id="opacity-pos">Dim</span></div></div>',
    visible: true },
  // visibility: the element's own computed value, so a visible child of a hidden parent shows
  { id: 'visibility-neg', html: '<span id="visibility-neg" style="visibility:hidden">Invisible</span>', visible: false,
    rule: 'visibility' },
  { id: 'visibility-pos', html: '<div style="visibility:hidden"><span id="visibility-pos" style="visibility:visible">Back</span></div>',
    visible: true },
  // the box, transforms included
  { id: 'box-neg', html: '<span id="box-neg" style="display:inline-block;width:3px;height:20px;overflow:hidden">Thin</span>',
    visible: false, rule: 'box-size' },
  { id: 'box-scale-neg', html: '<span id="box-scale-neg" style="display:inline-block;transform:scale(0)">Scaled away</span>',
    visible: false, rule: 'box-size' },
  { id: 'box-pos', html: '<span id="box-pos" style="display:inline-block;width:40px;height:20px;overflow:hidden">Wide</span>',
    visible: true },
  // off-screen in document coordinates; far below the fold still counts
  { id: 'left-neg', html: '<span id="left-neg" style="position:absolute;left:-9999px">Left</span>', visible: false,
    rule: 'off-screen' },
  { id: 'top-neg', html: '<span id="top-neg" style="position:absolute;top:-9999px">Up</span>', visible: false,
    rule: 'off-screen' },
  { id: 'translate-neg', html: '<div style="transform:translateX(-300vw)"><span id="translate-neg">Moved</span></div>',
    visible: false, rule: 'off-screen' },
  { id: 'below-pos', html: '<span id="below-pos" style="position:absolute;top:3000px;left:0">Below the fold</span>',
    visible: true },
  // clipping by overflow, along the containing-block chain
  { id: 'overflow-neg', html: '<div style="width:0;height:0;overflow:hidden"><span id="overflow-neg">Clipped</span></div>',
    visible: false, rule: 'overflow-clip' },
  { id: 'overflow-block-neg',
    html: '<div style="position:relative;width:0;height:0;overflow:hidden"><span id="overflow-block-neg" style="position:absolute">Clipped by its block</span></div>',
    visible: false, rule: 'overflow-clip' },
  { id: 'overflow-tiny-scroll-neg',
    html: '<div style="width:2px;height:2px;overflow:auto"><span id="overflow-tiny-scroll-neg">Too small to scroll</span></div>',
    visible: false, rule: 'overflow-clip' },
  { id: 'overflow-escape-pos',
    html: '<div style="width:0;height:0;overflow:hidden"><span id="overflow-escape-pos" style="position:absolute">Escapes a static clip</span></div>',
    visible: true },
  { id: 'overflow-scroll-pos',
    html: '<div style="height:20px;overflow:auto"><div style="height:200px"></div><span id="overflow-scroll-pos">Scroll to me</span></div>',
    visible: true },
  // tiny fonts (a box that is big enough, text that is not)
  { id: 'font-neg', html: '<span id="font-neg" style="display:inline-block;padding:6px;font-size:3px">Tiny</span>',
    visible: false, rule: 'font-size' },
  { id: 'font-pos', html: '<span id="font-pos" style="display:inline-block;padding:6px;font-size:12px">Readable</span>',
    visible: true },
  // clip on an absolutely positioned element
  { id: 'clip-neg', html: '<div style="position:absolute;clip:rect(0 0 0 0)"><span id="clip-neg">Clipped away</span></div>',
    visible: false, rule: 'clip' },
  { id: 'clip-pos', html: '<div style="position:absolute;clip:rect(0px, 600px, 80px, 0px)"><span id="clip-pos">Clip leaves room</span></div>',
    visible: true },
  // clip-path: shapes it can measure, and a path it cannot (fails closed)
  { id: 'clip-path-neg', html: '<div style="clip-path:inset(50%)"><span id="clip-path-neg">Inset away</span></div>',
    visible: false, rule: 'clip-path' },
  { id: 'clip-path-circle-neg', html: '<div style="clip-path:circle(1px at 50% 50%)"><span id="clip-path-circle-neg">Pinhole</span></div>',
    visible: false, rule: 'clip-path' },
  { id: 'clip-path-path-neg', html: '<div style="clip-path:path(\'M0 0 L10 10\')"><span id="clip-path-path-neg">Path</span></div>',
    visible: false, rule: 'clip-path' },
  { id: 'clip-path-pos', html: '<div style="clip-path:inset(0 round 8px)"><span id="clip-path-pos">Rounded corners</span></div>',
    visible: true },
  { id: 'clip-path-circle-pos',
    html: '<div style="clip-path:circle(50%);width:120px;height:120px"><span id="clip-path-circle-pos">Round</span></div>',
    visible: true },
];

const TABLE = `<!doctype html><html><head><style>body{margin:0;font:16px/1.4 sans-serif} p,div{margin:4px 0}</style></head>
<body>${CASES.map((c) => c.html).join('\n')}</body></html>`;

const TRAP_RULES = ['font-size-0', 'font-size-3', 'zero-overflow', 'left-offscreen', 'top-offscreen', 'transform', 'clip',
  'clip-path', 'opacity', 'visibility', 'hidden', 'aria-hidden', 'inert', 'content-visibility'];

function verdicts(fixture: Fixture): Record<string, boolean> {
  const cache = newScanCache();
  return Object.fromEntries(CASES.map((c) => [c.id, isUserVisible(fixture.doc.getElementById(c.id)!, cache)]));
}

function trapVerdicts(fixture: Fixture): Record<string, boolean> {
  const cache = newScanCache();
  const result: Record<string, boolean> = {};
  for (const carrier of Array.from(fixture.doc.querySelectorAll<HTMLElement>('.carrier'))) {
    const span = carrier.querySelector('.text')!;
    const text = Array.from(span.childNodes).find((node) => node.nodeType === 3) as Text;
    result[carrier.dataset.rule!] = isUserVisible(span, cache) || isTextVisible(text, cache);
  }
  result['far-below'] = isUserVisible(fixture.doc.getElementById('far-below')!, cache);
  return result;
}

describe('isUserVisible', () => {
  afterEach(() => removeFixtures(document));

  it('has one positive and one negative case for every rule', async () => {
    const fixture = await loadFixture(document, TABLE);
    const got = verdicts(fixture);
    for (const c of CASES) expect([c.id, got[c.id]]).toEqual([c.id, c.visible]);
  });

  it('gives the same verdicts with checkVisibility removed, and names each rule from the manual walk', async () => {
    const fixture = await loadFixture(document, TABLE);
    const withNative = verdicts(fixture);
    const restore = withoutCheckVisibility(fixture.view);
    try {
      expect(typeof fixture.doc.body.checkVisibility).toBe('undefined');
      expect(verdicts(fixture)).toEqual(withNative);
      const cache = newScanCache();
      for (const c of CASES.filter((entry) => entry.rule !== undefined)) {
        expect([c.id, visibilityOf(fixture.doc.getElementById(c.id)!, cache).rule]).toEqual([c.id, c.rule]);
      }
    } finally {
      restore();
    }
  });

  it("hides every one of trap 2's carriers and keeps the far-below paragraph, with and without checkVisibility",
    async () => {
      const fixture = await loadFixture(document, trap02);
      const withNative = trapVerdicts(fixture);
      expect(Object.keys(withNative).sort()).toEqual([...TRAP_RULES, 'far-below'].sort());
      for (const rule of TRAP_RULES) expect([rule, withNative[rule]]).toEqual([rule, false]);
      expect(withNative['far-below']).toBe(true);
      const restore = withoutCheckVisibility(fixture.view);
      try {
        expect(trapVerdicts(fixture)).toEqual(withNative);
      } finally {
        restore();
      }
    });

  it('treats elements outside an open modal dialog as inert, and those inside it as visible', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><p><span id="outside">Behind the dialog</span></p>
      <dialog id="dialog"><span id="inside">In the dialog</span></dialog></body>`);
    const dialog = fixture.doc.getElementById('dialog') as HTMLDialogElement;
    expect(isUserVisible(fixture.doc.getElementById('outside')!)).toBe(true);
    dialog.showModal();
    for (const native of [true, false]) {
      const restore = native ? () => undefined : withoutCheckVisibility(fixture.view);
      try {
        expect(visibilityOf(fixture.doc.getElementById('outside')!).rule).toBe('outside-modal');
        expect(isUserVisible(fixture.doc.getElementById('inside')!)).toBe(true);
      } finally {
        restore();
      }
    }
    dialog.close();
  });

  it('sees nothing in a frame whose own viewport is under 4 px', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><p id="shown">Shown</p></body>', { width: 3, height: 300 });
    expect(visibilityOf(fixture.doc.getElementById('shown')!).rule).toBe('frame');
    const roomy = await loadFixture(document, '<!doctype html><body><p id="shown">Shown</p></body>', { width: 300, height: 300 });
    expect(isUserVisible(roomy.doc.getElementById('shown')!)).toBe(true);
  });

  it("never sees a detached element or the extension's own UI", async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><div id="host"><p id="ours">Our panel</p></div><p id="theirs">Page</p></body>');
    const detached = fixture.doc.createElement('p');
    detached.textContent = 'Not in the page';
    expect(visibilityOf(detached).rule).toBe('disconnected');
    expect(isUserVisible(fixture.doc.getElementById('ours')!)).toBe(true);
    registerOwnUiHost(fixture.doc.getElementById('host')!);
    expect(visibilityOf(fixture.doc.getElementById('ours')!).rule).toBe('own-ui');
    expect(isUserVisible(fixture.doc.getElementById('theirs')!)).toBe(true);
  });

  it('defers what content-visibility: auto has not rendered yet', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body>
      <div style="height:5000px"></div>
      <div style="content-visibility:auto;contain-intrinsic-size:auto 100px"><span id="later">Rendered on scroll</span></div></body>`);
    const verdict = visibilityOf(fixture.doc.getElementById('later')!);
    expect(verdict).toEqual({ visible: false, rule: 'deferred', deferred: true });
  });

  it('judges text nodes by their own glyph boxes', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body>
      <p id="shown">Shown text</p>
      <div style="width:0;height:0;overflow:hidden"><span id="clipped">Clipped text</span></div></body>`);
    const textOf = (id: string) => fixture.doc.getElementById(id)!.firstChild as Text;
    expect(isTextVisible(textOf('shown'))).toBe(true);
    expect(isTextVisible(textOf('clipped'))).toBe(false);
  });
});
