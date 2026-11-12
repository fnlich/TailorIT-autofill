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
  stripInjectedInPage,
  CHOSEN_PLACES,
  // ── jr6 (FIXPLAN 6.1, TOOLING) ──
  ANGULAR_STATE_ELEMENTS,
  ANGULAR_STATE_SOURCE,
  CHOICE_ROWS,
  keepsShadowRoots,
  POSTING_TEXT_PLACES,
  readReplaceOption,
  unevenChoiceRowsInPage,
  // ── jr6 round 2 (TOOLING; BUILD.md 4b) ──
  FIXED_ROWS,
  ID_REFERENCES,
  LIST_ROWS,
  noteListRowsInPage,
  redactListRowsInPage,
  respelledAddress,
  respelledEdge,
  respelledIn,
  respelledSources,
  respelledSpans,
  ROW_ID_ATTRIBUTES,
  ROW_ID_DATA_SOURCE,
  ROW_WORD_ATTRIBUTES,
  ROW_WORD_DATA_SOURCE,
  TYPED_LIST_BOXES,
  TYPED_LISTS,
  // ── jr6 fixes (TOOLING; the line W reviews) ──
  CHOICE_ROW_INPUT,
  CHOSEN_MARK_LABELS,
  CLEAR_CHOICE_INPUT,
  VALUE_MIRRORS,
  deepenInPage,
  ROVING_ROLES,
  REFERRAL_PARAMS,
  REFERRAL_PREFIXES,
  redactReferralParams,
  referralNeedles,
  eliminatedListsIn,
  LISTED_LISTS,
  // ── snapshot build 2026-11-06 (core pass Z1, item 36) ──
  CHOSEN_MARKS,
  PROFILE_PLACES,
  icimsRedactInPage,
  ENTRY_SUMMARY_CONTROLS,
  ENTRY_SUMMARY_PLACES,
  FILE_LINK_PLACES,
  SEARCH_RESULT_PLACES,
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
  // ── jr6 PRIVACY-FIX ──
  POSTING_COPY_ATTRIBUTES,
  ROW_ID_WORDS_KEPT,
  // ── jr7 TOOLING-7 ──
  checkedStyleForms,
  readFrameSrcOption,
  STYLE_ORDER_DEFAULTS,
  OPENED_ROWS,
  CHOSEN_ICONS,
  SPELLED_IDS,
  spelledIdsIn,
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
 *  With `encoded`, a link also carries the owner's name percent-encoded (jr6 round 2: an attribute's respelling, which
 *  the converter now redacts), and so does a text run, which the DOM redaction cannot see and the final check refuses
 *  (jr6 fixes, PRIV-6: the page's text is respelled too now, so for a refusal that run stands in a <template>
 *  (`'template'`), whose content no in-page pass reaches). */
const mainHtml = (encoded: boolean | 'template') => `<!DOCTYPE html><html lang="en"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
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
<a href="javascript:alert(1)">Run</a> <a href="java&#9;script:alert(2)">Run too</a>${encoded ? ` <a href="${ORIGIN}/search?q=Jane%20Roe">Jobs like yours</a> ${encoded === 'template' ? '<template>' : ''}<span>Saved search: q=Jane%20Roe</span>${encoded === 'template' ? '</template>' : ''}` : ''}</p>
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
function syntheticCapture(encoded: boolean | 'template' = false): Buffer {
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
    writeFileSync(file, syntheticCapture('template'));
    const error = await convertMhtml({ file, platform: 'greenhouse', caseName: 'refuse', redact: ['Jane Roe'], outDir: work })
      .then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConversionError);
    const reasons = (error as ConversionError).reasons;
    // The text run's (jr6 round 2: the link's, an attribute, is respelled away, so it is no reason of its own; jr6 fixes,
    // PRIV-6: a run in the page is respelled away too, so this one stands in a <template>, read by the final check alone).
    expect(reasons).toEqual(['refuse.html: redact entry 1 is still in the file',
      "refuse.html: redact entry 1 survives in the page's text"]);
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
    // jr7 TOOLING-7: 15, and jr7's five (UKG Ready, Paycom, JobDiva, Eightfold, Jibe).
    expect(NEW_ATS_PLATFORMS).toHaveLength(20);
  });

  it("jr7 TOOLING-7: converts jr7's platforms' frames on their candidate paths alone, never an employee page (FIX7PLAN §3.2)",
    () => {
      const client = 'a'.repeat(16) + '0123456789ABCDEF';
      const cases: Array<[string, boolean]> = [
        // UKG Ready (UKGR-2): /ta/<company>.careers only; the login, the home page and the file service are employee pages.
        ['https://secure7.saashr.com/ta/6200000.careers?ShowJob=123456789', true],
        ['https://secure.saashr.com/ta/6200000.careers', true], ['https://secure12.saashr.com/ta/123.careers', true],
        ['https://secure7.saashr.com/ta/6200000.login', false], ['https://secure7.saashr.com/ta/6200000.home', false],
        ['https://secure7.saashr.com/ta/fs?ticket=x', false], ['https://www.saashr.com/ta/6200000.careers', false],
        // Paycom (PC7-02): the portal's posting and application paths only; never /v4/ee/ or /v4/cl/.
        [`https://www.paycomonline.net/v4/ats/web.php/portal/${client}/jobs/53215`, true],
        [`https://www.paycomonline.net/v4/ats/web.php/portal/${client}/applications`, true],
        [`https://www.paycomonline.net/v4/ats/web.php/portal/${client}/jobs`, false],
        ['https://www.paycomonline.net/v4/ee/web.php/app/login', false], ['https://www.paycomonline.net/v4/cl/x', false],
        ['https://www.paycomonline.com/v4/ats/web.php/portal/x/jobs/1', false],
        // JobDiva (JDEF-12): /portal/ on www<n>.jobdiva.com.
        ['https://www1.jobdiva.com/portal/?a=x#/jobs/1', true], ['https://www2.jobdiva.com/portal/', true],
        ['https://www1.jobdiva.com/candidates/myjobs/x', false], ['https://login.jobdiva.com/portal/', false],
        // Eightfold (JDEF-12): a tenant's /careers; never app., www. or a career hub.
        ['https://twilio.eightfold.ai/careers?pid=1', true], ['https://twilio.eightfold.ai/careers/job/1', true],
        ['https://app.eightfold.ai/careers', false], ['https://twilio.eightfold.ai/careerhub/me', false],
        ['https://www.eightfold.ai/careers', false],
        // Jibe (ICIMS7-11): a tenant's /jobs/ pages; never its marketing pages.
        ['https://oneblood.jibeapply.com/jobs/1234', true], ['https://oneblood.jibeapply.com/about', false],
        ['https://jibeapply.com/jobs/1', false], ['http://oneblood.jibeapply.com/jobs/1', false],
      ];
      for (const [url, candidate] of cases) {
        expect(onAtsHost(url), url).toBe(candidate);
        // src/shared/hosts.ts agrees wherever it already names the page (ENGINE-7 E0 registers these hosts).
        if (platformOfUrl(url) !== null) expect(candidate, url).toBe(true);
      }
      expect(FIXTURE_PLATFORMS.slice(-5)).toEqual(['ukgready', 'paycom', 'jobdiva', 'eightfold', 'jibe']);
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
    writeFileSync(file, syntheticCapture('template'));
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
    // jr7 TOOLING-7: and its three new options.
    expect(run.stderr).toContain('[--style-order archive|live] [--keep-application <job id>] [--frame-src <css>=<https address>]...');
  });

  it("jr7 TOOLING-7: reads --style-order, --frame-src (repeatable) and --keep-application, refusing each one's misuse", () => {
    const file = join(work, 'cli-jr7.mhtml');
    writeFileSync(file, syntheticCapture());
    const out = join(work, 'cli-jr7-out');
    const anchor = 'https://www.google.com/recaptcha/api2/anchor?ar=1&size=normal';
    const run = (...extra: string[]) => spawnSync(process.execPath, [SCRIPT, file, '--platform', 'greenhouse', '--case',
      'cli-jr7', '--out', out, ...extra], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    const ok = run('--style-order', 'live', '--frame-src', `iframe[src^="cid:frame-BLANK"]=${anchor}`);
    expect(ok.stderr).toBe('');
    expect(ok.status).toBe(0);
    const written = readFileSync(join(out, 'greenhouse', 'cli-jr7.html'), 'utf8');
    expect(written).toContain(`src="${anchor.replace(/&/g, '&amp;')}" width="10" height="10"`);
    expect(headerOf(written)).toMatchObject({ styleOrder: 'live', frames: { given: 1 } });
    for (const [extra, refusal] of [
      [['--keep-application', '41'], '--keep-application is for --platform oracle'],
      [['--style-order', 'page'], '--style-order must be one of archive, live'],
      [['--frame-src', 'iframe=http://www.google.com/x'], '--frame-src #1 must be <css>=<https address>'],
      [['--frame-src', `iframe[title="Nothing"]=${anchor}`], '--frame-src #1 names no frame the capture saved unloaded'],
    ] as Array<[string[], string]>) {
      const refused = run(...extra);
      expect(refused.status, refusal).toBe(1);
      expect(refused.stderr, refusal).toContain(refusal);
    }
  }, 120_000);
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
    // jr6 fixes (PRIV-4): any other utm_source is a referral: it stays, its value REDACTED (where the person came from).
    expect(withoutInjectedParams('https://x.example/a?utm_source=SimplifyJobs')).toBe('https://x.example/a?utm_source=REDACTED');
    expect(withoutInjectedParams('https://x.example/a?utm_source=LinkedIn')).toBe('https://x.example/a?utm_source=REDACTED');
    expect(INJECTED_PARAMS).toEqual(['jr_id', 'utm_source=Simplify']);
    // The fix of 2026-11-08: Jobright's Edit with AI hosts too (snapshot5).
    expect(INJECTED_UI).toEqual(['plasmo-csui#jobright-helper-plugin', '#swooped-extension-root', '.jr-edit-ai-host']);
    // jr7 TOOLING-7 (UKGR-20): and UKG Ready's applicant session and file-service ticket.
    expect(PER_LOAD_PARAMS).toEqual(['validityToken', 'bft', 'hsutk', '__hstc', '__hssc', '__hsfp', 'ActiveSessionId', 'sft',
      'rnd', 'ticket']);
    // Greenhouse's, Ashby's and Workable's (boards), Workday's upload preview, the new ATSs' eleven and (jr6) ADP's
    // résumé row and SmartRecruiters' drop zone list (the generic applicant-text pass, redactApplicantTextInPage); jr7
    // TOOLING-7 (JDEF-16): and JobDiva's file card.
    expect(FILE_NAME_PLACES).toHaveLength(18);
    // Workable's file menu and (jr6) ADP's résumé Remove.
    expect(FILE_LINK_PLACES).toHaveLength(2);
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

/** jr6 (FIXPLAN 6.1 item 8): a case of the jr6 build (2026-11-10: the owner's snapshot6 and the Apply audits' pages),
 *  named jr6-*. The frozen counts and lists below leave them out; every jr6 file still goes through the per-file checks
 *  (its platform's, and those of every jr6 case: JR6_FILES). jr7 TOOLING-7: and a case of the jr7 build (2026-11-11: the
 *  owner's snapshot7, FIX7PLAN §11), named jr7-*, alike: out of the frozen lists, through every per-file check. */
const isJr6 = (name: string): boolean => /(?:^|\/)jr[67]-/.test(name);

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
    // jr6 cases (item 8) are left out of the list; each still goes through the per-file checks below.
    expect(CASES.filter((name) => !isJr6(name)).sort()).toEqual(['ashby/ashby-embed-closed.frame-1', 'ashby/cohere-closed', 'ashby/incident-closed',
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
      .map((name) => `ashby/${name.slice(0, -'.html'.length)}`).filter((name) => !CASES.includes(name) && !isJr6(name));
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
        // An Ashby month or year list's label is its block's "Start Date" with the adapter's "month" or "year"; s2 lists:
        // a Greenhouse phone's country is its own "Country" with the adapter's "code" (the phone's country code).
        const phoneCountry = first.matches('input.select__input#country') && first.closest('fieldset.phone-input') !== null;
        const shownLabel = ashby && field.kind === 'select' ? field.label.replace(/ (?:month|year)$/, '')
          : phoneCountry ? field.label.replace(/ code$/, '') : field.label;
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
    // application steps of the owner's snapshots are counted below (WORKDAY_STEP_FILES). jr6 cases (item 8) are left
    // out; each still goes through the per-file checks.
    expect(PHASE_67_FILES.filter((name) => !WORKDAY_STEP_FILES.includes(name) && !isJr6(name)).length)
      .toBe(26 + 3 + 1 + ICIMS_SNAPSHOT_FILES);
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
      'paycor', 'hibob',
      // jr7 TOOLING-7: jr7's five.
      'ukgready', 'paycom', 'jobdiva', 'eightfold', 'jibe']);
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
    // jr6 cases (item 8) are left out of the count; each still goes through the check below.
    expect(ICIMS_OWNER_FILES.filter((name) => !isJr6(name)).length).toBe(ICIMS_SNAPSHOT_FILES);
  });

  it.each(ICIMS_OWNER_FILES)('%s: holds no per-person value of the snapshot, nor its name, file or choices', (name) => {
    const html = readFileSync(join(ROOT, 'fixtures', `${name}.html`), 'utf8');
    const body = html.slice(html.indexOf('-->') + 3);
    // jr6 (ICIMS-28): the phone gate's pnumber= and ccode= too.
    expect(body).not.toMatch(/\b(?:csrf|eem|code|token|user|item|aid|applicationStartId|pnumber|ccode|_ga|ga|_gl|_sp|_jsqid)=(?!REDACTED)[^&"'\s<]/);
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
  'danafarber-voluntary-disclosures', 'danafarber-self-identify', 'web-review', 'verily-sign-in-verify',
  // s2 wd: the owner's snapshots of round 2 (2026-11-07, F:\Develop\Refer\snapshot1), the wd study's six and the
  // Country list open, converted once the converter dropped its chosen marks (s2-exelixis-country-open).
  's2-exelixis-country-open', 's2-exelixis-state-open', 's2-exelixis-my-experience', 's2-verily-create-account',
  's2-verily-source-open', 's2-verily-my-information', 's2-verily-field-of-study-open',
  // s2 wd, snapshot4: the owner's four captures of the evening.
  's2-verily-school-no-items', 's2-verily-degree-open', 's2-verily-school-results', 's2-verily-field-of-study-after-add',
  // The fix of 2026-11-08: snapshot5's two pureinsurance captures.
  's2-pureinsurance-my-experience-errors', 's2-pureinsurance-degree-open']
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

  // jr6 (item 8): every jr6 Workday case (the owner's snapshots too) goes through the same check, outside the frozen list.
  it.each([...WORKDAY_STEP_FILES, ...PHASE_67_FILES.filter((name) => name.startsWith('workday/') && isJr6(name))])(
    '%s holds no answer, upload name, chosen state, date or jr_id', (name) => {
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
    // s2 wd: a pill's id and its list's active descendant name no option, and no answer row of an open dropdown says
    // or shows that it is the chosen one.
    expect(body).not.toMatch(/id="pill-(?!REDACTED")/);
    expect(body).not.toMatch(/aria-activedescendant="pill-(?!REDACTED")/);
    expect(body).not.toMatch(/<li data-value="[^"]+"[^>]*aria-selected=/);
    const rows = [...body.matchAll(/<li data-value="[^"]+" role="option"[^>]*class="([^"]*)"/g)].map((row) => row[1]);
    expect(new Set(rows).size, `${name}: the answer rows of its open dropdown`).toBeLessThanOrEqual(1);
  });

  // s2 wd: the converter's findings of the wd study (snapshot round 2, 2026-11-07), on the snapshots' own markup with
  // made-up values.
  it("drops the chosen country's marks from an open dropdown: its list's active descendant and its row's look (s2 wd)",
    async () => {
      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();
      // The exelixis capture of the Country list open: the list names the chosen row as its active descendant, and that
      // row alone carries aria-selected and the class that draws it highlighted.
      await page.setContent(`<!doctype html><html><head><style>.row{color:#494949}.chosen{background:#be3a34}</style></head>
        <body><button aria-haspopup="listbox" type="button" value="wid-b" aria-label="Country Bravoland Required"
          id="country--country" aria-expanded="true" aria-controls="list">Bravoland</button>
        <div data-popper-placement="bottom"><ul role="listbox" id="list" aria-activedescendant="wid-b">
          <li data-value="" role="option" aria-disabled="true" id="select-one" class="none">Select One</li>
          <li data-value="wid-a" role="option" id="wid-a" class="row">Alphaland</li>
          <li data-value="wid-b" role="option" aria-selected="true" id="wid-b" class="chosen">Bravoland</li>
          <li data-value="wid-c" role="option" id="wid-c" class="row">Charlieland</li>
          <li data-value="wid-d" role="option" id="wid-d" class="row">Deltaland</li></ul></div>
        <input role="combobox" id="rs" aria-activedescendant="react-select-x-option-1"><div role="listbox">
          <div role="option" id="react-select-x-option-1" aria-selected="true">Bravoland</div></div>
        <ul role="listbox" id="other" aria-activedescendant="wid-z"><li role="option" id="wid-z">Zululand</li></ul>
      </body></html>`);
      expect((await page.evaluate(clearChoicesInPage, { redacted: 'REDACTED', marks: CHOSEN_MARKS })).choices).toBe(4);
      const counts = await page.evaluate(redactWorkdayInPage, { redacted: 'REDACTED' });
      const state = await page.evaluate(() => ({
        active: Array.from(document.querySelectorAll('[aria-activedescendant]'), (el) => `${el.id}>${el.getAttribute('aria-activedescendant')}`),
        rows: Array.from(document.querySelectorAll('#list li'), (row) => `${row.className}|${row.getAttribute('aria-selected') ?? ''}`),
      }));
      // The active descendant that named an option the generic pass unselected goes; one naming no chosen option stays.
      expect(state.active).toEqual(['other>wid-z']);
      // Every answer row is drawn as most of them are, none says it was chosen; Workday's "Select One" keeps its own look.
      expect(state.rows).toEqual(['none|', 'row|', 'row|', 'row|', 'row|']);
      expect(counts.options).toBe(1);
      expect(counts.dropdowns).toBe(1);
      await context.close();
    }, 30_000);

  it("redacts a pill's id, its list's active descendant and an open prompt list's chosen row (s2 wd)", async () => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    // s2-verily-my-information's chosen pill, and s2-verily-field-of-study-open's open list with a row chosen.
    await page.setContent(`<!doctype html><html><body><div data-automation-id="multiSelectContainer">
      <ul role="listbox" data-automation-id="selectedItemList" aria-activedescendant="pill-0a1b2c">
        <li role="presentation" data-automation-id="menuItem" data-automation-selected="true"><div role="option"
          data-automation-id="selectedItem" id="pill-0a1b2c" aria-label="Fixture Board"><p data-automation-id="promptOption"
          data-automation-label="Fixture Board">Fixture Board</p></div></li></ul></div>
      <div data-automation-id="activeListContainer" role="listbox" aria-label="Options Expanded">
        <div role="option" data-automation-id="menuItem" id="menuItem-1" aria-label="Fixture Studies checked"
          aria-selected="true" data-automation-selected="true"><div data-automation-id="promptLeafNode"
          data-automation-checked="Checked" data-uxi-multiselectlistitem-isselected="true"><input type="radio"
          data-automation-id="radioBtn" aria-checked="true"><div data-automation-id="promptOption">Fixture Studies</div></div></div>
        <div role="option" data-automation-id="menuItem" id="menuItem-2" aria-label="Other Studies not checked"
          aria-selected="false" data-automation-selected="false"><div data-automation-id="promptLeafNode"
          data-automation-checked="Not Checked"><div data-automation-id="promptOption">Other Studies</div></div></div></div>
    </body></html>`);
    await page.evaluate(clearChoicesInPage, { redacted: 'REDACTED', marks: CHOSEN_MARKS });
    const counts = await page.evaluate(redactWorkdayInPage, { redacted: 'REDACTED' });
    const html = await page.evaluate(() => document.body.innerHTML);
    expect(html).not.toContain('0a1b2c');
    expect(html).not.toContain('Fixture Board');
    expect(await page.evaluate(() => [document.querySelector('[data-automation-id="selectedItem"]')!.id,
      document.querySelector('[data-automation-id="selectedItemList"]')!.getAttribute('aria-activedescendant')]))
      .toEqual(['pill-REDACTED', 'pill-REDACTED']);
    // The open list's rows: as before an answer (a list's own option words stay: they are the page's).
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('[data-automation-id="activeListContainer"] [role="option"]'),
      (row) => [row.getAttribute('aria-label'), row.getAttribute('aria-selected'), row.getAttribute('data-automation-selected'),
        row.querySelector('[data-automation-id="promptLeafNode"]')!.getAttribute('data-automation-checked'),
        row.querySelector('[data-automation-id="promptLeafNode"]')!.getAttribute('data-uxi-multiselectlistitem-isselected')])))
      .toEqual([['Fixture Studies not checked', 'false', 'false', 'Not Checked', 'false'],
        ['Other Studies not checked', 'false', 'false', 'Not Checked', null]]);
    expect(counts.prompts).toBeGreaterThanOrEqual(5);
    expect(counts.options).toBe(1);
    await context.close();
  }, 30_000);

  it("redacts a prompt's search results, which what the applicant typed found, and keeps a browse list's (s2 wd)",
    async () => {
      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();
      // snapshot4's School search (s2-verily-school-results) and a browse list (s2-verily-field-of-study-open).
      const row = (words: string) => `<div role="option" data-automation-id="menuItem" aria-label="${words} not checked">
        <div data-automation-id="promptLeafNode" data-uxi-multiselectlistitem-type="1"><input type="radio"
        data-automation-id="radioBtn"><div data-automation-id="promptOption" title="${words}">${words}</div></div></div>`;
      await page.setContent(`<!doctype html><html><body>
        <div data-automation-id="responsiveMonikerPrompt"><div data-automation-id="multiSelectHeader"><div
          data-automation-id="promptTitle" title="Search Results">Search Results</div><div>(2)</div></div>
          <div data-uxi-widget-type="multiselectlist" data-uxi-multiselectlist-issearch="true"><div
            data-automation-id="activeListContainer" role="listbox">${row('Fixture University')}${row('Fixture College')}</div></div></div>
        <div data-automation-id="responsiveMonikerPrompt"><div data-uxi-widget-type="multiselectlist"
          data-uxi-multiselectlist-issearch="false"><div data-automation-id="activeListContainer" role="listbox"
          id="browse">${row('Fixture Studies')}</div></div></div>
      </body></html>`);
      await page.evaluate(redactWorkdayInPage, { redacted: 'REDACTED' });
      const html = await page.evaluate(() => document.body.innerHTML);
      expect(html).not.toMatch(/Fixture University|Fixture College/);
      expect(await page.evaluate(() => Array.from(document.querySelectorAll('[role="option"]'), (el) =>
        [el.getAttribute('aria-label'), el.querySelector('[data-automation-id="promptOption"]')!.textContent]))).toEqual([
        ['REDACTED not checked', 'REDACTED'], ['REDACTED not checked', 'REDACTED'],
        ['Fixture Studies not checked', 'Fixture Studies']]);
      // The header's words are the page's own.
      expect(html).toContain('Search Results');
      await context.close();
    }, 30_000);
});

// The fix of 2026-11-08 (snapshot5, [pureinsurance.wd5.myworkdayjobs.com] Senior Security Analyst – Cloud Security.mht):
// what Jobright and TailorIT drew into the page, and the digits Workday's errors repeat.
describe("snapshot5: other extensions' hosts, TailorIT's own, and Workday's errors (the fix of 2026-11-08)", () => {
  it("takes out Jobright's Edit with AI hosts and a closed shadow host on <body> or <html>, a page's own kept", async () => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><main><form><label for="why">Why?</label><textarea id="why"></textarea>
      <div class="jr-edit-ai-host" id="jr"></div><div id="page-host"></div></form></main>
      <div id="closed-on-body" ${CLOSED_ROOT_MARK}=""></div><div id="open-on-body"></div></body></html>`);
    await page.evaluate((mark) => {
      document.getElementById('jr')!.attachShadow({ mode: 'open' }).innerHTML = '<button>Edit with AI</button>';
      document.getElementById('page-host')!.attachShadow({ mode: 'open' }).innerHTML = '<input id="inner">';
      document.getElementById('open-on-body')!.attachShadow({ mode: 'open' }).innerHTML = '<input id="inner2">';
      // TailorIT's own UI host: a closed root, appended to <html> (content/ui/shadow.ts).
      const own = document.createElement('div');
      own.id = 'own';
      own.setAttribute(mark, '');
      document.documentElement.append(own);
    }, CLOSED_ROOT_MARK);
    const counts = await page.evaluate(stripInjectedInPage, { selectors: INJECTED_UI, perLoad: 'x^', dropOverlays: true,
      redacted: 'REDACTED', closedMark: CLOSED_ROOT_MARK });
    expect(await page.evaluate(() => ['jr', 'page-host', 'closed-on-body', 'open-on-body', 'own']
      .map((id) => document.getElementById(id) !== null))).toEqual([false, true, false, true, false]);
    expect(counts).toMatchObject({ injected: 1, shadowOverlays: 2 });
    await context.close();
  }, 30_000);

  it("redacts the digits Workday's field alerts and its errors summary repeat, and keeps their words", async () => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    // snapshot5's markup, digits made up.
    await page.setContent(`<!doctype html><html><body><div data-automation-id="errorHeading"><ol><li value="1"><div><button
      aria-describedby="hint1"><span>Error</span><div aria-hidden="true">-</div>From</button><div id="hint1">Invalid Date:
      07/</div></div></li></ol></div><div data-automation-id="formField-startDate"><fieldset><p id="error1-w--startDate"
      data-automation-id="inputAlert"><span>Error: </span>Invalid Date: 07/</p></fieldset></div></body></html>`);
    await page.evaluate(redactWorkdayInPage, { redacted: 'REDACTED' });
    const text = await page.evaluate(() => document.body.textContent!.replace(/\s+/g, ' ').trim());
    expect(text).not.toMatch(/\d/);
    expect(text).toBe('Error-FromInvalid Date: REDACTED/Error: Invalid Date: REDACTED/');
    await context.close();
  }, 30_000);
});

// s2 wd: the eeo study's converter findings (snapshot round 2): the answers react-select and Lever show besides a chip.
describe("the answers react-select and the location searches show besides their chosen value (s2 wd)", () => {
  it("redacts a chip's remove label, the live region's words and a location search's results, an option's too", async () => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    // s2-pie-eeo-0's chip, s2-lightning-0..2's live region and location results, s2-ahead-0's Lever result.
    await page.setContent(`<!doctype html><html><body>
      <div class="select__multi-value"><div class="select__multi-value__label">REDACTED</div>
        <div role="button" class="select__multi-value__remove" aria-label="Remove Fixture answer"><svg></svg></div></div>
      <span id="aria-selection">option Fixture answer, selected.</span><span id="aria-focused"></span>
      <span id="aria-results">1 result available for search term Fixturetown.</span>
      <span id="aria-guidance">Select is focused ,type to refine list, press Down to open the menu,</span>
      <div class="select__menu"><div class="select__menu-list" role="listbox">
        <div class="select__option" role="option" id="react-select-candidate-location-option-0">Fixturetown, Fixture State</div>
        <div class="select__option" role="option" id="react-select-gender-option-0">Fixture option</div></div></div>
      <div class="dropdown-results"><div class="break-word dropdown-location" id="location-0" title="Fixturetown, FS">Fixturetown, FS</div></div>
    </body></html>`);
    const cleared = await page.evaluate(redactApplicantTextInPage, { fileNames: FILE_NAME_PLACES, entries: ENTRY_SUMMARY_PLACES,
      chosen: CHOSEN_PLACES, profile: PROFILE_PLACES, links: [...FILE_LINK_PLACES, ...ENTRY_SUMMARY_CONTROLS],
      results: SEARCH_RESULT_PLACES, redacted: 'REDACTED' });
    const html = await page.evaluate(() => document.body.innerHTML);
    expect(html).not.toMatch(/Fixture answer|Fixturetown/);
    expect(await page.evaluate(() => [
      document.querySelector('.select__multi-value__remove')!.getAttribute('aria-label'),
      ...['aria-selection', 'aria-results', 'aria-guidance'].map((id) => document.getElementById(id)!.textContent),
      document.getElementById('react-select-candidate-location-option-0')!.textContent,
      document.getElementById('location-0')!.textContent, document.getElementById('location-0')!.getAttribute('title'),
      // Another list's own option is the page's words, kept.
      document.getElementById('react-select-gender-option-0')!.textContent,
    ])).toEqual(['REDACTED', 'REDACTED', 'REDACTED', 'Select is focused ,type to refine list, press Down to open the menu,',
      'REDACTED', 'REDACTED', 'REDACTED', 'Fixture option']);
    expect(cleared.applicantText).toBeGreaterThanOrEqual(4);
    await context.close();
  }, 30_000);
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
      // jr7 TOOLING-7 (jr7-O5): and its My Applications tiles' counts (none here).
      expect(oracle).toEqual({ widgetText: 4, checked: 1, typedValues: 0, placeholders: 0, applications: 0,
        keptApplications: 0 });
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
      expect(sr).toEqual({ widgetText: 1, checked: 0, typedValues: 0, placeholders: 1, applications: 0, keptApplications: 0 });
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
    // jr6 cases (item 8) are left out of the list; each still goes through the per-file check below, its .expect.json
    // required.
    expect(SR_FILES.filter((name) => !isJr6(name)).sort()).toEqual(['smartrecruiters/bertelsmann-expired',
      'smartrecruiters/xplor-one-click', 'smartrecruiters/xplor-posting', 'smartrecruiters/xplor-screening']);
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
    // jr6 fixes (PRIV-3, REVC-1; SMARTRECRUITERS): no answer of the person's in a control's marks. No spl-radio or
    // spl-checkbox keeps checked, no spl-radio its name, no Yes/No group a lone tab stop off its first row (the roving
    // tabindex 0 stood on the chosen row: an unanswered group, xplor-screening's six, has it on its first), and no
    // element (a form included) an Angular state class (which boxes were typed into, touched or valid). Every page here
    // was converted with the converter that clears them (the five form pages again in the jr6 fix round). Counts only,
    // so a failure never shows the row.
    const count = (pattern: RegExp) => markup.match(pattern)?.length ?? 0;
    expect(count(/<spl-(?:radio|checkbox)(?=[\s>])[^>]*\schecked(?:\s*=\s*"(?!false")[^"]*")?(?=[\s/>])/g), 'checked')
      .toBe(0);
    expect(count(/<spl-radio(?=[\s>])[^>]*\sname=/g), 'a radio named').toBe(0);
    const groups = [...markup.matchAll(/<spl-radio-group\b[^>]*>([\s\S]*?)<\/spl-radio-group>/g)]
      .map(([, group]) => [...(group ?? '').matchAll(/<spl-radio(?=[\s>])[^>]*?\stabindex="(-?\d+)"/g)].map(([, tab]) => tab));
    expect(groups.filter((tabs) => !tabs.every((tab, at) => tab === (at === 0 ? '0' : '-1'))).length,
      'Yes/No groups whose tab stop is off their first row').toBe(0);
    expect(count(/<[a-z][\w-]*\s[^>]*\bclass="[^"]*(?<![\w-])ng-(?:(?:valid|invalid|pending)(?:-[\w-]+)?|not-empty|empty|dirty|pristine|touched|untouched)(?![\w-])/g),
      'elements with an Angular state class').toBe(0);
  });
});

// ── snapshot build 2026-11-06 (core pass Z1, item 38): every committed fixture against the token checks ──
/** Every committed fixture's page, frame and route map (fixtures/<platform>/...), by its path under fixtures/. The
 *  git-ignored folders (.gitignore: fixtures/_incoming/, a checkout's raw captures before conversion, and
 *  fixtures/.generated/) are never committed, so they are not walked. jr6 ifix C-4: `names`, the files' names to take
 *  (the referral sweep reads the expectations' addresses too). */
const IGNORED_FIXTURE_DIRS: readonly string[] = ['_incoming', '.generated'];
function committedFixtureFiles(dir = join(ROOT, 'fixtures'), under = '', names = /\.(?:html|routes\.json)$/): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory()
    ? under === '' && IGNORED_FIXTURE_DIRS.includes(entry.name) ? []
      : committedFixtureFiles(join(dir, entry.name), `${under}${entry.name}/`, names)
    : names.test(entry.name) ? [`${under}${entry.name}`] : []));
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
    // Every committed fixture read and checked in all its forms: well past vitest's 5 s default when the whole suite
    // runs in parallel (snapshot round 2 brought it near 500 files).
  }, 60_000);

  it("refuses a per-load token's percent-encoded padding left after REDACTED (greenhouse/asana-embed.html's canonical link)", () => {
    const perLoad = tokenNeedles().find(({ label }) => label === 'a per-load token')!.pattern;
    const link = (value: string) => checkedForms(`<link rel="canonical" href="http://job-boards.greenhouse.io/embed/job_app?for=x&amp;validityToken=${value}&amp;token=1">`);
    expect(link('REDACTED%3D%3D').some((form) => perLoad.test(form))).toBe(true);
    expect(link('REDACTED').some((form) => perLoad.test(form))).toBe(false);
  });
});
// ── end core pass Z1, item 38 ──

// ── s2 core-gh review (C10): react-select's chosen answers, redacted in every committed fixture ──
/** react-select's own words in its live region ("option REDACTED, selected.", "All selected options have been
 *  cleared.", "option REDACTED is disabled. Select another option."): no answer of a person's. */
const REACT_SELECT_OWN_WORDS = new Set(['remove', 'option', 'options', 'selected', 'deselected', 'removed', 'cleared',
  'all', 'have', 'been', 'is', 'disabled', 'select', 'another']);
/** Elements that hold nothing a closing tag ends. */
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source',
  'track', 'wbr']);

/**
 * The places of a page where react-select shows a chosen answer and the text there is not redacted (every word
 * REDACTED or react-select's own): a chip's remove button's aria-label (`.select__multi-value__remove`), a chip's label
 * (`multi-value__label`), the single value shown (`single-value`), and the live region's `span#aria-selection`. Places
 * and counts only, never the text.
 */
function unredactedChoicesIn(html: string): string[] {
  const text = html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const found: string[] = [];
  const redacted = (words: string) => words.replace(/REDACTED/g, ' ').split(/[^A-Za-z0-9]+/)
    .every((word) => word === '' || REACT_SELECT_OWN_WORDS.has(word.toLowerCase()));
  const stack: Array<{ tag: string; place: string | null; text: string }> = [];
  const token = /<\/?([a-zA-Z][\w-]*)\b([^>]*)>|([^<]+)/g;
  for (let match = token.exec(text); match !== null; match = token.exec(text)) {
    const [whole, name, attributes = '', characters] = match;
    if (characters !== undefined) {
      for (const open of stack) if (open.place !== null) open.text += characters;
      continue;
    }
    const tag = name!.toLowerCase();
    if (whole.startsWith('</')) {
      let at = stack.length - 1;
      while (at >= 0 && stack[at]!.tag !== tag) at -= 1;
      if (at < 0) continue;
      for (const closed of stack.splice(at)) {
        if (closed.place !== null && !redacted(closed.text)) found.push(closed.place);
      }
      continue;
    }
    const classes = /\bclass\s*=\s*"([^"]*)"/i.exec(attributes)?.[1] ?? '';
    const id = /\bid\s*=\s*"([^"]*)"/i.exec(attributes)?.[1] ?? '';
    const removeLabel = /multi-value__remove/.test(classes) ? /\baria-label\s*=\s*"([^"]*)"/i.exec(attributes)?.[1] : undefined;
    if (removeLabel !== undefined && !redacted(removeLabel)) found.push('a chip\'s remove label');
    const place = /multi-value__label/.test(classes) ? 'a chip\'s label' : /single-value/i.test(classes) ? 'the single value'
      : id === 'aria-selection' ? 'the live region\'s selection' : null;
    if (VOID_ELEMENTS.has(tag) || whole.endsWith('/>')) continue;
    stack.push({ tag, place, text: '' });
  }
  return found;
}

describe('every committed fixture: react-select\'s chosen answers (s2 core-gh review, C10)', () => {
  it('holds no unredacted chip remove label, chip label, single value or live-region selection', () => {
    const pages = committedFixtureFiles().filter((file) => file.endsWith('.html'));
    expect(pages.length).toBeGreaterThan(300);
    const failing = pages.flatMap((file) => {
      const places = unredactedChoicesIn(readFileSync(join(ROOT, 'fixtures', file), 'utf8'));
      return places.length === 0 ? [] : [`${file}: ${[...new Set(places)].join(', ')} (${places.length})`];
    });
    expect(failing).toEqual([]);
  }, 60_000);

  it('reads each place by its markup, redacted or not', () => {
    const page = (markup: string) => unredactedChoicesIn(`<!doctype html><html><body>${markup}</body></html>`);
    expect(page('<div role="button" class="select__multi-value__remove css-1" aria-label="Remove Gamma"></div>'))
      .toEqual(['a chip\'s remove label']);
    expect(page('<div role="button" class="select__multi-value__remove css-1" aria-label="Remove REDACTED"></div>'))
      .toEqual([]);
    expect(page('<div class="select__multi-value__label css-2">Gamma</div>')).toEqual(['a chip\'s label']);
    expect(page('<div class="select__single-value css-3"><div class="iti__flag"></div><span>Delta</span></div>'))
      .toEqual(['the single value']);
    expect(page('<div class="select__single-value css-3">REDACTED</div>')).toEqual([]);
    expect(page('<span id="aria-selection">option Delta, selected.</span>')).toEqual(['the live region\'s selection']);
    expect(page('<span id="aria-selection">option REDACTED, selected.</span>')).toEqual([]);
    expect(page('<span id="aria-selection">All selected options have been cleared.</span>')).toEqual([]);
  });
});
// ── end s2 core-gh review (C10) ──

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

/**
 * jr6 fixes (PRIV-2, REVC-4): the committed fixtures converted before the converter cleared these marks, which still hold
 * one (a privacy finding, not an exception). Each was to be converted again with this converter, and its entry then
 * went: it let through only the marks named here, and only while the file still held exactly them. All are converted
 * again now, so the map is empty: ADP's main questions page, which drew its chosen radio's dot (the jr6 ADP fixer);
 * SmartRecruiters' xplor-one-click and xplor-screening (SMARTRECRUITERS); Oracle's hjf-after-submit and
 * hjf-apply-section, which kept each answered pill group's tab stop on the chosen pill (ORACLE); HiBob's form, which
 * kept Angular's state classes on its components (the jr6 privacy check).
 */
const MARKED_FIXTURES: Record<string, string[]> = {};

/**
 * jr6 (jobvite-new-4): the committed fixtures converted before the converter cleared AngularJS's state classes, which
 * still hold them on their controls (ng-dirty on a clicked radio, ng-not-empty on a ticked box: a privacy finding, not an
 * exception). Each is to be converted again with this converter: JOBVITE's six NinjaOne pages (fixtures/jobvite/**).
 * Only that one mark is let through, and only while the file still holds it, so this list shrinks as each is converted
 * again (SP\jr6\build\TOOLING.md, open issues). (Breezy's form, converted again by the jr6 privacy check, holds none now.)
 */
// jr6 JOBVITE (TOOLING's handoff §6): the six NinjaOne pages were converted again with the jr6 converter, so they left
// this list; Breezy's form left it when the jr6 privacy check converted it again. The list is empty now.
const ANGULAR_STATE_FIXTURES: string[] = [];
const ANGULAR_STATE_MARK = 'an AngularJS state class on a control';

describe('chosen marks (the security fix of 2026-11-06: S2, S3, S10)', () => {
  it('every committed fixture holds no chosen mark (chosenMarksIn), but the captures whose choices are no answer', () => {
    const pages = committedFixtureFiles().filter((file) => file.endsWith('.html'));
    expect(pages.length).toBeGreaterThan(300);
    const marked = pages.filter((file) => chosenMarksIn(readFileSync(join(ROOT, 'fixtures', file), 'utf8'))
      .some((label) => !(ANGULAR_STATE_FIXTURES.includes(file) && label === ANGULAR_STATE_MARK)
        && !(MARKED_FIXTURES[file] ?? []).includes(label)));
    expect(marked.filter((file) => !CHOSEN_STATE_FIXTURES.includes(file))).toEqual([]);
    // jr6 fixes (PRIV-2, REVC-4): each file let through for this round's marks still holds exactly them.
    for (const [file, labels] of Object.entries(MARKED_FIXTURES)) {
      expect(pages, file).toContain(file);
      expect(chosenMarksIn(readFileSync(join(ROOT, 'fixtures', file), 'utf8')), file).toEqual(labels);
    }
    // jr6 (jobvite-new-4): each file let through for AngularJS's classes still holds them, and nothing else.
    for (const file of ANGULAR_STATE_FIXTURES) {
      expect(pages, file).toContain(file);
      expect(chosenMarksIn(readFileSync(join(ROOT, 'fixtures', file), 'utf8')), file).toEqual([ANGULAR_STATE_MARK]);
    }
    // The owner's re-converted pages among them (S2, S3, S10).
    for (const file of ['ashby/rivian-submitting.html', 'bamboohr/swyfft-form.html', 'oracle/hjf-apply-section.html',
      'smartrecruiters/xplor-one-click.html', 'greenhouse/rushdown-country-open.html', 'workable/jobs-salvo-apply.html',
      'workable/raydar-attached.html', 'workday/resolvetech-source-open.html']) {
      expect(pages, file).toContain(file);
      expect(chosenMarksIn(readFileSync(join(ROOT, 'fixtures', file), 'utf8'))
        .filter((label) => !(MARKED_FIXTURES[file] ?? []).includes(label)), file).toEqual([]);
    }
    // Each exception is still there, and is hand-written or captured before the owner's snapshots of 2026-11-06.
    for (const file of CHOSEN_STATE_FIXTURES) {
      expect(pages, file).toContain(file);
      if (/^(?:synthetic|traps)\//.test(file)) continue;
      const captured = /"captured":"([^"]+)"/.exec(readFileSync(join(ROOT, 'fixtures', file), 'utf8').slice(0, 8_000))?.[1];
      expect(captured, file).toBeDefined();
      expect(captured! < '2026-11-06', file).toBe(true);
    }
  }, 60_000);

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

// ---------------------------------------------------------------------------------------------------------------------
// ── jr6 (FIXPLAN 6.1, TOOLING; SP\jr6\BUILD.md): the converter's rules for the owner's snapshot6 of 2026-11-10, each on a
// synthetic page in the platform's own markup (the audits name the captures it was read from). Every value is made up. ──
// ---------------------------------------------------------------------------------------------------------------------

const ADP_PAGE = 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=tailorit-fixture';
const SR_ONE_CLICK = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/00000000-0000-4000-8000-000000000002';
/** A made-up applicant's name and file name, neither in the redaction list the tests pass. */
const JR6_NAME = 'Avery Quill';
const JR6_FILE = 'cv final 2026.pdf';

/** A live page saved by Chrome itself (Page.captureSnapshot), so the shadow roots its script attaches are saved as
 *  Chrome saves them. */
async function liveCapture(url: string, body: string, name: string): Promise<string> {
  const live = await browser.newContext({ viewport: VIEWPORT });
  await live.route('**/*', (route) => (route.request().url() === url
    ? route.fulfill({ status: 200, contentType: 'text/html',
      body: `<!DOCTYPE html><html><head><title>Apply</title></head><body>${body}</body></html>` })
    : route.abort()));
  const page = await live.newPage();
  await page.goto(url);
  const session = await live.newCDPSession(page);
  const { data } = await session.send('Page.captureSnapshot', { format: 'mhtml' });
  await live.close();
  const file = join(work, `${name}.mhtml`);
  writeFileSync(file, data);
  return file;
}

/** A converted file's header. */
const headerOf = (text: string) => JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(text)?.[1] ?? '{}');

/** Jobvite's radio and box groups as snapshot6 jobvite1 (6) draws them filled: the chosen row's class and icon, the
 *  clicked radio's and the ticked box's AngularJS classes; `extra` goes on the third row. */
const jobviteRows = (extra = '') => `<!DOCTYPE html><html><head><title>Apply</title></head><body>
<form name="apply" class="ng-dirty ng-invalid ng-submitted"><fieldset class="jv-input-group" ng-form="q1"><legend>Pick one</legend>
<label class="jv-input-group-row"><input type="radio" name="g" value="a" ng-model="option.answer" class="ng-pristine ng-untouched ng-valid ng-not-empty"><i class="icon icon-radio-empty" role="radio" aria-selected="false"></i><span>Alpha</span></label>
<label class="jv-input-group-row jv-input-group-row-active"><input type="radio" name="g" value="b" ng-model="option.answer" class="ng-dirty ng-valid-parse ng-touched ng-valid ng-not-empty" checked><i class="icon icon-radio-checked" role="radio" aria-selected="true"></i><span>Beta</span></label>
<label class="jv-input-group-row"${extra}><input type="radio" name="g" value="c" ng-model="option.answer" class="ng-pristine ng-untouched ng-valid ng-not-empty"><i class="icon icon-radio-empty" role="radio" aria-selected="false"></i><span>Gamma</span></label>
</fieldset><fieldset class="jv-input-group"><legend>Pick any</legend>
<label class="jv-input-group-row"><input type="checkbox" ng-model="option.ticked" class="ng-dirty ng-valid ng-not-empty ng-touched" checked><i class="icon icon-checkbox-checked" role="checkbox" aria-checked="true"></i><span>Delta</span></label>
<label class="jv-input-group-row"><input type="checkbox" ng-model="option.ticked" class="ng-pristine ng-untouched ng-valid ng-empty"><i class="icon icon-checkbox-blank" role="checkbox" aria-checked=""></i><span>Epsilon</span></label>
</fieldset><label for="city">City</label><input type="text" id="city" ng-model="x.city" class="jv-text ng-dirty ng-valid ng-not-empty ng-valid-required" value="Fixture Town" required>
<div ng-form="sub" class="sub-form ng-dirty ng-valid"><select ng-model="x.s" class="ng-touched ng-valid"><option>One</option><option>Two</option></select></div>
<p class="ng-dirty">An ordinary paragraph keeps its classes.</p></form></body></html>`;

/** A Jobvite posting and its form where a listed word (Roeville, made up) is also the page's own word: a county among
 *  the page's list, a question's legend, an option's label, the posting's description and its copy in the page's
 *  description metadata. */
const JOBVITE_LISTED = `<!DOCTYPE html><html><head><title>Apply</title>
<meta name="description" content="This role sits in our Roeville office."></head><body>
<div class="jv-job-detail-description"><p>This role sits in our Roeville office.</p><p>It is a made-up posting.</p></div>
<form><label for="county">County of Residence</label><select id="county"><option value="">Select...</option>
<option value="1">Adams</option><option value="2">Roeville</option><option value="3">Zephyr</option></select>
<fieldset><legend>Have you lived in Roeville?</legend><label><input type="radio" name="lived" value="y"> Yes, in Roeville</label>
<label><input type="radio" name="lived" value="n"> No</label></fieldset></form></body></html>`;

/** The replacements that give JOBVITE_LISTED's four places synthetic text. */
const JOBVITE_REPLACEMENTS = [
  { selector: '#county', text: 'Alder\r\nBirch\n\nCedar\n' },
  { selector: 'fieldset > legend', text: 'Have you lived in Fixture Town?' },
  { selector: 'fieldset > label:first-of-type', text: 'Yes, in Fixture Town' },
  { selector: 'div.jv-job-detail-description', text: 'A synthetic description.\nIts second line.' },
  { selector: 'meta[name="description"]', text: 'A synthetic summary.\nOn one line.' },
];

describe('jr6: the owner\'s snapshot6 places (FIXPLAN 6.1, TOOLING)', () => {
  it("clears ADP's signed-in account, Review summary, résumé row and chosen answers, inside its shadow roots (adp-new-4)",
    async () => {
      // snapshot6 adp1 and adp2's markup (SP\jr6\audit\adp.md section 2), values made up: the avatar's initials (too
      // short for any redaction list), the name, the résumé's name, a Review line and answer, a chip and a chosen list.
      const file = await liveCapture(ADP_PAGE, `
<div class="logged-in-user"><div class="avatar-button" role="button" tabindex="0" aria-label="AQ,  Show user menu">
  <div class="avatar-container"><sdf-avatar id="avatar" role="img" aria-label="${JR6_NAME}"></sdf-avatar></div></div></div>
<div id="avatar-menu-pane"><div class="avatar-menu avatar-menu-header"><sdf-avatar id="avatar-menu" aria-hidden="true"></sdf-avatar><h2>${JR6_NAME}</h2></div></div>
<p>Applied on <span class="job-description-applied-date">11/03/2026</span></p>
<label for="question_7">How did you hear about this job?</label><sdf-select-simple id="question_7" placeholder="Choose an option"></sdf-select-simple>
<label for="question_8">Shift</label><sdf-select-simple id="question_8" placeholder="Choose an option"></sdf-select-simple>
<div class="MDFSelectBox__multi-value"><div class="MDFSelectBox__multi-value__label">Kubernetes</div><div role="button" class="MDFSelectBox__multi-value__remove" aria-label="Remove Kubernetes">x</div></div>
<div class="additional-document-success"><span class="fileName"><span>Great! Your resume is in.</span></span></div>
<div class="fileDetails"><i class="fa fa-file-text"></i><span class="fileName">${JR6_FILE}</span><button id="recruitment_afterResumeUpload_remove_0" type="button" aria-label="Remove,${JR6_FILE},Resume"><span>Remove</span></button></div>
<div class="self-review-content-personalInfo"><sdf-icon icon="user"></sdf-icon><span>${JR6_NAME}</span></div>
<div class="self-review-content-personalInfo"><sdf-icon icon="phone"></sdf-icon><span>Lisbon, Portugal</span></div>
<span class="self-review-content-resume-content" aria-label="${JR6_FILE}">${JR6_FILE}</span>
<div class="self-review-content-additionaldocs"><sdf-icon icon="media-file"></sdf-icon><span>2 documents</span></div>
<div class="self-review-content-question"><label class="self-review-content-question-label">Are you at least 18?</label><label class="self-review-content-question-answer">Yes, since 2001</label></div>
<script>
for (const id of ['avatar', 'avatar-menu']) document.getElementById(id).attachShadow({ mode: 'open' }).textContent = 'AQ';
document.getElementById('question_7').attachShadow({ mode: 'open' }).innerHTML = '<div class="combo"><div class="trigger-button" role="button" part="frame">'
  + '<span id="selected-label" part="selected-label"><span>Referral Board</span></span></div>'
  + '<div role="status" aria-live="polite" class="sr-only">Referral Board</div><div role="listbox">'
  + '<sdf-select-item role="option" aria-selected="false" class="hydrated" value="Job Fair">Job Fair</sdf-select-item>'
  + '<sdf-select-item role="option" aria-selected="true" class="hydrated selected" value="Referral Board">Referral Board</sdf-select-item></div></div>';
document.getElementById('question_8').attachShadow({ mode: 'open' }).innerHTML = '<div class="combo"><div class="trigger-button" role="button" part="frame">'
  + '<span class="selected-label-placeholder" id="select-placeholder" part="placeholder">Choose an option</span></div>'
  + '<div role="status" aria-live="polite" class="sr-only"></div></div>';
</script>`, 'jr6-adp');
      const conversion = await convertMhtml({ file, platform: 'adp', caseName: 'jr6-adp', redact: LISTED, outDir: work });
      const text = conversion.files[0]?.text ?? '';
      for (const gone of ['Avery', 'Quill', '>AQ<', 'AQ,', 'cv final', 'cv%20final', '11/03/2026', 'Kubernetes', 'Lisbon',
        'since 2001', '2 documents', 'hydrated selected', 'aria-selected="true"']) {
        expect(text, gone).not.toContain(gone);
      }
      // ... while ADP's own words stay: the banner, the Remove label's words, the placeholder, the questions, the list.
      for (const kept of ['Great! Your resume is in.', 'aria-label="Remove,REDACTED,Resume"', '<span>Remove</span>',
        'id="select-placeholder" part="placeholder">Choose an option</span>', 'How did you hear about this job?',
        '>Are you at least 18?</label>', 'value="Job Fair">Job Fair</sdf-select-item>',
        '<span id="selected-label" part="selected-label"><span>REDACTED</span></span>',
        '<div role="status" aria-live="polite" class="sr-only">REDACTED</div>', '<h2>REDACTED</h2>']) {
        expect(text, kept).toContain(kept);
      }
      expect(chosenMarksIn(text)).toEqual([]);
      expect(headerOf(text)).toMatchObject({ shadowRoots: 4, redacted: { applicantText: expect.any(Number) } });
    }, 60_000);

  it("clears SmartRecruiters' saved entries, their buttons' labels, the avatar and the drop zone's file (SR-8)", async () => {
    // Snapshot captures 4 and 5's markup (SP\jr6\audit\smartrecruiters.md SR-8), values made up.
    const file = await liveCapture(SR_ONE_CLICK, `
<oc-experience-entry data-test="experience-entry"><div data-test="experience-entry" class="entry"><div data-test="experience-entry-is-edit-enabled">
  <p data-test="experience-entry-title">Staff Engineer<span data-test="experience-entry-date">2019 - 2024</span></p>
  <p data-test="experience-entry-company">Initech</p><p data-test="experience-entry-description">Ran the build farm</p></div>
  <spl-button id="edit" data-test="experience-entry-edit" tooltip="Edit" splarialabel="Edit Staff Engineer"></spl-button>
  <spl-button id="delete" data-test="experience-entry-delete" tooltip="Delete" splarialabel="Delete Staff Engineer"></spl-button></div></oc-experience-entry>
<oc-education-entry data-test="education-entry"><div data-test="education-entry"><p data-test="education-entry-institution">Lisbon Tech</p>
  <p data-test="education-entry-degree">BSc</p><p data-test="education-entry-major">Physics</p></div></oc-education-entry>
<spl-avatar id="avatar" role="img" firstname="Avery" lastname="Quill" aria-label="${JR6_NAME}"></spl-avatar>
<spl-dropzone id="zone" data-test="resume-upload" files='[{"name":"${JR6_FILE}","size":4321,"type":"application/pdf"}]'></spl-dropzone>
<spl-dropzone id="photo" data-test="photo-upload" files="[]"></spl-dropzone>
<script>
for (const id of ['edit', 'delete']) {
  const button = document.getElementById(id);
  button.attachShadow({ mode: 'open' }).innerHTML = '<button type="button" aria-label="' + button.getAttribute('splarialabel') + '">o</button>';
}
document.getElementById('avatar').attachShadow({ mode: 'open' }).innerHTML = '<div class="c-spl-avatar"><span class="c-spl-avatar-thumb">AQ</span></div>';
document.getElementById('zone').attachShadow({ mode: 'open' }).innerHTML = '<label>Browse files</label><ul><li class="c-spl-file-list-item">'
  + '<span class="c-spl-file-list-item-name">${JR6_FILE}</span><spl-button class="c-spl-file-list-item-delete-button" tooltip="Delete file" '
  + 'splarialabel="Delete file ${JR6_FILE}"></spl-button></li></ul>';
document.getElementById('photo').attachShadow({ mode: 'open' }).innerHTML = '<label>Browse files</label>';
</script>`, 'jr6-sr');
    const conversion = await convertMhtml({ file, platform: 'smartrecruiters', caseName: 'jr6-sr', redact: LISTED,
      outDir: work });
    const text = conversion.files[0]?.text ?? '';
    for (const gone of ['Avery', 'Quill', 'Staff Engineer', '2019 - 2024', 'Initech', 'build farm', 'Lisbon Tech', '>BSc<',
      'Physics', 'cv final', '4321', 'application/pdf', '>AQ<']) {
      expect(text, gone).not.toContain(gone);
    }
    for (const kept of ['tooltip="Edit"', 'tooltip="Delete"', 'tooltip="Delete file"', 'splarialabel="Delete file REDACTED"',
      'firstname="REDACTED" lastname="REDACTED"', 'Browse files']) {
      expect(text, kept).toContain(kept);
    }
    expect(text.match(/splarialabel="REDACTED"/g)).toHaveLength(2);
    expect(text.match(/files="\[\]"/g)).toHaveLength(2);
    expect(chosenMarksIn(text)).toEqual([]);
  }, 60_000);

  it("unchooses Jobvite's drawn rows and strips AngularJS's state classes, the rows then alike (JV-10, jobvite-new-4)",
    async () => {
      const file = join(work, 'jr6-rows.mhtml');
      writeFileSync(file, mhtml(NEW_PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: NEW_PAGE,
        body: jobviteRows() }]));
      const text = (await convertMhtml({ file, platform: 'jobvite', caseName: 'jr6-rows', redact: LISTED, outDir: work }))
        .files[0]?.text ?? '';
      for (const gone of ['jv-input-group-row-active', 'icon-radio-checked', 'icon-checkbox-checked', 'aria-selected="true"',
        'aria-checked', 'ng-dirty ng-valid', 'ng-not-empty', 'ng-valid-parse', 'ng-touched', 'ng-pristine', 'ng-untouched',
        'ng-empty', 'ng-valid-required', ' checked', 'Fixture Town']) {
        expect(text, gone).not.toContain(gone);
      }
      expect(text.match(/class="icon icon-radio-empty" role="radio" aria-selected="false"/g)).toHaveLength(3);
      expect(text.match(/class="icon icon-checkbox-blank" role="checkbox">/g)).toHaveLength(2);
      // A form's own state (Breezy reads its root's validity) keeps its classes; jr6 fixes (PRIV-2): any other element's
      // Angular state classes go too.
      for (const kept of ['<form name="apply" class="ng-dirty ng-invalid ng-submitted"', 'class="jv-text"',
        '<div ng-form="sub" class="sub-form">', '<p class="">']) {
        expect(text, kept).toContain(kept);
      }
      expect(chosenMarksIn(text)).toEqual([]);
      // Every option row of each group now reads alike.
      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();
      await page.setContent(text);
      expect((await page.evaluate(unevenChoiceRowsInPage, { rows: CHOICE_ROWS, ...CHOICE_ROW_INPUT }))[0])
        .toEqual({ groups: 2, uneven: 0 });
      await context.close();
    }, 60_000);

  it('refuses choice rows that still differ once cleared, by a mark it does not know (JV-10)', async () => {
    const file = join(work, 'jr6-rows-uneven.mhtml');
    writeFileSync(file, mhtml(NEW_PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: NEW_PAGE,
      body: jobviteRows(' data-picked="1"') }]));
    const error = await convertMhtml({ file, platform: 'jobvite', caseName: 'jr6-rows-uneven', outDir: work })
      .then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConversionError);
    expect((error as ConversionError).reasons).toEqual(['jr6-rows-uneven.html: choice groups (fieldset.jv-input-group) '
      + 'whose option rows still differ once cleared: 1, a chosen mark the converter does not know']);
    expect(CHOICE_ROWS[0]).toMatchObject({ group: 'fieldset.jv-input-group', row: 'label.jv-input-group-row' });
  }, 60_000);

  it("reads AngularJS's state classes on controls and ng-model or ng-form elements (jobvite-new-4), Angular's elsewhere (PRIV-2)", async () => {
    const markup = '<form id="f" class="ng-dirty ng-invalid"><input id="a" class="x ng-dirty ng-not-empty ng-valid-required ng-touched">'
      + '<textarea id="b" class="ng-pristine ng-untouched ng-empty ng-invalid ng-invalid-required"></textarea>'
      + '<select id="c" class="ng-valid ng-pending"></select><div id="d" ng-model="v" class="ng-dirty y"></div>'
      + '<div id="e" data-ng-form="f" class="ng-valid-email"></div><ng-form id="g" class="ng-dirty"></ng-form>'
      + '<p id="h" class="ng-dirty ng-hide">no control</p><input id="i" class="ng-scope ng-isolate-scope ng-hide"></form>';
    // jr6 fixes (PRIV-2): an element that is no control is read too, under its own label (Angular's components).
    expect(chosenMarksIn(markup)).toEqual(['an AngularJS state class on a control', CHOSEN_MARK_LABELS.angularComponent]);
    // Not on a form (Breezy's root), or AngularJS's other classes (ng-hide hides).
    expect(chosenMarksIn('<form class="ng-dirty"></form><p class="ng-hide"></p><input class="ng-scope ng-hide">')).toEqual([]);
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>${markup}</body></html>`);
    expect((await page.evaluate(clearChoicesInPage, { redacted: 'REDACTED', marks: CHOSEN_MARKS })).choices).toBe(7);
    expect(await page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('[id]'),
      (element) => [element.id, element.getAttribute('class')])))).toEqual({ f: 'ng-dirty ng-invalid', a: 'x', b: '', c: '',
      d: 'y', e: '', g: '', h: 'ng-hide', i: 'ng-scope ng-isolate-scope ng-hide' });
    await context.close();
    expect(new RegExp(ANGULAR_STATE_SOURCE).test('ng-valid-maxlength')).toBe(true);
  }, 30_000);

  it('refuses the redaction list met in an option, a label, a legend or a posting description, naming no value (jobvite-new-2)',
    async () => {
      const file = join(work, 'jr6-listed.mhtml');
      writeFileSync(file, mhtml(NEW_PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: NEW_PAGE,
        body: JOBVITE_LISTED }]));
      const error = await convertMhtml({ file, platform: 'jobvite', caseName: 'jr6-listed', redact: ['Roeville'], outDir: work })
        .then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConversionError);
      const tail = ', where a REDACTED tells the value by elimination; give each synthetic text with --replace-text';
      expect((error as ConversionError).reasons).toEqual([
        `jr6-listed.html: options (an <option> or a role=option) whose page text the redaction list met: 1${tail}`,
        `jr6-listed.html: labels whose page text the redaction list met: 1${tail}`,
        `jr6-listed.html: legends whose page text the redaction list met: 1${tail}`,
        // The description and its copy in the page's description metadata.
        `jr6-listed.html: posting descriptions (POSTING_TEXT_PLACES) whose page text the redaction list met: 2${tail}`]);
      expect((error as ConversionError).reasons.join(' ')).not.toContain('Roeville');
      expect(existsSync(join(work, 'jobvite', 'jr6-listed.html'))).toBe(false);
      expect(POSTING_TEXT_PLACES).toContain('div.jv-job-detail-description');
    }, 60_000);

  it("passes an option whose whole list ends REDACTED, as iCIMS's server-loaded dropdowns do, and refuses a native list",
    async () => {
      const url = 'https://careers-acme.icims.com/jobs/1/engineer/candidate';
      const dropdown = '<label for="rcf1">State</label><select id="rcf1" class="dropdown-hide" icimsdropdown-enabled="1" '
        + 'icimsdropdown-ajax="1" icimsdropdown-search="0"><option value="501">Roeville</option></select>'
        + '<a id="rcf1_icimsDropdown" class="dropdown-select" role="combobox"><span class="dropdown-text">Roeville</span></a>';
      const native = '<label for="Q6">County</label><select id="Q6" icimsdropdown-enabled="0"><option value="">Make a Selection'
        + '</option><option value="1">Adams</option><option value="2">Roeville</option></select>';
      const page = (form: string) => `<!DOCTYPE html><html><body><form>${form}</form></body></html>`;
      const passing = join(work, 'jr6-icims-dropdown.mhtml');
      writeFileSync(passing, mhtml(url, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: url, body: page(dropdown) }]));
      const text = (await convertMhtml({ file: passing, platform: 'icims', caseName: 'jr6-icims-dropdown', redact: ['Roeville'],
        outDir: work })).files[0]?.text ?? '';
      expect(text).not.toContain('Roeville');
      expect(text).toContain('<option value="REDACTED">REDACTED</option>');
      const refused = join(work, 'jr6-icims-native.mhtml');
      writeFileSync(refused, mhtml(url, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: url, body: page(native) }]));
      await expect(convertMhtml({ file: refused, platform: 'icims', caseName: 'jr6-icims-native', redact: ['Roeville'],
        outDir: work })).rejects.toThrow('jr6-icims-native.html: options (an <option> or a role=option) whose page text the '
        + 'redaction list met: 1');
    }, 60_000);

  it('gives the named elements synthetic text before measuring, the same fixture every time (jobvite-new-2: --replace-text)',
    async () => {
      const file = join(work, 'jr6-replaced.mhtml');
      writeFileSync(file, mhtml(NEW_PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: NEW_PAGE,
        body: JOBVITE_LISTED }]));
      const convert = () => convertMhtml({ file, platform: 'jobvite', caseName: 'jr6-replaced', redact: ['Roeville'],
        outDir: work, replaceText: JOBVITE_REPLACEMENTS });
      const one = await convert();
      const two = await convert();
      expect(two.files.map((output) => output.text)).toEqual(one.files.map((output) => output.text));
      expect(two.routes).toEqual(one.routes);
      const text = one.files[0]?.text ?? '';
      expect(text).not.toContain('Roeville');
      // A select's options become one per line, its placeholder first; an element holding no control keeps only the
      // text; a label keeps its radio, its text run replaced.
      expect(text).toContain('<select id="county"><option value="">Select...</option><option value="Alder">Alder</option>'
        + '<option value="Birch">Birch</option><option value="Cedar">Cedar</option></select>');
      expect(text).toContain('<legend>Have you lived in Fixture Town?</legend>');
      expect(text).toContain('<label><input type="radio" name="lived" value="y">Yes, in Fixture Town</label>');
      expect(text).toContain('<div class="jv-job-detail-description">A synthetic description.\nIts second line.</div>');
      expect(text).toContain('<label><input type="radio" name="lived" value="n"> No</label>');
      // A meta element's content takes the text, on one line.
      expect(text).toContain('<meta name="description" content="A synthetic summary. On one line.">');
      expect(headerOf(text).replacedText).toEqual([1, 1, 1, 1, 1]);
    }, 60_000);

  it('refuses a replacement that names nothing, one the page cannot read and one without text, by its position', async () => {
    const file = join(work, 'jr6-replace-refused.mhtml');
    writeFileSync(file, mhtml(NEW_PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: NEW_PAGE,
      body: JOBVITE_LISTED }]));
    const options = { file, platform: 'jobvite', caseName: 'jr6-replace-refused', outDir: work };
    await expect(convertMhtml({ ...options, replaceText: [JOBVITE_REPLACEMENTS[0]!, { selector: '#nothing-here', text: 'x' }] }))
      .rejects.toThrow('--replace-text #2 names no element in any converted frame');
    await expect(convertMhtml({ ...options, replaceText: [{ selector: '##county', text: 'x' }] }))
      .rejects.toThrow('--replace-text #1 is not a selector the page can read');
    await expect(convertMhtml({ ...options, replaceText: [{ selector: '#county', text: ' \n ' }] }))
      .rejects.toThrow('--replace-text #1 needs a selector and a non-empty file');
  }, 60_000);

  it('reads --replace-text on the command line, splitting at the last "=", and prints neither selector nor text', () => {
    expect(readReplaceOption('select[id="county"]=C:\\fixtures\\county.txt', 1))
      .toEqual({ selector: 'select[id="county"]', file: 'C:\\fixtures\\county.txt' });
    expect(() => readReplaceOption('#county', 2)).toThrow('--replace-text #2 must be <css>=<file>');
    const file = join(work, 'jr6-cli.mhtml');
    writeFileSync(file, mhtml(NEW_PAGE, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: NEW_PAGE,
      body: JOBVITE_LISTED }]));
    const redact = join(work, 'jr6-cli-redact.txt');
    writeFileSync(redact, 'Roeville\n');
    const args = JOBVITE_REPLACEMENTS.flatMap(({ selector, text }, index) => {
      const textFile = join(work, `jr6-cli-text-${index + 1}.txt`);
      writeFileSync(textFile, text);
      return ['--replace-text', `${selector === '#county' ? 'select[id="county"]' : selector}=${textFile}`];
    });
    const out = join(work, 'jr6-cli-out');
    const run = spawnSync(process.execPath, [SCRIPT, file, '--platform', 'jobvite', '--case', 'jr6-cli', '--redact', redact,
      '--out', out, ...args], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const written = readFileSync(join(out, 'jobvite', 'jr6-cli.html'), 'utf8');
    expect(written).toContain('<option value="Cedar">Cedar</option>');
    expect(written).not.toContain('Roeville');
    expect(run.stdout).not.toMatch(/county|Fixture Town|synthetic description|Roeville/i);
  }, 60_000);

  it("redacts iCIMS's pnumber= and ccode= with its per-person values (ICIMS-28)", () => {
    const { text } = normaliseTokens('icims', '<a href="/jobs/1/x/candidate?from=login&amp;eem=a1&amp;pnumber=Zm9vYmFy'
      + '&amp;ccode=MQ%3D%3D&amp;code=b2">profile</a><p>A phonenumber=5 and pnumbers stay words.</p>');
    expect(text).toContain('from=login&amp;eem=REDACTED&amp;pnumber=REDACTED&amp;ccode=REDACTED&amp;code=REDACTED');
    expect(text).not.toMatch(/Zm9vYmFy|MQ%3D/);
    expect(text).toContain('A phonenumber=5 and pnumbers stay words.');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// ── jr6 round 2 (TOOLING; SP\jr6\BUILD.md 4b, the gap SMARTRECRUITERS P1 found): an open list's rows keep nothing that
// names them once their words go, a typed query's results lose their words, and no listed string survives in any
// attribute, respelled or not. Each shape on a synthetic page in the platform's own markup; every value is made up
// ("Roeville" is no listed string: the typed query's results are redacted by their markup alone). ──
// ---------------------------------------------------------------------------------------------------------------------

const ORACLE_APPLY = 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1/apply/section/1';
const ICIMS_APPLY = 'https://careers-acme.icims.com/jobs/1/engineer/candidate';
const WORKDAY_APPLY = 'https://acme.wd1.myworkdayjobs.com/en-US/External/job/Remote/Engineer_R1/apply/applyManually';
const GREENHOUSE_JOB = 'https://job-boards.greenhouse.io/acme/jobs/1';

/** One page converted from a hand-built archive (no script: no shadow root). */
async function convertPage(url: string, platform: string, caseName: string, body: string, redact: string[] = LISTED) {
  const file = join(work, `${caseName}.mhtml`);
  writeFileSync(file, mhtml(url, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: url,
    body: `<!DOCTYPE html><html><head><title>Apply</title></head><body>${body}</body></html>` }]));
  const conversion = await convertMhtml({ file, platform, caseName, redact, outDir: work });
  return { conversion, text: conversion.files[0]?.text ?? '' };
}

/** SmartRecruiters' City search as the Wiser one-click capture draws it open (SP\jr6\build\SMARTRECRUITERS.md SR-8):
 *  spl-autocomplete's shadow root holds its spl-input (Lit's ariacontrols; no typed text kept here, so the menu's own
 *  mark, TYPED_LISTS, says it lists a query's results) and the menu, each result an spl-select-option whose value and
 *  data-sr-id spell the place, its role=option inside its own shadow root; the manual-location row last. */
const SR_CITY = `<label for="city">City</label>
<spl-autocomplete id="city" data-sr-id="location-autocomplete-search" minquerylength="3" label="City"></spl-autocomplete>
<script>
const root = document.getElementById('city').attachShadow({ mode: 'open' });
root.innerHTML = '<div data-sr-id="location-autocomplete-search-root"><spl-input id="spl-form-element_3" type="text" '
  + 'value="" ariacontrols="menu-spl-form-element_3" ariaautocomplete="list" '
  + 'data-sr-id="location-autocomplete-search-search"></spl-input>'
  + '<div slot="menu" id="menu-spl-form-element_3" data-sr-id="location-autocomplete-search-menu" role="listbox">'
  + '<spl-select-option value="roeville-nj-us" data-sr-id="location-autocomplete-search-option-roeville-nj-us">'
  + '<spl-truncate title="Roeville, NJ, United States">Roeville, NJ, United States</spl-truncate>'
  + '<div class="c-spl-autocomplete-option-content" data-sr-id="location-autocomplete-search-option-roeville-nj-us-content">'
  + 'Roeville, NJ, United States</div></spl-select-option>'
  + '<spl-select-option value="goToManualLocationMode" data-sr-id="location-autocomplete-search-option-goToManualLocationMode">'
  + '<spl-truncate title="Enter your location manually">Enter your location manually</spl-truncate></spl-select-option>'
  + '</div></div>';
for (const [at, option] of [...root.querySelectorAll('spl-select-option')].entries()) {
  // Each row's own shadow root: its role=option, a component's own tooltip label, and a label repeating its words.
  option.attachShadow({ mode: 'open' }).innerHTML = '<div class="c-spl-dropdown-item" role="option" aria-selected="false"><slot></slot></div>'
    + '<div role="tooltip" id="tooltip-' + (at + 1) + '" aria-label="Tooltip"></div>'
    + '<span class="sr-only" aria-label="' + option.querySelector('spl-truncate').getAttribute('title') + '"></span>';
}
</script>`;

describe('jr6 round 2: the names an open list\'s rows carry, and a listed string respelled (BUILD.md 4b, TOOLING)', () => {
  it('spells a listed string as an attribute may: joined, camel-cased, its separators changed, percent-encoded', () => {
    const sources = respelledSources(['Jane Roe', '555 010 0142', 'Avery']);
    // A phone number keeps redactSources' own rule (its digits in any punctuation); each string keeps its position.
    expect(sources.map(({ index }) => index)).toEqual([1, 3]);
    const name = sources[0]?.source ?? '';
    for (const spelled of ['jane-roe', 'JaneRoe', 'jane_roe', 'jane%20roe', 'janeroe', 'JANE.ROE', 'optionJaneRoe',
      'u/jane+roe/2', 'Jane, Roe']) {
      expect(respelledSpans(spelled, name), spelled).toHaveLength(1);
    }
    // A match counts only at words' edges: not inside a longer word, before or after.
    for (const word of ['janeroebuck', 'mjaneroe', 'Janeroes', 'jane-roebuck']) expect(respelledSpans(word, name), word).toEqual([]);
    expect(respelledSpans('x-avery2-y', sources[1]?.source ?? '')).toEqual([[2, 7]]);
    expect([respelledEdge('aB', 1), respelledEdge('a2', 1), respelledEdge('a-b', 1), respelledEdge('ab', 1),
      respelledEdge('AB', 1), respelledEdge('Ab', 1)]).toEqual([true, true, true, false, false, false]);
  });

  it('names each entry that survives in an attribute by its position, the attribute and the tag, never its value', () => {
    const sources = respelledSources(LISTED);
    const markup = '<a href="/people/jane-roe">x</a><div data-owner-id="u-JaneRoe-1" title="Jane Roe">Jane Roe in text</div>'
      + '<iframe src="https://cards.example/c?u=jane%20roe"></iframe><img src="data:image/png;base64,SmFuZVJvZQ==">'
      + '<style>.jane-roe { color: red; }</style><!-- jane-roe --><p class="ordinary">nothing here</p>'
      + '<template shadowrootmode="open"><span aria-label="JANE_ROE">x</span></template><b title="Jane Roebuck">y</b>';
    const reasons = respelledIn(markup, sources);
    expect(reasons).toEqual(['redact entry 1 survives in an attribute (href on <a>)',
      'redact entry 1 survives in an attribute (data-owner-id on <div>)',
      'redact entry 1 survives in an attribute (title on <div>)',
      'redact entry 1 survives in an attribute (src on <iframe>)',
      'redact entry 1 survives in an attribute (aria-label on <span>)']);
    expect(reasons.join(' ')).not.toMatch(/jane/i);
    expect(respelledIn(markup, [])).toEqual([]);
    expect(respelledIn('<p>Jane Roe</p><!-- Jane Roe -->', sources)).toEqual([]);
  });

  it('reads the rows before any redaction and strips what names them once their words went, by markup alone',
    async () => {
      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();
      await page.setContent(`<!DOCTYPE html><html><body>
<div class="select__control"><input id="school" class="select__input" role="combobox" aria-autocomplete="list"
  aria-controls="react-select-school-listbox" aria-activedescendant="react-select-school-option-1" value="Roe"></div>
<div id="react-select-school-listbox" class="select__menu-list" role="listbox">
  <div id="react-select-school-option-0" role="option" class="select__option">Roeville State University</div>
  <div id="react-select-school-option-1" role="option" class="select__option">Roe College of Location Arts</div>
  <div id="react-select-school-option-2" role="option" class="select__option" data-fixed="1">Not listed? Type it</div></div>
<div id="react-select-country-listbox" class="select__menu-list" role="listbox">
  <div id="react-select-country-option-0" role="option" class="select__option">Portugal +351</div></div>
<x-search id="lit" value="Roe" ariacontrols="lit-menu"></x-search>
<div id="lit-menu" role="listbox"><div id="lit-0" role="option">Roeville Lit Result</div></div>
<ul id="cities" role="listbox" aria-activedescendant="city-roeville-4417">
  <li id="city-roeville-4417" role="option" data-value="4417" value="1" aria-label="Roeville"><span>Roeville</span>
    <a href="https://maps.tailorit-fixture.example/?q=Roeville">map</a></li>
  <li id="city-roeville-4418" role="option" data-value="4418" aria-label="Roeville North"><span data-uniform-id="typography-body1">Roeville North</span></li>
  <li id="city-alder-77" role="option" data-value="77" aria-label="Alder"><span>Alder</span></li>
  <li id="city-east" role="option" aria-label="Roeville East"><span id="w3">  Roeville East, NJ  </span></li></ul>
<label for="city-roeville-4418">A label naming the second city</label>
<div role="listbox"><div id="prompt" role="option" aria-label="Roeville not checked" data-automation-id="menuItem">
  <div data-automation-id="promptOption" data-automation-label="Roeville">Roeville</div></div></div>
<input id="jobsearch" type="search" value="engineer" aria-controls="results-region">
<div id="results-region"><select id="pick"><option value="a">Alpha</option><option value="b">Beta</option></select></div>
</body></html>`);
      const noted = await page.evaluate(noteListRowsInPage, { rows: LIST_ROWS, typedLists: TYPED_LISTS,
        typedBoxes: TYPED_LIST_BOXES, words: ROW_WORD_ATTRIBUTES, wordData: ROW_WORD_DATA_SOURCE });
      // Two typed lists: the school search (its box's typed text and aria-controls), and a custom element's (Lit's
      // unhyphenated ariacontrols, as SmartRecruiters' spl-input writes it). A search box's aria-controls naming a region
      // that is no list (holding a form's own select) makes nothing a typed list.
      expect(noted).toEqual({ rows: 12, typedLists: 2 });
      // Another redaction (a listed string, as transformInPage's) takes two cities' words and the prompt row's, and part
      // of a third city's.
      await page.evaluate(() => {
        for (const id of ['city-roeville-4417', 'city-roeville-4418']) {
          const row = document.getElementById(id)!;
          row.querySelector('span')!.textContent = 'REDACTED';
          row.setAttribute('aria-label', 'REDACTED');
        }
        document.getElementById('w3')!.textContent = '  REDACTED, NJ  ';
        const prompt = document.getElementById('prompt')!;
        prompt.setAttribute('aria-label', 'REDACTED not checked');
        prompt.firstElementChild!.setAttribute('data-automation-label', 'REDACTED');
        prompt.firstElementChild!.textContent = 'REDACTED';
      });
      const counts = await page.evaluate(redactListRowsInPage, { redacted: 'REDACTED', fixed: ['[data-fixed]'],
        results: SEARCH_RESULT_PLACES, words: ROW_WORD_ATTRIBUTES, wordData: ROW_WORD_DATA_SOURCE, ids: ROW_ID_ATTRIBUTES,
        idData: ROW_ID_DATA_SOURCE, references: ID_REFERENCES });
      expect(counts).toEqual({ rows: 7, words: 5, names: 4, ids: 4 });
      expect(await page.evaluate(() => document.getElementById('lit-menu')!.outerHTML))
        .toBe('<div id="lit-menu" role="listbox"><div id="lit-0" role="option">REDACTED</div></div>');
      // A word left beside a REDACTED one goes too, the white space around it kept.
      expect(await page.evaluate(() => document.getElementById('w3')!.firstChild!.nodeValue)).toBe('  REDACTED  ');
      expect(await page.evaluate(() => document.getElementById('w3')!.parentElement!.outerHTML))
        .toBe('<li id="city-REDACTED-3" role="option" aria-label="REDACTED"><span id="w3">  REDACTED  </span></li>');
      const html = await page.evaluate(() => document.body.innerHTML.replace(/\s+/g, ' '));
      // The typed query's results lose their words; their ids, which name a position, stay; the site's own row stays.
      expect(html).toContain('<div id="react-select-school-option-0" role="option" class="select__option">REDACTED</div>');
      expect(html).toContain('<div id="react-select-school-option-1" role="option" class="select__option">REDACTED</div>');
      expect(html).toContain('data-fixed="1">Not listed? Type it</div>');
      // A list nobody typed into keeps its words.
      expect(html).toContain('<div id="react-select-country-option-0" role="option" class="select__option">Portugal +351</div>');
      // A row whose words went loses the words left (its link's) and its value, data-value and every id part naming it
      // (its value, its words, an opaque number), a renamed id unique, and what named it follows; a row whose words
      // stayed is untouched.
      expect(html).toContain('<ul id="cities" role="listbox" aria-activedescendant="city-REDACTED">');
      expect(html).toContain('<li id="city-REDACTED" role="option" data-value="REDACTED" value="REDACTED" aria-label="REDACTED">'
        + '<span>REDACTED</span> <a href="https://maps.tailorit-fixture.example/?q=REDACTED">REDACTED</a></li>');
      expect(html).toContain('<li id="city-REDACTED-2" role="option" data-value="REDACTED" aria-label="REDACTED">');
      // A design token in a data- id ("body1": one digit) is no opaque id: it stays.
      expect(html).toContain('<span data-uniform-id="typography-body1">REDACTED</span>');
      expect(html).toContain('<label for="city-REDACTED-2">A label naming the second city</label>');
      expect(html).toContain('<li id="city-alder-77" role="option" data-value="77" aria-label="Alder"><span>Alder</span></li>');
      expect(html).toContain('<select id="pick"><option value="a">Alpha</option><option value="b">Beta</option></select>');
      // Workday's "REDACTED not checked" stays as its own rule wrote it; its structural data-automation-id stays.
      expect(html).toContain('<div id="prompt" role="option" aria-label="REDACTED not checked" data-automation-id="menuItem">');
      expect(html).toContain('<div data-automation-id="promptOption" data-automation-label="REDACTED">REDACTED</div>');
      expect(html).not.toMatch(/roeville|4417|4418|Roe College/i);
      await context.close();
    }, 30_000);

  // jr6 PRIVACY-FIX: a chosen Workday pill (the owner's Skills, jr6-danafarber-my-experience) is a row whose own label
  // says "press delete to clear value"; its delete icon's data-automation-id ("DELETE_charm") names the component, and
  // Workday's adapter reads it (neverPress, the pill tests), so its words stay; an opaque token there still goes.
  it("leaves the words of Workday's data-automation-id alone in a row's ids, its opaque tokens still taken (PRIVACY-FIX)",
    async () => {
      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();
      const pills = `<!DOCTYPE html><html><body><ul role="listbox" data-automation-id="selectedItemList">
<li id="pill-48213977" role="option" data-automation-id="selectedItem" aria-label="Roeville press delete to clear value">
<p data-automation-id="promptOption">Roeville</p><div data-automation-id="DELETE_charm" role="presentation"></div>
<div data-automation-id="charm-48213977"></div></li></ul></body></html>`;
      /** The pill after the rows' rules ran with `kept` as the words kept, its words redacted as a listed string's are. */
      const run = async (kept: string[]) => {
        await page.setContent(pills);
        await page.evaluate(noteListRowsInPage, { rows: LIST_ROWS, typedLists: TYPED_LISTS,
          typedBoxes: TYPED_LIST_BOXES, words: ROW_WORD_ATTRIBUTES, wordData: ROW_WORD_DATA_SOURCE });
        await page.evaluate(() => {
          document.querySelector('[data-automation-id="promptOption"]')!.textContent = 'REDACTED';
        });
        await page.evaluate(redactListRowsInPage, { redacted: 'REDACTED', fixed: [], results: SEARCH_RESULT_PLACES,
          words: ROW_WORD_ATTRIBUTES, wordData: ROW_WORD_DATA_SOURCE, ids: ROW_ID_ATTRIBUTES, idData: ROW_ID_DATA_SOURCE,
          references: ID_REFERENCES, wordsKept: kept });
        return page.evaluate(() => document.body.innerHTML.replace(/\s+/g, ' '));
      };
      expect(ROW_ID_WORDS_KEPT).toEqual(['data-automation-id']);
      const html = await run(ROW_ID_WORDS_KEPT);
      expect(html).toContain('<div data-automation-id="DELETE_charm" role="presentation"></div>');
      expect(html).toContain('<li id="pill-REDACTED" role="option" data-automation-id="selectedItem" aria-label="REDACTED">');
      expect(html).toContain('<div data-automation-id="charm-REDACTED"></div>');
      expect(html).not.toMatch(/roeville|48213977/i);
      // Without the rule, the label's "delete" takes the icon's own name (the regression it fixes).
      expect(await run([])).toContain('<div data-automation-id="REDACTED_charm" role="presentation"></div>');
      await context.close();
    }, 30_000);

  it("SmartRecruiters' City results (spl-select-option): a typed search's results lose their words, value and data-sr-id",
    async () => {
      const file = await liveCapture(SR_ONE_CLICK, SR_CITY, 'jr6r2-sr-city');
      const convert = () => convertMhtml({ file, platform: 'smartrecruiters', caseName: 'jr6r2-sr-city', redact: LISTED,
        outDir: work });
      const one = await convert();
      const text = one.files[0]?.text ?? '';
      expect(text).not.toMatch(/roeville|nj-us|NJ, United/i);
      // In its shadow root, the label repeating its words goes; the tooltip component's own label and id stay.
      expect(text).toContain('<spl-select-option value="REDACTED" data-sr-id="location-autocomplete-search-option-REDACTED">'
        + '<template shadowrootmode="open"><div class="c-spl-dropdown-item" role="option" aria-selected="false"><slot></slot>'
        + '</div><div role="tooltip" id="tooltip-1" aria-label="Tooltip"></div><span class="sr-only" aria-label="REDACTED"></span>'
        + '</template><spl-truncate title="REDACTED">REDACTED</spl-truncate><div class="c-spl-autocomplete-option-content" '
        + 'data-sr-id="location-autocomplete-search-option-REDACTED-content">REDACTED</div></spl-select-option>');
      // The manual-location row is the site's own (FIXED_ROWS): its value, id and words stay, so its adapter still
      // reads it unchoosable.
      expect(text).toContain('<spl-select-option value="goToManualLocationMode" '
        + 'data-sr-id="location-autocomplete-search-option-goToManualLocationMode"><template shadowrootmode="open">');
      expect(text).toContain('<span class="sr-only" aria-label="Enter your location manually"></span></template><spl-truncate '
        + 'title="Enter your location manually">Enter your location manually</spl-truncate></spl-select-option>');
      expect(TYPED_LISTS).toContain('[data-sr-id="location-autocomplete-search-menu"]');
      expect(FIXED_ROWS).toEqual(['spl-select-option[value="goToManualLocationMode"]']);
      expect(headerOf(text).redacted.listRows).toEqual({ rows: 1, words: 2, names: 3, ids: 2 });
      // Deterministic: the same capture gives the same bytes.
      const two = await convert();
      expect(two.files.map((output) => output.text)).toEqual(one.files.map((output) => output.text));
      expect(two.routes).toEqual(one.routes);
    }, 90_000);

  it('closes the gap itself: a row whose words a listed string took loses the value and ids that spell it otherwise',
    async () => {
      // No typed text and no typed-list mark: only the listed string ("Roeville Heights", made up) takes the row's
      // words; its value and data-sr-id spell the place in a form no list holds ("roeville-hts-nj"), as the Wiser
      // capture's did before SMARTRECRUITERS P1 listed that form.
      // (jr6 fixes, PRIV-7: a list holding that row beside a public one is refused now, a REDACTED among public rows
      // telling it by elimination; so the public row stands in a list of its own here.)
      const file = await liveCapture(SR_ONE_CLICK, `<spl-autocomplete id="city" data-sr-id="location-autocomplete-other"></spl-autocomplete>
<spl-autocomplete id="city2" data-sr-id="location-autocomplete-other"></spl-autocomplete>
<script>
const root = document.getElementById('city').attachShadow({ mode: 'open' });
root.innerHTML = '<spl-input id="spl-form-element_4" type="text" value="" ariacontrols="menu-spl-form-element_4"></spl-input>'
  + '<div slot="menu" id="menu-spl-form-element_4" data-sr-id="location-autocomplete-other-menu" role="listbox">'
  + '<spl-select-option value="roeville-hts-nj" data-sr-id="location-autocomplete-other-option-roeville-hts-nj">'
  + '<spl-truncate title="Roeville Heights, NJ, United States">Roeville Heights, NJ, United States</spl-truncate></spl-select-option></div>';
const other = document.getElementById('city2').attachShadow({ mode: 'open' });
other.innerHTML = '<spl-input id="spl-form-element_5" type="text" value="" ariacontrols="menu-spl-form-element_5"></spl-input>'
  + '<div slot="menu" id="menu-spl-form-element_5" data-sr-id="location-autocomplete-other-menu" role="listbox">'
  + '<spl-select-option value="alder-pa" data-sr-id="location-autocomplete-other-option-alder-pa">'
  + '<spl-truncate title="Alder, PA, United States">Alder, PA, United States</spl-truncate></spl-select-option></div>';
</script>`, 'jr6r2-sr-gap');
      const text = (await convertMhtml({ file, platform: 'smartrecruiters', caseName: 'jr6r2-sr-gap',
        redact: ['Roeville Heights'], outDir: work })).files[0]?.text ?? '';
      expect(text).not.toMatch(/roeville|hts-nj/i);
      // Its words go whole: "REDACTED, NJ, United States" would still tell part of the place.
      expect(text).toContain('<spl-select-option value="REDACTED" data-sr-id="location-autocomplete-other-option-REDACTED">'
        + '<spl-truncate title="REDACTED">REDACTED</spl-truncate></spl-select-option>');
      // The other row's words stayed: so does everything that names it.
      expect(text).toContain('<spl-select-option value="alder-pa" data-sr-id="location-autocomplete-other-option-alder-pa">'
        + '<spl-truncate title="Alder, PA, United States">Alder, PA, United States</spl-truncate></spl-select-option>');
    }, 60_000);

  it("Oracle's searching cx-select (role=grid rows): its results lose their words and the ids that number them",
    async () => {
      // The box holds no typed text in this capture: its searching class alone says its grid lists a query's results.
      const { text } = await convertPage(ORACLE_APPLY, 'oracle', 'jr6r2-oracle-grid', `<form>
<label for="loc">Location</label>
<input id="loc" type="text" class="cx-select-input cx-select-input--auto-suggest" role="combobox" aria-haspopup="grid"
  aria-expanded="true" aria-controls="loc-listbox" aria-activedescendant="loc-row-300512" value="">
<div id="loc-listbox" role="grid" class="cx-select__list">
  <div role="row" id="loc-row-300512" class="cx-select__list-item"><div role="gridcell"><span class="cx-select__list-item--content">Roeville, NJ</span></div></div>
  <div role="row" id="loc-row-300513" class="cx-select__list-item"><div role="gridcell"><span class="cx-select__list-item--content">Roeville Heights, NJ</span></div></div></div>
<label for="degree">Degree</label>
<input id="degree" type="text" class="cx-select-input" role="combobox" aria-haspopup="grid" aria-controls="degree-listbox" value="">
<div id="degree-listbox" role="grid" class="cx-select__list"><div role="row" id="degree-row-1" class="cx-select__list-item"><div role="gridcell"><span class="cx-select__list-item--content">Bachelor</span></div></div></div>
</form>`);
      expect(text).not.toMatch(/roeville|300512|300513/i);
      expect(text).toContain('aria-controls="loc-listbox" aria-activedescendant="loc-row-REDACTED" value="">');
      expect(text).toContain('<div role="row" id="loc-row-REDACTED" class="cx-select__list-item"><div role="gridcell"><span '
        + 'class="cx-select__list-item--content">REDACTED</span></div></div>');
      expect(text).toContain('<div role="row" id="loc-row-REDACTED-2" class="cx-select__list-item">');
      // A grid nobody typed into is the page's own list.
      expect(text).toContain('<div role="row" id="degree-row-1" class="cx-select__list-item"><div role="gridcell"><span '
        + 'class="cx-select__list-item--content">Bachelor</span></div></div>');
      expect(TYPED_LIST_BOXES).toContain('input.cx-select-input--auto-suggest');
    }, 60_000);

  it("iCIMS's searched dropdown: its results' data-value goes with their words; an unsearched list's results stay",
    async () => {
      const { text } = await convertPage(ICIMS_APPLY, 'icims', 'jr6r2-icims-results', `<form>
<label for="rcf3048">City</label>
<select id="rcf3048" class="dropdown-hide" icimsdropdown-enabled="1" icimsdropdown-ajax="1" icimsdropdown-search="1"><option value="501">Roeville</option></select>
<a id="rcf3048_icimsDropdown" class="dropdown-select" role="combobox"><span class="dropdown-text">Roeville</span></a>
<div id="rcf3048_icimsDropdown_ctnr" class="dropdown-container"><input class="dropdown-search" type="text" value="Roe">
<ul id="rcf3048_dropdown-results" class="dropdown-results" role="listbox">
  <li id="result-selectable_rcf3048_0" class="dropdown-result result-selectable" role="option" dropdown-index="0" title="Roeville" aria-label="Roeville" data-value="501">Roeville</li>
  <li id="result-selectable_rcf3048_1" class="dropdown-result result-selectable" role="option" dropdown-index="1" title="Roeville Heights" aria-label="Roeville Heights" data-value="502">Roeville Heights</li></ul></div>
<label for="rcf2">Shift</label>
<select id="rcf2" class="dropdown-hide" icimsdropdown-enabled="0" icimsdropdown-search="0"><option value="">Make a Selection</option><option value="D">Day</option><option value="N">Night</option></select>
<ul id="rcf2_dropdown-results" class="dropdown-results" role="listbox">
  <li id="result-selectable_rcf2_0" class="dropdown-result result-selectable" role="option" dropdown-index="0" title="Day" data-value="D">Day</li>
  <li id="result-selectable_rcf2_1" class="dropdown-result result-selectable" role="option" dropdown-index="1" title="Night" data-value="N">Night</li></ul>
</form>`);
      expect(text).not.toMatch(/roeville|"50[12]"/i);
      expect(text).toContain('<li id="result-selectable_rcf3048_0" class="dropdown-result result-selectable" role="option" '
        + 'dropdown-index="0" title="REDACTED" aria-label="REDACTED" data-value="REDACTED">REDACTED</li>');
      expect(text).toContain('<li id="result-selectable_rcf2_0" class="dropdown-result result-selectable" role="option" '
        + 'dropdown-index="0" title="Day" data-value="D">Day</li>');
      expect(text).toContain('<option value="D">Day</option><option value="N">Night</option>');
    }, 60_000);

  it("Workday's prompt search: each result's menuItem id (Workday's id of it) goes, and its list's active descendant follows",
    async () => {
      const { text } = await convertPage(WORKDAY_APPLY, 'workday', 'jr6r2-workday-search', `<div data-automation-id="formField-school">
<label for="input-5">School</label><input id="input-5" data-automation-id="searchBox" type="text" value="Roe">
<div data-uxi-widget-type="multiselectlist" data-uxi-multiselectlist-issearch="true">
  <div data-automation-id="activeListContainer" role="listbox" aria-activedescendant="menuItem-3f2a9c1b7e5d">
    <div id="menuItem-3f2a9c1b7e5d" data-automation-id="menuItem" role="option" aria-label="Roeville College not checked" aria-selected="false">
      <div data-automation-id="promptLeafNode" data-uxi-multiselect-id="0-1-2"><div id="promptOption-0-1" data-automation-id="promptOption" data-automation-label="Roeville College">Roeville College</div></div></div>
    <div id="menuItem-4c8b2e6d1a9f" data-automation-id="menuItem" role="option" aria-label="Roe Institute not checked" aria-selected="false">
      <div data-automation-id="promptLeafNode" data-uxi-multiselect-id="0-1-3"><div id="promptOption-0-2" data-automation-id="promptOption" data-automation-label="Roe Institute">Roe Institute</div></div></div></div></div>
<div data-uxi-widget-type="multiselectlist" data-uxi-multiselectlist-issearch="false"><div role="listbox">
  <div id="menuItem-aa11bb22cc" data-automation-id="menuItem" role="option" aria-label="Alder University not checked">
    <div data-automation-id="promptOption" data-automation-label="Alder University">Alder University</div></div></div></div>
</div>`);
      expect(text).not.toMatch(/roeville|Roe Institute|3f2a9c1b7e5d|4c8b2e6d1a9f/i);
      expect(text).toContain('role="listbox" aria-activedescendant="menuItem-REDACTED">');
      expect(text).toContain('<div id="menuItem-REDACTED" data-automation-id="menuItem" role="option" aria-label="REDACTED not '
        + 'checked" aria-selected="false">');
      expect(text).toContain('<div id="menuItem-REDACTED-2" data-automation-id="menuItem" role="option"');
      // Positions and the structure stay: promptOption-0-1, data-uxi-multiselect-id 0-1-2.
      expect(text).toContain('<div data-automation-id="promptLeafNode" data-uxi-multiselect-id="0-1-2"><div id="promptOption-0-1" '
        + 'data-automation-id="promptOption" data-automation-label="REDACTED">REDACTED</div></div>');
      // A browse list is the tenant's own: kept whole.
      expect(text).toContain('<div id="menuItem-aa11bb22cc" data-automation-id="menuItem" role="option" aria-label="Alder University '
        + 'not checked">');
    }, 60_000);

  it("ADP's sdf-select-item: a row whose words a listed string took loses its value and label, inside its shadow root",
    async () => {
      const file = await liveCapture(ADP_PAGE, `
<label for="q1">Preferred contact</label><sdf-select-simple id="q1"></sdf-select-simple>
<label for="q2">State</label><sdf-select-simple id="q2"></sdf-select-simple>
<script>
document.getElementById('q1').attachShadow({ mode: 'open' }).innerHTML = '<div role="listbox">'
  + '<sdf-select-item role="option" aria-selected="false" value="JR-7" aria-label="Jane Roe" embedded-context="select">Jane Roe</sdf-select-item></div>';
document.getElementById('q2').attachShadow({ mode: 'open' }).innerHTML = '<div role="listbox">'
  + '<sdf-select-item role="option" aria-selected="false" value="AL" aria-label="AL - Alabama" embedded-context="select">AL - Alabama</sdf-select-item>'
  + '<sdf-select-item role="option" aria-selected="false" value="AK" aria-label="AK - Alaska" embedded-context="select">AK - Alaska</sdf-select-item></div>';
</script>`, 'jr6r2-adp-items');
      const text = (await convertMhtml({ file, platform: 'adp', caseName: 'jr6r2-adp-items', redact: LISTED, outDir: work }))
        .files[0]?.text ?? '';
      expect(text).not.toMatch(/JR-7|Jane/);
      expect(text).toContain('<sdf-select-item role="option" aria-selected="false" value="REDACTED" aria-label="REDACTED" '
        + 'embedded-context="select">REDACTED</sdf-select-item>');
      expect(text).toContain('<sdf-select-item role="option" aria-selected="false" value="AL" aria-label="AL - Alabama" '
        + 'embedded-context="select">AL - Alabama</sdf-select-item>');
    }, 60_000);

  it("react-select's options: the location search's and a typed school search's results lose their words; an untyped list stays",
    async () => {
      const select = (id: string, typed: string, rows: string[]) => `<label id="${id}-label" for="${id}">${id}</label>
<div class="select__control"><input id="${id}" class="select__input" type="text" role="combobox" aria-autocomplete="list"
  aria-expanded="true" aria-controls="react-select-${id}-listbox" value="${typed}"></div>
<div id="react-select-${id}-listbox" class="select__menu-list" role="listbox">${rows.map((row, at) =>
  `<div id="react-select-${id}-option-${at}" class="select__option" role="option" aria-selected="false">${row}</div>`).join('')}</div>`;
      const { text } = await convertPage(GREENHOUSE_JOB, 'greenhouse', 'jr6r2-react-select', `<form>
${select('candidate-location', 'Roe', ['Roeville (Location 4), New Jersey, United States'])}
${select('school', 'Roe', ['Roeville State University', 'Roe College'])}
${select('country', '', ['Portugal', 'Spain'])}</form>`);
      expect(text).not.toMatch(/roeville|Roe College/i);
      // A result's word that is also its list's own ("location") stays in its id: the list's structure, not the answer.
      for (const id of ['react-select-candidate-location-option-0', 'react-select-school-option-0', 'react-select-school-option-1']) {
        expect(text).toContain(`<div id="${id}" class="select__option" role="option" aria-selected="false">REDACTED</div>`);
      }
      expect(text).toContain('<div id="react-select-country-option-0" class="select__option" role="option" aria-selected="false">'
        + 'Portugal</div><div id="react-select-country-option-1" class="select__option" role="option" aria-selected="false">Spain</div>');
    }, 60_000);

  it('redacts a listed string respelled in any attribute, and counts it in the header', async () => {
    const { conversion, text } = await convertPage(GREENHOUSE_JOB, 'greenhouse', 'jr6r2-respelled', `
<a id="profile" href="/people/jane-roe?ref=JaneRoe">Profile</a>
<div data-person="JANE_ROE" data-owner-id="u-janeroe-1">Card</div>
<span class="badge" title="Jane.Roe">Badge</span>
<p data-note="Roebuck Jane">Words around a listed one stay</p>`);
    expect(text).toContain('<a id="profile" href="/people/REDACTED?ref=REDACTED">Profile</a>');
    expect(text).toContain('<div data-person="REDACTED" data-owner-id="u-REDACTED-1">Card</div>');
    expect(text).toContain('<span class="badge" title="REDACTED">Badge</span>');
    expect(text).toContain('<p data-note="Roebuck Jane">');
    expect(headerOf(text).redacted).toMatchObject({ respelled: 5 });
    expect(respelledIn(text, respelledSources(LISTED))).toEqual([]);
    expect(conversion.counts['jr6r2-respelled.html']).toMatchObject({ respelled: 5 });
  }, 60_000);

  it("redacts a listed string respelled in the page's and its frames' addresses: src, route map and header agree",
    async () => {
      // An iCIMS IForm's address spells its posting's title, which the list may hold: here the page's query and a
      // third-party frame's path and query.
      const page = `${GREENHOUSE_JOB}?ref=jane-roe`;
      const card = 'https://cards.tailorit-fixture.example/card/JaneRoe?user=jane%20roe';
      const file = join(work, 'jr6r2-addresses.mhtml');
      writeFileSync(file, mhtml(page, [
        { type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: page, body: '<!DOCTYPE html><html><head>'
          + '<title>Apply</title></head><body><p>Apply</p><iframe src="cid:frame-CARD@mhtml.blink" width="300" height="80">'
          + '</iframe></body></html>' },
        { type: 'text/html', id: 'frame-CARD@mhtml.blink', location: card, body: '<html><body>A card</body></html>' }]));
      const conversion = await convertMhtml({ file, platform: 'greenhouse', caseName: 'jr6r2-addresses', redact: LISTED,
        outDir: work });
      const text = conversion.files[0]?.text ?? '';
      expect(headerOf(text).source).toBe(`${GREENHOUSE_JOB}?ref=REDACTED`);
      expect(text).toContain('<iframe src="https://cards.tailorit-fixture.example/card/REDACTED?user=REDACTED" width="300" '
        + 'height="80"></iframe>');
      expect(Object.keys(conversion.routes)).toEqual([`${GREENHOUSE_JOB}?ref=REDACTED`,
        'https://cards.tailorit-fixture.example/card/REDACTED?user=REDACTED']);
      for (const output of conversion.files) expect(output.text, output.path).not.toMatch(/jane/i);
      // Its scheme and host stay, so it is served where it was; anything else is answered as given.
      expect(respelledAddress('https://jane-roe.example/jane-roe', respelledSources(LISTED)))
        .toBe('https://jane-roe.example/REDACTED');
      expect(respelledAddress('not an address jane-roe', respelledSources(LISTED))).toBe('not an address jane-roe');
    }, 60_000);

  it('refuses a page where a listed string survives in an attribute, respelled (a frame\'s host), naming no value',
    async () => {
      const file = join(work, 'jr6r2-refused.mhtml');
      const card = 'https://jane-roe.cards.tailorit-fixture.example/card';
      writeFileSync(file, mhtml(GREENHOUSE_JOB, [
        { type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: GREENHOUSE_JOB, body: '<!DOCTYPE html><html><head>'
          + '<title>Apply</title></head><body><p>Apply</p><iframe src="cid:frame-CARD@mhtml.blink" width="300" height="80">'
          + '</iframe></body></html>' },
        { type: 'text/html', id: 'frame-CARD@mhtml.blink', location: card, body: '<html><body>A card</body></html>' }]));
      const error = await convertMhtml({ file, platform: 'greenhouse', caseName: 'jr6r2-refused', redact: LISTED, outDir: work })
        .then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConversionError);
      const reasons = (error as ConversionError).reasons;
      expect(reasons).toEqual(['jr6r2-refused.html: redact entry 1 survives in an attribute (src on <iframe>)']);
      expect(reasons.join(' ')).not.toMatch(/jane/i);
      expect(existsSync(join(work, 'greenhouse', 'jr6r2-refused.html'))).toBe(false);
    }, 60_000);
});
// ── end jr6 round 2 ──

// ---------------------------------------------------------------------------------------------------------------------
// ── jr6 fixes (TOOLING; the line W reviews of 2026-11-11: PRIV-2, PRIV-4, PRIV-6, PRIV-7, REVC-4). Each shape on a
// synthetic page in the platform's own markup, captured by Chrome itself where the platform draws in shadow roots; the
// privacy review's synthetic cases (T1 to T7) among them. Every value is made up. ──
// ---------------------------------------------------------------------------------------------------------------------

/** ADP's sdf-select-simple list drawn open after a choice (snapshot6 adp1's State list, adp2's Questions; the review's
 *  T1): the chosen item marked by its class, its aria-selected, the roving tab stop and the check mark its shadow root
 *  draws. */
const ADP_CHOSEN_LIST = `<label for="q1">How did you hear about this job?</label><sdf-select-simple id="q1"></sdf-select-simple>
<script>
const root = document.getElementById('q1').attachShadow({ mode: 'open' });
root.innerHTML = '<div class="combo"><span id="selected-label" part="selected-label"><span>Beta Board</span></span>'
  + '<div role="status" aria-live="polite" class="sr-only">Beta Board</div><div role="listbox" id="listbox">'
  + ['Alpha Board', 'Beta Board', 'Gamma Board'].map((words, at) => '<sdf-select-item role="option" aria-selected="'
    + (at === 1) + '" tabindex="' + (at === 1 ? 0 : -1) + '" class="hydrated' + (at === 1 ? ' selected' : '') + '" value="'
    + words + '" aria-label="' + words + '">' + words + '</sdf-select-item>').join('') + '</div></div>';
for (const [at, item] of [...root.querySelectorAll('sdf-select-item')].entries()) {
  item.attachShadow({ mode: 'open' }).innerHTML = '<div id="content"><slot></slot></div>' + (at === 1
    ? '<div id="checked-icon"><sdf-icon aria-hidden="true" role="presentation" class="hydrated"></sdf-icon></div>' : '');
}
</script>`;

/** SmartRecruiters' screening Yes/No answered (the Wiser screening capture; the review's T2): the chosen spl-radio
 *  reflects checked="true", holds the roving tab stop and alone carries a name; each radio's shadow root says only where
 *  it stands (first, last). */
const SR_CHOSEN_RADIO = `<p>Are you 18 or older?</p><spl-radio-group id="g" required>
<spl-radio id="r1" role="radio" aria-checked="false" tabindex="-1" label="Alpha" value="1" variant="default"></spl-radio>
<spl-radio id="r2" role="radio" aria-checked="true" checked="true" tabindex="0" name="question_1" label="Beta" value="2" variant="default"></spl-radio>
</spl-radio-group>
<script>
for (const [at, radio] of [...document.querySelectorAll('spl-radio')].entries()) {
  radio.attachShadow({ mode: 'open' }).innerHTML = '<spl-internal-form-field class="c-spl-radio-wrapper c-spl-radio-wrapper--'
    + (at === 0 ? 'first' : 'last') + '"><div class="c-spl-radio"><div class="c-spl-radio__ring"></div></div></spl-internal-form-field>';
}
</script>`;

/** ADP's drawn Yes/No answered (snapshot6 adp2's Questions): the chosen sdf-radio-button holds the tab stop, and its
 *  shadow root draws the dot (svg.toggled > circle.radio-dot); each radio's own class names its option. */
const ADP_CHOSEN_RADIO = `<fieldset><legend>Are you 18 or older?</legend><sdf-radio-group id="rg" class="hydrated">
<sdf-radio-button id="yes" class="question-yes-option hydrated" role="radio" aria-checked="false" tabindex="-1" label="Yes" value="Yes">Yes</sdf-radio-button>
<sdf-radio-button id="no" class="question-no-option hydrated" role="radio" aria-checked="true" tabindex="0" label="No" value="No">No</sdf-radio-button>
</sdf-radio-group></fieldset>
<script>
for (const [at, radio] of [...document.querySelectorAll('sdf-radio-button')].entries()) {
  radio.attachShadow({ mode: 'open' }).innerHTML = '<div class="radio-button"><svg part="graphic" class="' + (at === 1 ? 'toggled' : '')
    + '" viewBox="0 0 20 20"><circle class="radio-outline" cx="10" cy="10" r="9"></circle>'
    + (at === 1 ? '<circle class="radio-dot" cx="10" cy="10" r="5"></circle>' : '')
    + '</svg></div><div class="label-container" part="label-container"><label part="label"><slot></slot></label></div>';
}
</script>`;

/** A converted page served as the e2e harness serves it, read with its shadow roots: each CHOICE_ROWS entry's groups
 *  and how many read apart (unevenChoiceRowsInPage, as the conversion runs it). */
async function rowsOf(conversion: Awaited<ReturnType<typeof convertMhtml>>, url: string) {
  const { context } = await servedContext(conversion);
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.evaluate(deepenInPage);
    return await page.evaluate(unevenChoiceRowsInPage, { rows: CHOICE_ROWS, ...CHOICE_ROW_INPUT });
  } finally {
    await context.close();
  }
}

/** The CHOICE_ROWS entry of a row tag. */
const rowEntry = (row: string) => CHOICE_ROWS.findIndex((entry) => entry.row === row);

describe('jr6 fixes: the chosen marks the line W reviews found (PRIV-2, REVC-4)', () => {
  it("ADP's list: the chosen item's tab stop moves to the first item, its class and check mark go, rows alike (T1)",
    async () => {
      const file = await liveCapture(ADP_PAGE, ADP_CHOSEN_LIST, 'jr6fix-adp-list');
      const conversion = await convertMhtml({ file, platform: 'adp', caseName: 'jr6fix-adp-list', redact: LISTED,
        outDir: work });
      const text = conversion.files[0]?.text ?? '';
      expect(text).toContain('<span id="selected-label" part="selected-label"><span>REDACTED</span></span>');
      expect(text).toContain('<sdf-select-item role="option" aria-selected="false" tabindex="0" class="hydrated" '
        + 'value="Alpha Board" aria-label="Alpha Board"><template shadowrootmode="open"><div id="content"><slot></slot></div>'
        + '</template>Alpha Board</sdf-select-item>');
      expect(text).toContain('<sdf-select-item role="option" aria-selected="false" tabindex="-1" class="hydrated" '
        + 'value="Beta Board" aria-label="Beta Board"><template shadowrootmode="open"><div id="content"><slot></slot></div>'
        + '</template>Beta Board</sdf-select-item>');
      const body = text.slice(text.indexOf(' -->') + 4);
      for (const gone of ['checked-icon', '<sdf-icon', 'selected"', 'aria-selected="true"']) expect(body, gone).not.toContain(gone);
      expect(text.match(/tabindex="0"/g)).toHaveLength(1);
      expect(chosenMarksIn(text)).toEqual([]);
      expect((await rowsOf(conversion, ADP_PAGE))[rowEntry('sdf-select-item')]).toEqual({ groups: 1, uneven: 0 });
    }, 60_000);

  it("SmartRecruiters' Yes/No: the chosen radio's checked, name and tab stop go, the rows then alike (T2, REVC-4)",
    async () => {
      const file = await liveCapture(SR_ONE_CLICK, SR_CHOSEN_RADIO, 'jr6fix-sr-radio');
      const conversion = await convertMhtml({ file, platform: 'smartrecruiters', caseName: 'jr6fix-sr-radio',
        redact: LISTED, outDir: work });
      const text = conversion.files[0]?.text ?? '';
      expect(text).toContain('<spl-radio id="r1" role="radio" aria-checked="false" tabindex="0" label="Alpha" value="1" '
        + 'variant="default"><template shadowrootmode="open">');
      expect(text).toContain('<spl-radio id="r2" role="radio" aria-checked="false" tabindex="-1" label="Beta" value="2" '
        + 'variant="default"><template shadowrootmode="open">');
      for (const gone of [' checked=', 'name="question_1"', 'aria-checked="true"']) expect(text, gone).not.toContain(gone);
      expect(chosenMarksIn(text)).toEqual([]);
      expect((await rowsOf(conversion, SR_ONE_CLICK))[rowEntry('spl-radio')]).toEqual({ groups: 1, uneven: 0 });
    }, 60_000);

  it("ADP's Yes/No: the chosen radio's toggled svg, its dot and its tab stop go, the rows then alike", async () => {
    const file = await liveCapture(ADP_PAGE, ADP_CHOSEN_RADIO, 'jr6fix-adp-radio');
    const conversion = await convertMhtml({ file, platform: 'adp', caseName: 'jr6fix-adp-radio', redact: LISTED,
      outDir: work });
    const text = conversion.files[0]?.text ?? '';
    for (const gone of ['toggled', 'radio-dot', 'aria-checked="true"']) expect(text, gone).not.toContain(gone);
    expect(text.match(/<svg part="graphic" class="" viewBox="0 0 20 20"><circle class="radio-outline" cx="10" cy="10" r="9">/g))
      .toHaveLength(2);
    expect(text).toContain('<sdf-radio-button id="yes" class="question-yes-option hydrated" role="radio" aria-checked="false" '
      + 'tabindex="0" label="Yes" value="Yes">');
    expect(text).toContain('<sdf-radio-button id="no" class="question-no-option hydrated" role="radio" aria-checked="false" '
      + 'tabindex="-1" label="No" value="No">');
    expect(chosenMarksIn(text)).toEqual([]);
    expect((await rowsOf(conversion, ADP_PAGE))[rowEntry('sdf-radio-button')]).toEqual({ groups: 1, uneven: 0 });
  }, 60_000);

  it("strips Angular's state classes from a reactive form's components and groups, a form keeping its own (T3)",
    async () => {
      const { text } = await convertPage(SR_ONE_CLICK, 'smartrecruiters', 'jr6fix-angular', `<form class="ng-dirty ng-invalid">
<div data-test="web" class="form-section ng-touched ng-dirty ng-valid">
<oc-input formcontrolname="facebook" class="ng-touched ng-dirty ng-valid"><spl-input id="facebook-input" type="text" class="ng-touched ng-dirty ng-valid" value=""></spl-input></oc-input>
<oc-input formcontrolname="twitter" class="ng-untouched ng-pristine ng-valid"><spl-input id="twitter-input" type="text" class="ng-untouched ng-pristine ng-valid" value=""></spl-input></oc-input>
</div><spl-checkbox id="consent" data-test="consent-box" required class="ng-pristine ng-touched ng-valid"></spl-checkbox>
<p class="note ng-hide ng-scope">AngularJS's other classes stay.</p></form>`);
      for (const gone of ['ng-touched', 'ng-untouched', 'ng-pristine', 'ng-valid']) expect(text, gone).not.toContain(gone);
      for (const kept of ['<form class="ng-dirty ng-invalid"', '<div data-test="web" class="form-section">',
        '<oc-input formcontrolname="facebook" class="">', '<spl-input id="twitter-input" type="text" class="" value="">',
        '<spl-checkbox id="consent" data-test="consent-box" required="" class="">', '<p class="note ng-hide ng-scope">']) {
        expect(text, kept).toContain(kept);
      }
      expect(chosenMarksIn(text)).toEqual([]);
      expect(ANGULAR_STATE_ELEMENTS).toBe('[class*="ng-"]:not(form)');
    }, 60_000);

  it("moves a plain listbox's tab stop to its first option; a tab, a box group and an unanswered list keep theirs (T5)",
    async () => {
      const { text } = await convertPage(GREENHOUSE_JOB, 'greenhouse', 'jr6fix-roving', `
<label id="l" for="b">Favourite colour</label><button id="b" type="button" aria-haspopup="listbox">Choose</button>
<div id="colours" role="listbox" aria-labelledby="l"><div role="option" tabindex="-1" aria-selected="false">Red</div>
<div role="option" tabindex="0" aria-selected="true">Blue</div><div role="option" tabindex="-1" aria-selected="false">Green</div></div>
<div id="sizes" role="listbox"><div role="option" tabindex="0">Small</div><div role="option" tabindex="-1">Large</div></div>
<div role="tablist"><a role="tab" tabindex="-1" aria-selected="false" href="#o">Overview</a><a role="tab" tabindex="0" aria-selected="true" href="#a">Application</a></div>
<div class="boxes"><div role="checkbox" tabindex="0" aria-checked="true">Remote</div><div role="checkbox" tabindex="0" aria-checked="false">Hybrid</div></div>
<ul class="week"><li><span role="gridcell" tabindex="-1">1</span></li><li><span role="gridcell" tabindex="0">2</span></li></ul>
<div id="towns" role="listbox"><spl-select-option tabindex="-1" value="n">North</spl-select-option><spl-select-option tabindex="0" value="s">South</spl-select-option></div>`);
      expect(text).toContain('<div id="colours" role="listbox" aria-labelledby="l"><div role="option" tabindex="0" '
        + 'aria-selected="false">Red</div>\n<div role="option" tabindex="-1" aria-selected="false">Blue</div>');
      expect(text).toContain('<div id="sizes" role="listbox"><div role="option" tabindex="0">Small</div><div role="option" '
        + 'tabindex="-1">Large</div></div>');
      // No answer: the open tab keeps its stop (and its aria-selected); each box is a stop of its own.
      expect(text).toContain('<a role="tab" tabindex="0" aria-selected="true" href="#a">Application</a>');
      expect(text).toContain('<div role="checkbox" tabindex="0" aria-checked="false">Remote</div><div role="checkbox" '
        + 'tabindex="0" aria-checked="false">Hybrid</div>');
      // Rows of one kind in no widget roll up to the nearest element holding two of them.
      expect(text).toContain('<li><span role="gridcell" tabindex="0">1</span></li><li><span role="gridcell" tabindex="-1">2</span></li>');
      // A row that carries no role of its own (ROVING_TAGS: SmartRecruiters' spl-select-option) is read by its tag.
      expect(text).toContain('<spl-select-option tabindex="0" value="n">North</spl-select-option><spl-select-option '
        + 'tabindex="-1" value="s">South</spl-select-option>');
      expect(chosenMarksIn(text)).toEqual([]);
      expect(ROVING_ROLES).not.toContain('tab');
    }, 60_000);

  it('reads each new kind of mark by its markup (the write check and the sweep), and no tab, box group or form', () => {
    const kinds = (markup: string) => chosenMarksIn(`<!doctype html><html><body>${markup}</body></html>`);
    const labels = CHOSEN_MARK_LABELS;
    // T1: a lone stop off a list's first row, inside a declarative shadow root (its rows standing in their widget).
    expect(kinds('<sdf-select-simple><template shadowrootmode="open"><div role="listbox"><sdf-select-item role="option" '
      + 'tabindex="-1">A</sdf-select-item><sdf-select-item role="option" tabindex="0">B</sdf-select-item></div></template>'
      + '</sdf-select-simple>')).toEqual([labels.roving]);
    // T2: a reflected checked, and its tab stop; T5: a plain listbox's.
    expect(kinds('<spl-radio-group><spl-radio role="radio" tabindex="-1"></spl-radio><spl-radio role="radio" checked="true" '
      + 'tabindex="0"></spl-radio></spl-radio-group>')).toEqual([labels.reflected, labels.roving]);
    expect(kinds('<div role="listbox"><div role="option" tabindex="-1">a</div><div role="option" tabindex="0">b</div>'
      + '<div role="option">c</div></div>')).toEqual([labels.roving]);
    expect(kinds('<div role="listbox"><spl-select-option tabindex="-1">a</spl-select-option><spl-select-option tabindex="0">'
      + 'b</spl-select-option></div>')).toEqual([labels.roving]);
    expect(kinds('<x-chip selected></x-chip><x-switch checked=""></x-switch>')).toEqual([labels.reflected]);
    // A custom list item's selected keeps its own label (the security fix's rule), not this one too.
    expect(kinds('<sl-tree-item selected></sl-tree-item>')).toEqual(['a list item that says it is selected']);
    // T3: Angular's classes on a component or a group (AngularJS's on a control keep their own label).
    expect(kinds('<oc-input formcontrolname="x" class="ng-touched ng-dirty ng-valid"></oc-input>')).toEqual([labels.angularComponent]);
    expect(kinds('<div class="form-section ng-valid"></div><input class="ng-dirty">'))
      .toEqual([labels.angularComponent, 'an AngularJS state class on a control']);
    // ADP's drawn marks: the toggled svg (a CHOSEN_MARKS class) and the dot, the check mark in an item's shadow root.
    expect(kinds('<sdf-radio-button role="radio"><template shadowrootmode="open"><svg class="toggled"><circle class="radio-dot">'
      + '</circle></svg></template></sdf-radio-button>')).toEqual(['a chosen class CHOSEN_MARKS names', labels.drawing]);
    expect(kinds('<sdf-select-item role="option"><template shadowrootmode="open"><div id="checked-icon"></div></template>'
      + '</sdf-select-item>')).toEqual([labels.drawing]);
    // No answer: a stop on the first row, every box a stop, an open tab, a form's own classes, an input's and an
    // option's own state (each its own rule), a check mark id outside its host, a stop two rows hold.
    expect(kinds('<div role="listbox"><div role="option" tabindex="0">a</div><div role="option" tabindex="-1">b</div></div>'
      + '<div><span role="checkbox" tabindex="0"></span><span role="checkbox" tabindex="0"></span></div>'
      + '<div role="tablist"><a role="tab" tabindex="-1"></a><a role="tab" tabindex="0"></a></div>'
      + '<form class="ng-dirty ng-invalid"></form><select><option selected>x</option></select><div id="checked-icon"></div>'
      + '<div role="radiogroup"><b role="radio" tabindex="0"></b><b role="radio" tabindex="0"></b><b role="radio" tabindex="-1"></b></div>'))
      .toEqual([]);
  });

  it('refuses a page whose chosen row the clearing left marked, as it refuses any chosen mark (the backstop)', async () => {
    const { roving, drawings } = CLEAR_CHOICE_INPUT;
    const at = CHOSEN_MARKS.findIndex((mark) => mark.attributes?.includes('checked'));
    expect(at).toBeGreaterThan(-1);
    const [reflected] = CHOSEN_MARKS.splice(at, 1);
    delete (CLEAR_CHOICE_INPUT as { roving?: unknown }).roving;
    try {
      const file = await liveCapture(SR_ONE_CLICK, SR_CHOSEN_RADIO, 'jr6fix-sr-refused');
      const error = await convertMhtml({ file, platform: 'smartrecruiters', caseName: 'jr6fix-sr-refused', redact: LISTED,
        outDir: work }).then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConversionError);
      expect((error as ConversionError).reasons).toEqual([
        'jr6fix-sr-refused.html: choice groups (spl-radio-group) whose option rows still differ once cleared: 1, a chosen '
          + 'mark the converter does not know',
        `jr6fix-sr-refused.html: ${CHOSEN_MARK_LABELS.reflected} is still in the file`,
        `jr6fix-sr-refused.html: ${CHOSEN_MARK_LABELS.roving} is still in the file`]);
    } finally {
      CHOSEN_MARKS.splice(at, 0, reflected!);
      Object.assign(CLEAR_CHOICE_INPUT, { roving, drawings });
    }
  }, 60_000);

  it("blanks a group's chosen value mirrored on its rows (ADP's radio-group-value), an unanswered group's left as drawn",
    async () => {
      // snapshot6 adp2's Questions Yes/No answered (values made up): each row repeats the chosen row's value; the
      // second group is unanswered and draws it empty.
      const { text } = await convertPage(ADP_PAGE, 'adp', 'jr6fix-adp-mirror', `<fieldset><legend>Are you 18 or older?</legend>
<wfn-radio-button id="q1-yes" class="question-yes-option" value="yes" radio-group-value="no">Yes</wfn-radio-button>
<wfn-radio-button id="q1-no" class="question-no-option" value="no" radio-group-value="no">No</wfn-radio-button></fieldset>
<fieldset><legend>Can you travel?</legend>
<wfn-radio-button id="q2-yes" class="question-yes-option" value="yes" radio-group-value="">Yes</wfn-radio-button>
<wfn-radio-button id="q2-no" class="question-no-option" value="no" radio-group-value="">No</wfn-radio-button></fieldset>`);
      for (const id of ['q1-yes', 'q1-no', 'q2-yes', 'q2-no']) {
        expect(text, id).toMatch(new RegExp(`<wfn-radio-button id="${id}" class="question-(?:yes|no)-option" `
          + 'value="(?:yes|no)" radio-group-value="">'));
      }
      expect(headerOf(text).cleared).toEqual({ choices: 2 });
      expect(chosenMarksIn(text)).toEqual([]);
      expect(VALUE_MIRRORS).toEqual([{ tag: 'wfn-radio-button', attribute: 'radio-group-value' }]);
    }, 60_000);

  it('refuses a mirrored chosen value left on a row, by its label (the write check and the sweep)', () => {
    const kinds = (markup: string) => chosenMarksIn(`<!doctype html><html><body>${markup}</body></html>`);
    expect(kinds('<wfn-radio-button value="yes" radio-group-value="yes"></wfn-radio-button>'))
      .toEqual([CHOSEN_MARK_LABELS.mirrored]);
    expect(kinds('<wfn-radio-button value="no" radio-group-value=\'no\'></wfn-radio-button>'))
      .toEqual([CHOSEN_MARK_LABELS.mirrored]);
    // An unanswered group's empty mirror, and the same attribute on another element, say nothing.
    expect(kinds('<wfn-radio-button value="yes" radio-group-value=""></wfn-radio-button><wfn-radio-button value="no" '
      + 'radio-group-value></wfn-radio-button><x-radio radio-group-value="yes"></x-radio>')).toEqual([]);
  });

  it('reads choice rows alike but for what names them, where they stand and an unanswered tab stop (REVC-4)', async () => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const uneven = async (markup: string) => {
      await page.setContent(`<!doctype html><html><body>${markup}</body></html>`);
      return (await page.evaluate(unevenChoiceRowsInPage, { rows: CHOICE_ROWS, ...CHOICE_ROW_INPUT }))[rowEntry('spl-radio')];
    };
    const group = (rows: string[]) => `<spl-radio-group>${rows.join('')}</spl-radio-group>`;
    // Alike: own values (id, value, label, a data- id), an unanswered tab stop on the first row, a class saying where.
    expect(await uneven(group(['<spl-radio id="a" value="1" label="A" data-sr-id="q-a" tabindex="0" class="r r--first"></spl-radio>',
      '<spl-radio id="b" value="2" label="B" data-sr-id="q-b" tabindex="-1" class="r r--last"></spl-radio>'])))
      .toEqual({ groups: 1, uneven: 0 });
    // Apart: a stop off the first row, a name on one row alone, an attribute only one row holds.
    for (const rows of [['<spl-radio tabindex="-1"></spl-radio>', '<spl-radio tabindex="0"></spl-radio>'],
      ['<spl-radio></spl-radio>', '<spl-radio name="q1"></spl-radio>'],
      ['<spl-radio></spl-radio>', '<spl-radio data-picked="1"></spl-radio>']]) {
      expect(await uneven(group(rows)), rows.join('')).toEqual({ groups: 1, uneven: 1 });
    }
    // A part one row's shadow root draws alone reads apart; the site's own row (FIXED_ROWS) is left out.
    await page.setContent('<!doctype html><html><body><spl-radio-group><spl-radio></spl-radio><spl-radio></spl-radio>'
      + '</spl-radio-group><div role="listbox"><spl-select-option value="a"></spl-select-option>'
      + '<spl-select-option value="goToManualLocationMode"><b>Enter it</b></spl-select-option></div></body></html>');
    await page.evaluate(() => {
      for (const [at, radio] of [...document.querySelectorAll('spl-radio')].entries()) {
        radio.attachShadow({ mode: 'open' }).innerHTML = at === 1 ? '<i class="dot"></i>' : '';
      }
    });
    const read = await page.evaluate(unevenChoiceRowsInPage, { rows: CHOICE_ROWS, ...CHOICE_ROW_INPUT });
    expect(read[rowEntry('spl-radio')]).toEqual({ groups: 1, uneven: 1 });
    expect(read[rowEntry('spl-select-option')]).toEqual({ groups: 0, uneven: 0 });
    expect(CHOICE_ROWS.map(({ group: holder, row }) => `${holder} ${row}`)).toEqual(['fieldset.jv-input-group label.jv-input-group-row',
      'spl-radio-group spl-radio', 'sdf-radio-group sdf-radio-button', '[role="listbox" i] sdf-select-item',
      '[role="listbox" i] spl-select-option']);
    await context.close();
  }, 30_000);
});

/** iCIMS's posting reached from a job board (snapshot6 icims1's careers-sentinel shape, values made up): the wrapper's
 *  address and its portal frame's carry iis, iisn and utm_source; the page links to Apply and to a sign-in whose
 *  redirect holds them percent-encoded; a text run shows a campaign link. `value(name)` gives each parameter's value. */
function icimsReferred(name: string, value: (parameter: string) => string): { file: string; top: string; portal: string } {
  const top = `https://careers-acme.icims.com/jobs/1/engineer/job?iis=${value('iis')}&iisn=${value('iisn')}`
    + `&utm_source=${value('utm_source')}`;
  const portal = `${top}&in_iframe=1`;
  const file = join(work, `${name}.mhtml`);
  writeFileSync(file, mhtml(top, [
    { type: 'text/html', id: 'frame-TOP@mhtml.blink', location: top, body: '<!DOCTYPE html><html><head><title>Careers</title>'
      + `</head><body><h1>Careers</h1><a href="/jobs/1/engineer/job?mode=apply&amp;iis=${value('iis')}&amp;iisn=`
      + `${value('iisn')}">Apply</a><iframe id="icims_content_iframe" src="cid:frame-PORTAL@mhtml.blink" width="900" `
      + 'height="700"></iframe></body></html>' },
    { type: 'text/html', id: 'frame-PORTAL@mhtml.blink', location: portal, body: '<!DOCTYPE html><html><body>'
      + '<h1 class="iCIMS_Header">Engineer</h1><a class="iCIMS_ApplyOnlineButton" title="Apply for this job online" '
      + `href="https://careers-acme.icims.com/jobs/1/engineer/login?iis=${value('iis')}&amp;iisn=${value('iisn')}&amp;`
      + `utm_source=${value('utm_source')}&amp;mode=apply">Apply</a><a href="https://careers-acme.icims.com/jobs/1/`
      + `engineer/login?redirect=%2Fjobs%2F1%3Fiis%3D${encodeURIComponent(value('iis'))}%26iisn%3D${value('iisn')}">Sign in</a>`
      + `<p>Shared from https://careers-acme.icims.com/jobs/1/engineer/job?utm_campaign=${value('utm_campaign')}</p>`
      + '</body></html>' },
  ]));
  return { file, top, portal };
}

describe('jr6 fixes: where the person came from (PRIV-4)', () => {
  /** The made-up job board's values (none in the redaction list). */
  const BOARD: Record<string, string> = { iis: 'Fixture+Board', iisn: 'FixtureBoard', utm_source: 'FixtureBoard',
    utm_campaign: 'FixtureFall' };
  const BOARD_WORDS = /Fixture(?:\+|%2B|%20| )?(?:Board|Fall)/i;

  it("iCIMS's iis, iisn and utm_* read REDACTED in the header, the route map, the frame's src, the links and the text",
    async () => {
      const { file } = icimsReferred('jr6fix-referral', (name) => BOARD[name] ?? '');
      const conversion = await convertMhtml({ file, platform: 'icims', caseName: 'jr6fix-referral', redact: LISTED,
        outDir: work });
      const [top = '', portal = ''] = conversion.files.map((output) => output.text);
      const page = 'https://careers-acme.icims.com/jobs/1/engineer/job?iis=REDACTED&iisn=REDACTED&utm_source=REDACTED';
      expect(headerOf(top).source).toBe(page);
      expect(headerOf(portal).source).toBe(`${page}&in_iframe=1`);
      expect(Object.keys(conversion.routes)).toEqual([page, `${page}&in_iframe=1`]);
      expect(top).toContain('<iframe id="icims_content_iframe" src="https://careers-acme.icims.com/jobs/1/engineer/job?'
        + 'iis=REDACTED&amp;iisn=REDACTED&amp;utm_source=REDACTED&amp;in_iframe=1"');
      expect(top).toContain('<a href="/jobs/1/engineer/job?mode=apply&amp;iis=REDACTED&amp;iisn=REDACTED">Apply</a>');
      expect(portal).toContain('href="https://careers-acme.icims.com/jobs/1/engineer/login?iis=REDACTED&amp;iisn=REDACTED&amp;'
        + 'utm_source=REDACTED&amp;mode=apply">Apply</a>');
      expect(portal).toContain('login?redirect=%2Fjobs%2F1%3Fiis%3DREDACTED%26iisn%3DREDACTED">Sign in</a>');
      expect(portal).toContain('<p>Shared from https://careers-acme.icims.com/jobs/1/engineer/job?utm_campaign=REDACTED</p>');
      expect(headerOf(top).redacted.referral).toBe(2);
      expect(headerOf(portal).redacted.referral).toBe(6);
      for (const output of conversion.files) expect(output.text, output.path).not.toMatch(BOARD_WORDS);
      expect(JSON.stringify(conversion.routes)).not.toMatch(BOARD_WORDS);
      // Served by its route map, the page loads its frame and asks for nothing else.
      const { context, unexpected } = await servedContext(conversion);
      const served = await context.newPage();
      await served.goto(page);
      expect(served.frames().map((each) => each.url())).toEqual([page, `${page}&in_iframe=1`]);
      await context.close();
      expect(unexpected).toEqual([]);
      // The same capture whose addresses carry no board's value converts to the same files but the header's count.
      const twin = icimsReferred('jr6fix-referral-twin', () => 'REDACTED');
      const again = await convertMhtml({ file: twin.file, platform: 'icims', caseName: 'jr6fix-referral',
        redact: LISTED, outDir: join(work, 'twin') });
      const uncounted = (text: string) => text.replace(/,"referral":\d+/, '');
      expect(again.files.map((output) => output.text)).toEqual(conversion.files.map((output) => uncounted(output.text)));
      expect(Object.keys(again.routes)).toEqual(Object.keys(conversion.routes));
    }, 60_000);

  it("ADP's source reads REDACTED in its address and links; the other boards' tags by the same rule", async () => {
    const { conversion, text } = await convertPage(`${ADP_PAGE}&source=XB&lang=en_US`, 'adp', 'jr6fix-adp-source',
      `<a href="${ADP_PAGE}&amp;source=XB&amp;jobId=1">Engineer</a>`);
    expect(headerOf(text).source).toBe(`${ADP_PAGE}&source=REDACTED&lang=en_US`);
    expect(Object.keys(conversion.routes)).toEqual([`${ADP_PAGE}&source=REDACTED&lang=en_US`]);
    expect(text).toContain(`<a href="${ADP_PAGE}&amp;source=REDACTED&amp;jobId=1">Engineer</a>`);
    expect(text).not.toMatch(/source=XB/);
    // Every name and prefix, plain, after &amp;, or percent-encoded once or twice; the value ends at the next separator.
    // jr7 TOOLING-7: and Jobvite's __jvsc.
    expect(REFERRAL_PARAMS).toEqual(['iis', 'iisn', 'source', '__jvst', '__jvsd', 'gh_src', 'lever-source', '__jvsc']);
    expect(REFERRAL_PREFIXES).toEqual(['utm_']);
    const cases: Array<[string, string]> = [
      ['https://jobs.jobvite.com/acme/job/oX1?__jvst=Job%20Board&__jvsd=FixtureBoard&nl=0',
        'https://jobs.jobvite.com/acme/job/oX1?__jvst=REDACTED&__jvsd=REDACTED&nl=0'],
      ['https://acme.wd1.myworkdayjobs.com/en-US/External/job/Remote/Engineer_R1?source=FixtureBoard',
        'https://acme.wd1.myworkdayjobs.com/en-US/External/job/Remote/Engineer_R1?source=REDACTED'],
      ['https://job-boards.greenhouse.io/acme/jobs/1?gh_src=1a2b3c4d5e#app', 'https://job-boards.greenhouse.io/acme/jobs/1?gh_src=REDACTED#app'],
      ['https://jobs.lever.co/acme/1-2?lever-source=FixtureBoard&lever-origin=applied',
        'https://jobs.lever.co/acme/1-2?lever-source=REDACTED&lever-origin=applied'],
      ['/x?utm_medium=cpc&amp;utm_term=fixture+word&amp;utm_id=7', '/x?utm_medium=REDACTED&amp;utm_term=REDACTED&amp;utm_id=REDACTED'],
      // jr6 PRIVACY-FIX: an address escaped twice in an attribute (Jobvite's data-lnkd-debug), its "&amp;" escaped again.
      ['<span data-lnkd-debug="https://jobs.jobvite.com/acme/job/oX1?__jvst=Fixture&amp;amp;__jvsd=FixtureBoard&amp;amp;nl=0">',
        '<span data-lnkd-debug="https://jobs.jobvite.com/acme/job/oX1?__jvst=REDACTED&amp;amp;__jvsd=REDACTED&amp;amp;nl=0">'],
      ['/login?redirect=%2Fjob%3Fsource%3DFixture%2520Board%26x%3D1', '/login?redirect=%2Fjob%3Fsource%3DREDACTED%26x%3D1'],
      ['/a?r=%252Fjob%253Fiis%253DFixture%252BBoard%2526y%253D2', '/a?r=%252Fjob%253Fiis%253DREDACTED%2526y%253D2'],
      // Not a referral parameter: another name holding the word, a fragment, an empty value, Simplify's own tag (which
      // stripInjectedParams drops whole).
      ['/y?resource=a&data_source=b&sourceId=c#source=d&source=', '/y?resource=a&data_source=b&sourceId=c#source=d&source='],
      ['/z?utm_source=Simplify&k=1', '/z?utm_source=Simplify&k=1'],
    ];
    for (const [address, expectedAddress] of cases) expect(redactReferralParams(address).text, address).toBe(expectedAddress);
    expect(withoutInjectedParams('https://acme.example/z?utm_source=Simplify&utm_medium=FixtureBoard'))
      .toBe('https://acme.example/z?utm_medium=REDACTED');
    expect(redactReferralParams('?iis=REDACTED&iisn=x')).toEqual({ text: '?iis=REDACTED&iisn=REDACTED', count: 1 });
  }, 60_000);

  it("refuses a referral parameter's value the redaction missed, in any form the final check reads (its needle)", () => {
    const [needle] = referralNeedles();
    const hits = (text: string) => checkedForms(text).some((form) => needle!.pattern.test(form));
    for (const missed of ['<a href="/j?x=1&amp;gh_src=abc">', '<a href="/l?r=%2Fj%3Fiisn%3DBoard">', '<p>?utm_campaign=fall</p>',
      '{"https://acme.example/j?source=XB":"fixtures/x.html"}']) {
      expect(hits(missed), missed).toBe(true);
    }
    for (const kept of ['<a href="/j?x=1&amp;gh_src=REDACTED">', '<a href="/l?r=%2Fj%3Fiisn%3DREDACTED%26a%3D1">',
      '<a href="/j?resource=a&amp;sourceId=b">', '<a href="/j?source=&amp;a=1">', '<p>open source=good</p>']) {
      expect(hits(kept), kept).toBe(false);
    }
    expect(needle!.label).toBe('a referral-source parameter');
  });

  it('refuses a page whose referral value the redaction cannot read (the backstop)', async () => {
    // A value written as an entity (">") ends the redaction's reading at once; the final check reads it decoded.
    const error = await convertPage(GREENHOUSE_JOB, 'greenhouse', 'jr6fix-referral-refused',
      '<p>Shared from https://acme.example/jobs/1?gh_src=&gt;FixtureBoard</p>').then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConversionError);
    expect((error as ConversionError).reasons).toEqual(['jr6fix-referral-refused.html: a referral-source parameter is still '
      + 'in the file']);
  }, 60_000);
});

/** SmartRecruiters' list drawn open in shadow roots, untyped (a county, a school), values made up: each row an
 *  spl-select-option whose role=option is inside its own shadow root, its words slotted; one row's words are a listed
 *  string. With `typed`, the menu is the City search's (TYPED_LISTS), the manual row last (FIXED_ROWS). */
const srList = (rows: string[], typed = false) => `<label for="county">County</label><spl-select id="county"></spl-select>
<script>
const root = document.getElementById('county').attachShadow({ mode: 'open' });
root.innerHTML = '<div role="listbox" id="menu"${typed ? ' data-sr-id="location-autocomplete-search-menu"' : ''}>'
  + ${JSON.stringify(rows)}.map((words) => '<spl-select-option value="' + words.toLowerCase().replace(/ /g, '-') + '">'
    + words + '</spl-select-option>').join('')
  + '${typed ? '<spl-select-option value="goToManualLocationMode">Enter it yourself</spl-select-option>' : ''}</div>';
for (const option of root.querySelectorAll('spl-select-option')) {
  option.attachShadow({ mode: 'open' }).innerHTML = '<div role="option" class="c-spl-select-option"><slot></slot></div>';
}
</script>`;

describe('jr6 fixes: a listed string respelled in text (PRIV-6), in a list drawn in shadow roots (PRIV-7, REVC-4)', () => {
  it("redacts a listed name respelled in the page's text, as attributes are, and counts it in the header (T4)", async () => {
    const { text } = await convertPage(GREENHOUSE_JOB, 'greenhouse', 'jr6fix-respelled-text', '<p>Your resume '
      + '<b class="attached">Jane_Roe_Resume.pdf</b> is attached.</p><p>Signed by JaneRoe on the day.</p>'
      + '<p>jane-roe and JANE.ROE and Jane%20Roe stay out; Roebuck and Janet Roe are other names.</p>');
    expect(text).toContain('<b class="attached">REDACTED_Resume.pdf</b>');
    expect(text).toContain('<p>Signed by REDACTED on the day.</p>');
    expect(text).toContain('<p>REDACTED and REDACTED and REDACTED stay out; Roebuck and Janet Roe are other names.</p>');
    expect(text).not.toMatch(/jane[\s_.%-]*(?:20)?roe/i);
    expect(headerOf(text).redacted.respelledText).toBe(5);
  }, 60_000);

  it("refuses a listed name respelled in a text run no in-page pass reaches (the final check reads the page's text)",
    async () => {
      const error = await convertPage(GREENHOUSE_JOB, 'greenhouse', 'jr6fix-respelled-refused',
        '<p>Apply</p><template><p>Signed by JaneRoe</p></template>').then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConversionError);
      expect((error as ConversionError).reasons).toEqual(["jr6fix-respelled-refused.html: redact entry 1 survives in the "
        + "page's text"]);
      // Read by the conversion only: respelledIn's text reading is asked for (attributes alone by default).
      const sources = respelledSources(LISTED);
      expect(respelledIn('<p>JaneRoe</p><style>.jane-roe{}</style><!-- JaneRoe -->', sources)).toEqual([]);
      expect(respelledIn('<p>JaneRoe</p><style>.jane-roe{}</style><!-- JaneRoe -->', sources, { text: true }))
        .toEqual(["redact entry 1 survives in the page's text"]);
      expect(respelledIn('<p title="a>b">Jane &amp; Roe? no: jane&#95;roe</p>', sources, { text: true }))
        .toEqual(["redact entry 1 survives in the page's text"]);
    }, 60_000);

  it('refuses a fixed list in shadow roots with one listed row among public ones; a typed list and the site\'s row pass (T7)',
    async () => {
      const tail = ', where a REDACTED tells the value by elimination; give each synthetic text with --replace-text';
      const fixed = await liveCapture(SR_ONE_CLICK, srList(['Adams', 'Jane Roe', 'Zephyr']), 'jr6fix-sr-fixed-list');
      const error = await convertMhtml({ file: fixed, platform: 'smartrecruiters', caseName: 'jr6fix-sr-fixed-list',
        redact: LISTED, outDir: work }).then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConversionError);
      expect((error as ConversionError).reasons).toEqual([
        `jr6fix-sr-fixed-list.html: options (an <option> or a role=option) whose page text the redaction list met: 1${tail}`]);
      // Respelled alone (its value, "jane-roe", and a joined spelling in its words) it is refused the same way.
      const respelledRow = await liveCapture(SR_ONE_CLICK, srList(['Adams', 'JaneRoe', 'Zephyr']), 'jr6fix-sr-respelled-row');
      await expect(convertMhtml({ file: respelledRow, platform: 'smartrecruiters', caseName: 'jr6fix-sr-respelled-row',
        redact: LISTED, outDir: work })).rejects.toThrow('options (an <option> or a role=option) whose page text the '
        + 'redaction list met: 1');
      // A typed query's results lose their words whole, so they tell nothing; the site's own row is no candidate.
      const typed = await liveCapture(SR_ONE_CLICK, srList(['Adams', 'Jane Roe', 'Zephyr'], true), 'jr6fix-sr-typed-list');
      const conversion = await convertMhtml({ file: typed, platform: 'smartrecruiters', caseName: 'jr6fix-sr-typed-list',
        redact: LISTED, outDir: work });
      const text = conversion.files[0]?.text ?? '';
      expect(text).toContain('Enter it yourself');
      expect(text).not.toMatch(/Adams|Zephyr|jane/i);
      // And a list whose one listed row the replacement gives synthetic words passes.
      const replaced = await convertMhtml({ file: fixed, platform: 'smartrecruiters', caseName: 'jr6fix-sr-fixed-list',
        redact: LISTED, outDir: work, replaceText: [{ selector: '#menu', text: 'Alder\nBirch\nCedar' }] });
      expect(replaced.files[0]?.text).toContain('Alder');
      expect(eliminatedListsIn(replaced.files[0]?.text ?? '')).toBe(0);
      // Rows a level of shadow roots below their list, each drawing its words in its own shadow root: one place, the
      // outermost row, read in its list across the shadow roots, its neighbours' words read from their shadow roots.
      const deep = await liveCapture(SR_ONE_CLICK, `<div role="listbox" id="menu"><x-rows id="rows"></x-rows></div>
<script>
const root = document.getElementById('rows').attachShadow({ mode: 'open' });
root.innerHTML = ['Adams', 'Jane Roe', 'Zephyr'].map((words) => '<spl-select-option value="' + words + '"></spl-select-option>').join('');
for (const option of root.querySelectorAll('spl-select-option')) {
  option.attachShadow({ mode: 'open' }).innerHTML = '<div role="option">' + option.getAttribute('value') + '</div>';
}
</script>`, 'jr6fix-sr-deep-list');
      const deepError = await convertMhtml({ file: deep, platform: 'smartrecruiters', caseName: 'jr6fix-sr-deep-list',
        redact: LISTED, outDir: work }).then(() => null, (caught: unknown) => caught);
      expect((deepError as ConversionError).reasons).toEqual([
        `jr6fix-sr-deep-list.html: options (an <option> or a role=option) whose page text the redaction list met: 1${tail}`]);
    }, 90_000);

  it("refuses a listed string respelled in a place's attribute (a description meta, an option's value), as in its text (G.3)",
    async () => {
      const tail = ', where a REDACTED tells the value by elimination; give each synthetic text with --replace-text';
      // A posting's description copy and an option's value spell the listed name otherwise; the option's words are public.
      const error = await convertPage(GREENHOUSE_JOB, 'greenhouse', 'jr6fix-respelled-places', '<meta property="og:description" '
        + 'content="Our team, led by jane-roe, is hiring."><label for="m">Major</label><select id="m"><option value="1">Art'
        + '</option><option value="jane_roe">Other</option><option value="3">Zoology</option></select>')
        .then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConversionError);
      expect((error as ConversionError).reasons).toEqual([
        `jr6fix-respelled-places.html: options (an <option> or a role=option) whose page text the redaction list met: 1${tail}`,
        `jr6fix-respelled-places.html: posting descriptions (POSTING_TEXT_PLACES) whose page text the redaction list met: 1${tail}`]);
      // An attribute of no such place is redacted and passes (a link's address, an element's id); so is an address
      // inside a place (a posting's Apply link in its description's container, its slug spelling the title).
      const { text } = await convertPage(ICIMS_APPLY, 'icims', 'jr6fix-respelled-elsewhere',
        '<p><a href="/people/jane-roe" id="card-JaneRoe">A colleague</a></p><div class="iCIMS_JobContent"><p>A made-up '
        + 'posting.</p><a href="https://careers-acme.icims.com/jobs/1/jane-roe/job?mode=apply">Apply</a>'
        + '<a href="/jobs/1/jane_roe/job">Share</a><meta property="og:url" content="https://careers-acme.icims.com/jobs/1/janeroe">'
        + '</div>');
      expect(text).toContain('<a href="/people/REDACTED" id="card-REDACTED">A colleague</a>');
      expect(text).toContain('<a href="https://careers-acme.icims.com/jobs/1/REDACTED/job?mode=apply">Apply</a>'
        + '<a href="/jobs/1/REDACTED/job">Share</a><meta property="og:url" content="https://careers-acme.icims.com/jobs/1/REDACTED">');
      expect(POSTING_TEXT_PLACES).toContain('.iCIMS_JobContent');
    }, 60_000);

  // jr6 PRIVACY-FIX (SP\jr6\leakscan\VERDICTS-3.md): Breezy's page keeps a JSON copy of the posting in data-position on
  // div.body-wrapper (its name, its description's HTML, its company); a REDACTED gap there names the value by elimination
  // as one in the posting's own text does.
  it("refuses a listed string in a posting's JSON copy in an attribute (Breezy's data-position), and gives it synthetic text "
    + 'by <css>@<attribute> (PRIVACY-FIX)', async () => {
    const tail = ', where a REDACTED tells the value by elimination; give each synthetic text with --replace-text';
    const breezy = 'https://acme.breezy.hr/p/1-engineer/apply';
    const page = (position: object) => `<div class="body-wrapper" data-position='${JSON.stringify(position)}'><form>`
      + '<label for="n">Name</label><input id="n" type="text"></form></div>';
    const copyOf = (text: string) => JSON.parse((/data-position="([^"]*)"/.exec(text)?.[1] ?? '{}').replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&'));
    const listed = { name: 'Senior Jane Roe Engineer', friendly_id: '1-engineer',
      description: '<p>Work beside the team.</p>', company: { name: 'Acme' } };
    const refused = async (caseName: string, position: object) => {
      const error = await convertPage(breezy, 'breezy', caseName, page(position)).then(() => null, (caught: unknown) => caught);
      expect(error, caseName).toBeInstanceOf(ConversionError);
      expect((error as ConversionError).reasons, caseName).toEqual([
        `${caseName}.html: posting descriptions (POSTING_TEXT_PLACES) whose page text the redaction list met: 1${tail}`]);
    };
    // The title field as written, the description field respelled: each is refused.
    await refused('jr6pf-copy-title', listed);
    await refused('jr6pf-copy-description', { ...listed, name: 'Senior Engineer',
      description: '<p>Work beside jane_roe.</p>' });
    // A listed string in another field of the copy (the company's) is redacted and passes.
    const other = await convertPage(breezy, 'breezy', 'jr6pf-copy-other', page({ ...listed, name: 'Senior Engineer',
      company: { name: 'Jane Roe Corp' } }));
    expect(copyOf(other.text)).toEqual({ ...listed, name: 'Senior Engineer', company: { name: 'REDACTED Corp' } });
    // --replace-text '<css>@data-position=<file>': the title field takes the first line, the description the rest; the
    // copy's other fields and the element itself are left as they are.
    const file = join(work, 'jr6pf-copy-replaced.mhtml');
    writeFileSync(file, mhtml(breezy, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: breezy,
      body: `<!DOCTYPE html><html><head><title>Apply</title></head><body>${page(listed)}</body></html>` }]));
    const options = { file, platform: 'breezy', caseName: 'jr6pf-copy-replaced', redact: LISTED, outDir: work };
    const replaced = await convertMhtml({ ...options, replaceText: [{ selector: 'div.body-wrapper@data-position',
      text: 'Synthetic Posting Title\nA synthetic description.\nIts second line.' }] });
    const text = replaced.files[0]?.text ?? '';
    expect(copyOf(text)).toEqual({ ...listed, name: 'Synthetic Posting Title',
      description: 'A synthetic description. Its second line.' });
    expect(text).toContain('<label for="n">Name</label>');
    expect(headerOf(text).replacedText).toEqual([1]);
    expect(text).not.toMatch(/jane/i);
    // An attribute that holds no posting copy is refused, by the replacement's position.
    await expect(convertMhtml({ ...options, replaceText: [{ selector: 'div.body-wrapper@data-other', text: 'x' }] }))
      .rejects.toThrow('--replace-text #1 names an attribute that holds no copy of the posting (POSTING_COPY_ATTRIBUTES)');
    expect(POSTING_COPY_ATTRIBUTES).toEqual([{ attribute: 'data-position', title: ['name'], description: ['description'] }]);
  }, 90_000);

  it('passes a native list whose REDACTED row stands beside a placeholder alone (a résumé picker), refuses one beside '
    + 'public rows', async () => {
    const picker = await convertPage(GREENHOUSE_JOB, 'greenhouse', 'jr6fix-picker', '<label for="r">Resume</label>'
      + '<select id="r"><option value="">Select a resume</option><option value="">Jane Roe CV.pdf</option></select>');
    // (The row's words go whole once a listed string touched them: jr6 round 2.)
    expect(picker.text).toContain('<option value="">Select a resume</option><option value="">REDACTED</option>');
    await expect(convertPage(GREENHOUSE_JOB, 'greenhouse', 'jr6fix-public-list', '<label for="m">Major</label>'
      + '<select id="m"><option value="">Select</option><option value="1">Art</option><option value="2">Jane Roe</option>'
      + '<option value="3">Zoology</option></select>')).rejects.toThrow('options (an <option> or a role=option) whose '
      + 'page text the redaction list met: 1');
  }, 60_000);

  it('reads a written list that holds a REDACTED row beside public ones (eliminatedListsIn, the sweep)', () => {
    const html = (body: string) => `<!doctype html><html><body>${body}</body></html>`;
    // One REDACTED option among public ones tells it: a native select, an ARIA listbox, rows in declarative shadow roots.
    expect(eliminatedListsIn(html('<select><option value="">Select</option><option value="1">Art</option>'
      + '<option value="2">REDACTED</option></select>'))).toBe(1);
    expect(eliminatedListsIn(html('<div role="listbox"><div role="option">Adams</div><div role="option">REDACTED, NJ</div>'
      + '</div><ul role="menu"><li role="menuitem">Home</li><li role="menuitem">REDACTED</li></ul>'))).toBe(2);
    expect(eliminatedListsIn(html('<spl-select><template shadowrootmode="open"><div role="listbox"><spl-select-option '
      + 'value="a"><template shadowrootmode="open"><div role="option"><slot></slot></div></template>Adams'
      + '</spl-select-option><spl-select-option value="REDACTED">REDACTED</spl-select-option></div></template></spl-select>')))
      .toBe(1);
    // Nothing told: every row REDACTED or blank (a typed query's results), a placeholder beside it, the site's own row
    // beside it, a row nested in a row (read with it), a row in no list, or a list with no REDACTED row.
    for (const body of ['<select><option>REDACTED</option><option>REDACTED</option><option></option></select>',
      '<select><option value="">Select a resume</option><option value="">REDACTED</option></select>',
      '<div role="listbox"><spl-select-option value="REDACTED">REDACTED</spl-select-option><spl-select-option '
        + 'value="goToManualLocationMode">Enter it yourself</spl-select-option></div>',
      '<div role="listbox"><div role="option">REDACTED <span role="option">Adams</span></div></div>',
      '<div><div role="option">Adams</div><div role="option">REDACTED</div></div>',
      '<select><option>Art</option><option>Zoology</option></select>']) {
      expect(eliminatedListsIn(html(body)), body).toBe(0);
    }
    expect(LISTED_LISTS).toContain('[role="listbox" i]');
  });

  it('every committed fixture: no list tells a listed value by elimination, but the files handed back (REVC-4)', () => {
    const pages = committedFixtureFiles().filter((file) => file.endsWith('.html'));
    expect(pages.length).toBeGreaterThan(300);
    const told = Object.fromEntries(pages.flatMap((file) => {
      const lists = eliminatedListsIn(readFileSync(join(ROOT, 'fixtures', file), 'utf8'));
      return lists > 0 ? [[file, lists]] : [];
    }));
    // Each file let through holds no more such lists than it did; converted again, it holds none and its entry goes.
    for (const [file, lists] of Object.entries(told)) {
      expect(lists, file).toBeLessThanOrEqual(ELIMINATED_FIXTURES[file] ?? 0);
    }
  });
});

/**
 * jr6 fixes (REVC-4 b): the committed fixtures converted before the converter refused it, which still hold lists where
 * one REDACTED row stands beside public ones (each file's count). A file converted again holds none, and its entry then
 * goes; all went, so the map is empty: UltiPro's two education pages, the field-of-study selects of REVC-2, converted
 * again by ULTIPRO with a synthetic list (9b5ce3d; SP\jr6\leakscan\VERDICTS.md 4.2), and SeatGeek's site menus,
 * whose menu bar the jr6 privacy check gave synthetic text.
 */
const ELIMINATED_FIXTURES: Record<string, number> = {};

/** jr6 (item 8): every jr6 case's page and frame in a platform's folder (or sites/), outside the frozen lists above. */
const JR6_FILES = readdirSync(join(ROOT, 'fixtures'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && (FIXTURE_PLATFORMS.includes(entry.name) || entry.name === 'sites'))
  .flatMap((entry) => readdirSync(join(ROOT, 'fixtures', entry.name))
    .filter((name) => isJr6(name) && name.endsWith('.html') && !name.endsWith('.third-party-frame.html'))
    .map((name) => `${entry.name}/${name.slice(0, -'.html'.length)}`));

describe('every jr6 case (FIXPLAN 6.1 item 8)', () => {
  it('has a route map that serves its own files alone, every page and frame of the case among them', () => {
    const maps = readdirSync(join(ROOT, 'fixtures'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (FIXTURE_PLATFORMS.includes(entry.name) || entry.name === 'sites'))
      .flatMap((entry) => readdirSync(join(ROOT, 'fixtures', entry.name))
        .filter((name) => isJr6(name) && name.endsWith('.routes.json'))
        .map((name) => `${entry.name}/${name.slice(0, -'.routes.json'.length)}`));
    const served = new Set<string>();
    for (const map of maps) {
      for (const path of Object.values(JSON.parse(readFileSync(join(ROOT, 'fixtures', `${map}.routes.json`), 'utf8')) as
        Record<string, string>)) {
        expect(path.startsWith(`fixtures/${map}.`) && existsSync(join(ROOT, path)), path).toBe(true);
        served.add(path);
      }
    }
    for (const name of JR6_FILES) expect(served, name).toContain(`fixtures/${name}.html`);
  });

  it.each(JR6_FILES)('%s: its header, route map and markup agree, and its shadow roots and per-load ids are as kept', (name) => {
    const [folder = ''] = name.split('/');
    const html = readFileSync(join(ROOT, 'fixtures', `${name}.html`), 'utf8');
    const routes = JSON.parse(readFileSync(routesOf(name), 'utf8')) as Record<string, string>;
    const header = headerOf(html);
    expect(header).toMatchObject({ fixture: name, captured: expect.any(String) });
    expect(header.chrome).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    // jr7 JDEF-7: a single-page portal's address keeps its route in the fragment (JobDiva's #/jobs/<id>), which the
    // header's source keeps and the route map, serving no fragment, leaves out.
    expect(routes[header.source.split('#')[0]!]).toBe(`fixtures/${name}.html`); // jr7 JDEF-7
    for (const [url, path] of Object.entries(routes)) {
      expect(new URL(url).hash, url).toBe('');
      expect(path.startsWith(`fixtures/${name.replace(/\.frame-\d+$/, '')}.`) && existsSync(join(ROOT, path)), path).toBe(true);
    }
    const expectation = join(ROOT, 'fixtures', `${name}.expect.json`);
    if (existsSync(expectation)) {
      expect(JSON.parse(readFileSync(expectation, 'utf8'))).toMatchObject({ fixture: name, source: header.source,
        captured: header.captured });
    }
    const body = html.slice(html.indexOf('-->') + 3);
    const markup = markupOf(body);
    expect(markup).not.toMatch(/<script|<noscript|<base\b|http-equiv|<link[^>]*stylesheet|\r/i);
    expect(markup).not.toMatch(/(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/i);
    expect(attributeNames(markup).filter((attribute) => attribute.startsWith('on'))).toEqual([]);
    expect([...markup.matchAll(/<form(?=[\s>])[^>]*>/gi)].every(([form]) => form.includes('action="/__submitted"'))).toBe(true);
    // A platform that keeps shadow roots writes each as a declarative one, as its header counts; another keeps none.
    if (keepsShadowRoots(folder)) {
      expect(body.match(/<template shadowrootmode="open"/g)?.length ?? 0).toBe(header.shadowRoots);
    } else {
      expect(body).not.toMatch(/shadowrootmode=/);
    }
    expect(body).not.toMatch(/shadowmode="/);
    // Ashby's per-load ids are normalised, as the Ashby cases' are.
    if (folder === 'ashby') {
      const ids = new Set([...html.matchAll(/data-field-entry-id="([0-9a-f-]{36})_/g)].map((match) => match[1]));
      expect([...ids].every((id) => /^00000000-0000-4000-8000-0000000000\d\d$/.test(id ?? '')), name).toBe(true);
      expect(html).not.toMatch(/name="csp-nonce"[^>]*content="(?!REDACTED")/);
    }
    // The hCaptcha site key and widget ids, and iCIMS's hashed=, normalised away (S9). Only the hCaptcha platforms'
    // site key is normalised: a reCAPTCHA site key (JazzHR's classic board) is the page's public key and stays, as in
    // the older JazzHR fixtures (jr6 JAZZHR P1).
    expect(body).not.toMatch(/data-hcaptcha-widget-id="(?!REDACTED")/);
    // jr7 TOOLING-7 (T7-01): and Paycom's.
    if (folder === 'icims' || folder === 'oracle' || folder === 'paycom') {
      expect(body).not.toMatch(/[?&;#]sitekey=(?!REDACTED)[^&"'\s]/);
      expect(body).not.toMatch(/data-sitekey="(?!REDACTED")/);
    }
    expect(body).not.toMatch(/\bhashed=-?\d/);
    // No chosen mark, as the conversion refuses one (chosenMarksIn); jr7 TOOLING-7 (T7-01): and no widget's shown text
    // spelled in an id (spelledIdsIn).
    expect(chosenMarksIn(html)).toEqual([]);
    expect(spelledIdsIn(html)).toEqual([]);
  });
});
// ── end jr6 ──

// ── jr6 ifix C-4 (SP\jr6\review-i\completeness.md gap 4; INTEGRATION §4 item 7; line W PRIV-4): referral parameters in
// the committed fixtures ──
/** Every committed fixture's page, frame, route map and expectation (each holds addresses), by its path under fixtures/. */
const ADDRESSED_FIXTURES = committedFixtureFiles(undefined, '', /\.(?:html|routes\.json|expect\.json)$/);

/** jr7 TOOLING-7: the committed fixtures converted before __jvsc joined REFERRAL_PARAMS that keep a __jvsc value, each
 *  on the posting's own share buttons only (LinkedIn's IN/Share data-url, the share links' href, ng-href and ng-click),
 *  whose __jvst and __jvsd beside it read REDACTED: judged public (SP\jr6\build\INT-2.md §5). A file converted again
 *  reads REDACTED there and needs no entry. */
const JOBVITE_SHARE_FIXTURES = ['jobvite/ninjaone-posting.html', 'jobvite/jr6-sikich-posting.html',
  'jobvite/jr6-vhl-posting.html'];
/** The share networks Jobvite's posting widget names in __jvsc (lower case, as checkedForms reads them). */
const JOBVITE_SHARE_CHANNELS = ['linkedin', 'twitter', 'facebook', 'email'];

/** Each referral parameter (REFERRAL_PARAMS, REFERRAL_PREFIXES) that holds a value other than REDACTED in a text, by
 *  name, in every form the final check reads (checkedForms: as written, entities decoded, percent-decoded): the
 *  converter's own needle (referralNeedles), every match of it. Names only: a value is never read out. jr7 TOOLING-7:
 *  with `shareChannels`, a __jvsc whose value is a share network's (JOBVITE_SHARE_CHANNELS) is left out (the value is
 *  compared in memory, never read out). */
function referralNamesIn(text: string, options: { shareChannels?: boolean } = {}): string[] {
  const [needle] = referralNeedles();
  const every = new RegExp(needle!.pattern.source, 'gi');
  return checkedForms(text).flatMap((form) => [...form.matchAll(every)]
    .filter((match) => !(options.shareChannels === true && match[0].slice(1, match[0].indexOf('=')) === '__jvsc'
      && JOBVITE_SHARE_CHANNELS.includes(/^[^&#"'\s<]*/.exec(form.slice((match.index ?? 0) + match[0].length))?.[0] ?? '')))
    .map(([match]) => match.slice(1, match.indexOf('='))));
}

/** iCIMS's "Powered by" logo link (div.iCIMS_Logo > a.iCIMS_Logo_Link, "Powered by the ICIMS Talent Platform"), to
 *  www.icims.com/platform_help with four utm_* tags: the vendor's own tags, the same on every iCIMS page that shows the
 *  link (main's captures and the ten jr6 iCIMS step pages converted before PRIV-4's rule, 4896eca and ca3c5ec; compared
 *  by the ICIMS fixer by hash): never where the person came from. Group 1 the link's address, group 2 its query. */
const ICIMS_HELP_HREF = /\shref="((?:https?:)?\/\/www\.icims\.com\/platform_help)\?([^"]*)"/i;

/** The query of iCIMS's logo link in each of main's iCIMS pages that shows it with its tags' values (the files no jr6
 *  case is; a page converted since PRIV-4 shows them REDACTED and is left out). */
function icimsHelpQueries(): string[] {
  return ADDRESSED_FIXTURES.filter((file) => file.startsWith('icims/') && !isJr6(file) && file.endsWith('.html'))
    .flatMap((file) => [...readFileSync(join(ROOT, 'fixtures', file), 'utf8').matchAll(/<a\b[^>]*>/gi)]
      .flatMap(([tag]) => (/\sclass="iCIMS_Logo_Link"/.test(tag) ? [ICIMS_HELP_HREF.exec(tag)?.[2] ?? ''] : [])))
    .filter((query) => referralNamesIn(`?${query}`).length > 0);
}

/** A text with the query cut from each iCIMS logo link (a.iCIMS_Logo_Link to www.icims.com/platform_help) whose tags are
 *  the vendor's (`vendor`: main's query, as written), and how many it cut; any other link, value or place stands. */
function withoutIcimsHelpTags(text: string, vendor: string): { text: string; cut: number } {
  let cut = 0;
  const out = text.replace(/<a\b[^>]*>/gi, (tag) => {
    const href = ICIMS_HELP_HREF.exec(tag);
    if (href === null || !/\sclass="iCIMS_Logo_Link"/.test(tag) || href[2] !== vendor) return tag;
    cut += 1;
    return tag.replace(href[0], ` href="${href[1]}"`);
  });
  return { text: out, cut };
}

describe('jr6 ifix C-4: referral parameters in the committed fixtures (PRIV-4)', () => {
  it("main's iCIMS pages carry one constant query on iCIMS's logo link: the vendor's tags", () => {
    const queries = icimsHelpQueries();
    expect(queries.length).toBeGreaterThanOrEqual(5);
    // One query, the same on every page (its words never printed), holding the four utm_* tags.
    expect(new Set(queries).size).toBe(1);
    expect([...new Set(referralNamesIn(`<a href="http://www.icims.com/platform_help?${queries[0]!}">`))].sort())
      .toEqual(['utm_campaign', 'utm_content', 'utm_medium', 'utm_source']);
  });

  it("every jr6 case's page, frame, route map and expectation: no referral parameter holds a value, but iCIMS's logo link's vendor tags", () => {
    const [vendor = ''] = icimsHelpQueries();
    const files = ADDRESSED_FIXTURES.filter(isJr6);
    expect(files.length).toBeGreaterThan(200);
    expect(files).toEqual(expect.arrayContaining(['icims/jr6-ars-eeo.html', 'adp/jr6-posting.routes.json',
      'adp/jr6-consent.expect.json', 'icims/jr6-apply-sentinel-posting.frame-1.html']));
    const cut: string[] = [];
    const failing = files.flatMap((file) => {
      const kept = withoutIcimsHelpTags(readFileSync(join(ROOT, 'fixtures', file), 'utf8'), vendor);
      if (kept.cut > 0) cut.push(file);
      // jr7 TOOLING-7: Jobvite's share buttons' __jvsc in the two jr6 postings converted before it joined.
      return [...new Set(referralNamesIn(kept.text, { shareChannels: JOBVITE_SHARE_FIXTURES.includes(file) }))]
        .map((name) => `${file}: ${name}`);
    });
    expect(failing).toEqual([]);
    // The exemption stands on iCIMS's step pages alone (the ten of the review, or fewer once converted again).
    expect(cut.every((file) => /^icims\/jr6-(?:ars|sentinel)-[a-z-]+(?:\.frame-1)?\.html$/.test(file)), cut.join(', ')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(10);
  }, 60_000);

  it("every committed fixture: no arrival tag a person's visit adds (iis, iisn, __jvst, __jvsd, gh_src, lever-source, __jvsc) holds a value", () => {
    // `source` and utm_* also name public share and footer links' constant tags in main's captures (Nextdoor's sharekit,
    // a Greenhouse sign-in link, Workable's and Dice's footers): the jr6 sweep above reads those in jr6 cases.
    const arrival = REFERRAL_PARAMS.filter((name) => name !== 'source');
    expect(arrival).toEqual(['iis', 'iisn', '__jvst', '__jvsd', 'gh_src', 'lever-source', '__jvsc']);
    expect(ADDRESSED_FIXTURES.length).toBeGreaterThan(800);
    const failing = ADDRESSED_FIXTURES.flatMap((file) => [...new Set(referralNamesIn(readFileSync(join(ROOT, 'fixtures',
      file), 'utf8'), { shareChannels: JOBVITE_SHARE_FIXTURES.includes(file) }))].filter((name) => arrival.includes(name))
      .map((name) => `${file}: ${name}`));
    expect(failing).toEqual([]);
    // jr7 TOOLING-7: the share-button exemption is narrow: each listed file holds a __jvsc that only it excuses, and a
    // __jvsc naming no share network is a hit there too.
    for (const file of JOBVITE_SHARE_FIXTURES) {
      const text = readFileSync(join(ROOT, 'fixtures', file), 'utf8');
      expect(referralNamesIn(text), file).toContain('__jvsc');
      expect(referralNamesIn(`${text}<a href="/x?__jvsc=Fixture">`, { shareChannels: true }), file).toContain('__jvsc');
    }
  }, 60_000);

  it("exempts iCIMS's logo link only with the vendor's own tags: another value, link, host, path or place is a hit", () => {
    const [vendor = ''] = icimsHelpQueries();
    const link = (href: string, extra = ' class="iCIMS_Logo_Link"') => `<a href="${href}" target="_blank"${extra}>`;
    const left = (text: string) => new Set(referralNamesIn(withoutIcimsHelpTags(text, vendor).text)).size;
    expect(left(link(`http://www.icims.com/platform_help?${vendor}`))).toBe(0);
    expect(left(link(`https://www.icims.com/platform_help?${vendor}`))).toBe(0);
    expect(left(link('http://www.icims.com/platform_help?utm_source=FixtureBoard&amp;utm_medium=x'))).toBe(2);
    expect(left(link(`http://www.icims.com/platform_help?${vendor}&amp;iis=FixtureBoard`))).toBeGreaterThan(0);
    expect(left(link(`http://www.icims.com/other_help?${vendor}`))).toBe(4);
    expect(left(link(`https://careers-acme.icims.com/jobs/1/job?${vendor}`))).toBe(4);
    expect(left(link(`http://www.icims.com/platform_help?${vendor}`, ''))).toBe(4);
    expect(left(`{"https://careers-acme.icims.com/jobs/1/job?${vendor}":"fixtures/icims/x.html"}`)).toBe(4);
    expect(left(`<iframe src="http://www.icims.com/platform_help?${vendor}">`)).toBe(4);
  });
});
// ── end jr6 ifix C-4 ──

// ── jr7 TOOLING-7 (FIX7PLAN §6.1: the converter's nine findings, and the jr6 leftovers BUILD7 names) ──
// Each rule on a synthetic page in the platform's own markup (read from the snapshot7 captures; every value made up).
// ---------------------------------------------------------------------------------------------------------------------

const UKG_SESSION = 'https://secure7.saashr.com/ta/6200000.careers?rnd=Ab1&Ext=careers&sft=QWERTY12'
  + '&ActiveSessionId=12345678901&cb=5550100142#applicant/profile';

describe('jr7 TOOLING-7: the converter (FIX7PLAN §6.1)', () => {
  it("UKGR-20: UKG Ready's session values, its file service's ticket, a phone-shaped listed string in the address, and its value places",
    async () => {
      const { conversion, text } = await convertPage(UKG_SESSION, 'ukgready', 'jr7-ukgr20', `
<header><button class="c-user-picture-button m-reset-styles" title="${JR6_NAME}" aria-label="${JR6_NAME}" aria-haspopup="true">
  <span class="c-user-picture m-has-size m-medium" aria-hidden="true"><span class="c-user-picture__abbr" title="${JR6_NAME}">AQ</span></span></button>
  <div class="c-menu-header"><span class="c-user-picture m-has-size m-large" aria-hidden="true"><span class="c-user-picture__abbr">QA</span></span></div></header>
<main><span class="c-form-control m-rounded"><label class="c-form-control__label--T25fFY" for="st"><span>State</span></label>
  <span class="c-form-control__field--zgYl4G"><span class="c-form-control__area--MtrJbA" aria-hidden="true">
  <span class="c-form-control__value--uC6xTb" aria-hidden="true">Ohio</span>
  <select id="st"><option value="">Select</option><option value="OH" selected>Ohio</option><option value="TX">Texas</option></select></span></span></span>
<span class="c-form-control m-rounded"><label class="c-form-control__label--T25fFY" for="sal"><span>Desired salary</span></label>
  <span class="c-form-control__field--zgYl4G"><span class="c-form-control__area--MtrJbA">
  <span class="c-form-control__value--uC6xTb" aria-hidden="true">95000</span><input id="sal" value="95000"></span></span></span>
<div class="m-border c-fat-item"><div class="c-fat-item__box"><h3 class="c-fat-item__title">Work entry</h3>
  <div class="c-fat-item__body"><span class="c-metadata__text">Fixture Town, OH</span><span class="c-metadata__text">2019 - 2024</span></div></div></div>
<div class="c-profile-summary-container"><span class="c-one-column-layout__label">City</span>
  <span class="c-one-column-layout__value">Fixture Town</span></div>
<a href="/ta/fs?ticket=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl">Your resume</a>
<a href="https://secure7.saashr.com/ta/6200000.careers?rnd=Ab1&amp;Ext=careers&amp;sft=QWERTY12&amp;ActiveSessionId=12345678901">Back</a>
</main>`);
      const header = headerOf(text);
      const clean = 'https://secure7.saashr.com/ta/6200000.careers?rnd=REDACTED&Ext=careers&sft=REDACTED'
        + '&ActiveSessionId=REDACTED&cb=REDACTED#applicant/profile';
      expect(header.source).toBe(clean);
      expect(Object.keys(conversion.routes)).toEqual([clean.split('#')[0]]);
      expect(text).toContain('href="/ta/fs?ticket=REDACTED"');
      expect(text).toContain('rnd=REDACTED&amp;Ext=careers&amp;sft=REDACTED&amp;ActiveSessionId=REDACTED"');
      for (const gone of ['12345678901', 'QWERTY12', 'Ab1&', 'eyJ', '5550100142', 'Avery', 'Quill', '>AQ<', '95000',
        'Fixture Town', '2019 - 2024', '>Ohio</span>', '>QA<']) {
        expect(text, gone).not.toContain(gone);
      }
      // The page's own words stay: the select's options, an entry's title, the review's labels.
      for (const kept of ['<option value="OH">Ohio</option>', '>Work entry</h3>', '>City</span>', '<span>State</span>']) {
        expect(text, kept).toContain(kept);
      }
      expect(text).toContain('<span class="c-form-control__value--uC6xTb" aria-hidden="true">REDACTED</span>');
    }, 60_000);

  it("T7-01: Paycom's chosen radios and boxes drawn as their unchosen twins, its tooltip anchors' spelled text, a canvas stood in",
    async () => {
      const radio = (chosen: boolean, value: string) => `<div class="uiLibRadio ui-radio-lg${chosen ? ' ui-radio-checked' : ''}">
<label class="uiLibRadioLabel"><div class="uiLibRadioButtonBase"><span class="uiLibRadioBase"><span class="uiLibRadioIcon">${chosen
    ? '<svg data-testid="uiLibRadioIconcheckedNoColorPassed" aria-label="radio button checked" color="#003a4f" width="24" height="24" viewBox="0 0 24 24"><path d="M1 1h22v22H1z"></path><path d="M7 7h10v10H7z"></path></svg>'
    : '<svg data-testid="uiLibRadioIconUncheckedNoColorPassed" aria-label="radio button unchecked" color="rgba(0,0,0,0.72)" width="24" height="24" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"></path><path d="M3 3h18v18H3z"></path></svg>'}</span>
<input class="uiLibRadioInput" type="radio" name="q1" value="${value}"${chosen ? ' checked' : ''}></span></div>
<span data-testid="anchor-for-${value}-tooltip">${value}</span></label></div>`;
      const box = (chosen: boolean, label: string) => `<label class="uiLibCheckbox${chosen ? ' ui-checkbox-checked' : ''}">
<div class="uiLibCheckboxIcon"><button class="uiLibCheckboxButton" type="button">${chosen
    ? '<svg data-testid="Checked Checkbox-icon" aria-label="Checked Checkbox" color="#003a4f" width="24" height="24" viewBox="0 0 24 24"><path d="M3 3h18v18H3z"></path><path d="M9 12l2 2 4-4"></path></svg>'
    : '<svg data-testid="Unchecked Checkbox-icon" aria-label="Unchecked Checkbox" color="rgba(0,0,0,0.72)" width="24" height="24" viewBox="0 0 24 24"><path d="M19 5v14H5V5h14"></path><path d="M5 3h14"></path></svg>'}</button></div>
<input class="uiLibCheckboxInput" type="checkbox"${chosen ? ' checked' : ''}><p class="uiLibCheckboxLabel">${label}</p></label>`;
      const page = (boxes: string) => `<div id="ats-portal"><div id="questions-1-field"><p>Are you 18 or older?</p>
<div class="uiLibRadioGroup" role="radiogroup">${radio(true, 'Yes')}${radio(false, 'No')}</div></div>${boxes}
<div><span data-testid="anchor-for-Fixture Town-tooltip">Fixture Town</span><span data-testid="anchor-for--tooltip"></span></div>
<div class="css-pad" style="width: 480px; height: 96px"><canvas class="css-sig" width="476" height="93" style="width: 100%; height: 100%"></canvas></div></div>`;
      const { text } = await convertPage(`https://www.paycomonline.net/v4/ats/web.php/portal/${'ab'.repeat(16)}/applications`,
        'paycom', 'jr7-t701', page(`${box(true, 'I acknowledge')}${box(false, 'I do not have a middle name')}`));
      // Every radio and box draws its unchosen icon, the page's own twin's copy; no chosen class, test id or colour stays.
      for (const gone of ['ui-radio-checked', 'ui-checkbox-checked', 'uiLibRadioIconchecked', '"Checked Checkbox-icon"',
        'radio button checked', '#003a4f', 'anchor-for-Fixture Town-tooltip', 'anchor-for-Yes-tooltip', ' checked']) {
        expect(text, gone).not.toContain(gone);
      }
      expect(text.match(/data-testid="uiLibRadioIconUncheckedNoColorPassed"/g)).toHaveLength(2);
      expect(text.match(/data-testid="Unchecked Checkbox-icon"/g)).toHaveLength(2);
      expect(text).toContain('data-testid="anchor-for-REDACTED-tooltip"');
      expect(text).toContain('data-testid="anchor-for--tooltip"');
      // The canvas keeps the box it draws (the capture measured it with scripting off, the fixture is served with it on).
      expect(text).toContain('style="width: 100%; height: 100%; display: inline-block; min-width: 476px; min-height: 93px;"');
      expect(headerOf(text).canvasStandIns).toBe(1);
      expect(chosenMarksIn(text)).toEqual([]);
      expect(spelledIdsIn(text)).toEqual([]);
      // A chosen box with no unchosen twin in the page to copy is refused, never written.
      await expect(convertPage(`https://www.paycomonline.net/v4/ats/web.php/portal/${'ab'.repeat(16)}/applications`,
        'paycom', 'jr7-t701-lone', page(box(true, 'I acknowledge'))))
        .rejects.toThrow(`jr7-t701-lone.html: ${CHOSEN_MARK_LABELS.icon} is still in the file`);
      // The final check reads each spelled id by its frame alone.
      expect(spelledIdsIn('<span data-testid="anchor-for-Fixture Town-tooltip">')).toEqual([
        "a widget's shown text spelled in its data-testid (on <span>; SPELLED_IDS)"]);
      expect(spelledIdsIn('<span data-testid="anchor-for-REDACTED-tooltip"><b data-testid="anchor-for--tooltip">')).toEqual([]);
      expect(SPELLED_IDS).toEqual([{ attribute: 'data-testid', source: '^(anchor-for-)(.+)(-tooltip)$' }]);
      expect(CHOSEN_ICONS.map(({ testid }) => testid)).toEqual(['^uiLibRadioIconchecked', '^Checked Checkbox-icon$']);
    }, 120_000);

  it("T7-01 (PC7-08's markers): Paycom's hCaptcha site key, widget id and response normalised, as iCIMS's and Oracle's", () => {
    const page = '<div class="h-captcha" data-sitekey="94fee806-5cac-4582-9738-384a0f4ea6f8" data-hcaptcha-widget-id="0gp98jgqs8c8"'
      + ' data-hcaptcha-response="P1_eyJx.y"><iframe src="https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html'
      + '#frame=checkbox&amp;id=0gp98jgqs8c8&amp;host=www.paycomonline.net&amp;sitekey=94fee806-5cac-4582-9738-384a0f4ea6f8'
      + '&amp;size=invisible"></iframe></div><p id="main">id=main stays</p>';
    const { text, renderIds } = normaliseNewAts('paycom', page);
    expect(text).not.toContain('94fee806');
    expect(text).not.toContain('0gp98jgqs8c8');
    expect(text).not.toContain('P1_eyJx');
    expect(text).toContain('data-sitekey="REDACTED" data-hcaptcha-widget-id="REDACTED" data-hcaptcha-response="REDACTED"');
    expect(text).toContain('&amp;id=REDACTED&amp;host=www.paycomonline.net&amp;sitekey=REDACTED&amp;size');
    expect(text).toContain('<p id="main">id=main stays</p>');
    expect(renderIds.length).toBeGreaterThanOrEqual(4);
    // Another platform's page is left as it is (iCIMS's and Oracle's go through normaliseTokens).
    expect(normaliseNewAts('hibob', page).text).toBe(page);
  });

  it("T7-02: Dayforce's Personal Information read view, its values and the source chosen, its labels kept", async () => {
    const { text } = await convertPage('https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/1/apply', 'dayforce',
      'jr7-t702', `<div test-id="personal-info-read"><h3 test-id="personal-info-read-candidate-name">${JR6_NAME} Q</h3>
<span test-id="personal-info-read-address1">1 Fixture Way</span><span test-id="personal-info-read-city-state-zip">Fixture Town, OH 00000</span>
<span test-id="personal-info-read-country">Fixtureland</span>
<div test-id="personal-info-read-listed-items"><div>Preferred contact</div><div>Text me</div><div>Fixture</div></div>
<div test-id="personal-info-read-phone-type-label">Mobile Phone:</div><div test-id="personal-info-read-mobile-phone-number">Ext 7</div>
<div test-id="personal-info-read-email-label">Email:</div><div test-id="personal-info-read-email"><a href="#">avery at example</a></div>
<span test-id="personal-info-read-candidate-source-statement-label">How did you hear about this job?</span>
<span test-id="personal-info-read-candidate-source-label">Billboard</span></div>
<form test-id="workhistory-record"><h3 test-id="workHistory-read-position-title">Staff Engineer</h3></form>`);
    for (const gone of ['Avery', 'Quill', 'Fixture Way', 'Fixture Town', 'Fixtureland', 'Preferred contact', 'Text me', 'Ext 7',
      'avery at example', 'Billboard', 'Staff Engineer']) {
      expect(text, gone).not.toContain(gone);
    }
    for (const kept of ['>Mobile Phone:</div>', '>Email:</div>', '>How did you hear about this job?</span>']) {
      expect(text, kept).toContain(kept);
    }
  }, 60_000);

  it("JDEF-16: JobDiva's file card, wherever the page repeats the name, and Eightfold's per-session CSRF token", async () => {
    const { text } = await convertPage('https://www1.jobdiva.com/portal/?a=fixture#/jobs/1', 'jobdiva', 'jr7-jdef16', `
<div class="jd-dropzone"><div class="jd-dropzone-filecard"><span>${JR6_FILE}</span><span><svg width="16" height="16"
  viewBox="0 0 16 16"><path d="M4 4l8 8"></path></svg></span></div></div>
<p class="jd-note">Uploaded: ${JR6_FILE}</p><button type="button" aria-label="Remove ${JR6_FILE}">x</button>`);
    for (const gone of ['cv final', 'cv%20final']) expect(text, gone).not.toContain(gone);
    expect(text).toContain('<div class="jd-dropzone-filecard"><span>REDACTED</span>');
    expect(text).toContain('aria-label="Remove REDACTED"');
    expect(headerOf(text).source).toBe('https://www1.jobdiva.com/portal/?a=fixture#/jobs/1');
    const head = '<meta name="_csrf_header" content="X-CSRF-TOKEN"><meta name="_csrf" content="0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0">';
    const eightfold = normaliseNewAts('eightfold', head);
    expect(eightfold.text).toBe('<meta name="_csrf_header" content="X-CSRF-TOKEN"><meta name="_csrf" content="REDACTED">');
    expect(eightfold.renderIds).toEqual(['0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0']);
    expect(normaliseNewAts('jobdiva', head).text).toBe(head);
  }, 60_000);

  it("ICIMS7-15: an open searched iCIMS list converts, each result's runs (the bolded query's among them) keeping a REDACTED",
    async () => {
      const row = (at: number, before: string, after: string) => `<li class="dropdown-result result-selectable${at === 0
        ? ' result-focus" aria-selected="true' : ''}" id="result-selectable_-1_PersonProfileFields.School_${at}" role="option"
  dropdown-index="${at}" title="${before}Roeville${after}" aria-label="${before}Roeville${after}">${before}<b>Roeville</b>${after}</li>`;
      const { text } = await convertPage(ICIMS_APPLY, 'icims', 'jr7-icims715', `<style>.dropdown-results li b { font-weight: 700; }</style>
<label for="-1_PersonProfileFields.School">School</label>
<select id="-1_PersonProfileFields.School" icimsdropdown-enabled="1" icimsdropdown-ajax="1" icimsdropdown-search="1"
  icimsdropdown-selected="7"><option value="7">Roeville State University</option></select>
<a id="-1_PersonProfileFields.School_icimsDropdown" class="dropdown-select" aria-activedescendant="result-selectable_-1_PersonProfileFields.School_0"><span class="dropdown-text">Roeville State University</span></a>
<div class="dropdown-container"><input type="text" class="dropdown-search" value="Roeville" aria-controls="-1_PersonProfileFields.School_dropdown-results">
<ul id="-1_PersonProfileFields.School_dropdown-results" class="dropdown-results" role="listbox">
${row(0, '', ' State University')}${row(1, 'Old ', ' College')}${row(2, 'North ', '')}</ul></div>`);
      expect(text).not.toContain('Roeville');
      expect(text).not.toContain('State University');
      expect(text.match(/<b>REDACTED<\/b>/g)).toHaveLength(3);
      // Each run keeps its own REDACTED, the white space around it as written.
      expect(text).toContain('>REDACTED <b>REDACTED</b> REDACTED</li>');
      expect(text).toContain('><b>REDACTED</b> REDACTED</li>');
    }, 60_000);

  it("UP7-14: UltiPro's Race row, closed by the capture's answer, is drawn open before the measure, so the page converts",
    async () => {
      const { text } = await convertPage('https://recruiting.ultipro.com/ACM1000/JobBoard/0000/OpportunityApply?opportunityId=1',
        'ultipro', 'jr7-up714', `<style>.collapse { display: none; } .collapse.in { display: block; }</style>
<div class="form-group"><label for="hisp">Are you Hispanic or Latino?</label>
  <select id="hisp" data-bind="value: isHispanic"><option>Choose...</option><option>Yes</option><option selected>No</option></select></div>
<div class="row collapse" data-bind="collapse: isHispanic() != 'No'"><div class="col-md-6"><label for="race">Race</label>
  <select id="race"><option>Choose...</option><option>Fixture race</option></select></div></div>
<p>Thank you.</p>`);
      expect(text).toContain('<div class="row collapse in" data-bind="collapse: isHispanic() != \'No\'">');
      expect(headerOf(text).cleared.choices).toBeGreaterThanOrEqual(1);
      expect(OPENED_ROWS).toEqual([{ selector: '.collapse[data-bind*="isHispanic()"]', className: 'in' }]);
    }, 60_000);

  it("jr7-O5: Oracle's profile tile summaries, their words and labels, the tile's own Edit and Delete kept", async () => {
    const tile = (title: string, subtitle: string) => `<article class="apply-flow-profile-item-tile" data-qa="tile">
<div class="apply-flow-profile-item-tile__summary" data-profile-item-tile="" role="button" tabindex="0" aria-label="${title}, ${subtitle}">
<div class="apply-flow-profile-item-tile__summary-content"><div class="apply-flow-profile-item-tile__summary-title"><span>${title}</span></div>
<div class="apply-flow-profile-item-tile__summary-subtitle text-color-secondary">${subtitle}</div>
<div class="apply-flow-profile-item-tile__summary-validation"><span title="${title} is complete">Complete</span></div></div>
<div class="apply-flow-profile-item-tile__actions-container"><button class="apply-flow-profile-item-tile__edit-item-icon" title="Edit" aria-label="Edit"></button>
<button class="apply-flow-profile-item-tile__delete-icon" title="Delete" aria-label="Delete"></button></div></div></article>`;
    const { text } = await convertPage(ORACLE_APPLY, 'oracle', 'jr7-o5-tiles', `<div class="apply-flow-block apply-flow-block--skill">
<h3 class="apply-flow-block__title">Experience</h3>${tile('Staff Engineer', 'Initech, 2019 - 2024')}${tile('Kubernetes', 'Expert')}</div>`);
    for (const gone of ['Staff Engineer', 'Initech', '2019 - 2024', 'Kubernetes', 'Expert', 'is complete', '>Complete<']) {
      expect(text, gone).not.toContain(gone);
    }
    expect(text.match(/class="apply-flow-profile-item-tile__summary"[^>]*aria-label="REDACTED"/g)).toHaveLength(2);
    expect(text.match(/class="apply-flow-profile-item-tile__edit-item-icon" title="Edit" aria-label="Edit"/g)).toHaveLength(2);
    expect(text.match(/class="apply-flow-profile-item-tile__delete-icon" title="Delete" aria-label="Delete"/g)).toHaveLength(2);
    expect(text).toContain('>Experience</h3>');
  }, 60_000);

  it("jr7-O5: Oracle's My Applications keep the captured posting's tile (--keep-application) and redact the person's others",
    async () => {
      const site = 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX';
      const tile = (job: string, title: string, status: string) => `<li class="cs-application-tile"><div class="cs-application-tile__column cs-job-info">
<div class="cs-job-info__title-container"><a class="cs-job-info__title cs-button--link" aria-haspopup="false" href="${site}/job/${job}">${title}</a></div>
<span class="cs-job-info__location text-color-secondary"><span>Fixture Town</span></span></div>
<div class="cs-job-status"><span class="cs-job-status__label">Status</span><span class="cs-job-status__value" title="${status}">${status}</span></div>
<div class="cs-job-info__metadata"><span>Submitted Date</span><span>11/11/2026</span></div></li>`;
      const page = `<div class="cs-applications__container cs-applications__container-active"><h2 class="cs-header">Active Job Applications</h2>
<ul class="cs-applications__list" role="list">${tile('41', 'Platform Engineer', 'Under Consideration')}${tile('42', 'Data Engineer', 'Under Consideration')}</ul></div>
<div class="cs-applications__container cs-applications__container-drafts"><ul class="cs-applications__list">${tile('43', 'Site Engineer', 'Draft')}</ul></div>
<div class="cs-applications__container cs-applications__container-resolved"><ul class="cs-applications__list">${tile('44', 'Cloud Engineer', 'Not Selected')}</ul></div>`;
      const file = join(work, 'jr7-o5-profile.mhtml');
      writeFileSync(file, mhtml(`${site}/my-profile`, [{ type: 'text/html', id: 'frame-MAIN@mhtml.blink',
        location: `${site}/my-profile`, body: `<!DOCTYPE html><html><head><title>My Applications</title></head><body>${page}</body></html>` }]));
      const kept = (await convertMhtml({ file, platform: 'oracle', caseName: 'jr7-o5-profile', redact: LISTED, outDir: work,
        keepApplication: '41' })).files[0]?.text ?? '';
      // The captured posting's tile stays whole: its link (the success sign ORACLE-7 reads), title and status.
      expect(kept).toContain(`href="${site}/job/41">Platform Engineer</a>`);
      expect(kept).toContain('title="Under Consideration">Under Consideration</span>');
      // The others are the person's history: every word, label and address gone.
      for (const gone of ['/job/42', '/job/43', '/job/44', 'Data Engineer', 'Site Engineer', 'Cloud Engineer', 'Not Selected',
        '>Draft<']) {
        expect(kept, gone).not.toContain(gone);
      }
      expect(kept.match(/<a class="cs-job-info__title cs-button--link" aria-haspopup="false" href="#">REDACTED<\/a>/g)).toHaveLength(3);
      expect(headerOf(kept).redacted).toMatchObject({ applications: 3, keptApplications: 1 });
      expect(kept).toContain('>Active Job Applications</h2>');
      // With no job named, every tile goes.
      const none = (await convertMhtml({ file, platform: 'oracle', caseName: 'jr7-o5-profile', redact: LISTED, outDir: work }))
        .files[0]?.text ?? '';
      expect(none).not.toContain('/job/4');
      expect(headerOf(none).redacted.applications).toBe(4);
      // A job id that names no tile, an id that is no id, another platform: refused.
      await expect(convertMhtml({ file, platform: 'oracle', caseName: 'jr7-o5-profile', redact: LISTED, outDir: work,
        keepApplication: '9' })).rejects.toThrow('--keep-application names no My Applications tile');
      await expect(convertMhtml({ file, platform: 'oracle', caseName: 'jr7-o5-profile', outDir: work,
        keepApplication: '4.*' })).rejects.toThrow('--keep-application must be a job id');
      await expect(convertMhtml({ file, platform: 'workday', caseName: 'jr7-o5-profile', outDir: work,
        keepApplication: '41' })).rejects.toThrow('--keep-application is for --platform oracle');
    }, 120_000);

  it("JDEF-V1: --style-order live puts the sheets Blink hoisted back after the head's own, so the run-time style wins (1px)",
    async () => {
      // The verifier's experiment (SP\jr7\audit\jobdiva-eightfold-verify.md §2.1), saved by Chrome's own serializer: a
      // linked sheet, then a <style> the page's script appends at run time; live, the later one wins.
      const url = 'https://www1.jobdiva.com/portal/?a=fixture';
      const live = await browser.newContext({ viewport: VIEWPORT });
      await live.route('**/*', (route) => {
        const at = route.request().url();
        if (at === url) {
          return route.fulfill({ status: 200, contentType: 'text/html', body: `<!DOCTYPE html><html><head><title>Portal</title>
<link rel="stylesheet" href="https://www1.jobdiva.com/portal/a.css"><style>.jd-static { outline: 0; }</style></head>
<body><input class="form-control jd-form" id="box" aria-label="First name"><p class="jd-static">Quick Apply</p>
<script>const s = document.createElement('style'); s.textContent = '.jd-form { border: 1px solid rgb(218, 222, 227); }';
document.head.appendChild(s);</script></body></html>` });
        }
        if (at.endsWith('/a.css')) {
          return route.fulfill({ status: 200, contentType: 'text/css', body: '.form-control { border: 0px solid rgb(204, 204, 204); }' });
        }
        return route.abort();
      });
      const page = await live.newPage();
      await page.goto(url);
      const liveBorder = await page.evaluate(() => getComputedStyle(document.getElementById('box')!).borderTopWidth);
      const session = await live.newCDPSession(page);
      const { data } = await session.send('Page.captureSnapshot', { format: 'mhtml' });
      await live.close();
      const file = join(work, 'jr7-jdefv1.mhtml');
      writeFileSync(file, data);
      // The archive hoists both <style>s above the linked sheet (Blink's layout).
      const head = /<head>([\s\S]*?)<\/head>/i.exec(data.replace(/=\r?\n/g, ''))?.[1] ?? '';
      expect(head.indexOf('cid:css-')).toBeGreaterThanOrEqual(0);
      expect(head.indexOf('cid:css-')).toBeLessThan(head.indexOf('a.css'));
      const borderOf = async (conversion: Awaited<ReturnType<typeof convertMhtml>>) => {
        const { context } = await servedContext(conversion);
        const served = await context.newPage();
        await served.goto(url);
        const border = await served.evaluate(() => getComputedStyle(document.getElementById('box')!).borderTopWidth);
        await context.close();
        return border;
      };
      const liveOrder = await convertMhtml({ file, platform: 'jobdiva', caseName: 'jr7-jdefv1-live', outDir: work });
      const archived = await convertMhtml({ file, platform: 'jobdiva', caseName: 'jr7-jdefv1-archive', outDir: work,
        styleOrder: 'archive' });
      expect(liveBorder).toBe('1px');
      // jobdiva's default is live: the fixture draws the box's edge as the live page did; the archive's order loses it.
      expect(await borderOf(liveOrder)).toBe('1px');
      expect(await borderOf(archived)).toBe('0px');
      expect(headerOf(liveOrder.files[0]?.text ?? '')).toMatchObject({ styleOrder: 'live', styleSheetsMoved: 2 });
      expect(headerOf(archived.files[0]?.text ?? '').styleOrder).toBeUndefined();
      // Another platform keeps the archive's order unless asked; an unknown order is refused.
      const asked = await convertMhtml({ file, platform: 'hibob', caseName: 'jr7-jdefv1-asked', outDir: work, styleOrder: 'live' });
      expect(await borderOf(asked)).toBe('1px');
      expect(await borderOf(await convertMhtml({ file, platform: 'hibob', caseName: 'jr7-jdefv1-hibob', outDir: work })))
        .toBe('0px');
      await expect(convertMhtml({ file, platform: 'jobdiva', caseName: 'jr7-jdefv1-bad', outDir: work, styleOrder: 'page' }))
        .rejects.toThrow('--style-order must be one of archive, live');
      expect(STYLE_ORDER_DEFAULTS).toEqual({ jobdiva: 'live' });
    }, 120_000);

  it("RBP7-V2(a): --frame-src gives a frame the capture saved unloaded its public vendor address, a third party's stand-in",
    async () => {
      // bamboohr1-blank's shape (SP\jr7\audit\rippling-bamboohr-pinpoint-verify.md RBP7-V2): the reCAPTCHA anchor's part
      // has no Content-Location and an empty document, so the fixture's frame has no address.
      const page = 'https://acme.bamboohr.com/careers/1';
      const anchor = 'https://www.google.com/recaptcha/api2/anchor?ar=1&hl=en&size=normal&cb=fixture';
      const other = 'https://www.google.com/recaptcha/api2/bframe?hl=en';
      const file = join(work, 'jr7-v2a.mhtml');
      writeFileSync(file, mhtml(page, [
        { type: 'text/html', id: 'frame-MAIN@mhtml.blink', location: page, body: `<!DOCTYPE html><html><head><title>Apply</title></head>
<body><form><label for="first">First name</label><input id="first">
<div class="g-recaptcha"><iframe title="reCAPTCHA" src="cid:frame-ANCHOR@mhtml.blink" width="304" height="78"></iframe>
<textarea name="g-recaptcha-response" style="display: none"></textarea></div>
<iframe title="recaptcha challenge" src="cid:frame-CHALLENGE@mhtml.blink" width="10" height="10"></iframe></form></body></html>` },
        { type: 'text/html', id: 'frame-ANCHOR@mhtml.blink', body: '<html><head></head><body></body></html>' },
        { type: 'text/html', id: 'frame-CHALLENGE@mhtml.blink', location: other, body: '<html><body>A challenge</body></html>' },
      ]));
      const plain = await convertMhtml({ file, platform: 'bamboohr', caseName: 'jr7-v2a', outDir: work });
      expect(plain.files[0]?.text).toContain('<iframe title="reCAPTCHA" width="304" height="78"></iframe>');
      expect(headerOf(plain.files[0]?.text ?? '').frames).toEqual({ linked: 1, blanked: 1 });
      const given = await convertMhtml({ file, platform: 'bamboohr', caseName: 'jr7-v2a', outDir: work,
        frameSrc: [readFrameSrcOption(`iframe[title="reCAPTCHA"]=${anchor}`, 1)] });
      const text = given.files[0]?.text ?? '';
      expect(text).toContain(`<iframe title="reCAPTCHA" src="${anchor.replace(/&/g, '&amp;')}" width="304" height="78"></iframe>`);
      expect(headerOf(text).frames).toEqual({ linked: 1, blanked: 0, given: 1 });
      // The route map answers it with the third-party stand-in, as the captured challenge frame's.
      const standIn = given.files.find((output) => output.path.endsWith('jr7-v2a.third-party-frame.html'))?.path.split('\\').join('/');
      expect(given.routes[anchor]).toBe(standIn);
      expect(given.routes[other]).toBe(standIn);
      // Refused: an entry that names no unloaded frame, or a frame with an address of its own; an address that is no
      // third party's public one.
      await expect(convertMhtml({ file, platform: 'bamboohr', caseName: 'jr7-v2a', outDir: work,
        frameSrc: [{ selector: 'iframe[title="Nothing"]', url: anchor }] }))
        .rejects.toThrow('--frame-src #1 names no frame the capture saved unloaded');
      await expect(convertMhtml({ file, platform: 'bamboohr', caseName: 'jr7-v2a', outDir: work,
        frameSrc: [{ selector: 'iframe', url: anchor }] })).rejects.toThrow('--frame-src #1 names a frame with an address of its own');
      expect(() => readFrameSrcOption(`iframe=${anchor}&k=6LcFixtureKey`, 2)).toThrow('--frame-src #2 holds a site key');
      expect(() => readFrameSrcOption('iframe=https://acme.bamboohr.com/careers/2', 1)).toThrow('names a host the extension runs on');
      expect(() => readFrameSrcOption('iframe=https://user:pw@www.google.com/recaptcha/api2/anchor', 1)).toThrow('holds credentials');
      expect(() => readFrameSrcOption('iframe=http://www.google.com/recaptcha/api2/anchor', 1)).toThrow('must be <css>=<https address>');
      expect(readFrameSrcOption(`iframe[title="reCAPTCHA"]=${anchor}`, 1)).toEqual({ selector: 'iframe[title="reCAPTCHA"]', url: anchor });
    }, 120_000);

  it("the jr6 leftover (INT-2 §5): Jobvite's __jvsc reads REDACTED in the address, its links and its share buttons", async () => {
    const posting = 'https://jobs.jobvite.com/acme/job/oFixture2?__jvst=Job%20Board&__jvsd=FixtureBoard&__jvsc=FixtureChannel';
    const { conversion, text } = await convertPage(posting, 'jobvite', 'jr7-jvsc', `<h1>Engineer</h1>
<a class="share" href="https://twitter.com/intent/tweet?url=https%3A%2F%2Fjobs.jobvite.com%2Facme%2Fjob%2FoFixture2%3F__jvst%3DSocial%26__jvsc%3DTwitter">Share</a>
<a ng-href="/acme/job/oFixture2/apply?__jvsc=FixtureChannel&amp;nl=0" href="/acme/job/oFixture2/apply?__jvsc=FixtureChannel&amp;nl=0">Apply</a>`);
    const clean = 'https://jobs.jobvite.com/acme/job/oFixture2?__jvst=REDACTED&__jvsd=REDACTED&__jvsc=REDACTED';
    expect(headerOf(text).source).toBe(clean);
    expect(Object.keys(conversion.routes)).toEqual([clean]);
    expect(text).not.toMatch(/FixtureChannel|FixtureBoard|%3DTwitter|%3DSocial/);
    expect(text).toContain('/acme/job/oFixture2/apply?__jvsc=REDACTED&amp;nl=0');
    expect(text).toContain('%26__jvsc%3DREDACTED');
  }, 60_000);

  it("every committed fixture: no widget's shown text spelled in an id (T7-01, spelledIdsIn)", () => {
    const files = committedFixtureFiles();
    expect(files.length).toBeGreaterThan(400);
    expect(files.flatMap((file) => spelledIdsIn(readFileSync(join(ROOT, 'fixtures', file), 'utf8'))
      .map((label) => `${file}: ${label}`))).toEqual([]);
  }, 60_000);

  it('the jr6 leftover (INT-2 §6 item 3): the final check reads the inlined stylesheets for the token and referral needles',
    async () => {
      // A content blocker's filter list, as the owner's browser injected it (INT-2 §4: one rule, hundreds of link-matching
      // selectors, display: none !important), its utm_ tag made up: the whole-text pass redacts it, as in any text.
      const filter = `<style>a[href^="https://ads.tailorit-fixture.example/"][href*="&utm_source=FixtureAds"], .fixture-ad
  { display: none !important; visibility: hidden !important; }</style>`;
      const { text } = await convertPage(GREENHOUSE_JOB, 'greenhouse', 'jr7-styles', `${filter}<h1>Engineer</h1>`);
      expect(text).toContain('[href*="&utm_source=REDACTED"]');
      expect(checkedStyleForms(text).some((form) => form.includes('utm_source=redacted'))).toBe(true);
      // What no pass redacts there is refused now: a per-load token in a selector, a JWT in a content string.
      await expect(convertPage(GREENHOUSE_JOB, 'greenhouse', 'jr7-styles-token', `<style>a[href*="?bft=0dAFfixture"] { color: red; }
.x::after { content: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl"; }</style><h1>Engineer</h1>`))
        .rejects.toThrow(/jr7-styles-token\.html: a per-load token is still in an inlined stylesheet[\s\S]*a JWT is still in an inlined stylesheet/);
      // Base64 payloads are no text, and a page's text is checkedForms', as before.
      expect(checkedStyleForms('<style>.a { background: url("data:image/png;base64,ZXlKaGJHY2lPaUpJVXpJMU5pSjk=") }</style><p>x</p>'))
        .toEqual(['.a { background: url("data:image/png;base64,") }', '.a { background: url("data:image/png;base64,") }']);
    }, 120_000);

  it("every committed fixture's inlined stylesheets: no token needle; no referral value but inside a content blocker's filter list",
    () => {
      const files = committedFixtureFiles(undefined, '', /\.html$/);
      expect(files.length).toBeGreaterThan(400);
      /** A content blocker's cosmetic filter list (INT-2 §4): a rule block whose every rule hides with display: none
       *  !important, a hundred selectors or more; the referral needle reads a stylesheet without it. */
      const withoutFilterLists = (style: string) => {
        const rules = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
        const selectors = rules.reduce((sum, rule) => sum + (rule[1] ?? '').split(',').length, 0);
        return rules.length > 0 && selectors >= 100 && rules.every((rule) => /display\s*:\s*none\s*!important/i.test(rule[2] ?? ''))
          ? '' : style;
      };
      const token: string[] = [];
      const referral: string[] = [];
      let filterLists = 0;
      for (const file of files) {
        const text = readFileSync(join(ROOT, 'fixtures', file), 'utf8');
        const forms = checkedStyleForms(text);
        for (const { label, pattern } of tokenNeedles()) if (forms.some((form) => pattern.test(form))) token.push(`${file}: ${label}`);
        const styles = [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1] ?? '');
        const kept = styles.map(withoutFilterLists);
        filterLists += kept.filter((style, at) => style !== styles[at]).length;
        // A jr7 case (converted by this converter) has none anywhere; an older one none outside a filter list.
        const read = isJr6(file) && /(?:^|\/)jr7-/.test(file) ? styles : kept;
        const [needle] = referralNeedles();
        if (checkedStyleForms(read.map((style) => `<style>${style}</style>`).join('')).some((form) => needle!.pattern.test(form))) {
          referral.push(file);
        }
      }
      expect(token).toEqual([]);
      expect(referral).toEqual([]);
      // The filter list the owner's browser injected stands in older captures (INT-2 §4: 21 with a utm_ tag in it).
      expect(filterLists).toBeGreaterThanOrEqual(21);
    }, 60_000);
});
// ── end jr7 TOOLING-7 ──
