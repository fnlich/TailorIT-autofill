import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures } from './fixture.testkit';
import {
  captchaElements, captchaErrorsShown, captchaRefusalShown, challengeLikeFramesShown, checkboxCaptchasUnsolved, detectPause,
  isCaptchaError, pageChallenged, unsolvedCaptchas, vendorFramesShown, withoutSolvedCaptchaErrors,
} from './pause-detect';
import { scan } from './scan';

async function pauseOf(body: string, adapter: Adapter | null = null) {
  const fixture = await loadFixture(document, `<!doctype html><body>${body}</body>`);
  return detectPause(fixture.doc, fixture.doc.querySelector('form'), adapter);
}

describe('detectPause', () => {
  afterEach(() => removeFixtures(document));

  it('finds sign-in, account creation and email-code steps', async () => {
    expect(await pauseOf('<form><label for="e">Email</label><input id="e"><label for="p">Password</label><input id="p" type="password"></form>'))
      .toEqual({ kind: 'sign-in', evidence: 'password' });
    expect(await pauseOf('<form><input type="password" aria-label="Password"><input type="password" aria-label="Again"></form>'))
      .toEqual({ kind: 'create-account', evidence: 'password' });
    expect(await pauseOf('<form><label for="p">Confirm password</label><input id="p" type="password"></form>'))
      .toEqual({ kind: 'create-account', evidence: 'confirm-password' });
    expect(await pauseOf('<form><input autocomplete="one-time-code" aria-label="Code"></form>'))
      .toEqual({ kind: 'email-code', evidence: 'one-time-code' });
    expect(await pauseOf('<form><label for="c">Verification code</label><input id="c"></form>'))
      .toEqual({ kind: 'email-code', evidence: 'code-label' });
  });

  it('ignores a hidden password field and ordinary codes', async () => {
    expect(await pauseOf(`<form><input type="password" style="display:none">
      <label for="z">Zip code</label><input id="z"><label for="r">Referral code</label><input id="r"></form>`)).toBeNull();
  });

  it("recognises CAPTCHA vendors' documented markup only when it is visible", async () => {
    // srcdoc wins over src, so these frames never load anything from the network; only their address is read.
    const frame = (src: string, style = 'width:300px;height:80px') =>
      `<form><iframe srcdoc="" src="${src}" style="${style}"></iframe></form>`;
    // The behaviour review of 2026-11-06 (M6): reCAPTCHA's checkbox (its anchor, size=normal) no longer pauses the fill
    // (the block below); its challenge popup (the bframe) and an anchor not known to be a checkbox still do.
    expect(await pauseOf(frame('https://www.google.com/recaptcha/api2/bframe?k=x')))
      .toEqual({ kind: 'captcha', evidence: 'captcha-frame' });
    expect(await pauseOf(frame('https://www.google.com/recaptcha/api2/anchor?k=x&size=compact')))
      .toEqual({ kind: 'captcha', evidence: 'captcha-frame' });
    expect(await pauseOf(frame('https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html')))
      .toEqual({ kind: 'captcha', evidence: 'captcha-frame' });
    expect(await pauseOf(frame('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x')))
      .toEqual({ kind: 'captcha', evidence: 'captcha-frame' });
    expect(await pauseOf(frame('https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible'))).toBeNull();
    expect(await pauseOf(frame('https://www.google.com/maps/embed?pb=x'))).toBeNull();
    expect(await pauseOf(frame('https://www.google.com/recaptcha/api2/anchor?k=x', 'display:none'))).toBeNull();
    expect(await pauseOf('<form><div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px"></div></form>'))
      .toEqual({ kind: 'captcha', evidence: 'captcha-container' });
    expect(await pauseOf('<form><div class="cf-turnstile" data-sitekey="x" style="width:300px;height:65px"></div></form>'))
      .toEqual({ kind: 'captcha', evidence: 'captcha-container' });
  });

  it('recognises the other vendors a page may show, and a widget in a frame of its own origin (round 2, E10)', async () => {
    const frame = (src: string) => `<form><iframe srcdoc="" src="${src}" style="width:300px;height:80px"></iframe></form>`;
    for (const src of ['https://geo.captcha-delivery.com/captcha/?initialCid=x', 'https://client-api.funcaptcha.com/fc/gc/?token=x',
      'https://acme-api.arkoselabs.com/v2/x', 'https://static.geetest.com/x']) {
      expect(await pauseOf(frame(src)), src).toEqual({ kind: 'captcha', evidence: 'captcha-frame' });
      removeFixtures(document);
    }
    for (const widget of ['<div id="px-captcha" style="width:300px;height:80px"></div>',
      '<div class="geetest_holder" style="width:300px;height:80px"></div>']) {
      expect(await pauseOf(`<form>${widget}</form>`), widget).toEqual({ kind: 'captcha', evidence: 'captcha-container' });
      removeFixtures(document);
    }
    // A frame of the page's own origin that holds a widget, drawn in the form.
    expect(await pauseOf('<form><iframe style="width:400px;height:120px" srcdoc="&lt;div class=&quot;g-recaptcha&quot; '
      + 'data-sitekey=&quot;x&quot; style=&quot;width:304px;height:78px&quot;&gt;&lt;/div&gt;"></iframe></form>'))
      .toEqual({ kind: 'captcha', evidence: 'captcha-container' });
  });

  it('counts every visible frame on a vendor’s challenge host for Sign-in Auto, solved or not, the badge aside', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <div class="g-recaptcha" data-sitekey="x"><iframe srcdoc="" src="https://www.google.com/recaptcha/api2/anchor?k=x"
        style="width:304px;height:78px"></iframe><textarea name="g-recaptcha-response" style="display:none">tok</textarea></div>
      <div class="grecaptcha-badge" style="width:256px;height:60px"><iframe srcdoc=""
        src="https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible" style="width:256px;height:60px"></iframe></div>
      <iframe srcdoc="" src="https://www.example.com/widget" style="width:300px;height:80px"></iframe>
    </form></body>`);
    // Solved, so no pause; but a challenge frame shows, which Sign-in Auto never types beside.
    expect(unsolvedCaptchas(fixture.doc, null)).toBe(0);
    expect(vendorFramesShown(fixture.doc)).toBe(1);
  });

  it('counts the visible frames of another origin that read like a challenge for Sign-in Auto, and pauses no fill (X9)',
    async () => {
      const frame = (attributes: string, style = 'width:300px;height:80px') =>
        `<iframe srcdoc="" ${attributes} style="${style}"></iframe>`;
      const fixture = await loadFixture(document, `<!doctype html><body><form><input aria-label="Email">
        ${frame('src="https://shield.example/captcha/frame"')}
        ${frame('src="https://shield.example/f" title="Human verification"')}
        ${frame('src="https://shield.example/f" name="bot-check"')}
        ${frame('src="https://shield.example/f" aria-label="Verify you are a person"')}
        ${frame('src="https://shield.example/arkose"', 'display:none')}
        ${frame('src="https://player.example/bottom-banner" title="Robots on video"')}
        ${frame('title="Challenge accepted"')}
      </form></body>`);
      // Four that show; one hidden; one that reads like nothing of the kind ("bottom" and "robots" hold no word "bot");
      // one of the page's own origin.
      expect(challengeLikeFramesShown(fixture.doc)).toBe(4);
      expect(detectPause(fixture.doc, fixture.doc.querySelector('form'), null)).toBeNull();
    });

  it('does not pause for the invisible reCAPTCHA badge or a widget bound to a button', async () => {
    expect(await pauseOf(`<form><button class="g-recaptcha" data-sitekey="x">Submit</button></form>
      <div class="grecaptcha-badge" style="width:256px;height:60px"><iframe srcdoc=""
      src="https://www.google.com/recaptcha/api2/anchor?k=x" style="width:256px;height:60px"></iframe></div>`)).toBeNull();
    expect(await pauseOf('<form><div class="h-captcha" data-sitekey="x" data-size="invisible" style="width:300px;height:80px"></div></form>'))
      .toBeNull();
  });

  // ── snapshot build 2026-11-06 (core pass Z1, item 20) ──
  describe('a button carrying the invisible binding, whatever its tag (ADP\'s guest Continue, adp-6)', () => {
    /** ADP's markup (fixtures/adp/guest.html): a custom element whose role is button, bound to the invisible reCAPTCHA. */
    const BOUND = '<sdf-button id="continue" class="g-recaptcha layout-inline" role="button" aria-label="Continue" '
      + 'style="display:inline-block;width:120px;height:36px">Continue</sdf-button>';
    const page = async (extra = '') => {
      const fixture = await loadFixture(document, `<!doctype html><body><div id="guest"><label for="e">Email</label>
        <input id="e">${BOUND}</div>${extra}</body>`);
      return { pause: detectPause(fixture.doc, null, null), challenged: pageChallenged(fixture.doc) };
    };

    it('is no drawn challenge: the page fills, and no press is held for it', async () => {
      expect(await page()).toEqual({ pause: null, challenged: false });
    });

    it('still pauses for a visible checkbox widget beside it (adversarial)', async () => {
      expect(await page('<div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px"></div>'))
        .toEqual({ pause: { kind: 'captcha', evidence: 'captcha-container' }, challenged: true });
    });

    it('still pauses once the challenge it raised shows (its bframe), and not while reCAPTCHA keeps it off-screen',
      async () => {
        const bframe = (style: string) => `<div style="${style}"><iframe srcdoc="" title="recaptcha challenge expires in two minutes"
          src="https://www.google.com/recaptcha/api2/bframe?hl=en&amp;k=x" style="width:400px;height:580px"></iframe></div>`;
        expect(await page(bframe('position:absolute;left:0;top:0;visibility:visible')))
          .toEqual({ pause: { kind: 'captcha', evidence: 'captcha-frame' }, challenged: true });
        removeFixtures(document);
        expect(await page(bframe('position:absolute;left:0;top:-10000px;visibility:hidden')))
          .toEqual({ pause: null, challenged: false });
      });

    it('still pauses for a widget drawn into an element that says it is a button, and for the vendors with no binding',
      async () => {
        // A checkbox drawn into the bound element (its anchor frame inside it) is a drawn widget.
        const drawnInto = await loadFixture(document, `<!doctype html><body><div class="g-recaptcha" role="button"
          data-sitekey="x" style="width:304px;height:78px"><iframe srcdoc="" src="https://www.google.com/recaptcha/api2/anchor?k=x"
          style="width:304px;height:78px"></iframe></div></body>`);
        expect(detectPause(drawnInto.doc, null, null)).toEqual({ kind: 'captcha', evidence: 'captcha-frame' });
        removeFixtures(document);
        // Turnstile and PerimeterX bind to no button: their widget with role=button is still a challenge (PerimeterX's
        // is a button to press and hold).
        for (const widget of ['<div class="cf-turnstile" role="button" data-sitekey="x" style="width:300px;height:65px"></div>',
          '<div id="px-captcha" role="button" style="width:300px;height:80px"></div>']) {
          const fixture = await loadFixture(document, `<!doctype html><body>${widget}</body>`);
          expect(detectPause(fixture.doc, null, null), widget).toEqual({ kind: 'captcha', evidence: 'captcha-container' });
          removeFixtures(document);
        }
      });
  });
  // ── end core pass Z1, item 20 ──

  // ── The security fix of 2026-11-06 (S7): a bound button is named and button-sized ──
  describe('an element that says it is a bound button but is no button (S7)', () => {
    const ANCHOR = 'https://www.google.com/recaptcha/api2/anchor?k=x&size=normal';
    /** The review's probe P1: a .g-recaptcha element, with or without role=button, drawing reCAPTCHA's anchor frame in a
     *  closed shadow root (which no scan reads). */
    async function closedWidget(attributes: string, style = 'display:block;width:304px;height:78px') {
      const fixture = await loadFixture(document, `<!doctype html><body><form><label for="e">Email</label><input id="e">
        <div id="w" class="g-recaptcha" ${attributes} data-sitekey="x" style="${style}"></div></form></body>`);
      const shadow = fixture.doc.getElementById('w')!.attachShadow({ mode: 'closed' });
      const frame = fixture.doc.createElement('iframe');
      frame.setAttribute('srcdoc', '');
      frame.setAttribute('src', ANCHOR);
      frame.style.cssText = 'width:304px;height:78px;border:0';
      shadow.append(frame);
      return { pause: detectPause(fixture.doc, fixture.doc.querySelector('form'), null), challenged: pageChallenged(fixture.doc) };
    }
    const PAUSED = { pause: { kind: 'captcha', evidence: 'captcha-container' }, challenged: true };

    it('P1: still pauses for a widget-sized, nameless role=button host drawing its frame in a closed shadow root', async () => {
      expect(await closedWidget('')).toEqual(PAUSED);
      removeFixtures(document);
      expect(await closedWidget('role="button"')).toEqual(PAUSED);
    });

    it('still pauses for a named host as tall as a widget, and for a button-sized one with no name of its own', async () => {
      expect(await closedWidget('role="button" aria-label="Continue"')).toEqual(PAUSED);
      removeFixtures(document);
      expect(await closedWidget('role="button"', 'display:block;width:120px;height:36px')).toEqual(PAUSED);
      removeFixtures(document);
      // An aria-labelledby naming nothing with words is no name.
      expect(await closedWidget('role="button" aria-labelledby="none"', 'display:block;width:120px;height:36px'))
        .toEqual(PAUSED);
    });

    it('still pauses for a frame drawn in the open shadow root of a named, button-sized host', async () => {
      const fixture = await loadFixture(document, `<!doctype html><body><div id="w" class="g-recaptcha" role="button"
        aria-label="Continue" data-sitekey="x" style="display:block;width:120px;height:36px"></div></body>`);
      const shadow = fixture.doc.getElementById('w')!.attachShadow({ mode: 'open' });
      const frame = fixture.doc.createElement('iframe');
      frame.setAttribute('srcdoc', '');
      frame.setAttribute('src', ANCHOR);
      frame.style.cssText = 'width:304px;height:78px;border:0';
      shadow.append(fixture.doc.createElement('div'));
      shadow.firstElementChild!.append(frame);
      // No bound button: the frame and its host both count as widgets not solved.
      expect(unsolvedCaptchas(fixture.doc, null)).toBeGreaterThan(0);
      // The behaviour review of 2026-11-06 (M6): that frame is reCAPTCHA's checkbox, which no longer pauses the fill,
      // and since v5 (PLAN decision 9) holds no press either; any other challenge frame drawn there pauses it and holds
      // every press.
      expect(detectPause(fixture.doc, null, null)).toBeNull();
      expect(pageChallenged(fixture.doc)).toBe(false);
      frame.setAttribute('src', 'https://www.google.com/recaptcha/api2/bframe?k=x');
      expect(detectPause(fixture.doc, null, null)?.kind).toBe('captcha');
      expect(pageChallenged(fixture.doc)).toBe(true);
    });

    it('takes a named, button-sized host whose words are its own or those its aria-labelledby names as bound', async () => {
      for (const attributes of ['role="button" aria-labelledby="t"', 'role="button"']) {
        const fixture = await loadFixture(document, `<!doctype html><body><span id="t">Continue</span>
          <div class="g-recaptcha" ${attributes} data-sitekey="x" style="display:block;width:120px;height:36px">${
  attributes.includes('labelledby') ? '' : 'Continue'}</div></body>`);
        expect({ pause: detectPause(fixture.doc, null, null), challenged: pageChallenged(fixture.doc) }, attributes)
          .toEqual({ pause: null, challenged: false });
        removeFixtures(document);
      }
    });
  });
  // ── end of the security fix's block (S7) ──

  it("takes the adapter's word for what its snapshots show", async () => {
    const adapter = { authState: () => 'entry-choice' } as unknown as Adapter;
    expect(await pauseOf('<form><label for="e">Email</label><input id="e"></form>', adapter))
      .toEqual({ kind: 'entry-choice', evidence: 'adapter' });
  });

  it('puts a challenge shown before any page the adapter names, and a handed one after (the v3 Phase 6/7b review, S1)', async () => {
    const widget = '<div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px"></div>';
    for (const kind of ['sign-in', 'create-account', 'email-gate', 'entry-choice'] as const) {
      const adapter = { authState: () => kind } as unknown as Adapter;
      expect(await pauseOf(`<form><input aria-label="Email">${widget}</form>`, adapter), kind)
        .toEqual({ kind: 'captcha', evidence: 'captcha-container' });
      removeFixtures(document);
    }
    const fixture = await loadFixture(document, `<!doctype html><body><form><input aria-label="Email">${widget}</form></body>`);
    const adapter = { authState: () => 'sign-in' } as unknown as Adapter;
    const handed = new Set(captchaElements(fixture.doc, fixture.doc.querySelector('form')));
    expect(detectPause(fixture.doc, fixture.doc.querySelector('form'), adapter, undefined, { handed }))
      .toEqual({ kind: 'sign-in', evidence: 'adapter' });
  });

  it('looks into open shadow roots, as the scanner does when it fills them (the Phase 5 review, X-S6)', async () => {
    const shadowed = (inner: string) => `<form id="f"><div id="host"></div></form><script>
      document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = ${JSON.stringify(inner)};</script>`;
    expect(await pauseOf(shadowed('<label for="n">Full name</label><input id="n">'
      + '<div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px"></div>')))
      .toEqual({ kind: 'captcha', evidence: 'captcha-container' });
    expect(await pauseOf(shadowed('<label for="c">Verification code</label><input id="c">')))
      .toEqual({ kind: 'email-code', evidence: 'code-label' });
    expect(await pauseOf(shadowed('<label for="p">Password</label><input id="p" type="password">')))
      .toEqual({ kind: 'sign-in', evidence: 'password' });
    // Nested roots too, and a frame inside one.
    expect(await pauseOf(`<form id="f"><div id="outer"></div></form><script>
      const outer = document.getElementById('outer').attachShadow({ mode: 'open' });
      outer.innerHTML = '<div id="inner"></div>';
      outer.getElementById('inner').attachShadow({ mode: 'open' }).innerHTML = '<iframe srcdoc="" '
        + 'src="https://www.google.com/recaptcha/api2/anchor?k=x" style="width:300px;height:80px"></iframe>';</script>`))
      .toEqual({ kind: 'captcha', evidence: 'captcha-frame' });
    expect(await pauseOf(shadowed('<label for="n">Full name</label><input id="n">'))).toBeNull();
  });

  it('does not pause for a widget the person solved: it holds its response token (the Phase 5 review, X-S4)', async () => {
    const widget = (cls: string, field: string) => `<form><div class="${cls}" data-sitekey="x" style="width:304px;height:78px">
      <iframe srcdoc="" src="https://www.google.com/recaptcha/api2/anchor?k=x" style="width:300px;height:74px"></iframe>
      ${field}</div></form>`;
    const recaptcha = (value: string) => widget('g-recaptcha',
      `<textarea name="g-recaptcha-response" id="g-recaptcha-response" style="display:none">${value}</textarea>`);
    expect(await pauseOf(recaptcha(''))).toEqual({ kind: 'captcha', evidence: 'captcha-frame' });
    expect(await pauseOf(recaptcha('03AFcWeA-token'))).toBeNull();
    expect(await pauseOf(widget('h-captcha', '<textarea name="h-captcha-response" style="display:none">P1_token</textarea>')))
      .toBeNull();
    expect(await pauseOf(widget('cf-turnstile', '<input type="hidden" name="cf-turnstile-response" value="0.token">')))
      .toBeNull();
    expect(await pauseOf(widget('cf-turnstile', '<input type="hidden" name="cf-turnstile-response" value="">')))
      .toEqual({ kind: 'captcha', evidence: 'captcha-frame' });
    // A token field outside the widget says nothing of it.
    expect(await pauseOf(`${recaptcha('')}<textarea name="g-recaptcha-response" style="display:none">x</textarea>`))
      .toEqual({ kind: 'captcha', evidence: 'captcha-frame' });
  });

  it('skips the CAPTCHA elements the person was handed, and no other (the Phase 5 review, X-S4)', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <div class="g-recaptcha" id="one" data-sitekey="x" style="width:304px;height:78px"><iframe srcdoc=""
      src="https://www.google.com/recaptcha/api2/anchor?k=x" style="width:300px;height:74px"></iframe></div></form></body>`);
    const form = fixture.doc.querySelector('form')!;
    const handed = new Set(captchaElements(fixture.doc, form));
    expect([...handed].map((el) => el.localName).sort()).toEqual(['div', 'iframe']);
    expect(detectPause(fixture.doc, form, null, undefined, { handed })).toBeNull();
    // A sign-in is never skipped for it, and a widget the page puts in its place is a new one.
    const other = fixture.doc.createElement('div');
    other.className = 'h-captcha';
    other.dataset.sitekey = 'x';
    other.style.cssText = 'width:304px;height:78px';
    form.append(other);
    expect(detectPause(fixture.doc, form, null, undefined, { handed })).toEqual({ kind: 'captcha', evidence: 'captcha-container' });
    other.remove();
    const label = fixture.doc.createElement('label');
    label.htmlFor = 'p';
    label.textContent = 'Password';
    const password = fixture.doc.createElement('input');
    password.id = 'p';
    password.type = 'password';
    form.append(label, password);
    expect(detectPause(fixture.doc, form, null, undefined, { handed })).toEqual({ kind: 'sign-in', evidence: 'password' });
  });

  it('counts the CAPTCHA widgets not known to be solved, handed or not (X-S4, tightened)', async () => {
    const count = async (body: string) => {
      const fixture = await loadFixture(document, `<!doctype html><body>${body}</body>`);
      const found = unsolvedCaptchas(fixture.doc, fixture.doc.querySelector('form'));
      removeFixtures(document);
      return found;
    };
    const recaptcha = (value: string) => `<form><div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px">
      <textarea name="g-recaptcha-response" style="display:none">${value}</textarea></div></form>`;
    expect(await count(recaptcha(''))).toBeGreaterThan(0);
    expect(await count(recaptcha('03AFcWeA-token'))).toBe(0);
    // A vendor with no token field in its widget is never known solved, whatever sits beside it.
    expect(await count(`<form><div id="arkose"><iframe srcdoc="" src="https://client-api.arkoselabs.com/fc/gc/?token=x"
      style="width:300px;height:200px"></iframe><input type="hidden" name="fc-token" value="solved"></div></form>`))
      .toBeGreaterThan(0);
    expect(await count('<form><label for="n">Full name</label><input id="n"></form>')).toBe(0);
  });

  it('counts the parent of an empty response field no documented container holds (the audit of 2026-11-06, S-7)',
    async () => {
      const count = async (body: string) => {
        const fixture = await loadFixture(document, `<!doctype html><body>${body}</body>`);
        const found = [unsolvedCaptchas(fixture.doc, fixture.doc.querySelector('form')),
          detectPause(fixture.doc, fixture.doc.querySelector('form'), null)?.kind ?? null];
        removeFixtures(document);
        return found;
      };
      // A widget rendered into the page's own element: no documented class names it, only the vendor's field inside.
      for (const field of ['<textarea name="g-recaptcha-response" style="display:none">VALUE</textarea>',
        '<textarea name="h-captcha-response" style="display:none">VALUE</textarea>',
        '<input type="hidden" name="cf-turnstile-response" value="VALUE">']) {
        const widget = (value: string) => `<form><label for="n">Full name</label><input id="n">
          <div id="my-widget" style="width:304px;height:78px">${field.replace('VALUE', value)}</div></form>`;
        expect(await count(widget('')), field).toEqual([1, 'captcha']);
        expect(await count(widget('03AFcWeA-token')), field).toEqual([0, null]);
      }
      // Greenhouse's live markup: the invisible reCAPTCHA's field sits in its badge, which draws no challenge.
      expect(await count(`<form><label for="n">Full name</label><input id="n"></form>
        <div class="grecaptcha-badge" data-style="bottomright" style="width:256px;height:60px;position:fixed;bottom:14px;right:-186px">
        <div class="grecaptcha-logo"></div><div class="grecaptcha-error"></div>
        <textarea id="g-recaptcha-response-100000" name="g-recaptcha-response" class="g-recaptcha-response"
          style="width:250px;height:40px;display:none"></textarea></div>`)).toEqual([0, null]);
      // iCIMS's live markup: an invisible hCaptcha's field in its documented container, which says so.
      expect(await count(`<form><div id="h-captcha" class="h-captcha" data-sitekey="x" data-size="invisible">
        <textarea name="h-captcha-response" style="display:none;"></textarea></div></form>`)).toEqual([0, null]);
      // A field whose parent shows nothing (no size) is no challenge shown.
      expect(await count(`<form><div style="width:0;height:0;overflow:hidden">
        <textarea name="g-recaptcha-response" style="display:none"></textarea></div></form>`)).toEqual([0, null]);
      // In a documented container it is that container's, counted once.
      expect(await count(`<form><div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px"><div
        style="width:304px;height:78px"><textarea name="g-recaptcha-response" style="display:none"></textarea></div></div>
        </form>`)).toEqual([1, 'captcha']);
    });

  it('reads the whole page for a press, as Sign-in Auto does, but takes a solved widget as solved (S-7)', async () => {
    const challenged = async (body: string) => {
      const fixture = await loadFixture(document, `<!doctype html><body>${body}</body>`);
      const form = fixture.doc.querySelector('form');
      const found = [unsolvedCaptchas(fixture.doc, form) > 0, pageChallenged(fixture.doc)];
      removeFixtures(document);
      return found;
    };
    const form = '<form style="height:200px"><label for="n">Full name</label><input id="n"></form>';
    const below = (widget: string) => `${form}<div style="margin-top:400px">${widget}</div>`;
    // A widget outside the form and away from it: the form's own reading misses it; the page's does not.
    expect(await challenged(below(`<div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px">
      <textarea name="g-recaptcha-response" style="display:none"></textarea></div>`))).toEqual([false, true]);
    // Solved (its token there): no press is held for it.
    expect(await challenged(below(`<div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px">
      <textarea name="g-recaptcha-response" style="display:none">03AFcWeA-token</textarea></div>`)))
      .toEqual([false, false]);
    // A frame of another origin that reads like a challenge holds a press too.
    expect(await challenged(below(`<iframe srcdoc="" src="https://shield.example/f" title="Human verification"
      style="width:300px;height:80px"></iframe>`))).toEqual([false, true]);
    expect(await challenged(form)).toEqual([false, false]);
  });
});

// ── The behaviour review of 2026-11-06 (B1, M6) ──
describe('the invisible reCAPTCHA badge holds no press (B1)', () => {
  afterEach(() => removeFixtures(document));

  /** The badge as every Greenhouse fixture draws it (fixtures/greenhouse/discord-job.html: div.grecaptcha-badge >
   *  div.grecaptcha-logo > iframe title="reCAPTCHA", an enterprise anchor with size=invisible), fixed at the corner. */
  const BADGE = `<div class="grecaptcha-badge" data-style="bottomright" style="width:256px;height:60px;position:fixed;
    bottom:14px;right:0"><div class="grecaptcha-logo"><iframe srcdoc="" title="reCAPTCHA" width="256" height="60"
    src="https://www.recaptcha.net/recaptcha/enterprise/anchor?ar=1&amp;k=x&amp;size=invisible"></iframe></div></div>`;
  /** Its challenge popup, as fixtures/dayforce/submit-challenge.html shows it once raised. */
  const BFRAME = (style: string) => `<div style="${style}"><div style="z-index:2000000000;position:relative;width:400px;
    height:580px"><iframe srcdoc="" title="recaptcha challenge expires in two minutes" style="width:400px;height:580px"
    src="https://www.google.com/recaptcha/api2/bframe?hl=en&amp;k=x"></iframe></div></div>`;
  const FORM = '<form><label for="n">Full name</label><input id="n"></form>';

  const read = async (body: string) => {
    const fixture = await loadFixture(document, `<!doctype html><body>${body}</body>`);
    const found = { like: challengeLikeFramesShown(fixture.doc), challenged: pageChallenged(fixture.doc),
      pause: detectPause(fixture.doc, fixture.doc.querySelector('form'), null)?.kind ?? null };
    removeFixtures(document);
    return found;
  };

  it('reads the badge as no challenge-like frame: nothing holds, nothing pauses', async () => {
    expect(await read(`${FORM}${BADGE}`)).toEqual({ like: 0, challenged: false, pause: null });
    // A frame in the badge, whatever its address says.
    expect(await read(`${FORM}${BADGE.replace('https://www.recaptcha.net/recaptcha/enterprise/anchor',
      'https://badge.example/anchor')}`)).toEqual({ like: 0, challenged: false, pause: null });
  });

  it('still reads its challenge popup once shown, a frame reading like a challenge beside it, and neither hidden',
    async () => {
      // The popup is a vendor's frame (shownCaptchas), no longer a challenge-like one (M6 below).
      expect(await read(`${FORM}${BADGE}${BFRAME('position:absolute;left:0;top:0;visibility:visible')}`))
        .toEqual({ like: 0, challenged: true, pause: 'captcha' });
      expect(await read(`${FORM}${BADGE}${BFRAME('position:absolute;left:0;top:-10000px;visibility:hidden')}`))
        .toEqual({ like: 0, challenged: false, pause: null });
      expect(await read(`${FORM}${BADGE}<iframe srcdoc="" src="https://shield.example/f" title="Human verification"
        style="width:300px;height:80px"></iframe>`)).toEqual({ like: 1, challenged: true, pause: null });
    });
});

describe('a checkbox widget never holds the fill (M6, the owner’s decision of 2026-11-06), nor since v5 a press', () => {
  afterEach(() => removeFixtures(document));

  /** reCAPTCHA v2's checkbox as fixtures/jazzhr/invaluable-form.html draws it: .g-recaptcha > div 304 x 78 > div >
   *  iframe (api2/anchor, size=normal), the empty response field beside it, and reCAPTCHA's hidden helper frame. */
  const RECAPTCHA = (token = '', size = 'normal', path = 'api2') => `<div class="g-recaptcha" data-sitekey="x"><div
    style="width:304px;height:78px"><div><iframe srcdoc="" title="reCAPTCHA" width="304" height="78"
    src="https://www.google.com/recaptcha/${path}/anchor?ar=1&amp;k=x&amp;size=${size}"></iframe></div><textarea
    id="g-recaptcha-response" name="g-recaptcha-response" class="g-recaptcha-response" style="display:none">${token}</textarea>
    </div><iframe style="display:none"></iframe></div>`;
  /** The same widget rendered into the page's own element (fixtures/bamboohr/swyfft-form.html: no documented class). */
  const EXPLICIT = (token = '') => `<div><div style="width:304px;height:78px"><div><iframe srcdoc="" title="reCAPTCHA"
    width="304" height="78" src="https://www.google.com/recaptcha/api2/anchor?ar=1&amp;k=x&amp;size=normal"></iframe></div>
    <textarea name="g-recaptcha-response" class="g-recaptcha-response" style="display:none">${token}</textarea></div></div>`;
  /** hCaptcha's checkbox or its challenge frame, at the addresses fixtures/icims/* show. */
  const HCAPTCHA = (frame: string) => `<div class="h-captcha" data-sitekey="x"><iframe srcdoc="" width="303" height="78"
    style="width:303px;height:78px" src="https://newassets.hcaptcha.com/captcha/v1/b/static/hcaptcha.html#frame=${frame}&amp;id=x"
    ></iframe><textarea name="h-captcha-response" style="display:none"></textarea></div>`;
  const POPUP = `<div style="position:absolute;left:0;top:0;visibility:visible"><iframe srcdoc=""
    title="recaptcha challenge expires in two minutes" style="width:400px;height:580px"
    src="https://www.google.com/recaptcha/api2/bframe?hl=en&amp;k=x"></iframe></div>`;
  const FORM = (widget: string) => `<form><label for="n">Full name</label><input id="n">${widget}</form>`;

  const read = async (body: string, adapter: Adapter | null = null) => {
    const fixture = await loadFixture(document, `<!doctype html><body>${body}</body>`);
    const form = fixture.doc.querySelector('form');
    const found = { pause: detectPause(fixture.doc, form, adapter)?.kind ?? null,
      unsolved: unsolvedCaptchas(fixture.doc, form), challenged: pageChallenged(fixture.doc),
      handed: captchaElements(fixture.doc, form).length, checkbox: checkboxCaptchasUnsolved(fixture.doc) };
    removeFixtures(document);
    return found;
  };

  it('fills a step whose only challenge is reCAPTCHA’s checkbox, and since v5 holds no press: the site decides', async () => {
    // Its anchor frame and its container: two widgets not known solved, both checkbox widgets; no pause, and (v5, PLAN
    // decision 9, like Jobright) no press held either.
    expect(await read(FORM(RECAPTCHA()))).toEqual({ pause: null, unsolved: 2, challenged: false, handed: 2, checkbox: 2 });
    expect(await read(FORM(EXPLICIT()))).toEqual({ pause: null, unsolved: 2, challenged: false, handed: 2, checkbox: 2 });
    // Solved (its token there): nothing counts, its frame included (its title still says reCAPTCHA).
    expect(await read(FORM(RECAPTCHA('03AFcWeA-token')))).toEqual({ pause: null, unsolved: 0, challenged: false,
      handed: 0, checkbox: 0 });
    expect(await read(FORM(EXPLICIT('03AFcWeA-token')))).toEqual({ pause: null, unsolved: 0, challenged: false,
      handed: 0, checkbox: 0 });
  });

  it('fills beside hCaptcha’s checkbox too, holding no press, and pauses once its challenge frame shows', async () => {
    expect(await read(FORM(HCAPTCHA('checkbox')))).toEqual({ pause: null, unsolved: 2, challenged: false, handed: 2,
      checkbox: 2 });
    expect(await read(FORM(HCAPTCHA('challenge')))).toMatchObject({ pause: 'captcha', challenged: true, checkbox: 0 });
  });

  it('pauses everything once the challenge popup shows, the checkbox beside it or not (adversarial)', async () => {
    expect(await read(`${FORM(RECAPTCHA())}${POPUP}`)).toMatchObject({ pause: 'captcha', challenged: true });
    expect(await read(`${FORM('')}${POPUP}`)).toMatchObject({ pause: 'captcha', challenged: true });
  });

  it('pauses for every widget not known to be a checkbox (adversarial)', async () => {
    // reCAPTCHA's anchor in another size, or Enterprise's (no snapshot shows either as a checkbox).
    expect((await read(FORM(RECAPTCHA('', 'compact')))).pause).toBe('captcha');
    expect((await read(FORM(RECAPTCHA('', 'normal', 'enterprise')))).pause).toBe('captcha');
    // A container that shows no frame (not drawn yet, or drawn where it cannot be read).
    expect((await read(FORM('<div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px"></div>')))
      .pause).toBe('captcha');
    // A checkbox's container that also shows another frame.
    expect((await read(FORM(RECAPTCHA().replace('<iframe style="display:none"></iframe>',
      '<iframe srcdoc="" src="https://www.example.com/x" style="width:300px;height:80px"></iframe>')))).pause)
      .toBe('captcha');
    // Another vendor beside the checkbox: Turnstile's widget, an Arkose frame.
    expect((await read(FORM(`${RECAPTCHA()}<div class="cf-turnstile" data-sitekey="x" style="width:300px;height:65px">
      </div>`))).pause).toBe('captcha');
    expect((await read(FORM(`${RECAPTCHA()}<iframe srcdoc="" src="https://client-api.arkoselabs.com/fc/gc/?token=x"
      style="width:300px;height:200px"></iframe>`))).pause).toBe('captcha');
    // v5 (PLAN decision 9): each of them holds every press, as before.
    expect((await read(FORM(RECAPTCHA('', 'compact')))).challenged).toBe(true);
    expect((await read(FORM('<div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px"></div>')))
      .challenged).toBe(true);
    expect((await read(FORM(`${RECAPTCHA()}<div class="cf-turnstile" data-sitekey="x" style="width:300px;height:65px">
      </div>`))).challenged).toBe(true);
  });

  it('leaves an account page the adapter names its own pause, Sign-in Auto no longer held by its checkbox (v5)', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body>${FORM(RECAPTCHA())}</body>`);
    const adapter = { authState: () => 'create-account' } as unknown as Adapter;
    expect(detectPause(fixture.doc, fixture.doc.querySelector('form'), adapter)).toEqual({ kind: 'create-account',
      evidence: 'adapter' });
    // What Sign-in Auto reads (content/sign-in.ts challenged): since v5 (PLAN decision 9) a checkbox widget's own frame
    // is no challenge frame there: it types and presses beside it, and the site decides.
    expect(vendorFramesShown(fixture.doc)).toBe(0);
    expect(pageChallenged(fixture.doc)).toBe(false);
    // Its challenge popup, once shown, is one.
    const popup = fixture.doc.createElement('iframe');
    popup.setAttribute('srcdoc', '');
    popup.title = 'recaptcha challenge expires in two minutes';
    popup.style.cssText = 'width:400px;height:580px';
    popup.setAttribute('src', 'https://www.google.com/recaptcha/api2/bframe?hl=en&k=x');
    fixture.doc.body.append(popup);
    expect(vendorFramesShown(fixture.doc)).toBe(1);
    expect(pageChallenged(fixture.doc)).toBe(true);
  });

  it('never makes the vendor’s response field a field of the step, shown or not (the run never touches the widget)',
    async () => {
      const fixture = await loadFixture(document, `<!doctype html><body>${FORM(RECAPTCHA())}</body>`);
      const form = fixture.doc.querySelector('form')!;
      const field = fixture.doc.querySelector<HTMLTextAreaElement>('textarea[name="g-recaptcha-response"]')!;
      // A page that shows it, labelled as a question.
      field.style.cssText = 'display:block;width:250px;height:40px';
      const label = fixture.doc.createElement('label');
      label.htmlFor = 'g-recaptcha-response';
      label.textContent = 'Cover letter';
      field.before(label);
      const fields = scan(form, null, { platform: 'greenhouse' }).fields;
      expect(fields.map((each) => each.label)).toEqual(['Full name']);
    });

  // ── v5 p1-rules: CAPTCHA like Jobright (PLAN decision 9) ──
  /** JazzHR's own "complete the reCAPTCHA" error as Jobright 1.25.2 reads it (#recaptcha-required-error.dv_error). */
  const JAZZ_ERROR = '<div id="recaptcha-required-error" class="dv_error">Please complete the reCAPTCHA.</div>';
  /** An adapter whose errors are the form's .dv_error and [role=alert] elements. */
  const ERRORS = { errors: (root: Element) => Array.from(root.querySelectorAll('.dv_error, [role="alert"]'))
    .map((el) => ({ el })) } as unknown as Adapter;

  it('reads a site’s CAPTCHA-required error by its own words, never another error', () => {
    const el = (attributes: Record<string, string>, text: string) => {
      const made = document.createElement('div');
      for (const [name, value] of Object.entries(attributes)) made.setAttribute(name, value);
      made.textContent = text;
      return made;
    };
    expect(isCaptchaError(el({ id: 'recaptcha-required-error', class: 'dv_error' }, 'This field is required.'))).toBe(true);
    expect(isCaptchaError(el({ class: 'field-error' }, 'Please verify you are not a robot'))).toBe(true);
    expect(isCaptchaError(el({ role: 'alert' }, 'Please confirm that you are human.'))).toBe(true);
    expect(isCaptchaError(el({ class: 'error' }, 'This field is required.'))).toBe(false);
    expect(isCaptchaError(el({ class: 'error' }, 'Contact Human Resources for help.'))).toBe(false);
    expect(isCaptchaError(el({ class: 'error' }, 'The robotics team needs a portfolio.'))).toBe(false);
  });

  it('reads a refusal for the unticked checkbox: its error, or a press the page did not take, never once it is solved',
    async () => {
      const refusal = async (body: string, afterPress: boolean) => {
        const fixture = await loadFixture(document, `<!doctype html><body>${body}</body>`);
        const form = fixture.doc.querySelector('form');
        const found = captchaRefusalShown(fixture.doc, form, ERRORS, { afterPress });
        removeFixtures(document);
        return found;
      };
      // The widget alone: no refusal before a press (the site decides), one after a press it did not take.
      expect(await refusal(FORM(RECAPTCHA()), false)).toBe(false);
      expect(await refusal(FORM(RECAPTCHA()), true)).toBe(true);
      // The site's own CAPTCHA error beside it is the refusal, press or not.
      expect(await refusal(FORM(`${RECAPTCHA()}${JAZZ_ERROR}`), false)).toBe(true);
      // Solved: none, whatever the page still shows.
      expect(await refusal(FORM(`${RECAPTCHA('03AFcWeA-token')}${JAZZ_ERROR}`), true)).toBe(false);
      // No checkbox widget (an invisible one, a popup, none): no refusal of this kind; another error is no refusal.
      expect(await refusal(FORM(JAZZ_ERROR), true)).toBe(false);
      expect(await refusal(FORM(`${RECAPTCHA()}<div class="dv_error">Phone is required.</div>`), false)).toBe(false);
      expect(await refusal(`${FORM(RECAPTCHA())}${POPUP}`, false)).toBe(false);
    });

  it('drops a CAPTCHA error the person’s solved check made stale, and keeps every other error', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body>${FORM(`${RECAPTCHA()}${JAZZ_ERROR}
      <div class="dv_error">Phone is required.</div>`)}</body>`);
    const form = fixture.doc.querySelector('form')!;
    const errors = ERRORS.errors!(form);
    expect(captchaErrorsShown(fixture.doc, form, ERRORS)).toHaveLength(1);
    expect(withoutSolvedCaptchaErrors(errors, fixture.doc)).toHaveLength(2);
    (fixture.doc.querySelector('textarea[name="g-recaptcha-response"]') as HTMLTextAreaElement).value = '03AFcWeA-token';
    expect(withoutSolvedCaptchaErrors(errors, fixture.doc).map((error) => error.el.textContent)).toEqual(['Phone is required.']);
  });
  // ── end v5 p1-rules ──
});
// ── end of the behaviour review's block ──
