import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { captchaElements, detectPause, unsolvedCaptchas } from './pause-detect';

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
    expect(await pauseOf(frame('https://www.google.com/recaptcha/api2/anchor?k=x&size=normal')))
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

  it('does not pause for the invisible reCAPTCHA badge or a widget bound to a button', async () => {
    expect(await pauseOf(`<form><button class="g-recaptcha" data-sitekey="x">Submit</button></form>
      <div class="grecaptcha-badge" style="width:256px;height:60px"><iframe srcdoc=""
      src="https://www.google.com/recaptcha/api2/anchor?k=x" style="width:256px;height:60px"></iframe></div>`)).toBeNull();
    expect(await pauseOf('<form><div class="h-captcha" data-sitekey="x" data-size="invisible" style="width:300px;height:80px"></div></form>'))
      .toBeNull();
  });

  it("takes the adapter's word for what its snapshots show", async () => {
    const adapter = { authState: () => 'entry-choice' } as unknown as Adapter;
    expect(await pauseOf('<form><label for="e">Email</label><input id="e"></form>', adapter))
      .toEqual({ kind: 'entry-choice', evidence: 'adapter' });
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
});
