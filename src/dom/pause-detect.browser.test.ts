import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { detectPause } from './pause-detect';

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
});
