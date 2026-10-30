import { afterEach, describe, expect, it } from 'vitest';
import { isCamouflaged, isControlCamouflaged, optionCamouflage, type CamouflageVerdict } from './camouflage';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { visiblePlaceholder } from './visible-text';

/** One positive and one negative case for every camouflage rule; each target is the element with the case's id. */
const CASES: Array<{ id: string; html: string; verdict: CamouflageVerdict }> = [
  // transparent text, whatever is behind it
  { id: 'transparent', html: '<p id="transparent" style="color:transparent">Clear glass</p>', verdict: 'camouflaged' },
  { id: 'translucent', html: '<p id="translucent" style="color:rgba(0,0,0,0.5)">Half ink</p>', verdict: 'clear' },
  { id: 'faded-by-opacity', html: '<div style="opacity:0.04"><p id="faded-by-opacity" style="color:#000">Faded</p></div>',
    verdict: 'camouflaged' },
  // the contrast threshold, against the composited background
  { id: 'white-on-white', html: '<div style="background:#fff"><p id="white-on-white" style="color:#fff">White</p></div>',
    verdict: 'camouflaged' },
  { id: 'near-white', html: '<div style="background:#fff"><p id="near-white" style="color:#fefefe">Near white</p></div>',
    verdict: 'camouflaged' },
  { id: 'light-grey', html: '<div style="background:#fff"><p id="light-grey" style="color:#bbb">Light grey</p></div>',
    verdict: 'clear' },
  { id: 'dark-on-white', html: '<p id="dark-on-white" style="color:#222">Ink</p>', verdict: 'clear' },
  { id: 'composited-clear',
    html: '<div style="background:#000"><div style="background:rgba(255,255,255,0.5)"><p id="composited-clear" style="color:#fff">On grey</p></div></div>',
    verdict: 'clear' },
  { id: 'composited-camouflaged',
    html: '<div style="background:#000"><div style="background:rgba(255,255,255,0.5)"><p id="composited-camouflaged" style="color:rgb(128,128,128)">Grey on grey</p></div></div>',
    verdict: 'camouflaged' },
  // gradients: against every stop
  { id: 'gradient-all',
    html: '<div style="background-image:linear-gradient(#000, #010101)"><p id="gradient-all" style="color:#000">Dark on dark</p></div>',
    verdict: 'camouflaged' },
  { id: 'gradient-some',
    html: '<div style="background-image:linear-gradient(#000, #fff)"><p id="gradient-some" style="color:#000">Half lost</p></div>',
    verdict: 'unknown' },
  { id: 'gradient-none',
    html: '<div style="background-image:linear-gradient(#fff, #eee)"><p id="gradient-none" style="color:#000">Readable</p></div>',
    verdict: 'clear' },
  // effects that make the answer unknown
  { id: 'image', html: '<div style="background-image:url(data:image/gif;base64,R0lGODlhAQABAAAAACw=)"><p id="image">On an image</p></div>',
    verdict: 'unknown' },
  { id: 'blend', html: '<div style="mix-blend-mode:difference"><p id="blend">Blended</p></div>', verdict: 'unknown' },
  { id: 'filter', html: '<div style="filter:invert(1)"><p id="filter">Inverted</p></div>', verdict: 'unknown' },
  { id: 'backdrop', html: '<div style="backdrop-filter:blur(2px)"><p id="backdrop">Frosted</p></div>', verdict: 'unknown' },
  { id: 'clip-text', html: '<p id="clip-text" style="background:linear-gradient(red,blue);background-clip:text;color:#000">Gradient text</p>',
    verdict: 'unknown' },
  { id: 'fill-transparent', html: '<p id="fill-transparent" style="color:#000;-webkit-text-fill-color:transparent">Hollow</p>',
    verdict: 'unknown' },
  // outlines rescue camouflaged text, but only with some offset or blur
  { id: 'shadow', html: '<div style="background:#fff"><p id="shadow" style="color:#fff;text-shadow:1px 1px 0 #000">Outlined</p></div>',
    verdict: 'clear' },
  { id: 'shadow-flat', html: '<div style="background:#fff"><p id="shadow-flat" style="color:#fff;text-shadow:0 0 0 #000">Flat shadow</p></div>',
    verdict: 'camouflaged' },
  { id: 'stroke', html: '<div style="background:#fff"><p id="stroke" style="color:#fff;-webkit-text-stroke:1px #000">Stroked</p></div>',
    verdict: 'clear' },
  // filter: opacity() is known: it fades the text like opacity does (DOM-3); any other filter, or a mask, is unknown
  // (DOM-1, S2)
  { id: 'filter-opacity-only', html: '<div style="filter:opacity(0.5)"><p id="filter-opacity-only" style="color:#000">Half ink</p></div>',
    verdict: 'clear' },
  { id: 'filter-opacity-faded', html: '<div style="filter:opacity(0.04)"><p id="filter-opacity-faded" style="color:#000">Faded</p></div>',
    verdict: 'camouflaged' },
  { id: 'filter-and-opacity', html: '<div style="filter:opacity(0.5) drop-shadow(0 0 1px #000)"><p id="filter-and-opacity">Shadowed</p></div>',
    verdict: 'unknown' },
  { id: 'mask', html: '<div style="mask-image:linear-gradient(#000,#000)"><p id="mask">Masked</p></div>', verdict: 'unknown' },
  // The first line and the first letter, drawn in colours of their own, on the element or an ancestor (S4)
  { id: 'first-line-white',
    html: '<style>#first-line-white::first-line{color:#fff}</style><p id="first-line-white" style="color:#000">White first line</p>',
    verdict: 'camouflaged' },
  { id: 'first-line-ancestor',
    html: '<style>.first-line-block::first-line{color:#fff}</style><div class="first-line-block"><span id="first-line-ancestor">On its first line</span></div>',
    verdict: 'camouflaged' },
  { id: 'first-letter-white',
    html: '<style>#first-letter-white::first-letter{color:#fff}</style><p id="first-letter-white" style="color:#000">Lost letter</p>',
    verdict: 'camouflaged' },
  { id: 'first-line-tiny',
    html: '<style>#first-line-tiny::first-line{font-size:0}</style><p id="first-line-tiny" style="color:#000">Tiny first line</p>',
    verdict: 'camouflaged' },
  { id: 'first-line-on-white-box',
    html: '<style>#first-line-on-white-box::first-line{background:#000}</style><p id="first-line-on-white-box" style="color:#000">Black on a black band</p>',
    verdict: 'camouflaged' },
  { id: 'first-letter-drop-cap',
    html: '<style>#first-letter-drop-cap::first-letter{color:#c00;font-size:2em}</style><p id="first-letter-drop-cap" style="color:#000">Drop cap</p>',
    verdict: 'clear' },
];

describe('isCamouflaged', () => {
  afterEach(() => removeFixtures(document));

  it('has one positive and one negative case for every rule', async () => {
    const fixture = await loadFixture(document,
      `<!doctype html><html><body style="margin:0;background:#fff">${CASES.map((c) => c.html).join('\n')}</body></html>`);
    for (const c of CASES) expect([c.id, isCamouflaged(fixture.doc.getElementById(c.id)!)]).toEqual([c.id, c.verdict]);
  });

  it('composites onto the dark canvas of a page that uses a dark colour scheme', async () => {
    const fixture = await loadFixture(document, `<!doctype html><html style="color-scheme:dark"><body>
      <p id="dark-ink" style="color:#151515">Lost in the dark</p><p id="light-ink" style="color:#eee">Readable</p></body></html>`);
    expect(isCamouflaged(fixture.doc.getElementById('dark-ink')!)).toBe('camouflaged');
    expect(isCamouflaged(fixture.doc.getElementById('light-ink')!)).toBe('clear');
  });
});

describe('isControlCamouflaged', () => {
  afterEach(() => removeFixtures(document));

  it('catches a control drawn so it cannot be seen, and nothing else', async () => {
    const plain = 'border:0;background:transparent;outline:none;box-shadow:none;padding:6px;width:200px';
    const fixture = await loadFixture(document, `<!doctype html><body style="background:#fff">
      <input id="invisible" style="${plain}">
      <input id="near-identical" style="${plain};background:#fdfdfd">
      <input id="bordered" style="${plain};border:1px solid #888">
      <input id="faint-border" style="${plain};border:1px solid #e5e5e5">
      <input id="bottom-line" style="${plain};border-bottom:1px solid #333">
      <input id="shaded" style="${plain};background:#eee">
      <input id="shadowed" style="${plain};box-shadow:0 0 0 1px #888">
      <input id="outlined" style="${plain};outline:1px solid #888">
      <input id="placeholder" style="${plain}" placeholder="Your city">
      <input id="default">
      <input id="box" type="checkbox" style="border:0;background:transparent">
    </body>`);
    const camouflaged = (id: string) => {
      const control = fixture.doc.getElementById(id)!;
      return isControlCamouflaged(control, visiblePlaceholder(control) !== null);
    };
    expect(camouflaged('invisible')).toBe(true);
    expect(camouflaged('near-identical')).toBe(true);
    for (const id of ['bordered', 'faint-border', 'bottom-line', 'shaded', 'shadowed', 'outlined', 'placeholder',
      'default', 'box']) {
      expect([id, camouflaged(id)]).toEqual([id, false]);
    }
  });

  it('counts a box a wrapper inside the field container draws around the control (Greenhouse), and only that', async () => {
    const plain = 'border-style:none;background:transparent;outline:none;box-shadow:none;width:100%;box-sizing:border-box';
    const fixture = await loadFixture(document, `<!doctype html><body style="background:#fff"><form>
      <div class="field-wrapper"><div class="text-input-wrapper"><div class="input-wrapper"
        style="outline:1px solid rgba(0,0,0,0.3);border-radius:5px;width:300px;padding:4px">
        <label for="greenhouse">First Name</label><input id="greenhouse" style="${plain}"></div></div></div>
      <div style="border-bottom:1px solid #333;width:300px"><input id="underlined" style="${plain}"></div>
      <div style="box-shadow:0 0 0 1px #888;width:300px"><input id="shadowed-wrapper" style="${plain}"></div>
      <div style="outline:1px solid #888;width:300px"><input id="shared-a" style="${plain}"><input id="shared-b" style="${plain}"></div>
      <div style="outline:1px solid #888;width:300px"><input id="beside-a-box" style="${plain}">
        <input type="checkbox" id="hidden-box" style="position:absolute;width:1px;height:1px;opacity:0"><label for="hidden-box">Text me</label></div>
      <div style="outline:1px solid #888;width:300px"><input id="phone" type="tel" style="${plain}">
        <div style="display:none"><input type="search" role="combobox" aria-label="Search"></div></div>
      <div style="outline:1px solid #888;width:300px;height:4px"><input id="spills-out" style="${plain};display:block;height:30px"></div>
      <div style="outline:1px solid #fdfdfd;width:300px"><input id="faint-wrapper" style="${plain}"></div>
      <div style="width:300px"><input id="bare-wrapper" style="${plain}"></div>
    </form></body>`);
    const camouflaged = (id: string) => isControlCamouflaged(fixture.doc.getElementById(id)!, false);
    // A control nobody can see does not share the box (Greenhouse's phone beside intl-tel-input's closed country search).
    for (const id of ['greenhouse', 'underlined', 'shadowed-wrapper', 'phone']) {
      expect([id, camouflaged(id)]).toEqual([id, false]);
    }
    // A wrapper that holds another control a person can use (a hidden box shown through its visible label included) is
    // not this control's box; nor is one the control spills out of, one drawn in a colour that is practically the
    // page's, or a plain div.
    for (const id of ['shared-a', 'shared-b', 'beside-a-box', 'spills-out', 'faint-wrapper', 'bare-wrapper']) {
      expect([id, camouflaged(id)]).toEqual([id, true]);
    }
  });

  it('counts a box-shadow as drawn only when it reaches past the box in a colour that shows (DOM-4)', async () => {
    const plain = 'border:0;background:transparent;outline:none;box-shadow:none;padding:6px;width:200px';
    const inner = 'border-style:none;background:transparent;outline:none;box-shadow:none;width:100%;box-sizing:border-box';
    const fixture = await loadFixture(document, `<!doctype html><body style="background:#fff"><form>
      <input id="zero-shadow" style="${plain};box-shadow:0 0 0 0 #000">
      <input id="white-shadow" style="${plain};box-shadow:0 0 0 2px #fff">
      <input id="soft-shadow" style="${plain};box-shadow:0 1px 3px rgba(0,0,0,0.3)">
      <input id="inset-line" style="${plain};box-shadow:inset 0 -1px 0 #333">
      <div style="box-shadow:0 0 0 0 red;width:300px"><input id="zero-wrapper-shadow" style="${inner}"></div>
      <div style="box-shadow:0 0 0 2px #fff;width:300px"><input id="white-wrapper-shadow" style="${inner}"></div>
    </form></body>`);
    const camouflaged = (id: string) => isControlCamouflaged(fixture.doc.getElementById(id)!, false);
    for (const id of ['zero-shadow', 'white-shadow', 'zero-wrapper-shadow', 'white-wrapper-shadow']) {
      expect([id, camouflaged(id)]).toEqual([id, true]);
    }
    for (const id of ['soft-shadow', 'inset-line']) expect([id, camouflaged(id)]).toEqual([id, false]);
  });

  it('takes a wrapper for the control\'s box only when it hugs the control and its own label (DOM-4)', async () => {
    const plain = 'border:0;background:transparent;outline:none;box-shadow:none';
    const fixture = await loadFixture(document, `<!doctype html><body style="background:#fff"><form>
      <div style="border:1px solid #ccc;border-radius:8px;padding:24px;margin-top:16px;width:420px">
        <h3 style="margin:0">About the team</h3><p>We build payments infrastructure in Austin and remote.</p>
        <label for="in-a-card">LinkedIn profile</label><input id="in-a-card" style="${plain};width:200px"></div>
      <div style="outline:1px solid #888;width:300px;padding:3px"><label for="hugged" style="display:block">Website</label>
        <input id="hugged" style="${plain};width:100%;box-sizing:border-box"></div>
    </form></body>`);
    expect(isControlCamouflaged(fixture.doc.getElementById('in-a-card')!, false)).toBe(true);
    expect(isControlCamouflaged(fixture.doc.getElementById('hugged')!, false)).toBe(false);
  });

  it('fails closed on what it cannot judge: a filter on the control, a blend, or colours behind it it cannot work out (DOM-3, S2)',
    async () => {
      const image = 'background-image:url(data:image/gif;base64,R0lGODlhAQABAAAAACw=)';
      const fixture = await loadFixture(document, `<!doctype html><body style="background:#fff"><form>
        <input id="own-filter" style="border:1px solid #888;filter:blur(4px)">
        <input id="own-filter-opacity" style="border:1px solid #888;filter:opacity(0.5)">
        <div style="${image}"><input id="on-an-image" style="border:1px solid #888"></div>
        <div style="${image}"><select id="select-on-an-image"><option>One</option></select></div>
        <div style="mix-blend-mode:difference"><input id="blended" style="border:1px solid #888"></div>
        <div style="filter:invert(1)"><input id="inverted" style="border:1px solid #888"></div>
        <input id="plain-bordered" style="border:1px solid #888">
      </form></body>`);
      const camouflaged = (id: string) => isControlCamouflaged(fixture.doc.getElementById(id)!, false);
      for (const id of ['own-filter', 'on-an-image', 'select-on-an-image', 'blended', 'inverted']) {
        expect([id, camouflaged(id)]).toEqual([id, true]);
      }
      for (const id of ['own-filter-opacity', 'plain-bordered']) expect([id, camouflaged(id)]).toEqual([id, false]);
    });
});

describe('optionCamouflage', () => {
  afterEach(() => removeFixtures(document));

  it("reads an option against the select's own list, not the page", async () => {
    const fixture = await loadFixture(document, `<!doctype html><body style="background:#000">
      <select id="list"><option id="white" style="color:#fff;background:#fff">White</option>
        <option id="normal">Normal</option></select></body>`);
    const select = fixture.doc.getElementById('list') as HTMLSelectElement;
    expect(optionCamouflage(fixture.doc.getElementById('white') as HTMLOptionElement, select)).toBe('camouflaged');
    expect(optionCamouflage(fixture.doc.getElementById('normal') as HTMLOptionElement, select)).toBe('clear');
  });
});
