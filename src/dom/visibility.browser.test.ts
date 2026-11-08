import { afterEach, describe, expect, it } from 'vitest';
import trap02 from '../../fixtures/traps/02-zero-and-offscreen.html?raw';
import { genericAdapter } from '../adapters/generic';
import { fillabilityOf } from '../adapters/test/expectations.testkit';
import { loadFixture, removeFixtures, withoutCheckVisibility, type Fixture } from './fixture.testkit';
import { registerOwnUiHost } from './own-ui';
import { rawScan } from './raw-scan';
import { scan } from './scan';
import { newScanCache } from './scan-cache';
import { coverRight, followsItsField, isTextVisible, isUserVisible, stopsFollowing, visibilityOf,
  type VisibilityRule } from './visibility';
import { visibleText } from './visible-text';

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
  // A mask of any kind hides what it covers, whatever its shape (fails closed; DOM-1, S2): mask-image, its -webkit-
  // spelling and the mask border.
  { id: 'mask-neg', html: '<div style="mask-image:linear-gradient(transparent,transparent)"><span id="mask-neg">Masked</span></div>',
    visible: false, rule: 'mask' },
  { id: 'webkit-mask-neg',
    html: '<div style="-webkit-mask-image:linear-gradient(transparent,transparent)"><span id="webkit-mask-neg">Masked</span></div>',
    visible: false, rule: 'mask' },
  { id: 'mask-border-neg',
    html: '<div style="-webkit-mask-box-image:linear-gradient(transparent,transparent)"><span id="mask-border-neg">Masked</span></div>',
    visible: false, rule: 'mask' },
  { id: 'mask-pos', html: '<div style="mask-image:none"><span id="mask-pos">Unmasked</span></div>', visible: true },
  // The back face of an element turned away under a 3D transform (DOM-1, S2), against the GPU hack translateZ(0)
  { id: 'backface-neg',
    html: '<div style="transform:rotateY(180deg);backface-visibility:hidden"><span id="backface-neg">Turned away</span></div>',
    visible: false, rule: 'backface' },
  { id: 'backface-context-neg',
    html: '<div style="transform:rotateX(180deg);transform-style:preserve-3d"><div style="backface-visibility:hidden"><span id="backface-context-neg">Turned with its parent</span></div></div>',
    visible: false, rule: 'backface' },
  { id: 'backface-pos',
    html: '<div style="transform:translateZ(0);backface-visibility:hidden"><span id="backface-pos">Facing</span></div>',
    visible: true },
  // filter: opacity() multiplies into the opacity product (DOM-3, S2)
  { id: 'filter-opacity-neg', html: '<div style="filter:opacity(0)"><span id="filter-opacity-neg">Filtered away</span></div>',
    visible: false, rule: 'opacity' },
  { id: 'filter-opacity-product-neg',
    html: '<div style="opacity:0.2"><div style="filter:opacity(20%)"><span id="filter-opacity-product-neg">Faint</span></div></div>',
    visible: false, rule: 'opacity' },
  { id: 'filter-opacity-pos', html: '<div style="filter:opacity(50%)"><span id="filter-opacity-pos">Half</span></div>',
    visible: true },
  // A closed <details> shows its summary alone (DOM-12)
  { id: 'details-neg', html: '<details><summary>More</summary><p><span id="details-neg">Inside</span></p></details>',
    visible: false, rule: 'closed-details' },
  { id: 'details-summary-pos',
    html: '<details><summary><span id="details-summary-pos">The summary</span></summary><p>Inside</p></details>',
    visible: true },
  { id: 'details-open-pos', html: '<details open><summary>More</summary><p><span id="details-open-pos">Open</span></p></details>',
    visible: true },
  // Far to the right: reachable means the viewport's width, not the scroll width the element widens (DOM-6)
  { id: 'right-neg', html: '<span id="right-neg" style="position:absolute;left:10000px;top:0">Far right</span>',
    visible: false, rule: 'off-screen' },
];

const TABLE = `<!doctype html><html><head><style>body{margin:0;font:16px/1.4 sans-serif} p,div{margin:4px 0}</style></head>
<body>${CASES.map((c) => c.html).join('\n')}</body></html>`;

const TRAP_RULES = ['font-size-0', 'font-size-3', 'zero-overflow', 'left-offscreen', 'top-offscreen', 'transform', 'clip',
  'clip-path', 'opacity', 'visibility', 'hidden', 'aria-hidden', 'inert', 'content-visibility', 'mask', 'backface',
  'filter-opacity', 'closed-details', 'far-right'];

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

  it('counts nothing under the sidebar while it is open as on screen (v5 p1-shell, the review S5)', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body style="margin:0">'
      + '<input id="under" style="position:fixed;right:20px;top:20px;width:120px">'
      + '<input id="placed" style="position:absolute;left:1100px;top:80px;width:120px">'
      + '<input id="left" style="position:absolute;left:20px;top:80px;width:120px"></body>', { width: 1280, height: 600 });
    const at = (id: string) => fixture.doc.getElementById(id)!;
    for (const id of ['under', 'placed', 'left']) expect(isUserVisible(at(id)), id).toBe(true);
    coverRight(fixture.view, 384);
    try {
      expect([visibilityOf(at('under')).rule, visibilityOf(at('placed')).rule]).toEqual(['off-screen', 'off-screen']);
      expect(isUserVisible(at('left'))).toBe(true);
    } finally {
      coverRight(fixture.view, 0);
    }
    expect(isUserVisible(at('under'))).toBe(true);
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

  it('hides text sitting right inside a closed <details>, and keeps its summary, with and without checkVisibility',
    async () => {
      // DOM-12: the manual walk took a closed details' content for visible after a forced layout.
      const fixture = await loadFixture(document, `<!doctype html><body>
        <details id="closed"><summary>Show more</summary>Loose text inside</details></body>`);
      const loose = fixture.doc.getElementById('closed')!.lastChild as Text;
      const summary = fixture.doc.querySelector('summary')!.firstChild as Text;
      for (const native of [true, false]) {
        const restore = native ? () => undefined : withoutCheckVisibility(fixture.view);
        try {
          expect([native, isTextVisible(loose), isTextVisible(summary)]).toEqual([native, false, true]);
        } finally {
          restore();
        }
      }
    });
});

describe('a declared list drawn where its field is (followsItsField; the Phase 7a review)', () => {
  afterEach(() => removeFixtures(document));

  /** A field below the fold (the viewport 700 px high) and a fixed list in its part of the page, at `top`. */
  async function page(top: string, left = '20px') {
    const fixture = await loadFixture(document, `<!doctype html><body style="margin:0"><form>
      <div style="height:1500px"></div>
      <div id="field-part"><input id="box" style="display:block;width:300px;height:30px;margin-left:20px">
      <div id="list" role="dialog" style="position:fixed;top:${top};left:${left};width:300px;height:120px">
        <ul role="listbox"><li role="option">LinkedIn</li></ul></div></div>
      <div style="height:400px"></div></form></body>`, { width: 1000, height: 700 });
    return { fixture, list: fixture.doc.querySelector('[role="listbox"]')!, box: fixture.doc.getElementById('box')! };
  }

  it('judges the list at its field, below the fold, as visible until the list closes', async () => {
    const { list, box } = await page('1532px');
    expect(isUserVisible(list)).toBe(false);
    followsItsField(list, box);
    expect(isUserVisible(list)).toBe(true);
    stopsFollowing(list);
    expect(isUserVisible(list)).toBe(false);
  });

  it('never marks a fixed box drawn away from its field, at a negative top, beyond the document or to its side',
    async () => {
      for (const [top, left] of [['900px', '20px'], ['-500px', '20px'], ['4000px', '20px'], ['1532px', '700px']]) {
        const { list, box } = await page(top!, left);
        followsItsField(list, box);
        expect(isUserVisible(list), `${top} ${left}`).toBe(false);
        removeFixtures(document);
      }
    });
});

// The core pass of 2026-11-06 (rule 5 and rule 6): jobs.workable.com's application dialog (fixtures/workable/
// jobs-salvo-apply.html) scrolls its content region (overflow-y: auto) inside a position: fixed wrapper, under a
// div.styles__modal-content with overflow: hidden as tall as the region. A person scrolls the region to every box in it.
describe('a box in a container that scrolls inside a fixed box', () => {
  afterEach(() => removeFixtures(document));

  /** The dialog's shape, the viewport 700 px high: a fixed wrapper, a clipping box, a region scrolling 1,500 px of
   *  content in 400 px, and `inner` inside the content. */
  async function dialog(inner: string, region = 'position:absolute;inset:0;overflow-y:auto') {
    const fixture = await loadFixture(document, `<!doctype html><body style="margin:0;overflow:hidden">
      <div id="wrapper" style="position:fixed;top:0;left:0;width:1000px;height:700px;overflow:hidden">
        <div id="clip" style="position:relative;margin:100px auto;width:600px;height:400px;overflow:hidden">
          <div id="region" style="${region}">
            <div style="position:relative;height:1500px">${inner}</div>
          </div>
        </div>
      </div></body>`, { width: 1000, height: 700 });
    return fixture.doc;
  }

  it('reaches a box below the fold of the region, and the words beside it', async () => {
    const doc = await dialog(`<div style="height:1200px"></div><label id="words" for="box">Summary</label>
      <input id="box" style="display:block;width:300px;height:30px">`);
    expect(visibilityOf(doc.getElementById('box')!)).toEqual({ visible: true, rule: null, deferred: false });
    const words = doc.getElementById('words')!;
    expect(isTextVisible(Array.from(words.childNodes).find((node) => node.nodeType === 3) as Text)).toBe(true);
    // A person sees it once the region is scrolled to it, and the verdict stays.
    doc.getElementById('region')!.scrollTop = 1000;
    expect(isUserVisible(doc.getElementById('box')!)).toBe(true);
  });

  it('still hides a box placed off-screen in a fixed box that does not scroll, above the region, or beside it', async () => {
    // The region does not scroll (overflow hidden): its content is held to what it shows.
    const still = await dialog('<div style="height:1200px"></div><input id="box" style="display:block;width:300px;height:30px">',
      'position:absolute;inset:0;overflow:hidden');
    expect(visibilityOf(still.getElementById('box')!).visible).toBe(false);
    removeFixtures(document);
    // Above the region's scroll origin, or far to its side: nothing scrolls there.
    for (const place of ['top:-600px;left:0', 'top:900px;left:-2000px', 'top:900px;left:3000px']) {
      const doc = await dialog(`<input id="box" style="position:absolute;${place};width:300px;height:30px">`);
      expect(visibilityOf(doc.getElementById('box')!).visible, place).toBe(false);
      removeFixtures(document);
    }
    // Positioned against the fixed wrapper (its containing block), past the viewport: it never moves with the region.
    const pinned = await dialog('');
    const box = pinned.createElement('input');
    box.setAttribute('style', 'position:absolute;top:1200px;left:0;width:300px;height:30px');
    pinned.getElementById('wrapper')!.append(box);
    expect(visibilityOf(box)).toMatchObject({ visible: false, rule: 'off-screen' });
  });

  it('hides everything in a scrolling region whose own place is off-screen', async () => {
    const doc = await dialog('<div style="height:1200px"></div><input id="box" style="display:block;width:300px;height:30px">');
    doc.getElementById('wrapper')!.style.top = '-2000px';
    expect(visibilityOf(doc.getElementById('box')!).visible).toBe(false);
  });
});

// ── The security fix of 2026-11-06 (S1): a scroller in a fixed box seen through a slit (trap) ──
// The review's probes P3 and P3b: an overflow: hidden band a few pixels tall between a fixed box and the scroller in
// it. A person sees only the band, however far the scroller scrolls, so a passage and a field deep in the scroller are
// hidden, never visible text or a field to fill. The band as tall as the scroller (the Workable dialog's shape) still
// shows all of it.
describe('trap: a scroller in a fixed box seen through a slit (S1)', () => {
  afterEach(() => removeFixtures(document));

  /** P3: the slit inside the fixed box, a 600 px form scrolling inside it. */
  const inFixedBox = (slit: number) => `<!doctype html><body style="margin:0">
    <div style="position:fixed;top:40px;left:40px;width:600px;height:700px;background:#fff">
      <div id="slit" style="overflow:hidden;height:${slit}px;background:#fff">
        <form id="f" style="display:block;height:600px;overflow-y:auto;background:#fff;color:#222;font:16px sans-serif">
          <label for="ok">Email</label><input id="ok" style="border:1px solid #888">
          <div style="height:200px"></div>
          <p id="msg">SLIT-MARKER-P3 a passage below the slit.</p>
          <label for="trap">Website</label><input id="trap" style="border:1px solid #888">
          <div style="height:1500px"></div>
          <label for="deep">Fax</label><input id="deep" style="border:1px solid #888">
        </form>
      </div>
    </div></body>`;

  it('P3: nothing past the slit is visible, visible text or a field to fill; a band as tall as the form shows it all',
    async () => {
      for (const slit of [4, 2000]) {
        const f = await loadFixture(document, inFixedBox(slit), { width: 1280, height: 900 });
        const result = scan(f.doc.getElementById('f')!, genericAdapter, { platform: 'lever' });
        const field = (id: string) => result.fields.find((each) => each.idAttr === id);
        const shown = slit === 2000;
        expect(isUserVisible(f.doc.getElementById('msg')!), `${slit} msg`).toBe(shown);
        expect(isUserVisible(f.doc.getElementById('trap')!), `${slit} trap`).toBe(shown);
        expect(isUserVisible(f.doc.getElementById('deep')!), `${slit} deep`).toBe(shown);
        expect(String(visibleText(f.doc)).includes('SLIT-MARKER-P3'), `${slit} text`).toBe(shown);
        for (const id of ['trap', 'deep']) {
          const verdict = field(id) === undefined ? 'none' : fillabilityOf(field(id)!);
          if (shown) expect(verdict, `${slit} ${id}`).toEqual({ fillable: true });
          else expect(verdict, `${slit} ${id}`).not.toEqual({ fillable: true });
        }
        removeFixtures(document);
      }
    });

  /** P3b: a fixed box at the bottom right, the slit inside it, a 290 px scroller holding a passage and a box 1,400 px
   *  down that a form= attribute ties to the page's form. */
  const cornerSlit = (slit: number) => `<!doctype html><body style="margin:0;background:#fff;color:#222;font:16px sans-serif">
    <main><h1>Support Engineer</h1>
    <form id="f"><label for="email">Email</label><input id="email" name="email" type="email" style="border:1px solid #888">
    <button type="submit">Submit application</button></form></main>
    <div style="position:fixed;bottom:0;right:0;width:400px;height:300px">
      <div id="slit" style="overflow:hidden;height:${slit}px">
        <div id="scroller" style="height:290px;overflow-y:auto">
          <div style="height:1400px"></div>
          <p id="msg">SLIT-MARKER-P3B a passage deep in the scroller.</p>
          <label for="hp">Website</label><input id="hp" name="website" form="f" style="border:1px solid #888">
          <div style="height:20px"></div>
        </div>
      </div>
    </div></body>`;

  it('P3b: the passage and the box seen only through a 4 px slit are hidden, as with no slit at all', async () => {
    for (const slit of [0, 4, 290]) {
      const f = await loadFixture(document, cornerSlit(slit), { width: 1280, height: 900 });
      const result = scan(f.doc.getElementById('f')!, genericAdapter, { platform: 'lever' });
      const hp = result.fields.find((field) => field.idAttr === 'hp');
      const raw = await rawScan(f.doc);
      const passage = raw.passages.find((each) => each.text.includes('SLIT-MARKER-P3B'));
      const shown = slit === 290;
      expect(isUserVisible(f.doc.getElementById('hp')!), `${slit} hp`).toBe(shown);
      expect(String(visibleText(f.doc)).includes('SLIT-MARKER-P3B'), `${slit} text`).toBe(shown);
      if (!shown) {
        expect(hp === undefined ? 'none' : fillabilityOf(hp), `${slit} field`).not.toEqual({ fillable: true });
        expect(passage?.origin ?? 'none', `${slit} passage`).not.toBe('visible');
      }
      removeFixtures(document);
    }
  });
});
// ── end of the security fix's block (S1) ──

// ── The behaviour review of 2026-11-06 (M8): rule 5's guards with no clip to hide behind ──
// The review's probe: a fixed, scrolling dialog with no clipping box between the fixed wrapper and the region, so that
// only scrollIn's `across` check and containingBlockOf's absolute branch can refuse a honeypot placed in it.
describe('a box in a scrolling region inside a fixed box, no clip but the region (M8: visibility rule 5)', () => {
  afterEach(() => removeFixtures(document));

  async function dialog(inner: string) {
    const fixture = await loadFixture(document, `<!doctype html><body style="margin:0;overflow:hidden">
      <div id="wrapper" style="position:fixed;top:0;left:0;width:1000px;height:700px">
        <div id="region" style="width:600px;height:400px;overflow-y:auto;margin:100px">
          <div style="height:1500px">${inner}</div>
        </div>
      </div></body>`, { width: 1000, height: 700 });
    return fixture.doc;
  }

  it('control: reaches a box below the region’s fold', async () => {
    const doc = await dialog('<div style="height:1200px"></div><input id="box" style="display:block;width:300px;height:30px">');
    expect(visibilityOf(doc.getElementById('box')!).visible).toBe(true);
  });

  it('hides a box far to the side of the region, which scrolls only down (scrollIn’s across)', async () => {
    const doc = await dialog('<input id="box" style="position:relative;top:900px;left:3000px;width:300px;height:30px">');
    expect(visibilityOf(doc.getElementById('box')!).visible).toBe(false);
  });

  it('hides a box positioned against the fixed wrapper though it sits in the region in the DOM (its containing block)',
    async () => {
      const doc = await dialog('<input id="box" style="position:absolute;top:1200px;left:0;width:300px;height:30px">');
      expect(visibilityOf(doc.getElementById('box')!).visible).toBe(false);
    });
});
// ── end of the behaviour review's block (M8) ──
