/*
 * The snapshot converter (scripts/mhtml-to-fixture.mjs). A synthetic capture is built by hand in Blink's own MHTML
 * layout (quoted-printable and base64 parts, a cid: stylesheet holding rules only the CSSOM had, archived frames),
 * converted, and served back the way the e2e harness serves fixtures. The tests check what was inlined, removed and
 * redacted, what the route map answers, that every probe element is shown or hidden exactly as before conversion
 * (measured in Chromium), and that the converter refuses to write a fixture that leaks a listed string or makes a
 * request. A second capture comes from a live page through Chrome's own serializer (CDP Page.captureSnapshot), so
 * the converter is proven against the real format too. Last, the committed Lever and Greenhouse fixtures are checked
 * against their hand-written expectations, so the scanner's oracle stays coherent. Nothing here reaches the network:
 * every request is routed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { chromium, type Browser, type BrowserContext, type Frame } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConversionError,
  EMAIL_SOURCE,
  IMAGE_INLINE_MAX,
  PHONE_DIGITS,
  PHONE_SOURCE,
  ashbyRenderId,
  checkedForms,
  chosenMarksIn,
  clearChoicesInPage,
  CLOSED_ROOT_MARK,
  convertMhtml,
  FIXTURE_PLATFORMS,
  measureInPage,
  NEW_ATS_PLATFORMS,
  normaliseNewAts,
  redactNewAtsAddress,
  redactSignInTokens,
  stripJrId,
  CHOSEN_PLACES,
  // ── snapshot build 2026-11-06 (core pass Z1, item 36) ──
  CHOSEN_MARKS,
  PROFILE_PLACES,
  icimsRedactInPage,
  ENTRY_SUMMARY_CONTROLS,
  ENTRY_SUMMARY_PLACES,
  FILE_LINK_PLACES,
  FILE_NAME_PLACES,
  imageSize,
  INJECTED_PARAMS,
  INJECTED_UI,
  PER_LOAD_PARAMS,
  withoutInjectedParams,
  stripInjectedParams,
  // ── snapshot build 2026-11-06 (core pass Z1, item 38) ──
  tokenNeedles,
  redactApplicantTextInPage,
  normaliseAshby,
  normaliseTokens,
  normaliseWorkable,
  onAtsHost,
  parseMhtml,
  pruneCssInPage,
  PRUNED_CSS_PLATFORMS,
  // ── snapshot build 2026-11-06 (oracle-sf-sr) ──
  redactPlatformInPage,
  SHADOW_ROOT_PLATFORMS,
  readRedactList,
  redactSources,
  redactWorkdayInPage,
  workableRenderId,
  writeConversion,
} from '../scripts/mhtml-to-fixture.mjs';
import { FIELD_KINDS } from '../src/core/enums';
import { platformOfUrl } from '../src/shared/hosts';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'mhtml-to-fixture.mjs');

const PAGE = 'https://careers.tailorit-fixture.example/jobs/1';
const ORIGIN = 'https://careers.tailorit-fixture.example';
const EMBED = 'https://job-boards.greenhouse.io/embed/job_app?for=tailoritfixture&token=1';
const CAPTCHA = 'https://captcha.tailorit-fixture.example/anchor?k=site-key#frame=1';
const VIEWPORT = { width: 1280, height: 900 };
/** The owner's strings in the redact file: a name, and a phone number written without punctuation. */
const LISTED = ['Jane Roe', '5550100142'];

// ---------------------------------------------------------------------------------------------------------------------
// Building a capture
// ---------------------------------------------------------------------------------------------------------------------

/** A valid RGB PNG: flat grey, or noise that does not compress (to pass IMAGE_INLINE_MAX). */
function png(width: number, height: number, noise: boolean): Buffer {
  const row = 1 + width * 3;
  const raw = Buffer.alloc(row * height, 0x80);
  let seed = 0x2545f491;
  for (let y = 0; y < height; y += 1) {
    raw[y * row] = 0;
    if (!noise) continue;
    for (let x = 1; x < row; x += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      raw[y * row + x] = seed & 0xff;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))]);
}

/** Quoted-printable as Blink writes it: =XX for "=" and non-ASCII bytes, soft line breaks before 76 characters. */
function quotedPrintable(text: string): string {
  const lines: string[] = [];
  let line = '';
  for (const byte of Buffer.from(text, 'utf8')) {
    if (byte === 0x0a) {
      lines.push(line);
      line = '';
      continue;
    }
    const token = byte === 0x0d ? '' : byte >= 0x20 && byte < 0x7f && byte !== 0x3d ? String.fromCharCode(byte)
      : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    if (line.length + token.length > 75) {
      lines.push(`${line}=`);
      line = '';
    }
    line += token;
  }
  lines.push(line);
  return lines.join('\r\n');
}

interface Part {
  type: string;
  location?: string;
  id?: string;
  body: string | Buffer;
}

/** An MHTML archive in Blink's layout: headers, then each part quoted-printable (text) or base64 (binary). */
function mhtml(snapshot: string, parts: Part[]): Buffer {
  const boundary = '----MultipartBoundary--tailoritFixtureTest----';
  const out = ['From: <Saved by Blink>', `Snapshot-Content-Location: ${snapshot}`, 'Subject: Synthetic',
    'Date: Thu, 29 Oct 2026 22:38:44 GMT', 'MIME-Version: 1.0', 'Content-Type: multipart/related;',
    '\ttype="text/html";', `\tboundary="${boundary}"`, '', ''];
  for (const part of parts) {
    out.push(`--${boundary}`, `Content-Type: ${part.type}`);
    if (part.id) out.push(`Content-ID: <${part.id}>`);
    const binary = Buffer.isBuffer(part.body);
    out.push(`Content-Transfer-Encoding: ${binary ? 'base64' : 'quoted-printable'}`);
    if (part.location) out.push(`Content-Location: ${part.location}`);
    out.push('', binary ? (part.body.toString('base64').match(/.{1,76}/g) ?? []).join('\r\n') : quotedPrintable(String(part.body)));
  }
  out.push(`--${boundary}--`, '');
  return Buffer.from(out.join('\r\n'), 'latin1');
}

/** The synthetic company page: every kind of thing the converter inlines, removes or redacts, and probe elements.
 *  With `encoded`, a link also carries the owner's name percent-encoded, which the DOM redaction cannot see. */
const mainHtml = (encoded: boolean) => `<!DOCTYPE html><html lang="en"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<link rel="stylesheet" type="text/css" href="cid:css-cssom@mhtml.blink" />
<link rel="stylesheet" href="${ORIGIN}/site.css">
<link rel="preload" href="${ORIGIN}/font.woff2" as="font"><link rel="icon" href="${ORIGIN}/icon.png">
<link rel="canonical" href="${PAGE}"><base href="${ORIGIN}/"><meta http-equiv="refresh" content="3600">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'">
<title>Application for Jane Roe</title><script>window.stolen = true;</script>
<style>.order-b { display: none; } .bg { background-image: url(/badge.png); width: 20px; height: 20px; }</style>
</head><body onload="steal()">
<h1 data-probe="heading" data-expect="shown">Apply to Fixture Co</h1>
<p data-probe="cssom-hidden" data-expect="hidden" class="cssom-hidden">Hidden by a rule only the CSSOM held</p>
<p data-probe="ext-hidden" data-expect="hidden" class="ext-hidden">Hidden by the external stylesheet</p>
<p data-probe="ext-invisible" data-expect="hidden" class="ext-invisible">visibility: hidden</p>
<p data-probe="ext-transparent" data-expect="hidden" class="ext-transparent">opacity: 0</p>
<p data-probe="tiny" data-expect="hidden" class="tiny">Two pixels square</p>
<p data-probe="offscreen" data-expect="hidden" class="offscreen">Off the left edge</p>
<p data-probe="order-a" data-expect="shown" class="order-a">Hidden by the CSSOM sheet, shown again by the later one</p>
<p data-probe="order-b" data-expect="hidden" class="order-b">Shown by the external sheet, hidden by the later style</p>
<p data-probe="attr-hidden" data-expect="hidden" hidden>The hidden attribute</p>
<p data-probe="inline-hidden" data-expect="hidden" style="display:none">An inline style</p>
<div data-probe="background" data-expect="shown" class="bg"></div>
<img data-probe="logo" data-expect="shown" alt="Logo" src="${ORIGIN}/logo.png" srcset="${ORIGIN}/logo.png 1x">
<img data-probe="banner" data-expect="shown" alt="Banner" src="${ORIGIN}/banner.png" loading="lazy">
<p>Welcome back, Jane Roe. <!-- prepared for Jane Roe --> Questions: jobs@tailorit-fixture.example or
+1 (555) 010-0199, or our office line 555-010-0142.</p>
<p><a href="mailto:jobs@tailorit-fixture.example">Write to us</a> <a href="tel:+15550100199">Call us</a>
<a href="javascript:alert(1)">Run</a> <a href="java&#9;script:alert(2)">Run too</a>${encoded ? ` <a href="${ORIGIN}/search?q=Jane%20Roe">Jobs like yours</a>` : ''}</p>
<form action="${ORIGIN}/apply" method="get">
<label for="first" data-probe="label" data-expect="shown">First name</label>
<input id="first" name="first" data-probe="first" data-expect="shown" value="Jane typed" title="Jane Roe" data-owner="jane roe">
<input type="hidden" name="csrf" value="csrf-0123456789abcdefghij">
<input type="checkbox" id="agree" checked><label for="agree">I agree</label>
<select id="state"><option>Texas</option><option selected>Ohio</option></select>
<textarea id="cover">I typed this cover letter</textarea>
<div class="select__control"><div class="select__single-value">Austin, TX</div><div class="select__input-container" data-value="Aus"><input role="combobox" aria-expanded="true" value="Aus"></div></div>
<div role="listbox"><div role="option">Austin, TX</div><div role="option">Dallas, TX</div></div>
<div class="select__multi-value"><div class="select__multi-value__label">Python</div><div class="select__multi-value__remove">x</div></div>
<button type="button" aria-haspopup="listbox">Female</button>
<button type="submit" onclick="send()" formaction="https://evil.tailorit-fixture.example/x" formmethod="get">Submit</button>
</form>
<noscript><img src="${ORIGIN}/pixel.gif"></noscript><object data="${ORIGIN}/plugin.swf"></object><embed src="${ORIGIN}/plugin.swf">
<iframe data-probe="embed" data-expect="shown" src="cid:frame-EMBED@mhtml.blink" width="400" height="300"></iframe>
<iframe src="cid:frame-CAPTCHA@mhtml.blink" width="300" height="80"></iframe>
<iframe src="cid:frame-BLANK@mhtml.blink" width="10" height="10"></iframe>
<iframe srcdoc="&lt;script&gt;parent.stolen = true&lt;/script&gt;" width="10" height="10"></iframe>
<iframe src="data:text/html,%3Cscript%3Eparent.stolen%3Dtrue%3C/script%3E" width="10" height="10"></iframe>
</body></html>`;

const EMBED_HTML = `<!DOCTYPE html><html><head><link rel="stylesheet" href="https://job-boards.greenhouse.io/frame.css"></head>
<body><form action="https://job-boards.greenhouse.io/embed/job_app" method="post">
<label for="email" data-probe="frame-label" data-expect="shown">Email</label>
<input id="email" data-probe="frame-email" data-expect="shown" value="jane.roe@tailorit-fixture.example">
<p class="frame-hidden" data-probe="frame-hidden" data-expect="hidden">Hidden inside the frame</p>
</form></body></html>`;

const SITE_CSS = `@charset "utf-8";
.ext-hidden { display: none; }
.ext-invisible { visibility: hidden; }
.ext-transparent { opacity: 0; }
.tiny { display: block; width: 2px; height: 2px; overflow: hidden; }
.offscreen { position: absolute; left: -9999px; }
.order-a { display: block; }
.order-b { display: block; }
@font-face { font-family: Fixture; src: url("/font.woff2") format("woff2"); }
.badge { background: url("badge.png"); }`;

/** The synthetic capture: the page, a cid: sheet, the stylesheets, three images and three frames. */
function syntheticCapture(encoded = false): Buffer {
  return mhtml(PAGE, [
    { type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: PAGE, body: mainHtml(encoded) },
    { type: 'text/css', location: 'cid:css-cssom@mhtml.blink', body: '@charset "utf-8";\n.cssom-hidden { display: none; }\n.order-a { display: none; }' },
    { type: 'text/css', location: `${ORIGIN}/site.css`, body: SITE_CSS },
    { type: 'image/png', location: `${ORIGIN}/logo.png`, body: png(8, 6, false) },
    { type: 'application/octet-stream', location: `${ORIGIN}/badge.png`, body: png(4, 4, false) },
    { type: 'image/png', location: `${ORIGIN}/banner.png`, body: png(300, 200, true) },
    { type: 'text/html', id: 'frame-EMBED@mhtml.blink', location: EMBED, body: EMBED_HTML },
    { type: 'text/css', location: 'https://job-boards.greenhouse.io/frame.css', body: '.frame-hidden { display: none; }' },
    { type: 'text/html', id: 'frame-CAPTCHA@mhtml.blink', location: CAPTCHA,
      body: '<html><body><input type="hidden" value="captcha-token-0123456789abcdef">I am a captcha</body></html>' },
    { type: 'text/html', id: 'frame-BLANK@mhtml.blink', body: '<html><head></head><body></body></html>' },
  ]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------------------------------------------------

/** Each probe's state, measured independently of the converter: Chromium's checkVisibility, a box of at least 4 px,
 *  and a box on the page (document coordinates). */
async function probes(frame: Frame): Promise<Record<string, string>> {
  return frame.evaluate(() => {
    const states: Record<string, string> = {};
    for (const element of document.querySelectorAll<HTMLElement>('[data-probe]')) {
      const rect = element.getBoundingClientRect();
      const shown = element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && rect.width >= 4 &&
        rect.height >= 4 && rect.right + window.scrollX > 0 && rect.bottom + window.scrollY > 0;
      states[element.dataset.probe ?? ''] = shown ? 'shown' : 'hidden';
    }
    return states;
  });
}

/** Each probe's expected state, as the page declares it. */
async function expected(frame: Frame): Promise<Record<string, string>> {
  return frame.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLElement>('[data-probe]')]
    .map((element) => [element.dataset.probe ?? '', element.dataset.expect ?? ''])));
}

/** The frame of a page whose address starts with `prefix`. */
function frameAt(frames: Frame[], prefix: string): Frame {
  const frame = frames.find((candidate) => candidate.url().startsWith(prefix));
  if (!frame) throw new Error(`no frame at ${prefix}`);
  return frame;
}

let browser: Browser;
let work: string;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  work = mkdtempSync(join(tmpdir(), 'tailorit-mhtml-'));
});

afterAll(async () => {
  await browser?.close();
  if (work) rmSync(work, { recursive: true, force: true });
});

/** A context that answers the route map's addresses from the conversion's files and records anything else. */
async function servedContext(conversion: Awaited<ReturnType<typeof convertMhtml>>): Promise<{ context: BrowserContext; unexpected: string[] }> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const unexpected: string[] = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    const path = conversion.routes[url];
    const file = conversion.files.find((output) => output.path.split('\\').join('/') === path);
    if (file) return route.fulfill({ status: 200, contentType: 'text/html', body: file.text });
    if (new URL(url).pathname !== '/favicon.ico') unexpected.push(url);
    return route.abort();
  });
  return { context, unexpected };
}

// ---------------------------------------------------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------------------------------------------------

describe('mhtml-to-fixture on a synthetic capture', () => {
  let conversion: Awaited<ReturnType<typeof convertMhtml>>;
  let main: string;
  let frame: string;
  let file: string;

  beforeAll(async () => {
    file = join(work, 'synthetic.mhtml');
    writeFileSync(file, syntheticCapture());
    conversion = await convertMhtml({ file, platform: 'greenhouse', caseName: 'synthetic', redact: LISTED, outDir: work });
    main = conversion.files.find((output) => output.path.endsWith('synthetic.html'))?.text ?? '';
    frame = conversion.files.find((output) => output.path.endsWith('synthetic.frame-1.html'))?.text ?? '';
  }, 60_000);

  it('writes the page, its ATS frame, a stand-in for the third-party frame, and a route map for all three', () => {
    const names = conversion.files.map((output) => output.path.split(/[\\/]/).pop());
    expect(names).toEqual(['synthetic.html', 'synthetic.frame-1.html', 'synthetic.third-party-frame.html']);
    const folder = join(work, 'greenhouse').split('\\').join('/');
    expect(conversion.routes).toEqual({
      [PAGE]: `${folder}/synthetic.html`,
      [EMBED]: `${folder}/synthetic.frame-1.html`,
      [CAPTCHA.split('#')[0] ?? '']: `${folder}/synthetic.third-party-frame.html`,
    });
    // The frames point at their own addresses; the frame without one is left blank.
    expect(main).toContain(`src="${EMBED.replace(/&/g, '&amp;')}"`);
    expect(main).toContain(`src="${CAPTCHA}"`);
    expect(main).not.toContain('cid:');
    // A data: frame would run its own scripts in the fixture: it is blanked like the frame with no web address.
    expect(main).not.toContain('src="data:text/html');
    expect(main).toContain('<iframe width="10" height="10"></iframe>');
    const standIn = conversion.files[2]?.text ?? '';
    expect(standIn).not.toContain('captcha-token');
    expect(standIn).not.toContain('I am a captcha');
  });

  it('records the source, the capture date, the Chrome version and the counts in each header', () => {
    const header = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(main)?.[1] ?? '{}');
    expect(header).toMatchObject({ fixture: 'greenhouse/synthetic', source: PAGE, captured: '2026-10-29T22:38:44.000Z' });
    expect(header.chrome).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(header.chrome).toBe(conversion.chrome);
    expect(header.redacted).toEqual({ typedValues: 4, checked: 1, selected: 1, hiddenValues: 1, widgetText: 3,
      emails: 2, phones: 2, listed: 6 });
    expect(header.removed).toMatchObject({ scripts: 2, eventHandlers: 2, javascriptUrls: 2, bases: 1, metaRefresh: 1,
      metaHttpEquiv: 2, embeds: 2, links: 2, srcdoc: 1 });
    expect(header.inlined).toEqual({ stylesheets: 2, images: 4, placeholders: 1, missing: 1 });
    expect(header.frames).toEqual({ linked: 2, blanked: 2 });
    const frameHeader = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(frame)?.[1] ?? '{}');
    expect(frameHeader).toMatchObject({ fixture: 'greenhouse/synthetic.frame-1', source: EMBED });
    expect(frameHeader.redacted.typedValues).toBe(1);
  });

  it('inlines every stylesheet in place and every image as a data: URI, with a same-size stand-in for a large one', () => {
    expect(main).not.toMatch(/<link[^>]*stylesheet/i);
    expect(main).toContain('.cssom-hidden { display: none; }');
    expect(main).toContain('.ext-hidden { display: none; }');
    // The CSSOM sheet still comes before the external one, and the page's own style after both.
    expect(main.indexOf('.cssom-hidden')).toBeLessThan(main.indexOf('.ext-hidden'));
    expect(main.indexOf('.ext-hidden')).toBeLessThan(main.indexOf('.order-b { display: none; }'));
    expect(main).toContain(`src="data:image/png;base64,${png(8, 6, false).toString('base64')}"`);
    expect(main).toContain(`url("data:image/png;base64,${png(4, 4, false).toString('base64')}")`);
    expect(main).toContain('src="data:image/svg+xml;base64,');
    expect(Buffer.from(/src="data:image\/svg\+xml;base64,([^"]+)"/.exec(main)?.[1] ?? '', 'base64').toString())
      .toContain('width="300" height="200"');
    expect(main).toContain('src: url("data:,") format("woff2")');
    expect(main).not.toMatch(/srcset=|loading=/);
    expect(main).toContain(`<link rel="canonical" href="${PAGE}">`);
    expect(frame).toContain('.frame-hidden { display: none; }');
  });

  it('removes scripts, handlers, javascript: URLs, base, meta http-equiv, plugins and srcdoc, and sends forms to /__submitted', () => {
    // The page after its header comment (the header's counts name the things removed).
    for (const text of [main, frame].map((file) => file.slice(file.indexOf('-->') + 3))) {
      expect(text).not.toMatch(/<script|<noscript|<base|http-equiv|<object|<embed|srcdoc|javascript:|\son[a-z]+=/i);
      expect(text).not.toMatch(/stolen|steal\(|send\(/);
    }
    expect(main).toContain('<form action="/__submitted" method="post">');
    expect(main).toContain('formaction="/__submitted"');
    expect(main).not.toContain('formmethod');
    expect(main).not.toContain('evil.tailorit-fixture');
    expect(frame).toContain('<form action="/__submitted" method="post">');
    expect(main.indexOf('<meta charset="utf-8">')).toBe(main.indexOf('<head>') + '<head>'.length);
    // The archive's quoted-printable text breaks lines with CR LF; the fixture uses LF, as git stores it.
    for (const output of conversion.files) expect(output.text.includes('\r'), output.path).toBe(false);
  });

  it('clears typed values and choices, and redacts hidden values, widget text, emails, phones and listed strings', () => {
    expect(main).toContain('<input id="first" name="first" data-probe="first" data-expect="shown" value="" title="REDACTED" data-owner="REDACTED">');
    expect(main).toContain('<textarea id="cover"></textarea>');
    expect(main).toContain('<input type="checkbox" id="agree">');
    expect(main).toContain('<option>Ohio</option>');
    expect(main).toContain('<input type="hidden" name="csrf" value="REDACTED">');
    expect(main).toContain('<div class="select__single-value">REDACTED</div>');
    expect(main).toContain('data-value=""');
    expect(main).toContain('<div class="select__multi-value"><div class="select__multi-value__label">REDACTED</div><div class="select__multi-value__remove">REDACTED</div></div>');
    expect(main).toContain('<button type="button" aria-haspopup="listbox">REDACTED</button>');
    // Option text is page text, not a choice: it stays.
    expect(main).toContain('<div role="option">Austin, TX</div><div role="option">Dallas, TX</div>');
    expect(main).toContain('<title>Application for REDACTED</title>');
    expect(main).toContain('<!-- prepared for REDACTED -->');
    expect(main).toContain('href="mailto:REDACTED"');
    expect(main).toContain('href="tel:REDACTED"');
    for (const text of [main, frame]) {
      expect(text.toLowerCase()).not.toMatch(/jane roe|jane typed|cover letter|csrf-0123|@tailorit-fixture/);
      expect(text).not.toMatch(/010-0199|010-0142|5550100199|Aus"/);
    }
  });

  it('keeps every element shown or hidden exactly as Chromium rendered the capture', async () => {
    // Before: Chromium renders the capture itself, without the page's CSP, as the converter does (the fixture drops
    // the CSP meta, which would otherwise block the capture's own cid: frames).
    const original = await browser.newContext({ javaScriptEnabled: false, bypassCSP: true, viewport: VIEWPORT });
    await original.route(/^https?:/, (route) => route.abort());
    const page = await original.newPage();
    await page.goto(pathToFileURL(file).href);
    const before = { main: await probes(page.mainFrame()), frame: await probes(frameAt(page.frames(), 'cid:frame-EMBED')) };
    const wanted = { main: await expected(page.mainFrame()), frame: await expected(frameAt(page.frames(), 'cid:frame-EMBED')) };
    await original.close();
    // After: the fixture, served at its real addresses with JavaScript on, as the e2e harness serves it.
    const { context, unexpected } = await servedContext(conversion);
    const served = await context.newPage();
    await served.goto(PAGE);
    const after = { main: await probes(served.mainFrame()), frame: await probes(frameAt(served.frames(), EMBED)) };
    await context.close();
    expect(Object.keys(before.main)).toHaveLength(17);
    expect(before).toEqual(wanted);
    expect(after).toEqual(before);
    expect(unexpected).toEqual([]);
  }, 60_000);
});

describe('mhtml-to-fixture refusals', () => {
  it('refuses a listed string that survives percent-encoded, and names the entry, not the value', async () => {
    const file = join(work, 'refuse.mhtml');
    writeFileSync(file, syntheticCapture(true));
    const error = await convertMhtml({ file, platform: 'greenhouse', caseName: 'refuse', redact: ['Jane Roe'], outDir: work })
      .then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConversionError);
    const reasons = (error as ConversionError).reasons;
    expect(reasons).toEqual(['refuse.html: redact entry 1 is still in the file']);
    expect(reasons.join(' ')).not.toContain('Jane');
    expect(existsSync(join(work, 'greenhouse', 'refuse.html'))).toBe(false);
  }, 60_000);

  it('refuses a fixture that would make a request the route map does not answer', async () => {
    const file = join(work, 'request.mhtml');
    const html = '<!DOCTYPE html><html><head><style>.x { background-image: image-set("https://cdn.tailorit-fixture.example/x.png" 1x); width: 9px; height: 9px; }</style></head><body><div class="x"></div></body></html>';
    writeFileSync(file, mhtml(PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: PAGE, body: html }]));
    await expect(convertMhtml({ file, platform: 'lever', caseName: 'request', outDir: work }))
      .rejects.toThrow('the fixture requests 1 addresses the route map does not answer: cdn.tailorit-fixture.example');
  }, 60_000);

  it('refuses bad arguments before opening a browser', async () => {
    // ── snapshot build 2026-11-06 (oracle-sf-sr): SmartRecruiters is a platform now (and BambooHR, a new ATS); one that is
    // neither is not ──
    await expect(convertMhtml({ file: 'x.mhtml', platform: 'teamtailor', caseName: 'x' })).rejects.toThrow('--platform must be one of');
    await expect(convertMhtml({ file: 'x.mhtml', platform: 'lever', caseName: 'Not A Case' })).rejects.toThrow('--case must be');
    await expect(convertMhtml({ file: 'x.html', platform: 'lever', caseName: 'x' })).rejects.toThrow('must be an .mhtml file');
  });
});

describe('mhtml-to-fixture on a live page saved by Chrome itself', () => {
  // Chrome's serializer saves every <style> as a cid: sheet ahead of the page's <link> sheets and drops
  // adoptedStyleSheets, so a capture can differ from the live page where the cascade order decides; the probes here
  // do not depend on it (docs/FIXTURES.md).
  it('keeps the visibility of every probe, CSSOM-only rules and a cross-origin frame included', async () => {
    const live = await browser.newContext({ viewport: VIEWPORT });
    const pages: Record<string, { type: string; body: string | Buffer }> = {
      [PAGE]: { type: 'text/html', body: `<!DOCTYPE html><html><head><link rel="stylesheet" href="/site.css"><style id="js"></style>
<script>document.getElementById('js').sheet.insertRule('.js-hidden { display: none; }');
document.getElementById('js').sheet.insertRule('.js-tiny { display: block; width: 3px; height: 3px; overflow: hidden; }');</script></head><body>
<p data-probe="js-hidden" class="js-hidden">Hidden by a rule a script inserted</p>
<p data-probe="ext-hidden" class="ext-hidden">Hidden by the external sheet</p>
<p data-probe="js-tiny" class="js-tiny">Three pixels square, by a rule a script inserted</p>
<p data-probe="ext-shown" class="ext-shown">Shown</p>
<label for="name" data-probe="label">Name</label><input id="name" data-probe="name">
<img data-probe="logo" src="/logo.png"><iframe data-probe="embed" src="${EMBED}" width="400" height="200"></iframe>
<script>document.getElementById('name').setAttribute('value', 'Jane Roe');</script></body></html>` },
      [`${ORIGIN}/site.css`]: { type: 'text/css', body: '.ext-hidden { display: none; } .ext-shown { display: block; }' },
      [`${ORIGIN}/logo.png`]: { type: 'image/png', body: png(8, 6, false) },
      [EMBED]: { type: 'text/html', body: `<!DOCTYPE html><html><head><style>.frame-hidden { visibility: hidden; }</style></head>
<body><label for="e" data-probe="frame-label">Email</label><input id="e" data-probe="frame-email" type="email">
<p class="frame-hidden" data-probe="frame-hidden">Hidden inside the frame</p></body></html>` },
    };
    await live.route('**/*', (route) => {
      const entry = pages[route.request().url()];
      return entry ? route.fulfill({ status: 200, contentType: entry.type, body: entry.body }) : route.abort();
    });
    const page = await live.newPage();
    await page.goto(PAGE);
    const before = { main: await probes(page.mainFrame()), frame: await probes(frameAt(page.frames(), EMBED)) };
    const session = await live.newCDPSession(page);
    const { data } = await session.send('Page.captureSnapshot', { format: 'mhtml' });
    await live.close();
    const file = join(work, 'live.mhtml');
    writeFileSync(file, data);

    const conversion = await convertMhtml({ file, platform: 'greenhouse', caseName: 'live', redact: ['Jane Roe'], outDir: work });
    const { context, unexpected } = await servedContext(conversion);
    const served = await context.newPage();
    await served.goto(PAGE);
    const after = { main: await probes(served.mainFrame()), frame: await probes(frameAt(served.frames(), EMBED)) };
    await context.close();
    expect(before.main).toEqual({ 'js-hidden': 'hidden', 'ext-hidden': 'hidden', 'js-tiny': 'hidden', 'ext-shown': 'shown',
      label: 'shown', name: 'shown', logo: 'shown', embed: 'shown' });
    expect(before.frame).toEqual({ 'frame-label': 'shown', 'frame-email': 'shown', 'frame-hidden': 'hidden' });
    expect(after).toEqual(before);
    expect(unexpected).toEqual([]);
    const text = conversion.files.map((output) => output.text).join('\n');
    expect(text).not.toMatch(/<script|Jane Roe/);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------------
// ── New ATSs (DESIGN-NEW-ATS §6, Phase 0): hosts and paths, open shadow roots, animations, the applicant's own text at
// each §6.4 place, Jobright's jr_id and the new platforms' per-load values. Every value below is made up. ──
// ---------------------------------------------------------------------------------------------------------------------

/** A new ATS's page: Jobvite's host, the reserved fixture company, with Jobright's jr_id in its address. */
const NEW_PAGE = 'https://jobs.jobvite.com/tailorit-fixture/job/oFixture1/apply?jr_id=0123456789abcdefABCDEF01';
const NEW_PAGE_CLEAN = 'https://jobs.jobvite.com/tailorit-fixture/job/oFixture1/apply';
/** A made-up applicant: a first name, a file name and a skill none of the redact list holds. */
const FIRST = 'Avery';
const FILE_NAME = 'cv final 2026.pdf';

/** Each probe's state, as measureInPage reads it, in the document and in every open shadow root (nested ones too). */
async function deepProbes(frame: Frame): Promise<Record<string, string>> {
  return frame.evaluate(() => {
    const states: Record<string, string> = {};
    const visit = (scope: ParentNode) => {
      for (const element of scope.querySelectorAll<HTMLElement>('*')) {
        if (element.dataset.probe !== undefined) {
          const rect = element.getBoundingClientRect();
          const shown = element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && rect.width >= 4
            && rect.height >= 4;
          states[element.dataset.probe] = shown ? 'shown' : 'hidden';
        }
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(document);
    return states;
  });
}

describe('mhtml-to-fixture on the new ATSs (DESIGN-NEW-ATS §6)', () => {
  it("converts the new ATSs' frames on their candidate paths alone, as src/shared/hosts.ts reads them", () => {
    for (const url of ['https://jobs.jobvite.com/acme/job/x/apply', 'https://acme.applytojob.com/apply/x/y',
      'https://acme.applytojob.com/', 'https://www.applytojob.com/apply/x', 'https://ats.rippling.com/acme/jobs/x',
      'https://acme.breezy.hr/p/x', 'https://acme.breezy.hr/', 'https://acme.careerplug.com/jobs/1/apps/new',
      'https://acme.pinpointhq.com/en/postings/x', 'https://app.pinpointhq.com/en/postings/x', 'https://acme.pinpointhq.com/fr/x',
      'https://recruitingbypaycor.com/career/x', 'https://acme.careers.hibob.com/jobs/x',
      'https://recruiting.ultipro.com/ACM1000/JobBoard/x/OpportunityApply', 'https://recruiting.ultipro.com/silent-callback.html',
      'https://jobs.dayforcehcm.com/en-US/acme/x', 'https://recruiting.paylocity.com/Recruiting/Jobs/Apply/1',
      'https://recruiting.paylocity.com/x', 'https://www.dice.com/job-applications/x/wizard', 'https://www.dice.com/dashboard/x',
      'https://acme.clearcompany.com/careers/jobs/x', 'https://acme.clearcompany.com/blank/page',
      'https://cc-app-static.clearcompany.com/careers/x', 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/x.html',
      'https://workforcenow.adp.com/theme/index.html', 'https://acme.bamboohr.com/careers/1', 'https://acme.bamboohr.com/home',
      'https://www.paycomonline.net/v4/ats/web.php/portal/x', 'https://jobs.dfinsolutions.com/job/x', 'http://jobs.jobvite.com/x']) {
      expect(onAtsHost(url), url).toBe(platformOfUrl(url) !== null);
    }
    for (const platform of NEW_ATS_PLATFORMS) expect(FIXTURE_PLATFORMS, platform).toContain(platform);
    expect(NEW_ATS_PLATFORMS).toHaveLength(15);
  });

  it('keeps open shadow roots, nested ones too, as declarative shadow DOM: redacted inside and measured inside', async () => {
    const live = await browser.newContext({ viewport: VIEWPORT });
    await live.route('**/*', (route) => (route.request().url() === NEW_PAGE ? route.fulfill({ status: 200,
      contentType: 'text/html', body: `<!DOCTYPE html><html><body><h1 data-probe="light">Apply</h1>
<x-field id="host" data-probe="host" style="display:block"></x-field>
<script>
const root = document.getElementById('host').attachShadow({ mode: 'open' });
root.innerHTML = '<label for="i" data-probe="shadow-label">Name</label><input id="i" data-probe="shadow-input" value="${FIRST} typed">'
  + '<p data-probe="shadow-hidden" style="display:none">Hidden in the root</p><p>Write to ${FIRST.toLowerCase()}@example.test</p>'
  + '<span class="filename">${FILE_NAME}</span><y-nested id="n" data-probe="nested-host" style="display:block"></y-nested>'
  + '<a href="https://jobs.jobvite.com/x?jr_id=0123456789abcdefABCDEF01&amp;src=1">Back</a>';
root.getElementById('n').attachShadow({ mode: 'open' }).innerHTML = '<b data-probe="nested">Nested</b>'
  + '<input type="checkbox" checked data-probe="nested-box">';
</script></body></html>` }) : route.abort()));
    const page = await live.newPage();
    await page.goto(NEW_PAGE);
    const before = await deepProbes(page.mainFrame());
    const session = await live.newCDPSession(page);
    const { data } = await session.send('Page.captureSnapshot', { format: 'mhtml' });
    await live.close();
    const file = join(work, 'shadow.mhtml');
    writeFileSync(file, data);

    const conversion = await convertMhtml({ file, platform: 'jobvite', caseName: 'shadow', redact: LISTED, outDir: work });
    const text = conversion.files.map((output) => output.text).join('\n');
    expect(text.match(/<template shadowrootmode="open">/g)).toHaveLength(2);
    expect(text).not.toMatch(/shadowmode=/);
    // Redacted inside the roots: the typed value, the checked box, the email, the file name; jr_id gone everywhere.
    expect(text).not.toMatch(new RegExp(`${FIRST}|example\\.test|cv final|cv%20final|jr_id|\\schecked`, 'i'));
    expect(text).toContain('href="https://jobs.jobvite.com/x?src=1"');
    const header = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(conversion.files[0]?.text ?? '')?.[1] ?? '{}');
    expect(header).toMatchObject({ source: NEW_PAGE_CLEAN, shadowRoots: 2, removed: { jrIds: 1 } });
    expect(conversion.routes).toEqual({ [NEW_PAGE_CLEAN]: `${join(work, 'jobvite').split('\\').join('/')}/shadow.html` });

    const { context, unexpected } = await servedContext(conversion);
    const served = await context.newPage();
    await served.goto(NEW_PAGE_CLEAN);
    const after = await deepProbes(served.mainFrame());
    await context.close();
    expect(before).toEqual({ light: 'shown', host: 'shown', 'shadow-label': 'shown', 'shadow-input': 'shown',
      'shadow-hidden': 'hidden', 'nested-host': 'shown', nested: 'shown', 'nested-box': 'shown' });
    expect(after).toEqual(before);
    expect(unexpected).toEqual([]);
  }, 60_000);

  it("stands a closed shadow root in by its host's box, which no page code can read or the fixture keep", async () => {
    const live = await browser.newContext({ viewport: VIEWPORT });
    await live.route('**/*', (route) => (route.request().url() === NEW_PAGE_CLEAN ? route.fulfill({ status: 200,
      contentType: 'text/html', body: `<!DOCTYPE html><html><body><p data-probe="before">Create your account</p>
<div class="challenge" data-probe="wrapper"><div id="widget" data-probe="host"></div></div><p data-probe="after">Next</p>
<script>document.getElementById('widget').attachShadow({ mode: 'closed' }).innerHTML
  = '<div style="width: 300px; height: 65px; background: #eee">A check</div>';</script></body></html>` }) : route.abort()));
    const page = await live.newPage();
    await page.goto(NEW_PAGE_CLEAN);
    const before = await deepProbes(page.mainFrame());
    const session = await live.newCDPSession(page);
    const { data } = await session.send('Page.captureSnapshot', { format: 'mhtml' });
    await live.close();
    const file = join(work, 'closed.mhtml');
    writeFileSync(file, data);
    const conversion = await convertMhtml({ file, platform: 'ultipro', caseName: 'closed', outDir: work });
    const text = conversion.files[0]?.text ?? '';
    expect(text).toContain(`${CLOSED_ROOT_MARK}=""`);
    expect(text).toMatch(/data-fixture-closed-root="" style="box-sizing: border-box; min-width: \d+px; min-height: 65px;"/);
    expect(text).not.toContain('A check');
    const header = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(text)?.[1] ?? '{}');
    expect(header.closedShadowRoots).toBe(1);
    const { context } = await servedContext(conversion);
    const served = await context.newPage();
    await served.goto(NEW_PAGE_CLEAN);
    const after = await deepProbes(served.mainFrame());
    await context.close();
    expect(before).toEqual({ before: 'shown', wrapper: 'shown', host: 'shown', after: 'shown' });
    expect(after).toEqual(before);
  }, 60_000);

  it('finishes every animation before it measures, so a section caught mid fade-in measures as it ends', async () => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><head><style>
      @keyframes in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes out { from { opacity: 1; } to { opacity: 0; } }
      @keyframes spin { to { transform: rotate(1turn); } }
      .fading-in { animation: in 600s both; } .fading-out { animation: out 600s both; }
      .spinner { animation: spin 1s linear infinite; width: 20px; height: 20px; }
    </style></head><body><section class="fading-in"><p>Shown once the fade ends</p></section>
      <section class="fading-out"><p>Hidden once the fade ends</p></section><div class="spinner"></div></body></html>`);
    expect(await page.evaluate(measureInPage)).toEqual(['section+', 'p+', 'section-', 'p-', 'div+']);
    await context.close();
  }, 60_000);

  it('clears the applicant\'s text at each §6.4 place by its markup, and scrubs a file name wherever the page repeats it', async () => {
    const places = `<!DOCTYPE html><html><head><title>Apply</title></head><body>
<ul class="jv-file-list"><li><div class="jv-file"><span class="jv-spinner"></span><span>${FILE_NAME}</span>
  <a href="#" class="jv-text-action">remove</a></div></li></ul>
<div data-fabric-component="FileUploadList"><div><span class="fabric-x-name">bamboo-${FILE_NAME}</span>
  <button aria-label="remove file">x</button></div></div>
<a ng-if="candidate.resume.file_name" class="bzyLinkColor"><span class="fa fa-paperclip"></span><span></span><span>breezy-${FILE_NAME}</span></a>
<div class="file-result-area"><div class="filename">plug-${FILE_NAME}</div><a class="remove" aria-label="Remove file">x</a></div>
<div data-testid="chip"><div role="button" aria-label="Preview file : chip-${FILE_NAME}"><div id="chip-1-content"><div>chip-${FILE_NAME}</div></div></div></div>
<table><tbody><tr class="file-row"><td class="file-name">row-${FILE_NAME}</td><td class="file-created-date">11/6/2026</td><td><a class="remove-button">Remove</a></td></tr></tbody></table>
<span class="ant-upload-list-item-name" title="ant-${FILE_NAME}">ant-${FILE_NAME}</span>
<div data-automation="file-row"><span id="FileName0" data-automation="file-name">ukg-${FILE_NAME}</span>
  <a aria-label="Delete ukg-${FILE_NAME}" href="/files?name=ukg-${encodeURIComponent(FILE_NAME)}">Delete</a></div>
<span data-automation-id="&quot;cv-final-2026_uploaded&quot;">pcty-${FILE_NAME}</span>
<div class="flex"><div class="min-w-0 flex-1">dice-${FILE_NAME}</div><button aria-label="File options">...</button></div>
<button class="fab-SelectToggle" aria-label="State Kentucky"><div class="fab-SelectToggle__content">Kentucky</div></button>
<button class="ButtonUnstyled-root" aria-haspopup="dialog" aria-label="Pick a date. The current value is 12/01/2026.">o</button>
<div data-testid="screen-reader-only" role="status" aria-live="polite">File dice-${FILE_NAME} uploaded successfully</div>
<div role="alert" data-automation="global-notification"><span data-bind="html: message">notice-${FILE_NAME} has been used to pre-fill part of your application.</span></div>
<div data-test-id="sc-resume"><h3>Resume</h3><div class="text-font-light">review-${FILE_NAME}</div></div>
<div data-test-id="sc-candidate-location"><h3>Location</h3><div class="text-font-light">Lisbon, Portugal</div></div>
<span class="ant-select-selection-item" title="Bachelor's Degree">Bachelor's Degree</span>
<div class="rw-input">Referral</div>
<div role="row" data-automation-id="ethnicityOptions-tag-item-0">Hispanic or Latino<button aria-label="Hispanic or Latino Dismiss"></button></div>
<div class="rrui__select"><button class="rrui__select__button" aria-label="Canada"><span class="rrui__select__selected-content"><img alt="Canada" title="Canada" src="data:,"></span></button></div>
<b-single-select><div role="button" aria-haspopup="true"><div class="bfe-input"><span>Portugal</span></div></div></b-single-select>
<div class="multigroup-item" data-automation="selected-item"><button aria-label="Remove Kubernetes">x</button><strong data-automation="skill-label">Kubernetes</strong>
  <select><option>Beginner</option><option>Expert</option></select></div>
<div class="welcome-alert-message-box"><div><span>Welcome! ${FIRST},</span></div></div>
<span class="self-review-signature-label"><label class="required">Please type your full name.</label><input id="electronicSignature" value="${FIRST} Q"><div>11/06/2026 10:41 AM</div></span>
<nav aria-label="Account"><div><button aria-haspopup="true" aria-label="${FIRST} Quill"><span>AQ</span></button>
  <div role="menu"><div><span>${FIRST} Quill</span></div><a role="menuitem" href="/logout">Log Out</a></div></div></nav>
<ukg-button id="profile-button-menu"><span>${FIRST} Quill</span></ukg-button>
<ul><li data-automation="panel-list-item"><div data-automation="title-and-company-label">Staff Engineer, Initech</div>
  <div data-automation="date-range-label">2019 - 2024</div></li></ul>
<form test-id="workhistory-record"><h3 test-id="workHistory-read-position-title">Staff Engineer</h3>
  <button aria-label="Edit Employment History record">Edit</button></form>
<div id="pcty-wr-preview-jobapplication"><h3 id="info.name">${FIRST} Quill</h3><p class="no-wrap-value" id="info.city">Lisbon</p></div>
<careers-ui-experience-display-item><div class="b-heading">Portuguese</div><div class="b-bold-body">Native</div></careers-ui-experience-display-item>
<ukg-input value="${FIRST}"></ukg-input><ukg-date-input-text value="2026-11-06" data-date-value="2026-11-06"></ukg-date-input-text>
<ukg-input data-automation="ukg-datepicker-input" default-value="2026-12-01"></ukg-input>
<sdf-radio-group value="yes"><sdf-radio-button value="yes" aria-checked="true">Yes</sdf-radio-button><sdf-radio-button value="no" aria-checked="false">No</sdf-radio-button></sdf-radio-group>
<input type="text" data-gtm-form-interact-field-id="0" name="city">
<p>Your resume: <span>${FILE_NAME}</span> was attached.</p>
</body></html>`;
    const file = join(work, 'places.mhtml');
    writeFileSync(file, mhtml(NEW_PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: NEW_PAGE, body: places }]));
    const conversion = await convertMhtml({ file, platform: 'jobvite', caseName: 'places', redact: LISTED, outDir: work });
    const text = conversion.files[0]?.text ?? '';
    // Every made-up applicant value is gone, also from a repeat the markup does not key (the last paragraph, an
    // aria-label, a percent-encoded link) ...
    for (const value of [FILE_NAME, encodeURIComponent(FILE_NAME), 'cv-final-2026', FIRST, 'Quill', 'AQ', 'Kentucky',
      "Bachelor's Degree", 'Bachelor&#39;s', 'Referral', 'Hispanic', 'Canada', 'Portugal', 'Kubernetes', 'Welcome!',
      '11/06/2026', 'Staff Engineer', 'Initech', '2019 - 2024', 'Lisbon', 'Portuguese', 'Native', '2026-11-06',
      '12/01/2026', '2026-12-01', '11/6/2026', 'uploaded successfully', 'pre-fill',
      'value="yes"><', 'aria-checked="true"', 'data-gtm-form-interact', 'jr_id']) {
      expect(text, value).not.toContain(value);
    }
    // ... while the page's own words stay: its controls, a list's options and an option's value.
    for (const kept of ['>remove</a>', 'aria-label="remove file"', '>Remove</a>', 'aria-label="Remove file"', '>Log Out</a>',
      '<option>Beginner</option>', '<sdf-radio-button value="yes" aria-checked="false">', 'Please type your full name.',
      'data-automation-id="&quot;REDACTED_uploaded&quot;"', 'aria-label="File options"', '>Delete</a>', '<h3>Resume</h3>',
      'data-automation="global-notification"', 'aria-haspopup="dialog"']) {
      expect(text, kept).toContain(kept);
    }
    const header = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(text)?.[1] ?? '{}');
    expect(header.redacted.applicantText).toBeGreaterThan(20);
  }, 60_000);

  it('refuses a fixture that still names jr_id where no parameter separates it', async () => {
    const file = join(work, 'jr.mhtml');
    writeFileSync(file, mhtml(NEW_PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: NEW_PAGE,
      body: '<!DOCTYPE html><html><body><p>Tracked by jr_id: 0123</p></body></html>' }]));
    await expect(convertMhtml({ file, platform: 'jobvite', caseName: 'jr', outDir: work }))
      .rejects.toThrow('jr.html: jr_id is still in the file');
  }, 60_000);

  it("strips Jobright's jr_id in every spelling, keeping the address's other parameters", () => {
    const id = '0123456789abcdefABCDEF01';
    const cases: Array<[string, string]> = [
      [`/apply?jr_id=${id}`, '/apply'],
      [`/apply?jr_id=${id}&amp;step=2`, '/apply?step=2'],
      [`/apply?jr_id=${id}&step=2#x`, '/apply?step=2#x'],
      [`/apply?a=1&amp;jr_id=${id}&amp;b=2`, '/apply?a=1&amp;b=2'],
      [`/apply?a=1&jr_id=${id}`, '/apply?a=1'],
      [`mailto:?body=https%3A%2F%2Fx%2Fapply%3Fjr_id%3D${id}%26a%3D1`, 'mailto:?body=https%3A%2F%2Fx%2Fapply%3Fa%3D1'],
      [`share?u=https%253A%252F%252Fx%253Fa%253D1%2526jr_id%253D${id}`, 'share?u=https%253A%252F%252Fx%253Fa%253D1'],
      ['/apply?jobId=1', '/apply?jobId=1'],
    ];
    for (const [from, to] of cases) expect(stripJrId(from).text, from).toBe(to);
    expect(stripJrId(`?jr_id=${id}&amp;x=1 and &jr_id=${id}`).stripped).toBe(2);
  });

  it('normalises the new platforms\u2019 per-load values wherever they stand, and nothing else', () => {
    const recaptcha = '<iframe name="a-abcdef123456" src="x"></iframe><iframe name="c-abcdef123456"></iframe>'
      + '<iframe name="a-zyxwvu987654"></iframe>';
    expect(normaliseNewAts('jazzhr', recaptcha).text).toBe('<iframe name="a-000000000001" src="x"></iframe>'
      + '<iframe name="c-000000000001"></iframe><iframe name="a-000000000002"></iframe>');
    expect(normaliseNewAts('bamboohr', '<label for="FabricTextField-109"></label><input id="FabricTextField-109">'
      + '<select id="fab-select111"></select><ul id="fab-menu66">').text).toBe('<label for="FabricTextField-1"></label>'
      + '<input id="FabricTextField-1"><select id="fab-select1"></select><ul id="fab-menu66">');
    expect(normaliseNewAts('rippling', '<input id="field-12" name="5b6S8FIRp"><input name="sms_opt_in" type="radio">').text)
      .toBe('<input id="field-12" name="REDACTED"><input name="sms_opt_in" type="radio">');
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(normaliseNewAts('adp', `<div id="MDFContentPane-${uuid}"></div><input id="checkbox_jgIxFQLmFlVn55jK1ZrxX">`
      + '<sdf-radio-group id="sdf-radio-group-17"></sdf-radio-group><label for="checkbox_jgIxFQLmFlVn55jK1ZrxX">').text)
      .toBe('<div id="MDFContentPane-00000000-0000-4000-8000-000000000001"></div><input id="checkbox_000000000000000000001">'
        + '<sdf-radio-group id="sdf-radio-group-1"></sdf-radio-group><label for="checkbox_000000000000000000001">');
    expect(normaliseNewAts('ultipro', '<upload-files params="documents: candidate.Documents, currentUserId: '
      + '&quot;8f0e4f1c-2b7a-4c0e-9a51-3b1d2e4f5a6b&quot;, x: 1"></upload-files>').text)
      .toBe('<upload-files params="documents: candidate.Documents, currentUserId: &quot;REDACTED&quot;, x: 1"></upload-files>');
    expect(normaliseNewAts('ultipro', '<ukg-input id="ukg-input-id-abcdefghi1730900000000"></ukg-input>'
      + '<div id="FileUpload_aBcDeFgHiJ"></div><div id="cf-chl-widget-x1y2z"></div>').text)
      .toBe('<ukg-input id="ukg-input-id-0000000000000000000001"></ukg-input><div id="FileUpload_0000000001"></div>'
        + '<div id="cf-chl-widget-00001"></div>');
    expect(normaliseNewAts('dice', '<button id="react-aria9855676123-_r_i_" aria-controls="react-aria9855676123-_r_j_">'
      + '<div id="_R_v5iumiulb_"></div><img id="batBeacon123456789012">').text)
      .toBe('<button id="react-aria0000000001-_r_i_" aria-controls="react-aria0000000001-_r_j_"><div id="_R_1_"></div>'
        + '<img id="batBeacon000000000001">');
    expect(normaliseNewAts('clearcompany', '<div subscriberid="apply-view42"></div><form name="form7"></form>'
      + '<iframe src="https://www.linkedin.com/x#xdChannel=abc_123-def"></iframe>').text)
      .toBe('<div subscriberid="apply-view1"></div><form name="form1"></form>'
        + '<iframe src="https://www.linkedin.com/x#xdChannel=REDACTED"></iframe>');
    // Core pass Z1, item 35: ClearCompany's camelCase Backbone views (clearcompany-*), each name counted on its own.
    expect(normaliseNewAts('clearcompany', '<div subscriberid="formFieldView-view301"></div><div subscriberid="formFieldView-view17">'
      + '</div><div subscriberid="formSectionView-view9"></div><div subscriberid="formFieldView-view301"></div>').text)
      .toBe('<div subscriberid="formFieldView-view1"></div><div subscriberid="formFieldView-view2"></div>'
        + '<div subscriberid="formSectionView-view1"></div><div subscriberid="formFieldView-view1"></div>');
    // Another platform's page is left as it is.
    expect(normaliseNewAts('lever', recaptcha).text).toBe(recaptcha);
    expect(redactNewAtsAddress('lever', 'xdChannel=abc')).toBe('xdChannel=abc');
  });
});
// ── end New ATSs ──

// ── New ATSs, builder A (ADP Workforce Now, Dayforce, UltiPro) ──
describe("builder A's tokens", () => {
  // A made-up JWT of the shape of ultipro-0's RelyingPartyIframe?id_token=, and a made-up one-time code.
  const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl-_';

  it('redacts a sign-in token in any text or address, in any spelling, on every platform (redactSignInTokens)', () => {
    const page = `<iframe id="rp" src="https://recruiting.ultipro.com/acme/JobBoard/x/RelyingPartyIframe?id_token=${jwt}">`
      + '<iframe id="op" src="https://recruiting.ultipro.com/content/silent-callback.html?code=-aB3_x9&amp;state=ta%3DACME">';
    const ids: string[] = [];
    expect(redactSignInTokens(page, ids)).toBe('<iframe id="rp" src="https://recruiting.ultipro.com/acme/JobBoard/x/'
      + 'RelyingPartyIframe?id_token=REDACTED"><iframe id="op" src="https://recruiting.ultipro.com/content/'
      + 'silent-callback.html?code=REDACTED&amp;state=ta%3DACME">');
    expect(ids).toEqual([jwt, '-aB3_x9']);
    expect(redactSignInTokens(`returnUrl%3D%2Fx%3Fid_token%3D${jwt}`)).toBe('returnUrl%3D%2Fx%3Fid_token%3DREDACTED');
    expect(redactSignInTokens(`returnUrl%253D%252Fx%253Fid_token%253D${jwt}`)).toBe('returnUrl%253D%252Fx%253Fid_token%253DREDACTED');
    expect(redactSignInTokens(`/cb?a=1&amp;id_token=${jwt}#x`)).toBe('/cb?a=1&amp;id_token=REDACTED#x');
    expect(redactSignInTokens(`/cb#state=1&id_token=${jwt}`)).toBe('/cb#state=1&id_token=REDACTED');
    // Only the silent callback's code: another code= is the page's own; so is a word that only names id_token.
    expect(redactSignInTokens('/x?code=ABC&response_type=id_token')).toBe('/x?code=ABC&response_type=id_token');
    // An address keeps none, whatever its platform (withoutInjectedParams: a frame's, the header's, the route map's).
    expect(withoutInjectedParams(`https://boards.greenhouse.io/x?id_token=${jwt}&b=1`))
      .toBe('https://boards.greenhouse.io/x?id_token=REDACTED&b=1');
    // Dayforce's reCAPTCHA challenge token is every platform's per-load parameter (PER_LOAD_PARAMS).
    expect(withoutInjectedParams('https://www.google.com/recaptcha/api2/bframe?hl=en&k=6Lx&bft=0dAF-x_1'))
      .toBe('https://www.google.com/recaptcha/api2/bframe?hl=en&k=6Lx&bft=REDACTED');
  });

  it('keeps no sign-in token in a page, its frames, its header or its route map, on any platform', async () => {
    const rp = `https://recruiting.ultipro.com/acme/JobBoard/x/RelyingPartyIframe?id_token=${jwt}`;
    const op = 'https://login.tailorit-fixture.example/content/silent-callback.html?code=-aB3_x9';
    const page = `<!DOCTYPE html><html><head><title>Apply</title></head><body><h1>Apply</h1>
<a href="https://login.tailorit-fixture.example/cb?state=1&amp;id_token=${jwt}">Back</a>
<iframe id="rp" src="cid:frame-RP@mhtml.blink" width="40" height="40"></iframe>
<iframe id="op" src="cid:frame-OP@mhtml.blink" width="40" height="40"></iframe></body></html>`;
    const frame = (text: string) => `<!DOCTYPE html><html><head><title>Frame</title></head><body><p>${text}</p></body></html>`;
    const file = join(work, 'sign-in.mhtml');
    writeFileSync(file, mhtml(PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: PAGE, body: page },
      { type: 'text/html', id: 'frame-RP@mhtml.blink', location: rp, body: frame(`<a href="${rp}">again</a>`) },
      { type: 'text/html', id: 'frame-OP@mhtml.blink', location: op, body: frame('callback') }]));
    const conversion = await convertMhtml({ file, platform: 'greenhouse', caseName: 'sign-in', outDir: work });
    const written = [...conversion.files.map((output) => output.text), JSON.stringify(conversion.routes)].join('\n');
    for (const gone of [jwt, '-aB3_x9']) expect(written).not.toContain(gone);
    expect(Object.keys(conversion.routes)).toEqual(expect.arrayContaining([
      'https://recruiting.ultipro.com/acme/JobBoard/x/RelyingPartyIframe?id_token=REDACTED',
      'https://login.tailorit-fixture.example/content/silent-callback.html?code=REDACTED']));
    const header = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(conversion.files[0]?.text ?? '')?.[1] ?? '{}');
    expect(header.redacted.signInTokens).toBe(1);
    expect(conversion.tokens.map(({ token }) => token).join(' ')).not.toContain(jwt);
  }, 60_000);

  it('refuses a page that still holds a JWT under any other name', async () => {
    const page = `<!DOCTYPE html><html><head><title>Apply</title></head><body><h1>Apply</h1>
<a href="https://login.tailorit-fixture.example/cb?session=${jwt}">Back</a></body></html>`;
    const file = join(work, 'jwt.mhtml');
    writeFileSync(file, mhtml(PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: PAGE, body: page }]));
    await expect(convertMhtml({ file, platform: 'greenhouse', caseName: 'jwt', outDir: work }))
      .rejects.toThrow('jwt.html: a JWT is still in the file');
  }, 60_000);

  it("normalises Dayforce's menu ids and UltiPro's autocomplete GUIDs", () => {
    expect(normaliseNewAts('dayforce', '<li data-menu-id="rc-menu-uuid-19790-2-logo"></li><li data-menu-id='
      + '"rc-menu-uuid-19790-2-search-jobs"></li>').text).toBe('<li data-menu-id="rc-menu-uuid-00000-0-logo"></li>'
      + '<li data-menu-id="rc-menu-uuid-00000-0-search-jobs"></li>');
    expect(normaliseNewAts('ultipro', '<input autocomplete="3f2504e0-4f89-41d3-9a0c-0305e82c3301-ukg-no-autocomplete-given-name">'
      + '<input autocomplete="3f2504e0-4f89-41d3-9a0c-0305e82c3301-ukg-no-autocomplete-family-name">').text)
      .toBe('<input autocomplete="00000000-0000-4000-8000-000000000001-ukg-no-autocomplete-given-name">'
        + '<input autocomplete="00000000-0000-4000-8000-000000000001-ukg-no-autocomplete-family-name">');
    expect(normaliseNewAts('adp', '<li data-menu-id="rc-menu-uuid-19790-2-logo"></li>').text)
      .toBe('<li data-menu-id="rc-menu-uuid-19790-2-logo"></li>');
    // ADP's per-load checkbox ids hold '-' and '_' too (adp-1: the preferred-name box).
    expect(normaliseNewAts('adp', '<input id="checkbox_BrVHlJnVhzwp-13o6KGZ_"><label for="checkbox_BrVHlJnVhzwp-13o6KGZ_">'
      + '<input id="checkbox_jgIxFQLmFlVn55jK1ZrxX">').text).toBe('<input id="checkbox_000000000000000000001">'
      + '<label for="checkbox_000000000000000000001"><input id="checkbox_000000000000000000002">');
  });

  it("clears the answers Ant Design draws as classes and in its select lists, keeping a full list's words", async () => {
    const page = `<!DOCTYPE html><html><head><title>Apply</title></head><body>
<label class="ant-radio-wrapper ant-radio-wrapper-checked"><span class="ant-radio ant-radio-checked"><input type="radio" name="q" value="Yes"></span><span>Yes</span></label>
<label class="ant-checkbox-wrapper ant-checkbox-wrapper-checked"><span class="ant-checkbox ant-checkbox-checked"><input type="checkbox"></span><span>I agree</span></label>
<div class="ant-select ant-select-show-search"><input id="state" role="combobox" aria-controls="state_list"></div>
<div class="ant-select"><input id="contact" role="combobox" aria-controls="contact_list" readonly></div>
<div class="ant-select-dropdown ant-select-dropdown-hidden"><div role="listbox" id="state_list"><div role="option" aria-selected="true" class="ant-select-item ant-select-item-option ant-select-item-option-selected" title="Kentucky"><div class="ant-select-item-option-content">Kentucky</div></div></div></div>
<div class="ant-select-dropdown ant-select-dropdown-hidden"><div role="listbox" id="contact_list"><div role="option" aria-selected="false" class="ant-select-item ant-select-item-option" title="Email"><div class="ant-select-item-option-content">Email</div></div><div role="option" aria-selected="true" class="ant-select-item ant-select-item-option ant-select-item-option-active ant-select-item-option-selected" title="Mobile Phone"><div class="ant-select-item-option-content">Mobile Phone</div></div></div></div>
<div style="display: none"><div class="row collapse" data-bind="collapse: isHispanic() != 'No'"><select><option>Choose...</option></select></div></div>
</body></html>`;
    const file = join(work, 'ant.mhtml');
    writeFileSync(file, mhtml(NEW_PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: NEW_PAGE, body: page }]));
    const text = (await convertMhtml({ file, platform: 'jobvite', caseName: 'ant', outDir: work })).files[0]?.text ?? '';
    for (const gone of ['-checked', 'aria-selected="true"', 'option-selected', 'option-active', 'Kentucky']) {
      expect(text, gone).not.toContain(gone);
    }
    // A select-only list is the page's own words, whole: kept.
    for (const kept of ['title="Email"', '>Mobile Phone<', '<span>Yes</span>', '<span>I agree</span>']) expect(text, kept).toContain(kept);
    // UltiPro's Race row is drawn open, as before any answer (its hidden application keeps it hidden).
    expect(text).toContain('class="row collapse in"');
  }, 60_000);
});
// ── end New ATSs, builder A ──

// ── New ATSs, builder B (DESIGN-NEW-ATS §6.4): the chosen answers Phase 0's places miss. Every value is made up. ──
describe("mhtml-to-fixture on builder B's platforms", () => {
  it("clears Dice's chosen option title and visitor id, unmarks react-widgets' chosen option and ClearCompany's file id", async () => {
    // The visitor id in a style element, and (as Dice's captures keep it: a sheet a script filled, saved as a part of its
    // own) in a cid: stylesheet.
    const page = `<!DOCTYPE html><html><head><title>Apply</title><style>:root { --sa-uid: 'ZmFrZS12aXNpdG9yLWlkLTAwMDE='; }</style>
<link rel="stylesheet" type="text/css" href="cid:css-visitor@mhtml.blink" />
</head><body><form>
<button type="button" aria-haspopup="listbox" aria-expanded="false"><span id="v1"><div class="ListItemTemplate" title="Green Card Holder">
  <div slot="selection"><span>Green Card Holder</span></div></div></span></button>
<div aria-hidden="true" data-testid="hidden-select-container"><label><select name="workAuthorization">
  <option value="">&nbsp;</option><option value="GREEN_CARD_HOLDER">Green Card Holder</option></select></label></div>
<div class="form-group"><label>Legal gender</label><div role="combobox" class="rw-dropdownlist rw-widget"><div class="rw-input">Yes</div>
  <div class="rw-popup-container" style="display: none"><ul class="rw-list" role="listbox" aria-hidden="true">
  <li role="option" aria-selected="false" class="rw-list-option">--</li>
  <li role="option" aria-selected="true" class="rw-list-option rw-state-selected">Prefer not to say</li></ul></div></div></div>
<table><tbody class="file-list single-file-list"><tr class="file-row" data-id="0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0">
  <td class="file-name">x.pdf</td><td><a class="remove-button">Remove</a></td></tr></tbody></table>
</form></body></html>`;
    const file = join(work, 'chosen-b.mhtml');
    writeFileSync(file, mhtml(NEW_PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: NEW_PAGE, body: page },
      { type: 'text/css', location: 'cid:css-visitor@mhtml.blink', body: ":root { --sa-uid: 'CiQwMDAwLWZha2UtdmlzaXRvcg=='; }" }]));
    const text = (await convertMhtml({ file, platform: 'dice', caseName: 'chosen-b', redact: LISTED, outDir: work }))
      .files[0]?.text ?? '';
    expect(text).not.toContain('CiQwMDAwLWZha2UtdmlzaXRvcg');
    expect(text.match(/--sa-uid: 'REDACTED'/g)).toHaveLength(2);
    expect(text).not.toContain('title="Green Card Holder"');
    expect(text).not.toContain('aria-selected="true"');
    expect(text).not.toContain('rw-state-selected');
    expect(text).not.toContain('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0');
    expect(text).toContain('<tr class="file-row" data-id="REDACTED">');
    expect(text).not.toContain('ZmFrZS12aXNpdG9yLWlkLTAwMDE');
    expect(text).toContain("--sa-uid: 'REDACTED'");
    // The lists' own options stay page text.
    expect(text).toContain('<option value="GREEN_CARD_HOLDER">Green Card Holder</option>');
    expect(text).toContain('class="rw-list-option">Prefer not to say</li>');
  }, 60_000);
});
// ── end New ATSs, builder B ──

// ── New ATSs, builder C (DESIGN-NEW-ATS §5) ──
describe('builder C’s converter rules', () => {
  it('redacts Pinpoint’s and CareerPlug’s session values and Pinpoint’s link keys, and nothing else', () => {
    const metas = '<meta name="csrf-param" content="authenticity_token"><meta name="csrf-token" content="mFoy/T4E+mp==">'
      + '<meta name="csp-nonce" content="c8735a0cbfdcfdd6">';
    const redactedMetas = '<meta name="csrf-param" content="authenticity_token"><meta name="csrf-token" content="REDACTED">'
      + '<meta name="csp-nonce" content="REDACTED">';
    expect(redactNewAtsAddress('pinpoint', metas)).toBe(redactedMetas);
    expect(redactNewAtsAddress('careerplug', metas)).toBe(redactedMetas);
    const thanks = 'https://acme.pinpointhq.com/en/postings/x/applications/thanks?token=CWxCt7tzjsymp';
    expect(redactNewAtsAddress('pinpoint', thanks)).toBe('https://acme.pinpointhq.com/en/postings/x/applications/thanks?token=REDACTED');
    expect(redactNewAtsAddress('pinpoint', '<a href="https://app.pinpointhq.com/auth/linkedin/new?cache_key=5cb7849a&amp;host=x">'))
      .toBe('<a href="https://app.pinpointhq.com/auth/linkedin/new?cache_key=REDACTED&amp;host=x">');
    expect(redactNewAtsAddress('pinpoint', 'x.png?X-Amz-Credential=ASIA%2F2026&amp;X-Amz-Date=20261106T1&amp;X-Amz-Signature=ad4f'))
      .toBe('x.png?X-Amz-Credential=REDACTED&amp;X-Amz-Date=20261106T1&amp;X-Amz-Signature=REDACTED');
    // normaliseNewAts reads them in the page as the addresses do.
    expect(normaliseNewAts('careerplug', metas).text).toBe(redactedMetas);
    // Another platform's page, and CareerPlug's addresses, are left as they are.
    expect(redactNewAtsAddress('jazzhr', metas)).toBe(metas);
    expect(redactNewAtsAddress('careerplug', thanks)).toBe(thanks);
    expect(redactNewAtsAddress('greenhouse', metas)).toBe(metas);
  });

  it('prunes the unused style rules of builder C’s platforms (the one PRUNED_CSS_PLATFORMS list)', () => {
    expect(PRUNED_CSS_PLATFORMS).toEqual(expect.arrayContaining(['jazzhr', 'bamboohr', 'rippling', 'breezy', 'careerplug',
      'pinpoint', 'paycor', 'hibob']));
  });
});
// ── end New ATSs, builder C ──

describe('mhtml-to-fixture command line', () => {
  it('writes the files and the route map, and replaces an earlier conversion of the same case', () => {
    const file = join(work, 'cli.mhtml');
    writeFileSync(file, syntheticCapture(true));
    const redact = join(work, 'redact.txt');
    writeFileSync(redact, '# the owner\nJane Roe\n\n555 010 0142\nJane%20Roe\n');
    const out = join(work, 'cli-out');
    writeConversion({ files: [], routes: {}, chrome: '', tokens: [], notes: [], counts: {} }, join(out, 'greenhouse'), 'cli');
    writeFileSync(join(out, 'greenhouse', 'cli.frame-7.html'), 'stale');
    // A frame's hand-written expectations stay through a conversion again (round 2 of the v3 Phase 6/7b review, K8).
    writeFileSync(join(out, 'greenhouse', 'cli.frame-1.expect.json'), '{"kept":true}\n');
    const run = spawnSync(process.execPath, [SCRIPT, file, '--platform', 'greenhouse', '--case', 'cli', '--redact', redact,
      '--out', out], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('cli.mhtml -> greenhouse/cli');
    expect(run.stdout).toMatch(/cli\.html {2}\d+\.\d KiB/);
    for (const name of ['cli.html', 'cli.frame-1.html', 'cli.third-party-frame.html', 'cli.routes.json']) {
      expect(existsSync(join(out, 'greenhouse', name)), name).toBe(true);
    }
    expect(existsSync(join(out, 'greenhouse', 'cli.frame-7.html'))).toBe(false);
    expect(readFileSync(join(out, 'greenhouse', 'cli.frame-1.expect.json'), 'utf8')).toBe('{"kept":true}\n');
    const routes = JSON.parse(readFileSync(join(out, 'greenhouse', 'cli.routes.json'), 'utf8'));
    expect(Object.keys(routes)).toEqual([PAGE, EMBED, CAPTCHA.split('#')[0]]);
    const written = readFileSync(join(out, 'greenhouse', 'cli.html'), 'utf8');
    expect(written).not.toMatch(/Jane|010-0142/);
    expect(run.stdout).not.toMatch(/Jane|jobs@|010-01/);
  }, 60_000);

  it('exits 1 and writes nothing when the conversion is refused', () => {
    const file = join(work, 'cli-refused.mhtml');
    writeFileSync(file, syntheticCapture(true));
    const redact = join(work, 'redact-refused.txt');
    writeFileSync(redact, 'Jane Roe\n');
    const out = join(work, 'cli-refused-out');
    const run = spawnSync(process.execPath, [SCRIPT, file, '--platform', 'greenhouse', '--case', 'refused', '--redact', redact,
      '--out', out], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('nothing was written');
    expect(run.stderr).toContain('redact entry 1 is still in the file');
    expect(run.stderr).not.toContain('Jane');
    expect(existsSync(out)).toBe(false);
  }, 60_000);

  it('explains its usage', () => {
    const run = spawnSync(process.execPath, [SCRIPT, '--platform', 'lever'], { encoding: 'utf8', windowsHide: true });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('usage: node scripts/mhtml-to-fixture.mjs <file.mhtml> --platform');
  });
});

describe('mhtml-to-fixture helpers', () => {
  it('reads MIME parts: quoted-printable with soft breaks, base64, Content-ID and Content-Location', () => {
    const archive = parseMhtml(mhtml(PAGE, [
      { type: 'text/html', id: 'frame-A@mhtml.blink', location: PAGE, body: `<p class="${'x'.repeat(90)}">\u00c5land = 1</p>` },
      { type: 'image/png', location: `${ORIGIN}/logo.png`, body: png(8, 6, false) },
    ]));
    expect(archive.snapshotUrl).toBe(PAGE);
    expect(archive.date).toBe('Thu, 29 Oct 2026 22:38:44 GMT');
    expect(archive.parts.map((part) => [part.contentType, part.contentId, part.location])).toEqual([
      ['text/html', 'cid:frame-A@mhtml.blink', PAGE], ['image/png', null, `${ORIGIN}/logo.png`]]);
    expect(archive.parts[0]?.body.toString('utf8')).toBe(`<p class="${'x'.repeat(90)}">\u00c5land = 1</p>`);
    expect(archive.parts[1]?.body.equals(png(8, 6, false))).toBe(true);
    expect(() => parseMhtml(Buffer.from('<html></html>'))).toThrow('not an MHTML file');
  });

  it('reads image sizes from PNG, GIF and JPEG headers', () => {
    expect(imageSize(png(300, 200, false))).toEqual({ width: 300, height: 200 });
    const gif = Buffer.from('474946383961' + '2c01' + 'c800' + '000000', 'hex');
    expect(imageSize(gif)).toEqual({ width: 300, height: 200 });
    // SOI, an APP0 segment, then SOF0 with height 200 and width 300.
    const jpeg = Buffer.from('ffd8' + 'ffe00004' + '0000' + 'ffc00011' + '08' + '00c8' + '012c' + '03' + '00'.repeat(12), 'hex');
    expect(imageSize(jpeg)).toEqual({ width: 300, height: 200 });
    expect(imageSize(Buffer.from('not an image'))).toBeNull();
    expect(png(300, 200, true).length).toBeGreaterThan(IMAGE_INLINE_MAX);
  });

  it('reads the redact file, refuses entries that would redact too much, and matches phone numbers in any spelling', () => {
    expect(readRedactList('# comment\n  Jane Roe  \n\n555-010-0142\r\n')).toEqual(['Jane Roe', '555-010-0142']);
    expect(() => readRedactList('Jo\n')).toThrow('entry 1 is shorter than 3 characters');
    const [name, phone] = redactSources(['J.R. (Jane)', '+1 555 010 0142']).map((source) => new RegExp(source, 'i'));
    expect(name?.test('by j.r. (jane) today')).toBe(true);
    expect(name?.test('by JxR. (Jane)')).toBe(false);
    for (const spelling of ['+1 (555) 010-0142', '15550100142', '1.555.010.0142']) expect(phone?.test(spelling), spelling).toBe(true);
    expect(phone?.test('215550100142')).toBe(false);
    // A word entry is a whole word: the owner's name or employer never takes part of the page's own words.
    const [ann, acme, zoe] = redactSources(['Ann', 'Acme Corp', 'Zoë']).map((source) => new RegExp(source, 'i'));
    expect(zoe?.test('Zoëlle')).toBe(false);
    expect(zoe?.test('Zoë Roe')).toBe(true);
    expect('Ann wrote to ann.'.replace(new RegExp(redactSources(['Ann'])[0] ?? '', 'gi'), 'X')).toBe('X wrote to X.');
    expect(ann?.test('Ann Roe')).toBe(true);
    expect(ann?.test('Ann_Roe_Resume.pdf')).toBe(true);
    expect(ann?.test('Announcement')).toBe(false);
    expect(ann?.test('Joann')).toBe(false);
    expect(acme?.test('worked at acme corp.')).toBe(true);
    expect(acme?.test('Acme Corporation')).toBe(false);
  });

  it('finds emails and phone numbers, and leaves ids, dates and image names alone', () => {
    const email = new RegExp(EMAIL_SOURCE, 'g');
    expect('Write to jobs@acme.co.uk or a.b+c@x-y.io.'.match(email)).toEqual(['jobs@acme.co.uk', 'a.b+c@x-y.io']);
    const phone = new RegExp(PHONE_SOURCE, 'g');
    const phones = (text: string) => (text.match(phone) ?? []).filter((match) => {
      const digits = match.replace(/\D/g, '').length;
      return digits >= (match.startsWith('+') ? PHONE_DIGITS.minWithPlus : PHONE_DIGITS.min) && digits <= PHONE_DIGITS.max;
    });
    expect(phones('Call +1 (555) 010-0199, 555.010.0199, 555-010-0199 or +15550100199.')).toEqual(
      ['+1 (555) 010-0199', '555.010.0199', '555-010-0199', '+15550100199']);
    expect(phones('Job 8857185002, question_38599927002, 2026-10-29 22:38:44, /jobs/555-010-0199, v1.2.3')).toEqual([]);
  });

  it('converts the frames on the hosts src/shared/hosts.ts lists, and no others', () => {
    for (const url of [EMBED, 'https://boards.greenhouse.io/x/jobs/1', 'https://jobs.lever.co/x', 'https://jobs.eu.lever.co/x',
      'https://jobs.ashbyhq.com/x', 'https://wlu.wd5.myworkdayjobs.com/x', 'https://wd5.myworkdaysite.com/recruiting/x',
      'https://job-boards.eu.greenhouse.io/x/jobs/1', 'http://jobs.lever.co/x', 'https://jobs.lever.co.tailorit-fixture.example/x',
      CAPTCHA, 'https://www.recaptcha.net/recaptcha/enterprise/anchor', 'https://myworkdayjobs.com/x', PAGE,
      // v3 Phase 7b: the candidate hosts alone (src/shared/hosts.ts HOST_PLATFORMS).
      'https://careers-acme.icims.com/jobs/1/x/job', 'https://login.icims.com/u/login', 'https://www.icims.com/',
      'https://acme.taleo.net/careersection/ex/jobdetail.ftl', 'https://acme.tbe.taleo.net/x',
      'https://career2.successfactors.eu/career', 'https://performancemanager4.successfactors.com/login',
      'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/x', 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/x',
      'https://acme.fa.us2.oraclecloud.com/hcmUI/x', 'https://acme.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome',
      'https://objectstorage.us-ashburn-1.oraclecloud.com/n/x', 'https://acme.myworkdayjobs.com/x', 'https://wd5.myworkdayjobs.com/x',
      'https://a.b.wd5.myworkdayjobs.com/x',
      // ── snapshot build 2026-11-06 (oracle-sf-sr): Oracle's government cloud by its candidate path, SmartRecruiters ──
      'https://iaaxmg.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/job/11551/apply/section/1',
      'https://iaaxmg.fa.ocs.oraclegovcloud.com/fscmUI/faces/FuseWelcome', 'https://iaaxmg.fa.us2.oraclegovcloud.com/hcmUI/CandidateExperience/x',
      'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-58b4-4671-bd81-6ed11d3bcfd1',
      'https://careers.smartrecruiters.com/Xplor', 'https://www.smartr.me/oneclick-ui/company/Xplor/publication/x',
      // Snapshot build, boards: Workable's job-search site.
      'https://jobs.workable.com/view/h3u3XDdUxbcDLb9v7mvmpN/x', 'https://www.workable.com/j/F88446C814']) {
      expect(onAtsHost(url), url).toBe(platformOfUrl(url) !== null);
    }
  });

  it("redacts hCaptcha's site key in its frames' addresses and each widget's id, wherever they stand (S9)", () => {
    const page = '<div class="h-captcha" data-sitekey="94fee806-5cac-4582-9738-384a0f4ea6f8"><iframe '
      + 'data-hcaptcha-widget-id="0gp98jgqs8c8" src="https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html'
      + '#frame=challenge&amp;id=0gp98jgqs8c8&amp;host=careers-gdms.icims.com&amp;sitekey=94fee806-5cac-4582-9738-384a0f4ea6f8'
      + '&amp;size=invisible"></iframe></div><p id="main">id=main stays</p>';
    for (const platform of ['icims', 'oracle']) {
      const { text, renderIds } = normaliseTokens(platform, page);
      expect(text, platform).not.toContain('94fee806');
      expect(text, platform).not.toContain('0gp98jgqs8c8');
      expect(text, platform).toContain('data-hcaptcha-widget-id="REDACTED"');
      expect(text, platform).toContain('&amp;id=REDACTED&amp;host=careers-gdms.icims.com&amp;sitekey=REDACTED&amp;size');
      expect(text, platform).toContain('<p id="main">id=main stays</p>');
      expect(renderIds.length, platform).toBeGreaterThanOrEqual(3);
    }
  });

  it('normalises the v3 Phase 6 and 7b platforms\u2019 per-load values, wherever they stand, and nothing else', () => {
    const workday = normaliseTokens('workday', '<label for="input-14">Email</label><input id="input-14" '
      + 'aria-describedby="input-14-error"><input id="input-9"><input data-automation-id="beecatcher" '
      + 'id="f3a71433-d857-401f-983e-be6f20e1f05e"><p>input-stream stays</p>');
    expect(workday.text).toBe('<label for="input-1">Email</label><input id="input-1" aria-describedby="input-1-error">'
      + '<input id="input-2"><input data-automation-id="beecatcher" id="00000000-0000-4000-8000-000000000001"><p>input-stream '
      + 'stays</p>');
    expect(workday.renderIds).toHaveLength(3);
    expect(normaliseTokens('icims', '<a href="/jobs/1/x/job?mode=apply&amp;hashed=-336056110">'
      + '<div data-sitekey="94fee806-5cac-4582-9738-384a0f4ea6f8">https://login.icims.com/u/login/identifier?state=hKFo2SB').text)
      .toBe('<a href="/jobs/1/x/job?mode=apply&amp;hashed=REDACTED"><div data-sitekey="REDACTED">'
        + 'https://login.icims.com/u/login/identifier?state=REDACTED');
    expect(normaliseTokens('successfactors', '<form action="/career?_s.crb=U9GeUu%252bw%253d"><a href="/career?company=x&amp;'
      + 'requestParams=TiIiBIY%0aGZ&amp;login_ns=register">').text)
      .toBe('<form action="/career?_s.crb=REDACTED"><a href="/career?company=x&amp;requestParams=REDACTED&amp;login_ns=register">');
    expect(normaliseTokens('oracle', '<label for="primary-email-3"><input id="primary-email-3"><input id="honey-pot-7">'
      + '<label for="primary-email-5">').text)
      .toBe('<label for="primary-email-0"><input id="primary-email-0"><input id="honey-pot-0"><label for="primary-email-1">');
    // Another platform's page is left as it is, its tokens and all.
    expect(normaliseTokens('lever', '<input id="input-14"> hashed=12').text).toBe('<input id="input-14"> hashed=12');
  });

  it("normalises Ashby's per-load ids: each form's render id wherever it stands, in the order first named, and the CSP nonce", () => {
    const application = '0513f5fb-8aae-4048-940a-6d47266a985e';
    const survey = 'f575a297-f052-48fa-a651-98a61e7ff792';
    const html = `<meta name="csp-nonce" id="csp-nonce" content="Lp7cAcoyl3XMaoSiuDAT4ngp">`
      + `<div data-field-path="_systemfield_name" data-field-entry-id="${application}__systemfield_name"></div>`
      + `<div data-field-path="x" data-field-entry-id="${application}_x"><input type="radio" id="${application}_x-labeled-radio-0" `
      + `name="${application}_x"><label for="${application}_x-labeled-radio-0">A</label></div>`
      + `<div data-field-path="_systemfield_eeoc_gender" data-field-entry-id="${survey}__systemfield_eeoc_gender"></div>`
      + '<p>d4780eac-03ad-4dae-861f-99af22b4287e stays: no data-field-entry-id names it</p>';
    const { text, renderIds, nonces } = normaliseAshby(html);
    expect(renderIds).toEqual([application, survey]);
    expect(nonces).toBe(1);
    expect(text).not.toContain(application);
    expect(text).not.toContain(survey);
    expect(text).not.toContain('Lp7cAcoyl3XMaoSiuDAT4ngp');
    expect(text).toContain(`data-field-entry-id="${ashbyRenderId(0)}__systemfield_name"`);
    expect(text).toContain(`<input type="radio" id="${ashbyRenderId(0)}_x-labeled-radio-0" name="${ashbyRenderId(0)}_x">`);
    expect(text).toContain(`data-field-entry-id="${ashbyRenderId(1)}__systemfield_eeoc_gender"`);
    expect(text).toContain('content="REDACTED"');
    expect(text).toContain('d4780eac-03ad-4dae-861f-99af22b4287e stays');
    expect(ashbyRenderId(0)).toBe('00000000-0000-4000-8000-000000000001');
    // Any other page is left as it is: the converter normalises only --platform ashby.
    expect(normaliseAshby('<div id="a"></div>')).toEqual({ text: '<div id="a"></div>', renderIds: [], nonces: 0 });
  });

  it("normalises Workable's per-render ids wherever they stand, in the order the page first names them", () => {
    const radio = 'pak2Gq7SZqwjVyH7';
    const group = 'ql336d53WijZCSZa';
    const file = 'RWwTI8hdLOqxiHAh';
    const html = `<span id="${group}_label">Q</span><fieldset aria-labelledby="${group}_label"><div id="wrapper_${radio}" `
      + `aria-labelledby="${group}_label radio_label_${radio}"><input id="${radio}" type="radio"><span id="radio_label_${radio}">`
      + `YES</span></div></fieldset><label for="input_files_input_${file}" id="description_input_${file}">Choose file</label>`
      + `<input id="input_files_input_${file}" aria-labelledby="${group}_label description_input_${file}">`
      + '<input id="firstname"><p id="characteristicsxy">a 16-letter id with no digit and one case stays</p>';
    const { text, renderIds } = normaliseWorkable(html);
    expect(renderIds).toEqual([group, radio, file]);
    for (const id of [radio, group, file]) expect(text).not.toContain(id);
    expect(text).toContain(`<span id="${workableRenderId(0)}_label">`);
    expect(text).toContain(`<div id="wrapper_${workableRenderId(1)}" aria-labelledby="${workableRenderId(0)}_label `
      + `radio_label_${workableRenderId(1)}">`);
    expect(text).toContain(`for="input_files_input_${workableRenderId(2)}"`);
    expect(text).toContain('<input id="firstname">');
    expect(text).toContain('id="characteristicsxy"');
    expect(workableRenderId(0)).toBe('wk00000000000001');
    expect(workableRenderId(0)).toHaveLength(16);
  });

  it('checks the written text with encodings undone, but not inside stylesheets or base64 payloads', () => {
    const [raw, entities, percents] = checkedForms('<a href="?q=Jane%20Roe" title="O&#39;Brien &amp; Co">' +
      '<style>.Jane-Roe{}</style><img src="data:image/png;base64,SmFuZSBSb2U=">');
    expect(raw).not.toContain('jane roe');
    expect(entities).toContain("o'brien & co");
    expect(percents).toContain('?q=jane roe');
    expect(percents).not.toContain('jane-roe');
    expect(percents).toContain('<img src="data:image/png;base64,">');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Snapshot build, boards (the owner's captures of 2026-11-06): what the owner's browser added to a page, a company
// page's overlays, per-load tokens in frames' addresses, an upload's file name, --folder, and frames converted before
// the frame holding them
// ---------------------------------------------------------------------------------------------------------------------

const BOARDS_PAGE = 'https://careers.tailorit-fixture.example/jobs/2?gh_jid=2&jr_id=6aecd9f13';
const BOARDS_EMBED = 'https://job-boards.greenhouse.io/embed/job_app?for=tailoritfixture&validityToken=one-time-0123456789abcdef&token=2';

/** A company page as the owner's browser saved it: Jobright's and Swooped's hosts, the page's own accessibility overlay
 *  (each a shadow host on <body>, saved as Chrome saves one: template shadowmode), links carrying jr_id and HubSpot's
 *  visitor id, upload widgets showing a file's name, and an embed whose address and canonical link carry a one-time
 *  validityToken. */
function boardsCapture(extra = ''): Buffer {
  const page = `<!DOCTYPE html><html><head><title>Careers</title></head><body>
<h1 data-probe="heading" data-expect="shown">Job 2</h1>
<access-widget-ui class="notranslate"><template shadowmode="open"><div><button>Accessibility</button></div></template></access-widget-ui>
<plasmo-csui id="jobright-helper-plugin"><template shadowmode="open"><div id="jobright-helper-root">Jobright</div></template></plasmo-csui>
<div id="swooped-extension-root"><template shadowmode="open"><div class="root-card" style="height:300px">Swooped</div></template></div>
<p><a id="back" href="https://careers.tailorit-fixture.example/jobs?jr_id=6aecd9f13">All jobs</a>
<a id="both" href="/jobs/3?a=1&amp;jr_id=6aecd9f13&amp;b=2#top">Next</a>
<a id="cta" href="https://careers.tailorit-fixture.example/cs/c/?cta=1&amp;hsutk=e6c79672e86861043172af3c82faac3e&amp;canon=x">Talk to us</a>
<a id="call" href="tel:+1(800)%20555-0199">Call us</a></p>
<div class="file-upload"><div class="file-upload__filename"><p class="body">Jane_Roe_Resume_2026.pdf</p><button type="button" aria-label="Remove file">x</button></div></div>
<p class="ashby-application-form-input-file-item-name"><span>Jane_Roe_Resume_2026.pdf</span></p>
<div data-role="dropzone"><div data-id="filename"><span>Jane_Roe_Resum</span><span>e_2026.pdf</span></div>
<div role="menu"><a data-action="view" href="https://bucket.tailorit-fixture.example/f?X-Amz-Signature=abcdef0123456789" aria-label="view Jane_Roe_Resume_2026.pdf">v</a>
<button data-action="delete" aria-label="delete Jane_Roe_Resume_2026.pdf">d</button></div></div>
<div data-ui="experience"><ul><li><div data-ui="group"><dl><dt>Title</dt><dd data-ui="title"><span>Staff Engineer at Roe Labs</span></dd></dl>
<a data-ui="edit-section" title="Edit" aria-label="Edit Staff Engineer at Roe Labs" role="button">e</a></div></li></ul></div>
<span class="option" data-checked=""><input type="radio" checked></span><div role="radio" aria-checked="true">Yes</div>
<button type="button" aria-pressed="true">No</button><label data-checked="true">x</label>
<div class="select__single-value"><div class="iti__flag iti__ca"></div><span>+1</span></div>
<div class="iti"><button type="button" class="iti__selected-country" title="Canada" aria-label="Change country, currently selected Canada (+1)"><div class="iti__flag iti__ca"></div><div class="iti__selected-dial-code">+1</div></button></div>
${extra}
<iframe id="grnhse_iframe" data-probe="embed" data-expect="shown" src="cid:frame-EMBED@mhtml.blink" width="400" height="300"></iframe>
</body></html>`;
  const embed = `<!DOCTYPE html><html><head><link rel="canonical" href="${BOARDS_EMBED.replace(/&/g, '&amp;')}"></head>
<body><form id="application-form"><label for="first">First Name</label><input id="first" data-probe="frame-first" data-expect="shown"></form></body></html>`;
  return mhtml(`${BOARDS_PAGE}`, [
    { type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: BOARDS_PAGE, body: page },
    { type: 'text/html', id: 'frame-EMBED@mhtml.blink', location: BOARDS_EMBED, body: embed },
  ]);
}

describe('mhtml-to-fixture, snapshot build: boards', () => {
  it('drops other extensions\' UI and parameters, a page\'s overlays and per-load tokens, and keeps the embed\'s frame', async () => {
    const file = join(work, 'boards.mhtml');
    writeFileSync(file, boardsCapture());
    const conversion = await convertMhtml({ file, platform: 'greenhouse', caseName: 'boards', redact: ['Jane Roe'],
      outDir: work, folderName: 'sites' });
    const main = conversion.files.find((output) => output.path.endsWith('boards.html'))?.text ?? '';
    const frame = conversion.files.find((output) => output.path.endsWith('boards.frame-1.html'))?.text ?? '';
    // --folder: the files sit in sites/, the header and the route map name them so; the page comes first in the map.
    const folder = join(work, 'sites').split('\\').join('/');
    const embed = BOARDS_EMBED.replace('one-time-0123456789abcdef', 'REDACTED');
    const page = 'https://careers.tailorit-fixture.example/jobs/2?gh_jid=2';
    expect(conversion.routes).toEqual({ [page]: `${folder}/boards.html`, [embed]: `${folder}/boards.frame-1.html` });
    const header = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(main)?.[1] ?? '{}');
    expect(header).toMatchObject({ fixture: 'sites/boards', source: page,
      injected: { injected: 2, shadowOverlays: 1, injectedParams: 3 }, cleared: { choices: 7 } });
    // A company's page (--folder sites) keeps only the style rules its elements match.
    expect(header.pruned).toMatchObject({ rulesKept: expect.any(Number), rulesDropped: expect.any(Number) });
    expect(JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(frame)?.[1] ?? '{}'))
      .toMatchObject({ fixture: 'sites/boards.frame-1', source: embed, injected: { injectedParams: 1 } });
    // Another extension's UI and the overlay are gone; their markup is nowhere.
    expect(main).not.toMatch(/jobright|swooped|plasmo-csui|access-widget-ui|shadowmode/i);
    // jr_id is dropped wherever it stood, the rest of each address kept; HubSpot's visitor id and the token REDACTED.
    expect(main).not.toContain('jr_id');
    expect(main).toContain('href="https://careers.tailorit-fixture.example/jobs"');
    expect(main).toContain('href="/jobs/3?a=1&amp;b=2#top"');
    expect(main).toContain('hsutk=REDACTED&amp;canon=x');
    expect(main).toContain(`src="${embed.replace(/&/g, '&amp;')}"`);
    expect(frame).toContain(`<link rel="canonical" href="${embed.replace(/&/g, '&amp;')}">`);
    expect(`${main}${frame}${JSON.stringify(conversion.routes)}`).not.toMatch(/one-time-0123|e6c79672/);
    // Each upload widget's file name, and the controls that name it, are REDACTED; the link to the file goes nowhere.
    expect(main).not.toContain('Jane_Roe');
    expect(main).toContain('<p class="body">REDACTED</p>');
    expect(main).toContain('<span>REDACTED</span><span>REDACTED</span>');
    expect(main).toContain('aria-label="view REDACTED"');
    expect(main).toContain('aria-label="delete REDACTED"');
    expect(main).not.toContain('X-Amz-Signature');
    // A tel: link's number is REDACTED, percent-encoded or not.
    expect(main).toContain('<a id="call" href="tel:REDACTED">');
    // A saved entry read from the resume is REDACTED, its controls keeping their own word.
    expect(main).not.toMatch(/Staff Engineer|Roe Labs/);
    expect(main).toContain('<dd data-ui="title"><span>REDACTED</span></dd>');
    expect(main).toContain('title="Edit" aria-label="Edit REDACTED"');
    // A choice's mirrors are cleared (a radio's span, role=radio, a pressed button, a label), and so is the country a
    // chosen value and the phone's country button show.
    expect(main).toContain('<span class="option"><input type="radio"></span><div role="radio" aria-checked="false">');
    expect(main).toContain('<button type="button" aria-pressed="false">No</button><label data-checked="false">');
    expect(main).not.toMatch(/iti__ca|Canada|\+1</);
    expect(main).toContain('title="REDACTED" aria-label="REDACTED"');
    // The frame was converted from its own capture: its field is there, and it shows as before.
    expect(frame).toContain('<input id="first"');
    const { context, unexpected } = await servedContext(conversion);
    const served = await context.newPage();
    await served.goto(page);
    expect(await probes(frameAt(served.frames(), embed))).toEqual(await expected(frameAt(served.frames(), embed)));
    expect(await probes(served.mainFrame())).toEqual(await expected(served.mainFrame()));
    expect(unexpected).toEqual([]);
    await context.close();
  }, 60_000);

  it('still refuses a shadow root that holds a form control, and one inside the page', async () => {
    for (const [name, extra] of [
      ['shadow-input', '<custom-form><template shadowmode="open"><input name="q"></template></custom-form>'],
      ['shadow-nested', '<div><span><template shadowmode="open"><b>inside</b></template></span></div>'],
    ] as const) {
      const file = join(work, `${name}.mhtml`);
      writeFileSync(file, boardsCapture(extra));
      await expect(convertMhtml({ file, platform: 'greenhouse', caseName: name, outDir: work }))
        .rejects.toThrow('the page has shadow roots, which the converter cannot keep yet');
    }
  }, 60_000);

  it('reads an address without another extension\'s parameters and with per-load tokens REDACTED', () => {
    expect(withoutInjectedParams('https://x.example/a?jr_id=1')).toBe('https://x.example/a');
    expect(withoutInjectedParams('https://x.example/a?jr_id=1&b=2')).toBe('https://x.example/a?b=2');
    expect(withoutInjectedParams('https://x.example/a?b=2&jr_id=1#f')).toBe('https://x.example/a?b=2#f');
    expect(withoutInjectedParams('/a?b=2&jr_id=1&c=3')).toBe('/a?b=2&c=3');
    expect(withoutInjectedParams('https://x.example/a?for=b&validityToken=abc&token=1'))
      .toBe('https://x.example/a?for=b&validityToken=REDACTED&token=1');
    expect(withoutInjectedParams('https://www.recaptcha.net/recaptcha/enterprise/bframe?hl=en&k=key&bft=0dAF'))
      .toBe('https://www.recaptcha.net/recaptcha/enterprise/bframe?hl=en&k=key&bft=REDACTED');
    expect(withoutInjectedParams('https://x.example/a?token=1&jr=2')).toBe('https://x.example/a?token=1&jr=2');
    // Simplify's referral, that value alone (the Raydar capture's own address).
    expect(withoutInjectedParams('https://apply.workable.com/x/j/2F8F576E57/apply?utm_source=Simplify'))
      .toBe('https://apply.workable.com/x/j/2F8F576E57/apply');
    expect(withoutInjectedParams('https://x.example/a?utm_source=Simplify&b=2')).toBe('https://x.example/a?b=2');
    expect(withoutInjectedParams('https://x.example/a?utm_source=SimplifyJobs')).toBe('https://x.example/a?utm_source=SimplifyJobs');
    expect(withoutInjectedParams('https://x.example/a?utm_source=LinkedIn')).toBe('https://x.example/a?utm_source=LinkedIn');
    expect(INJECTED_PARAMS).toEqual(['jr_id', 'utm_source=Simplify']);
    expect(INJECTED_UI).toEqual(['plasmo-csui#jobright-helper-plugin', '#swooped-extension-root']);
    expect(PER_LOAD_PARAMS).toEqual(['validityToken', 'bft', 'hsutk', '__hstc', '__hssc', '__hsfp']);
    // Greenhouse's, Ashby's and Workable's (boards), Workday's upload preview and the new ATSs' eleven (the generic
    // applicant-text pass, redactApplicantTextInPage).
    expect(FILE_NAME_PLACES).toHaveLength(15);
    expect(FILE_LINK_PLACES).toHaveLength(1);
    expect(ENTRY_SUMMARY_PLACES).toHaveLength(2);
    expect(ENTRY_SUMMARY_CONTROLS).toHaveLength(2);
  });

  it('refuses a --folder that is not lower-case words', async () => {
    await expect(convertMhtml({ file: 'x.mhtml', platform: 'greenhouse', caseName: 'x', folderName: '../x' }))
      .rejects.toThrow('--folder must be');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The committed fixtures (docs/FIXTURES.md): converted files, route maps and hand-written expectations agree
// ---------------------------------------------------------------------------------------------------------------------

interface Expectation {
  fixture: string;
  source: string;
  captured: string;
  fields: Array<{ label: string; kind: string; required: boolean; section: string; fillable: boolean;
    reason?: string; options?: number | 'lazy'; control: string; note?: string }>;
}

/** The reasons a control is not fillable (docs/FIXTURES.md). */
const NOT_FILLABLE = ['widget-phase-4', 'not-user-visible'];
const CHOICE_KINDS = ['select', 'radio', 'checkbox-group', 'combobox', 'multiselect', 'typeahead-remote'];
const CASES = ['lever', 'greenhouse', 'ashby'].flatMap((platform) => readdirSync(join(ROOT, 'fixtures', platform))
  .filter((name) => name.endsWith('.expect.json')).map((name) => `${platform}/${name.slice(0, -'.expect.json'.length)}`));
/** A frame's case (ashby/ashby-embed-closed.frame-1: the form inside a company's page) is served by its page's route
 *  map. */
const routesOf = (name: string) => join(ROOT, 'fixtures', `${name.replace(/\.frame-\d+$/, '')}.routes.json`);
/** The Ashby captures of a list open, which have no expectations: floating-ui marks the rest of the page aria-hidden
 *  while a list is open, and no scan runs then (docs/FIXTURES.md, "The Ashby capture"). */
const LIST_STATES = ['ashby/multiverse-select-open', 'ashby/openai-location-results', 'ashby/plaid-school-results'];

describe('the committed Lever, Greenhouse and Ashby fixtures', () => {
  it('are the six cases from the owner\'s captures, the six closed forms of the Greenhouse widget capture, the BeyondTrust form and the Ashby capture', () => {
    expect(CASES.sort()).toEqual(['ashby/ashby-embed-closed.frame-1', 'ashby/cohere-closed', 'ashby/incident-closed',
      'ashby/multiverse-closed', 'ashby/notion-closed', 'ashby/openai-checkbox-ticked',
      'ashby/openai-closed', 'ashby/openai-datepicker-open', 'ashby/openai-gh-closed',
      'ashby/openai-radio-chosen', 'ashby/openai-yesno-chosen', 'ashby/plaid-closed', 'greenhouse/affirm-job',
      'greenhouse/asana-embed', 'greenhouse/axle-attached', 'greenhouse/beyondtrust-job', 'greenhouse/discord-job',
      'greenhouse/discord-ml-job',
      'greenhouse/figma-legacy-host', 'greenhouse/gitlab-embed', 'greenhouse/gitlab-job', 'greenhouse/gusto-job',
      'greenhouse/twilio-job', 'greenhouse/twitch-job', 'lever/spotify-ny', 'lever/zoox-fostercity']);
    // Every other Ashby fixture is one of the open-list captures, or a page around a form, or (snapshot build, boards:
    // the owner's capture of 2026-11-06) the form sending its application, read by the adapter's DOM tests.
    const ashby = readdirSync(join(ROOT, 'fixtures', 'ashby')).filter((name) => name.endsWith('.html'))
      .map((name) => `ashby/${name.slice(0, -'.html'.length)}`).filter((name) => !CASES.includes(name));
    expect(ashby.sort()).toEqual(['ashby/ashby-embed-closed', ...LIST_STATES, 'ashby/rivian-submitting',
      'ashby/rivian-submitting.third-party-frame']);
  });

  it.each(LIST_STATES)('%s: its files, route map and header agree, and it holds the Ashby page with its list open', (name) => {
    const routes = JSON.parse(readFileSync(routesOf(name), 'utf8')) as Record<string, string>;
    const html = readFileSync(join(ROOT, 'fixtures', `${name}.html`), 'utf8');
    const header = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(html)?.[1] ?? '{}');
    expect(header).toMatchObject({ fixture: name, normalised: { renderIds: expect.any(Number), nonces: 1 } });
    expect(routes[header.source]).toBe(`fixtures/${name}.html`);
    const body = html.slice(html.indexOf('-->') + 3);
    expect(body).not.toMatch(/<script|<noscript|<base|http-equiv|javascript:|\son[a-z]+=|<link[^>]*stylesheet|\r/i);
    expect(body).toMatch(/data-floating-ui-portal[^>]*>\s*<div[^>]*role="listbox"/);
    expect(body).toContain('data-aria-hidden="true" aria-hidden="true"');
  });

  it.each(CASES)('%s: files, route map, header and expectations agree', (name) => {
    const file = (suffix: string) => join(ROOT, 'fixtures', `${name}${suffix}`);
    const expectation = JSON.parse(readFileSync(file('.expect.json'), 'utf8')) as Expectation;
    const routes = JSON.parse(readFileSync(routesOf(name), 'utf8')) as Record<string, string>;
    const html = readFileSync(file('.html'), 'utf8');
    expect(expectation.fixture).toBe(name);
    expect(routes[expectation.source]).toBe(`fixtures/${name}.html`);
    for (const [url, path] of Object.entries(routes)) {
      expect(new URL(url).hash, url).toBe('');
      expect(path.startsWith(`fixtures/${name.replace(/\.frame-\d+$/, '')}.`) && existsSync(join(ROOT, path)), path).toBe(true);
    }
    // An Ashby page's per-load ids are normalised: no render id but the fixed ones, and the CSP nonce redacted.
    if (name.startsWith('ashby/')) {
      const ids = new Set([...html.matchAll(/data-field-entry-id="([0-9a-f-]{36})_/g)].map((match) => match[1]));
      expect([...ids].every((id) => /^00000000-0000-4000-8000-0000000000\d\d$/.test(id ?? '')), name).toBe(true);
      expect(html).not.toMatch(/name="csp-nonce"[^>]*content="(?!REDACTED")/);
    }
    const header = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(html)?.[1] ?? '{}');
    expect(header).toMatchObject({ fixture: name, source: expectation.source, captured: expectation.captured });
    expect(header.chrome).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    const body = html.slice(html.indexOf('-->') + 3);
    expect(body).not.toMatch(/<script|<noscript|<base|http-equiv|javascript:|\son[a-z]+=|<link[^>]*stylesheet|\r/i);
    expect([...body.matchAll(/<form\b[^>]*>/g)].every(([form]) => form.includes('action="/__submitted"'))).toBe(true);
    for (const field of expectation.fields) {
      expect(FIELD_KINDS as readonly string[], field.control).toContain(field.kind);
      if (field.fillable) expect(field.reason, field.control).toBeUndefined();
      else expect(NOT_FILLABLE, field.control).toContain(field.reason);
      if (field.options !== undefined) expect(CHOICE_KINDS, field.control).toContain(field.kind);
      if (field.fillable) expect(field.label, field.control).not.toBe('');
    }
  });

  it.each(CASES)('%s: every control on the page is listed once, and each entry matches the page', async (name) => {
    const expectation = JSON.parse(readFileSync(join(ROOT, 'fixtures', `${name}.expect.json`), 'utf8')) as Expectation;
    const routes = JSON.parse(readFileSync(routesOf(name), 'utf8')) as Record<string, string>;
    const context = await browser.newContext({ viewport: VIEWPORT });
    await context.route('**/*', (route) => {
      const path = routes[route.request().url()];
      return path ? route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(ROOT, path), 'utf8') })
        : route.abort();
    });
    const page = await context.newPage();
    await page.goto(expectation.source);
    const problems = await page.evaluate(({ fields, ashby }) => {
      const found: string[] = [];
      const rendered = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && rect.width >= 4 &&
          rect.height >= 4 && getComputedStyle(element).clip === 'auto';
      };
      const visibleText = (document.body.innerText ?? '').replace(/\s+/g, ' ');
      const listed = new Set<Element>();
      for (const field of fields) {
        const elements = [...document.querySelectorAll(field.control)];
        const where = `${field.control} (${field.label || 'no label'})`;
        for (const element of elements) {
          if (listed.has(element)) found.push(`listed twice: ${where}`);
          listed.add(element);
        }
        const group = field.kind === 'radio' || field.kind === 'checkbox-group';
        if (elements.length !== (group ? field.options : 1)) found.push(`${elements.length} elements for ${where}`);
        const first = elements[0];
        if (!first) continue;
        if (field.kind === 'select' && (first as HTMLSelectElement).options.length !== field.options) {
          found.push(`option count for ${where}`);
        }
        // Fillable native controls render; hidden ones do not. A file input renders behind its widget instead, and on
        // an Ashby page a radio or checkbox drawn at opacity 0 behind its label.
        const shownByLabel = (element: Element) => ashby
          && Array.from((element as HTMLInputElement).labels ?? []).some(rendered);
        // A Greenhouse react-select that shows an answer draws its text box transparent and narrow: a person sees its
        // control, the box the adapter declares (snapshot build, boards: greenhouse/axle-attached, filled).
        const shownByBox = (element: Element) => element.matches('input.select__input')
          && element.closest('.select__control') !== null && rendered(element.closest('.select__control')!);
        if (field.fillable && field.kind !== 'file'
          && !elements.some((element) => rendered(element) || shownByLabel(element) || shownByBox(element))) {
          found.push(`not rendered: ${where}`);
        }
        if (field.kind === 'file' && elements.some(rendered)) found.push(`file input rendered: ${where}`);
        if (field.reason === 'not-user-visible' && elements.some(rendered)) found.push(`rendered: ${where}`);
        // An Ashby month or year list's label is its block's "Start Date" with the adapter's "month" or "year".
        const shownLabel = ashby && field.kind === 'select' ? field.label.replace(/ (?:month|year)$/, '') : field.label;
        if (field.fillable && !visibleText.includes(shownLabel)) found.push(`label not shown: ${where}`);
      }
      const controls = [...document.querySelectorAll('input, select, textarea')].filter((element) =>
        !['hidden', 'submit', 'button', 'reset', 'image'].includes((element.getAttribute('type') ?? '').toLowerCase()));
      for (const control of controls) if (!listed.has(control)) found.push(`unlisted: ${control.outerHTML.slice(0, 120)}`);
      return found;
    }, { fields: expectation.fields, ashby: name.startsWith('ashby/') });
    await context.close();
    expect(problems).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------------
// The committed v3 Phase 6 and 7b fixtures (the v3 Phase 6/7b review, C9): every converted file, its route map, its
// header and its expectations agree, and its markup holds nothing the converter removes
// ---------------------------------------------------------------------------------------------------------------------

const PHASE_67_PLATFORMS = ['workday', 'icims', 'taleo', 'successfactors', 'oracle'];
/** Each converted page and frame of those platforms (not the third-party stand-ins). */
const PHASE_67_FILES = PHASE_67_PLATFORMS.flatMap((platform) => readdirSync(join(ROOT, 'fixtures', platform))
  .filter((name) => name.endsWith('.html') && !name.endsWith('.third-party-frame.html'))
  .map((name) => `${platform}/${name.slice(0, -'.html'.length)}`));

/** The markup with its comments, and the text of its style, textarea and title elements, taken out: what is left is
 *  tags and text, so a word in a comment (Oracle's Knockout bindings) or a stylesheet reads as nothing. */
function markupOf(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<(style|textarea|title)\b[^>]*>)[\s\S]*?(<\/\2>)/gi, '$1$3');
}

/** Every attribute name of every tag in `markup` (markupOf's), in lower case. */
function attributeNames(markup: string): string[] {
  const names: string[] = [];
  for (const [, attributes] of markup.matchAll(/<[a-zA-Z][^\s/>]*((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g)) {
    for (const [, name] of (attributes ?? '').matchAll(/\s+([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g)) {
      names.push((name ?? '').toLowerCase());
    }
  }
  return names;
}

describe('the committed Workday, iCIMS, Taleo, SuccessFactors and Oracle fixtures', () => {
  it('reads tags and their attributes past comments and stylesheets', () => {
    const markup = markupOf('<!-- <script> onclick="x" --><div data-bind="click: next" title="onload=x"><style>a{}</style>'
      + '<button onClick="go()">Go</button>');
    expect(markup).not.toContain('<script');
    expect(attributeNames(markup)).toEqual(['data-bind', 'title', 'onclick']);
  });

  it('hold no expectation without its page or frame (round 2 of the v3 Phase 6/7b review, K8)', () => {
    for (const platform of PHASE_67_PLATFORMS) {
      for (const name of readdirSync(join(ROOT, 'fixtures', platform)).filter((each) => each.endsWith('.expect.json'))) {
        const page = name.replace(/\.expect\.json$/, '.html');
        expect(existsSync(join(ROOT, 'fixtures', platform, page)), `${platform}/${name}`).toBe(true);
      }
    }
  });

  it('are the cases of the capture: each platform’s pages and frames', () => {
    // 26 from the public capture of 2026-11-04/05; the owner's iCIMS snapshots of 2026-11-06 add 24 (ICIMS_SNAPSHOT_FILES),
    // the oracle-sf-sr snapshot build 3 (Oracle's code page and government-cloud section, DFIN's account), the behaviour
    // review of 2026-11-06 1 (M4: that section 12 s after its Submit, oracle/hjf-after-submit), and the Workday
    // application steps of the owner's snapshots are counted below (WORKDAY_STEP_FILES).
    expect(PHASE_67_FILES.filter((name) => !WORKDAY_STEP_FILES.includes(name)).length).toBe(26 + 3 + 1 + ICIMS_SNAPSHOT_FILES);
    for (const platform of PHASE_67_PLATFORMS) {
      expect(PHASE_67_FILES.some((name) => name.startsWith(`${platform}/`)), platform).toBe(true);
    }
  });

  it.each(PHASE_67_FILES)('%s: its file, route map, header and expectations agree, and it holds nothing removed', (name) => {
    const html = readFileSync(join(ROOT, 'fixtures', `${name}.html`), 'utf8');
    const routes = JSON.parse(readFileSync(routesOf(name), 'utf8')) as Record<string, string>;
    const header = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(html)?.[1] ?? '{}');
    expect(header).toMatchObject({ fixture: name });
    expect(header.chrome).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(routes[header.source]).toBe(`fixtures/${name}.html`);
    for (const [url, path] of Object.entries(routes)) {
      expect(new URL(url).hash, url).toBe('');
      expect(path.startsWith(`fixtures/${name.replace(/\.frame-\d+$/, '')}.`) && existsSync(join(ROOT, path)), path).toBe(true);
    }
    const expectation = join(ROOT, 'fixtures', `${name}.expect.json`);
    if (existsSync(expectation)) {
      const expected = JSON.parse(readFileSync(expectation, 'utf8')) as Expectation;
      expect(expected).toMatchObject({ fixture: name, source: header.source, captured: header.captured });
    }
    const body = html.slice(html.indexOf('-->') + 3);
    const markup = markupOf(body);
    expect(markup).not.toMatch(/<script|<noscript|<base\b|http-equiv|<link[^>]*stylesheet|\r/i);
    expect(markup).not.toMatch(/(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/i);
    expect(attributeNames(markup).filter((attribute) => attribute.startsWith('on'))).toEqual([]);
    // A form element (never Oracle's <form-element-label> custom element) posts to the harness's /__submitted.
    expect([...markup.matchAll(/<form(?=[\s>])[^>]*>/gi)].every(([form]) => form.includes('action="/__submitted"')))
      .toBe(true);
    // The per-load tokens and the hCaptcha site key and widget ids are normalised away (S9).
    expect(body).not.toMatch(/[?&;#]sitekey=(?!REDACTED)[^&"'\s]/);
    expect(body).not.toMatch(/data-(?:hcaptcha-widget-id|sitekey)="(?!REDACTED")/);
    expect(body).not.toMatch(/\bhashed=-?\d/);
    expect(body).not.toMatch(/_s\.crb=(?!REDACTED)[^&"'\s]/);
  });
});

describe('pruneCssInPage (the v3 Phase 6/7b review, C10)', () => {
  it('drops the rules no element matches, keeping state rules, at-rules and what it cannot read', async () => {
    expect(PRUNED_CSS_PLATFORMS).toEqual(['icims', 'taleo', 'successfactors', 'oracle', 'smartrecruiters',
      // The new ATSs: builder A's, builder B's, then builder C's.
      'adp', 'dayforce', 'ultipro', 'clearcompany', 'jazzhr', 'bamboohr', 'rippling', 'breezy', 'careerplug', 'pinpoint',
      'paycor', 'hibob']);
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><head><style>
      .used { color: red; }
      .unused { color: blue; }
      .used:hover, .used:focus-within > span { color: green; }
      input:checked + label { font-weight: bold; }
      .gone:checked { color: blue; }
      .used::before { content: "x"; }
      input::placeholder { color: #777; }
      :not(:hover) > .used { color: black; }
      @media (min-width: 1px) { .used { margin: 1px; } .unused { margin: 2px; } }
      @media print { .unused { display: none; } }
      @font-face { font-family: Kept; src: local(Arial); }
      @keyframes spin { to { transform: rotate(1turn); } }
    </style></head><body><p class="used"><span>a</span></p><input type="checkbox" id="box"><label for="box">b</label>
      <input placeholder="c"></body></html>`);
    const counts = await page.evaluate(pruneCssInPage);
    const text = await page.evaluate(() => document.querySelector('style')!.textContent ?? '');
    await context.close();
    expect(counts.dropped).toBe(4);
    for (const kept of ['.used { color: red; }', '.used:hover', 'input:checked + label', '.used::before',
      'input::placeholder', ':not(:hover) > .used', '@media (min-width: 1px)', 'margin: 1px', '@font-face',
      '@keyframes spin']) {
      expect(text, kept).toContain(kept);
    }
    for (const dropped of ['.unused', '.gone', '@media print']) expect(text, dropped).not.toContain(dropped);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------------
// iCIMS, the owner's snapshots of 2026-11-06 (signed in, the pages after the gate; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06)
// ---------------------------------------------------------------------------------------------------------------------

/** The pages and frames the owner's iCIMS snapshots added under fixtures/icims (src/adapters/icims ICIMS_SNAPSHOTS). */
const ICIMS_SNAPSHOT_FILES = 24;
/** Their cases: every committed iCIMS fixture but the public capture's (East West Bank's and GDMS's). */
const ICIMS_OWNER_FILES = PHASE_67_FILES.filter((name) => name.startsWith('icims/')
  && !/^icims\/(?:eastwestbank|gdms)-/.test(name));

describe('mhtml-to-fixture on iCIMS’s signed-in pages', () => {
  it('normalises the per-person and per-load values of their addresses, selects and frames, and nothing else', () => {
    const { text, renderIds } = normaliseTokens('icims', '<a href="/jobs/1/x/candidate?from=login&amp;eem=hkcPLxmn_D8c'
      + '&amp;code=e9c05b20b2e0db52&amp;ga=21e7c519">p</a><a href="/jobs/1/x/questions?csrf=1a15a7c0ffee&amp;hashed=-12">'
      + '</a><iframe src="https://acme.icims.com/forms?module=Forms&amp;form=Self_ID&amp;user=123456&amp;item=654321&amp;'
      + 'token=0a1b2c3d-4e5f&amp;csrf=0123456789abcdef&amp;in_iframe=1&amp;step=6&amp;aid=7654321&amp;'
      + 'applicationStartId=55555"></iframe><a href="/jobs/1/login?_sp=a1.b2&amp;_jsqid=9q&amp;_ga=2.1&amp;_gl=1*x">'
      + '</a><select id="Q6" hash="c2522fe1c2f6260"></select><iframe data-hcaptcha-response="P1_eyJhbGci.x"></iframe>'
      + '<p>A countryCode=US, a username=x and postal_code=1 stay; step=6 and form=Self_ID stay.</p>');
    for (const kept of ['countryCode=US', 'username=x', 'postal_code=1', 'step=6', 'form=Self_ID', 'module=Forms',
      'in_iframe=1', 'from=login']) {
      expect(text, kept).toContain(kept);
    }
    for (const gone of ['hkcPLxmn', 'e9c05b20', '21e7c519', '1a15a7c0ffee', '123456', '654321', '0a1b2c3d',
      '0123456789abcdef', '7654321', '55555', 'a1.b2', '9q', '2.1"', '1*x', 'c2522fe1', 'P1_eyJ']) {
      expect(text, gone).not.toContain(gone);
    }
    expect(text).toContain('eem=REDACTED&amp;code=REDACTED&amp;ga=REDACTED');
    expect(text).toContain('user=REDACTED&amp;item=REDACTED&amp;token=REDACTED&amp;csrf=REDACTED');
    expect(text).toContain('hash="REDACTED"');
    expect(text).toContain('data-hcaptcha-response="REDACTED"');
    expect(renderIds.length).toBeGreaterThanOrEqual(16);
    // Jobright's jr_id goes, wherever it stands in an address (the coordinator's privacy update of 2026-11-06), by the
    // one rule every platform runs on each frame's text (stripInjectedParams), no longer by iCIMS's own normalisation.
    expect(stripInjectedParams('<a href="/jobs/1/x/job?jr_id=abc123&amp;mode=apply"></a><a href="/jobs/2/job?in_iframe=1&amp;jr_id=abc123"></a>'
      + '<iframe src="https://acme.icims.com/jobs/3/job?a=1&jr_id=abc123&b=2"></iframe><a href="/jobs/4/job?jr_id=abc123"></a>').text)
      .toBe('<a href="/jobs/1/x/job?mode=apply"></a><a href="/jobs/2/job?in_iframe=1"></a>'
        + '<iframe src="https://acme.icims.com/jobs/3/job?a=1&b=2"></iframe><a href="/jobs/4/job"></a>');
    // Only iCIMS's.
    expect(normaliseTokens('lever', '<a href="?eem=x&amp;csrf=y">').text).toBe('<a href="?eem=x&amp;csrf=y">');
  });

  it('redacts what a signed-in page shows of the person: the header’s name, a current file, iCIMS’s dropdown choices',
    async () => {
      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();
      await page.setContent(`<!doctype html><html><body>
        <div class="iCIMS_userMenu"><div class="iCIMS_userMenuName">Jane Roe</div><div class="iCIMS_userMenuLink"><a>Dashboard</a></div></div>
        <div id="r_FileNameLabel" class="iCIMS_CurrentFile"><span>jane-roe-resume.pdf</span><span class="iCIMS_NoDisplay iCIMS_CurrentFileIcon"></span></div>
        <select id="rcf1" class="dropdown-hide" icimsdropdown-enabled="1" icimsdropdown-ajax="1" icimsdropdown-search="1" icimsdropdown-selected="Ohio"><option value="501">Ohio</option></select>
        <a id="rcf1_icimsDropdown" class="dropdown-select" role="combobox" aria-activedescendant="result-selectable_rcf1_3"><span class="dropdown-text">x</span></a>
        <ul id="rcf1_dropdown-results" role="listbox"><li id="result-selectable_rcf1_-1" role="option" title="Make a Selection"><span class="dropdown-placeholder">Make a Selection</span></li>
        <li id="result-selectable_rcf1_3" class="dropdown-result result-focus" role="option" aria-selected="true" title="Ohio" aria-label="Ohio">Ohio</li></ul>
        <select id="rcf2" icimsdropdown-enabled="1" icimsdropdown-ajax="1" icimsdropdown-search="0"><option value="7">Female</option></select>
        <ul id="rcf2_dropdown-results" role="listbox"><li role="option" title="Male">Male</li><li class="result-selected" role="option" aria-selected="true" title="Female">Female</li></ul>
        <select id="Q6" icimsdropdown-enabled="0" icimsdropdown-selected="Yes"><option>Yes</option><option>No</option></select>
        </body></html>`);
      const elements = await page.evaluate(() => document.querySelectorAll('*').length);
      const counts = await page.evaluate(icimsRedactInPage, 'REDACTED');
      const html = await page.evaluate(() => document.body.innerHTML);
      const after = await page.evaluate(() => document.querySelectorAll('*').length);
      await context.close();
      expect(counts).toEqual({ names: 1, files: 1, options: 2, choices: 6, results: 2 });
      expect(after).toBe(elements);
      for (const gone of ['Jane Roe', 'jane-roe-resume', 'Ohio', '"7"', '"501"', 'aria-selected', 'result-focus',
        'result-selected', 'Make a Selection</span>']) {
        expect(html, gone).not.toContain(gone);
      }
      // An unsearched list's options are the site's (Male, Female); a native select's own options stay as they are.
      for (const kept of ['title="Male"', '>Male<', 'title="Female">Female</li>', '<option>Yes</option><option>No</option>',
        'icimsdropdown-selected="REDACTED"', 'aria-activedescendant="REDACTED"',
        '<span class="dropdown-text">REDACTED</span>']) {
        expect(html, kept).toContain(kept);
      }
    }, 60_000);

  it('converts an IForm’s three levels, its form frame a level deeper on another host, deepest first', async () => {
    const top = 'https://careers-acme.icims.com/jobs/1/engineer/form?form=Self_ID&step=6&hashed=-12';
    const portal = `${top}&in_iframe=1`;
    const forms = 'https://acme.icims.com/forms?module=Forms&action=showForm&form=Self_ID&user=123456&item=654321'
      + '&token=0a1b2c3d-4e5f&csrf=0123456789abcdef&in_iframe=1&step=6&aid=7654321';
    const file = join(work, 'iform.mhtml');
    writeFileSync(file, mhtml(top, [
      { type: 'text/html', id: 'frame-TOP@mhtml.blink', location: top, body: '<!DOCTYPE html><html><body><h1>Careers</h1>'
        + '<iframe id="icims_content_iframe" src="cid:frame-PORTAL@mhtml.blink" width="900" height="700"></iframe></body></html>' },
      { type: 'text/html', id: 'frame-PORTAL@mhtml.blink', location: portal, body: '<!DOCTYPE html><html><body>'
        + '<div class="iCIMS_userMenuName">Alex Sample</div><h1 class="iCIMS_Header">Engineer</h1><div class="iCIMS_mainFormFrame">'
        + '<iframe id="icims_formFrame" name="icims_formFrame" src="cid:frame-FORM@mhtml.blink" width="800" height="500">'
        + '</iframe></div></body></html>' },
      { type: 'text/html', id: 'frame-FORM@mhtml.blink', location: forms, body: '<!DOCTYPE html><html><body>'
        + '<form class="iCIMS_FormMainStyle" method="post" name="icims_form" action="/forms"><input type="text" '
        + 'id="icims_f_Name" name="icims_f_Name" aria-label="Name" value="Jane typed" data-probe="name" data-expect="shown">'
        + '<input type="submit" name="icims_submit" value="Submit"></form></body></html>' },
    ]));
    const conversion = await convertMhtml({ file, platform: 'icims', caseName: 'iform', redact: LISTED, outDir: work });
    expect(conversion.files.map((output) => output.path.split(/[\\/]/).pop()))
      .toEqual(['iform.html', 'iform.frame-1.html', 'iform.frame-2.html']);
    const [, frame1, frame2] = conversion.files.map((output) => output.text);
    expect(frame2).toContain('name="icims_form"');
    expect(frame2).toContain('id="icims_f_Name"');
    expect(frame2).not.toContain('Jane typed');
    expect(frame1).not.toContain('Alex Sample');
    expect(frame1).toContain('<div class="iCIMS_userMenuName">REDACTED</div>');
    expect(frame1).toContain('src="https://acme.icims.com/forms?module=Forms&amp;action=showForm&amp;form=Self_ID&amp;'
      + 'user=REDACTED&amp;item=REDACTED&amp;token=REDACTED&amp;csrf=REDACTED&amp;in_iframe=1&amp;step=6&amp;aid=REDACTED"');
    expect(Object.keys(conversion.routes)).toContain('https://acme.icims.com/forms?module=Forms&action=showForm'
      + '&form=Self_ID&user=REDACTED&item=REDACTED&token=REDACTED&csrf=REDACTED&in_iframe=1&step=6&aid=REDACTED');
    const { context, unexpected } = await servedContext(conversion);
    const served = await context.newPage();
    await served.goto(top.replace('-12', 'REDACTED'));
    const form = frameAt(served.frames(), 'https://acme.icims.com/forms');
    expect(await probes(form)).toEqual(await expected(form));
    await context.close();
    expect(unexpected).toEqual([]);
  }, 60_000);
});

describe('the committed iCIMS fixtures of the owner’s snapshots', () => {
  it('are the 24 pages and frames of their 12 cases', () => {
    expect(ICIMS_OWNER_FILES.length).toBe(ICIMS_SNAPSHOT_FILES);
  });

  it.each(ICIMS_OWNER_FILES)('%s: holds no per-person value of the snapshot, nor its name, file or choices', (name) => {
    const html = readFileSync(join(ROOT, 'fixtures', `${name}.html`), 'utf8');
    const body = html.slice(html.indexOf('-->') + 3);
    expect(body).not.toMatch(/\b(?:csrf|eem|code|token|user|item|aid|applicationStartId|_ga|ga|_gl|_sp|_jsqid)=(?!REDACTED)[^&"'\s<]/);
    expect(body).not.toMatch(/\bhash="(?!REDACTED")/);
    expect(body).not.toMatch(/\bdata-hcaptcha-response="(?!REDACTED")[^"]/);
    expect(body).not.toMatch(/class="iCIMS_userMenuName"[^>]*>\s*(?!REDACTED)[^<\s]/);
    expect(body).not.toMatch(/class="iCIMS_CurrentFile[^"]*"[^>]*><span>\s*(?!REDACTED)[^<\s]/);
    expect(body).not.toMatch(/icimsdropdown-selected="(?!REDACTED")[^"]/);
    // A dropdown's result marked chosen (the company's own wrapper may mark its tabs: those are no answer).
    expect(body).not.toMatch(/<li\b[^>]*\bclass="[^"]*\bdropdown-result\b[^"]*"[^>]*\baria-selected="true"/);
    expect(body).not.toMatch(/<li\b[^>]*\baria-selected="true"[^>]*\bclass="[^"]*\bdropdown-result\b/);
    for (const [, options] of body.matchAll(/<select[^>]*icimsdropdown-enabled="1"[^>]*>([\s\S]*?)<\/select>/g)) {
      for (const [, text] of (options ?? '').matchAll(/<option[^>]*>([^<]*)<\/option>/g)) {
        expect(['', 'REDACTED']).toContain((text ?? '').trim());
      }
    }
  });
});

// --- Workday's application steps (the owner's snapshots of 2026-11-06; docs/OWNER-QUESTIONS.md 93) ------------------

/** The Workday step fixtures converted from the owner's snapshots (src/adapters/workday/application.ts
 *  WORKDAY_STEP_SNAPSHOTS). */
const WORKDAY_STEP_FILES = ['cisive-autofill-resume', 'resolvetech-source-open',
  'resolvetech-my-experience', 'web-my-experience', 'web-application-questions', 'aep-application-questions-2',
  'danafarber-voluntary-disclosures', 'danafarber-self-identify', 'web-review', 'verily-sign-in-verify']
  .map((name) => `workday/${name}`);

describe("Workday's application steps: the converter's redaction (docs/OWNER-QUESTIONS.md 93)", () => {
  it("drops Jobright's jr_id from every address, plain, as an entity or percent-encoded, and keeps the rest", () => {
    // The one rule every platform runs on each frame's text and every address (stripInjectedParams).
    const page = stripInjectedParams('<a href="https://t.wd1.myworkdayjobs.com/S/job/X_R1/apply?jr_id=69ba40c13b74eb1e2c8829b4">'
      + '<a href="/S/job/X_R1/apply/applyManually?jr_id=6aec9487&amp;source=x"><a href="/S?a=1&amp;jr_id=6aec9487">'
      + '<a href="/S/login?redirect=%2FS%2Fjob%2FX_R1%2Fapply%2FautofillWithResume%3Fjr_id%3D6aed1695a9ea762a04094ca9">'
      + '<p>jr_id stays in words</p>');
    expect(page.text).toBe('<a href="https://t.wd1.myworkdayjobs.com/S/job/X_R1/apply"><a href="/S/job/X_R1/apply/applyManually?'
      + 'source=x"><a href="/S?a=1"><a href="/S/login?redirect=%2FS%2Fjob%2FX_R1%2Fapply%2FautofillWithResume"><p>jr_id stays in words'
      + '</p>');
    expect(page.removed).toHaveLength(4);
    // Every platform's address loses it (one rule), and no platform's own normalisation touches it.
    expect(stripInjectedParams('<a href="/x?jr_id=6aec9487">').text).toBe('<a href="/x">');
    for (const platform of ['lever', 'workday', 'icims']) {
      expect(normaliseTokens(platform, '<a href="/x?jr_id=6aec9487">').text, platform).toBe('<a href="/x?jr_id=6aec9487">');
    }
  });

  it('redacts the Review cells, an upload’s name wherever it stands, chosen answers and dates, and nothing else', async () => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    // Each part is the snapshots' own markup, its values replaced by synthetic ones.
    await page.setContent(`<!doctype html><html><body><header><div data-automation-id="utilityButtonAccountTasksMenu">
      <button data-automation-id="utilityMenuButton" aria-label="Jane Roe"><span>Jane Roe</span></button></div></header>
      <main><div data-automation-id="applyFlowPage">
      <div data-automation-id="applyFlowReviewPage"><h3>My Information</h3><div role="group">
        <label for="jobTitle">Job Title</label><span id="jobTitle">Staff Fixture Engineer</span>
        <h4>Address</h4><span id="gnu01r">1 Fixture Way<br>Testville</span>
        <label for="q"><b>Are you over 18?</b></label><span id="q"><p>Yes</p></span>
        <button>MORE (10)</button></div></div>
      <div data-automation-id="formField-"><div data-automation-id="file-upload-item">
        <div data-automation-id="ariaLive"><div data-automation-id="ariaLiveMessage" role="alert">Jane_Roe_CV.html successfully uploaded</div></div>
        <div data-automation-id="file-upload-item-name">Jane_Roe_CV.html</div><div>49 KB</div>
        <div data-automation-id="file-upload-successful">Successfully Uploaded!</div>
        <button type="button" data-automation-id="delete-file" aria-label="Delete Jane_Roe_CV.html" title="Delete">x</button>
        <div aria-label="Category for Jane_Roe_CV.html">c</div></div></div>
      <div role="group" aria-labelledby="Email-Address-section"><h4 id="Email-Address-section">Email Address</h4>
        <label for="emailAddress"></label><span id="emailAddress">jane-fixture-handle</span></div>
      <ul><li class="chip">Jane_Roe_Cover_Letter.docx</li></ul>
      <a href="https://tenant.example/docs/Application%20Disclaimers.pdf">Application Disclaimers</a>
      <label for="country--country">Country</label>
      <button aria-haspopup="listbox" type="button" value="bc33aa3152ec42d4995f4791a106ed09" aria-label="Country Fixtureland Required"
        name="country" id="country--country">Fixtureland</button>
      <button aria-haspopup="listbox" type="button" value="" aria-label="Prefix Select One" id="prefix">Select One</button>
      <div data-automation-id="multiSelectContainer"><div data-automation-id="promptAriaInstruction" aria-hidden="true">1 item selected, Fixture Board</div>
        <ul role="listbox" data-automation-id="selectedItemList"><li role="presentation"><div role="option" data-automation-id="selectedItem"
        aria-label="Fixture Board, press delete to clear value."><p data-automation-id="promptOption" data-automation-label="Fixture Board">Fixture Board</p></div></li></ul></div>
      <ul role="listbox" id="list1" aria-activedescendant="o2"><li data-value="" role="option" id="select-one">Select One</li>
        <li data-value="0799a" role="option" id="o2" aria-selected="true">Option Two</li></ul>
      <input type="radio" id="r1" aria-checked="true"><label for="r1">Yes</label>
      <fieldset data-automation-id="disabilityStatus-CheckboxGroup"><div disabled><input type="checkbox" id="c1" aria-checked="false" disabled></div>
        <label cursor="default" for="c1">A</label><input type="checkbox" id="c2" aria-checked="true"><label cursor="pointer" for="c2">B</label></fieldset>
      <div aria-hidden="true" id="helpText-w--startDate">current value is 08/2015</div>
      <div id="w--startDate" role="group" data-automation-id="dateInputWrapper">
        <div data-automation-id="dateSectionMonth-display">08</div><input role="spinbutton" aria-valuetext="8" aria-valuenow="8" data-automation-id="dateSectionMonth-input">
        <div data-automation-id="dateSectionYear-display">2015</div><input role="spinbutton" aria-valuetext="2015" aria-valuenow="2015" data-automation-id="dateSectionYear-input"></div>
    </div></main></body></html>`);
    // As the converter runs them: the generic choice pass (before measuring), the generic file-name pass, Workday's own.
    const choices = await page.evaluate(clearChoicesInPage, { redacted: 'REDACTED' });
    const files = await page.evaluate(redactApplicantTextInPage, { fileNames: FILE_NAME_PLACES, entries: ENTRY_SUMMARY_PLACES,
      chosen: CHOSEN_PLACES, profile: PROFILE_PLACES, links: [...FILE_LINK_PLACES, ...ENTRY_SUMMARY_CONTROLS],
      redacted: 'REDACTED' });
    const counts = await page.evaluate(redactWorkdayInPage, { redacted: 'REDACTED' });
    const html = await page.evaluate(() => document.body.innerHTML);
    const text = (selector: string) => page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, selector);
    const attribute = (selector: string, name: string) => page.evaluate(([s, n]) => document.querySelector(s!)?.getAttribute(n!) ?? null,
      [selector, name]);
    // The Review page: values gone, its questions, headings and buttons kept.
    expect(await text('span#jobTitle')).toBe('REDACTED');
    expect(await text('#gnu01r')).toBe('REDACTEDREDACTED');
    expect(await text('span#q')).toBe('REDACTED');
    expect(await text('label[for="jobTitle"]')).toBe('Job Title');
    expect(await text('label[for="q"]')).toBe('Are you over 18?');
    expect(await text('h4')).toBe('Address');
    expect(await text('[data-automation-id="applyFlowReviewPage"] button')).toBe('MORE (10)');
    // The upload's name, wherever the page repeats it.
    expect(html).not.toContain('Jane_Roe');
    expect(await text('[data-automation-id="file-upload-successful"]')).toBe('Successfully Uploaded!');
    expect(await attribute('[data-automation-id="delete-file"]', 'title')).toBe('Delete');
    // A read-only summary, the account menu, and any other file name (but not a link to a tenant's own document).
    expect(await text('#emailAddress')).toBe('REDACTED');
    expect(html).not.toContain('jane-fixture-handle');
    expect(html).not.toMatch(/Jane Roe|Cover_Letter/);
    expect(await attribute('[data-automation-id="utilityMenuButton"]', 'aria-label')).toBe('REDACTED');
    expect(await attribute('a', 'href')).toBe('https://tenant.example/docs/Application%20Disclaimers.pdf');
    // The dropdown's chosen option and its words, but not the empty one's words.
    expect(await text('#country--country')).toBe('REDACTED');
    expect(await text('#prefix')).toBe('Select One');
    expect(await attribute('#country--country', 'value')).toBe('REDACTED');
    expect(await attribute('#country--country', 'aria-label')).toBe('REDACTED');
    expect(await attribute('#prefix', 'value')).toBe('');
    expect(await attribute('#prefix', 'aria-label')).toBe('Prefix Select One');
    // The prompt's answer: its pill's words (a role=option, which the generic rule leaves alone) and labels, and beside it.
    expect(await text('[data-automation-id="promptOption"]')).toBe('REDACTED');
    expect(html).not.toContain('Fixture Board');
    expect(await text('[data-automation-id="promptAriaInstruction"]')).toBe('REDACTED');
    expect(await attribute('[data-automation-id="selectedItem"]', 'aria-label')).toBe('REDACTED');
    expect(await attribute('[data-automation-id="promptOption"]', 'data-automation-label')).toBe('REDACTED');
    // An open list's chosen option, but not Workday's own "Select One".
    expect(await attribute('#o2', 'aria-selected')).toBe('false');
    expect(await attribute('#list1', 'aria-activedescendant')).toBeNull();
    // Choices: no box or radio says it is chosen, and the exclusive group is drawn as before an answer.
    expect(html).not.toContain('aria-checked="true"');
    expect(html).not.toMatch(/disabled/);
    expect(html).not.toContain('cursor="default"');
    // The date back to Workday's placeholders.
    expect(await text('[data-automation-id="dateSectionMonth-display"]')).toBe('MM');
    expect(await text('[data-automation-id="dateSectionYear-display"]')).toBe('YYYY');
    expect(await text('#helpText-w--startDate')).toBe('current value is MM/YYYY');
    expect(html).not.toMatch(/aria-valuenow|2015|>08</);
    // The radio's and the box's aria-checked are the generic pass's; the preview's text and the name wherever it is
    // repeated (the announcement, the delete label, the category label) the generic file-name pass's.
    expect(choices).toEqual({ choices: 2 });
    expect(files).toEqual({ applicantText: 4, names: ['Jane_Roe_CV.html'] });
    expect(counts).toEqual({ reviewCells: 4, summaries: 1, account: 2, uploads: 3, dropdowns: 1, prompts: 4, options: 1,
      choices: 1, dates: 2 });
    await context.close();
  }, 60_000);

  it.each(WORKDAY_STEP_FILES)('%s holds no answer, upload name, chosen state, date or jr_id', (name) => {
    const html = readFileSync(join(ROOT, 'fixtures', `${name}.html`), 'utf8');
    const body = markupOf(html.slice(html.indexOf('-->') + 3));
    const header = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(html)?.[1] ?? '{}');
    expect(header.redacted.workday, name).toBeDefined();
    expect(body).not.toMatch(/jr_id/);
    expect(body).not.toContain('aria-checked="true"');
    expect(body).not.toMatch(/aria-valuenow/);
    expect(body).not.toMatch(/current value is \d/);
    expect(body).not.toMatch(/data-automation-id="dateSection(?:Month|Day|Year)-display"[^>]*>\d/);
    expect(body).not.toMatch(/aria-haspopup="listbox"[^>]*value="(?!REDACTED"|")/);
    // The upload's names: no file name beside the page's own words for the types it takes and its links' documents.
    expect(body.replace(/DOC, DOCX, HTML, PDF, or TXT/g, '').replace(/\shref="[^"]*"/g, ''))
      .not.toMatch(/[\w-]\.(?:pdf|docx?)\b/i);
    // The words a pill, the account menu or a read-only summary shows are REDACTED (tags and REDACTED alone left).
    const words = (part: string) => part.replace(/<[^>]*>/g, ' ').split(/\s+/).filter((word) => word !== '');
    for (const [, pill] of body.matchAll(/data-automation-id="selectedItem"[^>]*>([\s\S]*?)<\/li>/g)) {
      expect(words(pill ?? '').every((word) => word === 'REDACTED'), `${name}: a pill`).toBe(true);
    }
    for (const [, menu] of body.matchAll(/data-automation-id="utilityButtonAccountTasksMenu"[^>]*>([\s\S]*?)<\/button>/g)) {
      expect(words(menu ?? '').every((word) => word === 'REDACTED'), `${name}: the account menu`).toBe(true);
    }
    expect(body).not.toMatch(/<span id="emailAddress"[^>]*>(?!REDACTED<)[^<]+</);
    // Every Review value cell (a span named by its label) is REDACTED.
    if (body.includes('data-automation-id="applyFlowReviewPage"')) {
      for (const [, id] of body.matchAll(/<label for="([^"]+)"/g)) {
        const cell = new RegExp(`<span id="${id}"[^>]*>([^<]*)<`).exec(body);
        if (cell !== null) expect(cell[1], `${name} #${id}`).toBe('REDACTED');
      }
    }
  });
});

// ── snapshot build 2026-11-06 (oracle-sf-sr): shadow roots, the per-platform redactions, SmartRecruiters' fixtures ──
describe('shadow roots (SHADOW_ROOT_PLATFORMS) and the per-platform redactions', () => {
  const SR_FORM = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/00000000-0000-4000-8000-000000000001';

  /** A live page whose form sits in open shadow roots, as SmartRecruiters draws its own, saved by Chrome itself. */
  async function shadowCapture(extra = '', name = 'shadow'): Promise<string> {
    const live = await browser.newContext({ viewport: VIEWPORT });
    await live.route('**/*', (route) => (route.request().url() === SR_FORM
      ? route.fulfill({ status: 200, contentType: 'text/html', body: `<!DOCTYPE html><html><head></head><body>
<spl-input id="first" value="Jane Roe"></spl-input><p>Light</p>
<script>const host = document.getElementById('first');
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = '<label for="i">First name</label><input id="i" value="Jane Roe">'
  + '<span hidden data-probe="hidden">Hidden</span><span class="x">jane.roe@example.com</span><inner-el></inner-el>';
root.querySelector('inner-el').attachShadow({ mode: 'open' }).innerHTML = '<b>Nested</b>';</script>
${extra}
</body></html>` })
      : route.abort()));
    const page = await live.newPage();
    await page.goto(SR_FORM);
    const session = await live.newCDPSession(page);
    const { data } = await session.send('Page.captureSnapshot', { format: 'mhtml' });
    await live.close();
    const file = join(work, `${name}.mhtml`);
    writeFileSync(file, data);
    return file;
  }

  it('keeps them for SmartRecruiters alone, as declarative shadow roots, redacted and shown as captured', async () => {
    expect(SHADOW_ROOT_PLATFORMS).toEqual(['smartrecruiters', ...NEW_ATS_PLATFORMS]);
    const file = await shadowCapture();
    await expect(convertMhtml({ file, platform: 'lever', caseName: 'shadow', redact: ['Jane Roe'], outDir: work }))
      .rejects.toThrow(/shadow roots, which the converter cannot keep yet/);
    const conversion = await convertMhtml({ file, platform: 'smartrecruiters', caseName: 'shadow', redact: ['Jane Roe'],
      outDir: work });
    const text = conversion.files.map((output) => output.text).join('\n');
    expect(text.match(/<template shadowrootmode="open"/g)?.length).toBe(2);
    expect(text).not.toMatch(/Jane Roe|jane\.roe@example\.com|<script|shadowmode="/);
    expect(JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(conversion.files[0]!.text)?.[1] ?? '{}'))
      .toMatchObject({ shadowRoots: 2, redacted: { emails: 1 } });
    // Served as the e2e harness serves it, the parser attaches both roots again, each shown or hidden as before.
    const { context, unexpected } = await servedContext(conversion);
    const served = await context.newPage();
    await served.goto(SR_FORM);
    const states = await served.evaluate(() => {
      const host = document.getElementById('first')!;
      const root = host.shadowRoot!;
      const shown = (el: Element | null | undefined) => el !== null && el !== undefined && el.checkVisibility();
      return { input: shown(root.querySelector('input')), hidden: shown(root.querySelector('[data-probe="hidden"]')),
        nested: shown(root.querySelector('inner-el')?.shadowRoot?.querySelector('b')),
        value: root.querySelector('input')!.value, host: host.getAttribute('value') };
    });
    await context.close();
    expect(states).toEqual({ input: true, hidden: false, nested: true, value: '', host: '' });
    expect(unexpected).toEqual([]);
  }, 60_000);

  // The integration of 2026-11-06: boards' overlay drop and oracle-sf-sr's kept shadow roots work together. A platform
  // that keeps shadow roots keeps a page's form-less overlay too (written as a declarative root); another extension's UI
  // goes on every platform.
  it('keeps a form-less overlay where shadow roots are kept, and drops another extension\'s UI everywhere', async () => {
    const file = await shadowCapture(`<a11y-overlay id="overlay"></a11y-overlay><plasmo-csui id="jobright-helper-plugin"></plasmo-csui>
<script>document.getElementById('overlay').attachShadow({ mode: 'open' }).innerHTML = '<button>Accessibility</button>';
document.getElementById('jobright-helper-plugin').attachShadow({ mode: 'open' }).innerHTML = '<div id="jobright-helper-root">x</div>';</script>`,
    'shadow-overlay');
    const conversion = await convertMhtml({ file, platform: 'smartrecruiters', caseName: 'shadow-overlay',
      redact: ['Jane Roe'], outDir: work });
    const text = conversion.files.map((output) => output.text).join('\n');
    expect(text.match(/<template shadowrootmode="open"/g)?.length).toBe(3);
    expect(text).toContain('<a11y-overlay id="overlay"><template shadowrootmode="open"><button>Accessibility</button>');
    expect(text).not.toMatch(/jobright|plasmo-csui/i);
    const header = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(conversion.files[0]!.text)?.[1] ?? '{}');
    expect(header).toMatchObject({ shadowRoots: 3, injected: { injected: 1, shadowOverlays: 0 } });
  }, 60_000);

  it("redacts Oracle's timeline, attached file and greeting, unchooses its pills, and SmartRecruiters' values, flags and radios",
    async () => {
      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();
      await page.setContent(`<!doctype html><html><body>
        <h1 class="standard-apply-flow-dialog__header" role="alert"><span>You're all set, Jane!</span></h1>
        <div class="beautiful-timeline-item__info"><span class="beautiful-timeline-item__title">Engineer</span>
          <span class="beautiful-timeline-item__subtitle">Acme</span><span class="oj-helper-hidden-accessible">From 2020 to 2021</span></div>
        <div class="beautiful-timeline__year"><span class="beautiful-timeline__year-title">2019</span></div>
        <button class="attachment-upload-button__download" title="cv.pdf">Jane-Roe-CV.pdf</button>
        <ul role="radiogroup"><li><button role="radio" aria-checked="true" class="cx-select-pill-section cx-select-pill-section--selected">Mr.</button></li>
          <li><button role="radio" aria-checked="false" class="cx-select-pill-section">Ms.</button></li></ul>
        <p class="keep">Keep me</p>
        <spl-phone-field value='{"country":"US"}'></spl-phone-field><spl-radio-group value="0"><spl-radio role="radio" value="1" aria-checked="true">Yes</spl-radio></spl-radio-group>
        <img class="c-spl-country-flag" width="24" height="18" src="data:image/svg+xml;base64,PHN2Zy8+">
        <div slot="triggerPrefix" class="c-spl-phone-field-selected"><spl-country-flag alt="Canada" countryisocode="CA"></spl-country-flag><span>+1</span></div>
      </body></html>`);
      // As the converter runs them: the generic choice pass (before measuring), then each platform's own.
      expect(await page.evaluate(clearChoicesInPage, { redacted: 'REDACTED' })).toEqual({ choices: 2 });
      // A custom element's value (spl-phone-field's, spl-radio-group's) is the generic applicant-text pass's.
      expect(await page.evaluate(redactApplicantTextInPage, { fileNames: FILE_NAME_PLACES, entries: ENTRY_SUMMARY_PLACES,
        chosen: CHOSEN_PLACES, profile: PROFILE_PLACES, links: [...FILE_LINK_PLACES, ...ENTRY_SUMMARY_CONTROLS],
        redacted: 'REDACTED' })).toEqual({ applicantText: 2, names: [] });
      const oracle = await page.evaluate(redactPlatformInPage, { platform: 'oracle', redacted: 'REDACTED' });
      const afterOracle = await page.evaluate(() => ({ text: document.body.innerText.replace(/\s+/g, ' ').trim(),
        title: document.querySelector('.attachment-upload-button__download')!.getAttribute('title'),
        pills: Array.from(document.querySelectorAll('.cx-select-pill-section'),
          (pill) => `${pill.getAttribute('aria-checked')}:${pill.className}`) }));
      expect(oracle).toEqual({ widgetText: 4, checked: 1, typedValues: 0, placeholders: 0 });
      expect(afterOracle.text).not.toMatch(/Jane|Engineer|Acme|2019|2020|cv\.pdf/);
      expect(afterOracle.text).toContain('Keep me');
      expect(afterOracle.title).toBe('REDACTED');
      expect(afterOracle.pills).toEqual(['false:cx-select-pill-section', 'false:cx-select-pill-section']);
      const sr = await page.evaluate(redactPlatformInPage, { platform: 'smartrecruiters', redacted: 'REDACTED' });
      const afterSr = await page.evaluate(() => ({ phone: document.querySelector('spl-phone-field')!.getAttribute('value'),
        group: document.querySelector('spl-radio-group')!.getAttribute('value'),
        option: document.querySelector('spl-radio')!.getAttribute('value'),
        radio: document.querySelector('spl-radio')!.getAttribute('aria-checked'),
        flag: document.querySelector('img')!.getAttribute('src'),
        chosen: document.querySelector('[slot="triggerPrefix"]')!.outerHTML }));
      await context.close();
      // The chosen spl-radio's aria-checked is the generic pass's (counted there).
      expect(sr).toEqual({ widgetText: 1, checked: 0, typedValues: 0, placeholders: 1 });
      expect(afterSr.chosen).not.toMatch(/Canada|CA"|\+1/);
      expect(afterSr).toMatchObject({ phone: '', group: '', option: '1', radio: 'false' });
      expect(Buffer.from(afterSr.flag!.split(',')[1]!, 'base64').toString()).toContain('width="24" height="18"');
    }, 60_000);
});

describe('the committed SmartRecruiters fixtures (the snapshot build of 2026-11-06)', () => {
  const SR_FILES = readdirSync(join(ROOT, 'fixtures', 'smartrecruiters'))
    .filter((name) => name.endsWith('.html') && !name.endsWith('.third-party-frame.html'))
    .map((name) => `smartrecruiters/${name.slice(0, -'.html'.length)}`);

  it("are the owner's four pages", () => {
    expect([...SR_FILES].sort()).toEqual(['smartrecruiters/bertelsmann-expired', 'smartrecruiters/xplor-one-click',
      'smartrecruiters/xplor-posting', 'smartrecruiters/xplor-screening']);
  });

  it.each(SR_FILES)('%s: its file, route map, header and expectations agree; its shadow roots are declarative ones', (name) => {
    const html = readFileSync(join(ROOT, 'fixtures', `${name}.html`), 'utf8');
    const routes = JSON.parse(readFileSync(routesOf(name), 'utf8')) as Record<string, string>;
    const header = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(html)?.[1] ?? '{}');
    expect(header).toMatchObject({ fixture: name });
    expect(routes[header.source]).toBe(`fixtures/${name}.html`);
    const expected = JSON.parse(readFileSync(join(ROOT, 'fixtures', `${name}.expect.json`), 'utf8')) as Expectation;
    expect(expected).toMatchObject({ fixture: name, source: header.source, captured: header.captured });
    const body = html.slice(html.indexOf('-->') + 3);
    const markup = markupOf(body);
    expect(markup).not.toMatch(/<script|<noscript|<base\b|http-equiv|<link[^>]*stylesheet|\r|shadowmode=/i);
    expect(attributeNames(markup).filter((attribute) => attribute.startsWith('on'))).toEqual([]);
    expect(body.match(/<template shadowrootmode="open"/g)?.length ?? 0).toBe(header.shadowRoots);
    // No form element of SmartRecruiters' keeps a value it was given (redactPlatformInPage).
    expect(markup).not.toMatch(/<spl-(?:input|textarea|number-field|phone-field|select|autocomplete|radio-group|checkbox)(?=[\s>])[^>]*\svalue="[^"]/);
  });
});

// ── snapshot build 2026-11-06 (core pass Z1, item 38): every committed fixture against the token checks ──
/** Every committed fixture's page, frame and route map (fixtures/<platform>/...), by its path under fixtures/. */
function committedFixtureFiles(dir = join(ROOT, 'fixtures'), under = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory()
    ? committedFixtureFiles(join(dir, entry.name), `${under}${entry.name}/`)
    : /\.(?:html|routes\.json)$/.test(entry.name) ? [`${under}${entry.name}`] : []));
}

describe('every committed fixture', () => {
  it("passes the final check's token needles (tokenNeedles): no jr_id, other extension, per-load token, sign-in token or JWT", () => {
    const files = committedFixtureFiles();
    expect(files.length).toBeGreaterThan(400);
    expect(files).toContain('greenhouse/asana-embed.html');
    const failing = files.flatMap((file) => {
      const forms = checkedForms(readFileSync(join(ROOT, 'fixtures', file), 'utf8'));
      return tokenNeedles().filter(({ pattern }) => forms.some((form) => pattern.test(form)))
        .map(({ label }) => `${file}: ${label}`);
    });
    expect(failing).toEqual([]);
  });

  it("refuses a per-load token's percent-encoded padding left after REDACTED (greenhouse/asana-embed.html's canonical link)", () => {
    const perLoad = tokenNeedles().find(({ label }) => label === 'a per-load token')!.pattern;
    const link = (value: string) => checkedForms(`<link rel="canonical" href="http://job-boards.greenhouse.io/embed/job_app?for=x&amp;validityToken=${value}&amp;token=1">`);
    expect(link('REDACTED%3D%3D').some((form) => perLoad.test(form))).toBe(true);
    expect(link('REDACTED').some((form) => perLoad.test(form))).toBe(false);
  });
});
// ── end core pass Z1, item 38 ──

// ── The security fix of 2026-11-06 (S2, S3, S10): chosen marks, cleared by markup, refused and swept ──
/**
 * The committed fixtures whose chosen states are no person's answer, which the sweep below lets keep them: the
 * developer's read-only public captures of 2026-11-01/02 (docs/FIXTURES.md, "The Ashby capture" and "The Workable
 * capture": nothing typed but test strings, no personal data; Ashby's open tab, a list's first result highlighted as it
 * opens, intl-tel-input's default country, the captures' test choices), v3 Phase 8's read-only capture of Netflix's
 * career pages (OneTrust's cookie-category switch, checked by default), and the hand-written synthetic pages and traps.
 * Every fixture converted from the owner's snapshots of 2026-11-06 holds none.
 */
const CHOSEN_STATE_FIXTURES = [
  'ashby/ashby-embed-closed.frame-1.html', 'ashby/cohere-closed.html', 'ashby/incident-closed.html',
  'ashby/multiverse-closed.html', 'ashby/multiverse-select-open.html', 'ashby/notion-closed.html',
  'ashby/openai-checkbox-ticked.html', 'ashby/openai-closed.html', 'ashby/openai-datepicker-open.html',
  'ashby/openai-gh-closed.html', 'ashby/openai-location-results.html', 'ashby/openai-radio-chosen.html',
  'ashby/openai-yesno-chosen.html', 'ashby/plaid-closed.html', 'ashby/plaid-school-results.html',
  'sites/netflix-eightfold-job.html', 'sites/netflix-resume-search.html',
  'synthetic/ashby-widgets/index.html', 'synthetic/widgets/index.html', 'traps/10-select-all-that-apply.html',
  'workable/blueground-at-closed.html', 'workable/blueground-at-gdpr-ticked.html', 'workable/blueground-closed.html',
  'workable/cloudfactory-checkbox-ticked.html', 'workable/cloudfactory-closed.html',
  'workable/cloudfactory-datepicker-open.html', 'workable/cvector-closed.html', 'workable/labella-closed.html',
  'workable/labella-dropdown-open.html', 'workable/labella-education-editor.html',
  'workable/labella-phone-countries-open.html', 'workable/labella-radio-chosen.html',
  'workable/labella-yesno-chosen.html', 'workable/verneek-closed.html',
];

describe('chosen marks (the security fix of 2026-11-06: S2, S3, S10)', () => {
  it('every committed fixture holds no chosen mark (chosenMarksIn), but the captures whose choices are no answer', () => {
    const pages = committedFixtureFiles().filter((file) => file.endsWith('.html'));
    expect(pages.length).toBeGreaterThan(300);
    const marked = pages.filter((file) => chosenMarksIn(readFileSync(join(ROOT, 'fixtures', file), 'utf8')).length > 0);
    expect(marked.filter((file) => !CHOSEN_STATE_FIXTURES.includes(file))).toEqual([]);
    // The owner's re-converted pages among them (S2, S3, S10).
    for (const file of ['ashby/rivian-submitting.html', 'bamboohr/swyfft-form.html', 'oracle/hjf-apply-section.html',
      'smartrecruiters/xplor-one-click.html', 'greenhouse/rushdown-country-open.html', 'workable/jobs-salvo-apply.html',
      'workable/raydar-attached.html', 'workday/resolvetech-source-open.html']) {
      expect(pages, file).toContain(file);
      expect(chosenMarksIn(readFileSync(join(ROOT, 'fixtures', file), 'utf8')), file).toEqual([]);
    }
    // Each exception is still there, and is hand-written or captured before the owner's snapshots of 2026-11-06.
    for (const file of CHOSEN_STATE_FIXTURES) {
      expect(pages, file).toContain(file);
      if (/^(?:synthetic|traps)\//.test(file)) continue;
      const captured = /"captured":"([^"]+)"/.exec(readFileSync(join(ROOT, 'fixtures', file), 'utf8').slice(0, 8_000))?.[1];
      expect(captured, file).toBeDefined();
      expect(captured! < '2026-11-06', file).toBe(true);
    }
  });

  it('reads each kind of chosen mark by its markup, and no tab, menu, link or default', () => {
    const kinds = (markup: string) => chosenMarksIn(`<!doctype html><html><body>${markup}</body></html>`);
    // Made-up markup in each platform's shape (the snapshots name each in scripts/mhtml-to-fixture.mjs CHOSEN_MARKS).
    expect(kinds('<label class="_label_1sm4i_29 _checked_1sm4i_44">x</label>')).toEqual(["a CSS module's chosen class"]);
    expect(kinds('<button class="_option_3svni_1 _active_3svni_9" aria-pressed="false">Yes</button>'))
      .toEqual(["a CSS module's chosen class"]);
    expect(kinds('<span class="MuiRadio-root Mui-checked"></span>')).toEqual(["MUI's chosen class"]);
    expect(kinds('<span class="apply-flow-input-checkbox__button apply-flow-input-checkbox__button--checked"></span>'))
      .toEqual(["an option's or a choice's chosen modifier"]);
    expect(kinds('<div class="select__option select__option--is-focused" role="option" aria-selected="false">x</div>'))
      .toEqual(["an option's or a choice's chosen modifier"]);
    expect(kinds('<div class="fab-MenuOption fab-MenuOption--active" role="menuitem">x</div>'))
      .toEqual(["an option's or a choice's chosen modifier"]);
    expect(kinds('<li role="option" aria-selected="true">x</li>')).toEqual(['a chosen option (aria-selected)']);
    expect(kinds('<td role="gridcell" aria-selected="true">6</td>')).toEqual(['a chosen option (aria-selected)']);
    expect(kinds('<spl-dropdown-item selected=""></spl-dropdown-item>')).toEqual(['a list item that says it is selected']);
    expect(kinds('<div role="radio" aria-checked="true">x</div>'))
      .toEqual(['a ticked or pressed control (aria-checked, aria-pressed)']);
    expect(kinds('<span data-checked="">x</span>')).toEqual(['a ticked control (data-checked)']);
    expect(kinds('<input type="checkbox" checked>')).toEqual(['a radio or box input that says it is checked']);
    expect(kinds('<div class="ant-radio-wrapper ant-radio-wrapper-checked"></div>'))
      .toEqual(['a chosen class CHOSEN_MARKS names']);
    // No answer: a tab's open marks, a menu's or a list's own BEM modifiers that name no choice, Workday's own
    // "Select One", a stylesheet or a comment naming a chosen class, a mark set false.
    expect(kinds('<a role="tab" class="mdc-tab mdc-tab--active" aria-selected="true">Application</a>'
      + '<div role="menu" class="nav__menu--active"></div><button class="pagination__button--active">2</button>'
      + '<li role="none" class="portalLanguages__item--active">English</li>'
      + '<li role="option" data-value="" aria-selected="true">Select One</li>'
      + '<style>.Mui-checked{color:red}._checked_1sm4i_44{}</style><!-- <span class="Mui-checked"> -->'
      + '<div role="option" aria-selected="false" class="c-spl-dropdown-item--with-suffix"></div>'
      + '<div role="radio" aria-checked="false" data-checked="false"></div><input type="radio">')).toEqual([]);
  });

  it('clears every generic mark as the converter runs clearChoicesInPage, leaving tabs, menus and defaults', async () => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    // Each platform's markup (the snapshots named in CHOSEN_MARKS), values made up.
    await page.setContent(`<!doctype html><html><body>
      <a id="tab" role="tab" class="_tab_1yu6i_1 _active_1yu6i_9" aria-selected="true">Application</a>
      <label id="ashby" class="_label_1sm4i_29 _checked_1sm4i_44">Yes</label><span id="ashby-span" class="_container_123c4_28 _checked_123c4_44"></span>
      <span id="mui" class="MuiRadio-root Mui-checked Mui-focusVisible"></span>
      <span id="oracle" class="apply-flow-input-checkbox__button apply-flow-input-checkbox__button--checked"></span>
      <div id="rs" class="select__option select__option--is-focused select__option--is-selected" role="option" aria-selected="true">x</div>
      <div id="bamboo" class="fab-MenuOption fab-MenuOption--active fab-MenuOption--sizeMedium" role="menuitem">x</div>
      <ul role="listbox"><li id="one" role="option" data-value="" aria-selected="true">Select One</li>
        <li id="iti" class="iti__country" role="option" aria-selected="true">x</li></ul>
      <spl-dropdown-item id="spl" selected=""></spl-dropdown-item>
      <nav><a id="nav" class="nav__item nav__item--active">Jobs</a></nav>
    </body></html>`);
    const cleared = await page.evaluate(clearChoicesInPage, { redacted: 'REDACTED', marks: CHOSEN_MARKS });
    expect(cleared.choices).toBeGreaterThanOrEqual(8);
    const state = await page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('[id]'),
      (el) => [el.id, `${el.getAttribute('class') ?? ''}|${el.getAttribute('aria-selected') ?? ''}|${el.hasAttribute('selected')}`])));
    expect(state).toEqual({
      // A tab's aria-selected stays (no answer); its CSS module's _active_ goes with every other module's.
      tab: '_tab_1yu6i_1|true|false',
      ashby: '_label_1sm4i_29||false', 'ashby-span': '_container_123c4_28||false',
      mui: 'MuiRadio-root||false',
      oracle: 'apply-flow-input-checkbox__button||false',
      rs: 'select__option|false|false',
      bamboo: 'fab-MenuOption fab-MenuOption--sizeMedium||false',
      // Workday's own "Select One" is no answer (redactWorkdayInPage keeps it too).
      one: '|true|false',
      iti: 'iti__country|false|false',
      spl: '||false',
      nav: 'nav__item nav__item--active||false',
    });
    expect(chosenMarksIn(await page.content())).toEqual([]);
    await context.close();
  }, 30_000);

  it('refuses to write a page that still holds a chosen mark, as it refuses jr_id', async () => {
    // The refusal is the backstop: with the generic marks left out of the clearing, Ashby's chosen classes stay, and
    // nothing is written.
    const generic = CHOSEN_MARKS.findIndex((mark) => mark.patterns?.some((source) => source.includes('checked|selected|active')));
    expect(generic).toBeGreaterThan(-1);
    const [removed] = CHOSEN_MARKS.splice(generic, 1);
    try {
      const file = join(work, 'chosen-marks.mhtml');
      writeFileSync(file, mhtml(NEW_PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: NEW_PAGE,
        body: '<!DOCTYPE html><html><body><form><label class="_label_1sm4i_29 _checked_1sm4i_44">Yes</label></form></body></html>' }]));
      await expect(convertMhtml({ file, platform: 'jobvite', caseName: 'chosen-marks', outDir: work }))
        .rejects.toThrow("chosen-marks.html: a CSS module's chosen class is still in the file");
    } finally {
      CHOSEN_MARKS.splice(generic, 0, removed!);
    }
    // With them, the same page is written without the mark.
    const file = join(work, 'chosen-marks-2.mhtml');
    writeFileSync(file, mhtml(NEW_PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: NEW_PAGE,
      body: '<!DOCTYPE html><html><body><form><label class="_label_1sm4i_29 _checked_1sm4i_44">Yes</label></form></body></html>' }]));
    const text = (await convertMhtml({ file, platform: 'jobvite', caseName: 'chosen-marks-2', outDir: work })).files[0]?.text ?? '';
    expect(text).toContain('<label class="_label_1sm4i_29">Yes</label>');
    expect(chosenMarksIn(text)).toEqual([]);
  }, 60_000);
});
// ── end of the security fix's block (S2, S3, S10) ──

// ── snapshot build 2026-11-06 (core pass Z1, item 36): the applicant's choices on Rippling's and HiBob's pages ──
describe("the applicant's choices on Rippling's and HiBob's pages (rippling-0, hibob-0)", () => {
  it('clears the SMS opt-in, the consent box and the Yes/No answer as the converter runs clearChoicesInPage', async () => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    // The markup of rippling-0 (fixtures/rippling/smartsuite-uploaded) and hibob-0 (fixtures/hibob/mplc-form), values
    // made up.
    await page.setContent(`<!doctype html><html><body>
      <div role="radiogroup"><div data-testid="radio-label-sms_opt_in" data-value="true" role="radio" aria-checked="true">Yes</div>
        <div data-testid="radio-label-sms_opt_in" data-value="false" role="radio" aria-checked="false">No</div></div>
      <b-checkbox data-testid="initial-consent-checkbox"><input type="checkbox" class="bchk-input" id="initialConsent"
        aria-checked="true"></b-checkbox>
      <b-radio-button><div role="radiogroup" id="g"><div class="flx min-w-0 selected"><input type="radio" class="brd-input"
        id="y"><label class="brd-label min-w-0 selected" for="y">Yes</label></div><div class="flx min-w-0"><input type="radio"
        class="brd-input" id="n"><label class="brd-label min-w-0" for="n">No</label></div></div></b-radio-button>
      <nav><a class="tab selected">Application</a></nav>
    </body></html>`);
    expect(await page.evaluate(clearChoicesInPage, { redacted: 'REDACTED', marks: CHOSEN_MARKS })).toEqual({ choices: 4 });
    expect(await page.evaluate(() => ({
      checked: Array.from(document.querySelectorAll('[aria-checked]'), (el) => el.getAttribute('aria-checked')),
      selected: Array.from(document.querySelectorAll('b-radio-button .selected'), (el) => el.className),
      // A "selected" outside a HiBob radio group (a tab) is no answer, and stays.
      tab: document.querySelector('nav a')!.className,
    }))).toEqual({ checked: ['false', 'false', 'false'], selected: [], tab: 'tab selected' });
    await context.close();
  }, 30_000);
});
// ── end core pass Z1, item 36 ──
