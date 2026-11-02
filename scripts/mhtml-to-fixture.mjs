// Turns a page capture (.mhtml, from Chrome's "Save page as > Webpage, Single File" or the dev build's capture hotkey)
// into a test fixture under fixtures/<platform>/: one self-contained HTML file per frame the extension runs in, a page
// standing in for every third-party frame (a CAPTCHA, an API proxy), and a route map that serves them at their real
// addresses. Chromium (Playwright's, JavaScript off) opens the capture itself, so its own MHTML loader resolves the
// archived parts; the converter's MIME reader supplies the stylesheet text and image bytes it inlines.
//
// What it does to each converted frame, in the page:
// - inlines every stylesheet as a <style> element (visibility depends on CSS) and every image as a data: URI; an image
//   over IMAGE_INLINE_MAX bytes becomes a grey SVG of the same size; a reference missing from the archive becomes
//   "data:,", so a fixture never makes a request;
// - removes scripts, noscript, on* attributes, javascript: URLs, <base>, meta http-equiv (refresh and CSP included),
//   object, embed and srcdoc; every form posts to /__submitted, which the e2e harness records as a failure;
// - redacts: typed values are cleared (text inputs, textareas, contenteditable, a widget's value mirror), checked and
//   selected are dropped, hidden-input values and the text of listbox and combobox triggers and chips become REDACTED;
//   emails, phone numbers and every string in the --redact file become REDACTED.
// - Ashby (--platform ashby): the per-load ids are normalised (normaliseAshby), so a fixture is the same whenever its
//   page was captured: each form's render id, which prefixes every data-field-entry-id and every radio's and checkbox's
//   id, name and for, becomes 00000000-0000-4000-8000-00000000000N in the order the page first names it, and the
//   per-load CSP nonce of meta[name=csp-nonce] becomes REDACTED.
// It then reloads the result as the e2e harness serves it and refuses to write anything if a listed string or a found
// email remains (also percent- or entity-encoded), if the page still finds an email or phone number, if the page
// requests anything the route map does not answer, or if any element's visibility changed. Leftover suspicious tokens
// are printed for review. Counts are printed, never values.
//
// Usage: node scripts/mhtml-to-fixture.mjs <file.mhtml> --platform <greenhouse|lever|ashby|workday> --case <name>
//          [--redact <file>] [--out <folder>]
// The redact file holds one string per line (blank lines and lines starting with # are skipped); a string that looks
// like a phone number matches whatever its punctuation. --out defaults to fixtures/.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { chromium } from 'playwright';
import { paint } from './proc.mjs';

const ROOT = resolve(import.meta.dirname, '..');

/** The platforms a fixture can belong to (src/core/enums.ts PLATFORMS). */
export const FIXTURE_PLATFORMS = ['greenhouse', 'lever', 'ashby', 'workday'];

/** The hosts the extension runs on (src/shared/hosts.ts, the one list): only frames on these are converted. */
const ATS_HOST = /^(?:(?:job-)?boards\.greenhouse\.io|jobs\.(?:eu\.)?lever\.co|jobs\.ashbyhq\.com|(?:[a-z0-9-]+\.)+myworkday(?:jobs|site)\.com)$/;

/** Images larger than this become a same-size placeholder: the box is what visibility needs, not the pixels. */
export const IMAGE_INLINE_MAX = 100 * 1024;

/** What every redacted value, hidden-input value, widget text, email and phone number becomes. */
export const REDACTED = 'REDACTED';

/** The viewport both renderings use, the DOM tests' own. */
const VIEWPORT = { width: 1280, height: 900 };

/** An email address; image names such as logo@2x.png are filtered out after matching. */
export const EMAIL_SOURCE =
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\\.[A-Za-z]{2,24}(?![A-Za-z0-9-])';
/**
 * A phone number written with a + or with separators: "+1 (555) 123-4567", "555.123.4567", "+15551234567". A bare
 * run of digits is an id far more often than a phone number, so it is left alone; the redact file catches the owner's
 * own number in any spelling. Digit counts are checked after matching (PHONE_DIGITS).
 */
export const PHONE_SOURCE =
  '(?<![\\w+/.-])(?:\\+\\d{8,15}|(?:\\+\\d{1,3}[ .-]?)?(?:\\(\\d{1,4}\\)[ .-]?)?\\d{1,4}(?:[ .-]\\d{1,4}){1,5})(?![\\w:/-])';
/** How many digits a phone-number match must hold: at least 10, or 8 after a +. */
export const PHONE_DIGITS = { min: 10, minWithPlus: 8, max: 15 };
/** The only attributes searched for phone numbers: the ones that carry words, not geometry, styles or ids. */
export const PHONE_ATTRIBUTES = ['value', 'placeholder', 'title', 'alt', 'aria-label', 'aria-description',
  'aria-placeholder', 'aria-valuetext', 'aria-roledescription', 'content', 'label'];
/** File extensions an email-looking match may end in when it is really an image name (logo@2x.png). */
export const NOT_EMAIL_SOURCE = '\\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|css|js)$';

/** A form render id of Ashby's: a UUID new on every load, before "_<path>" in each data-field-entry-id. */
const ASHBY_RENDER_ID = /\bdata-field-entry-id="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_/g;

/** The fixed id Ashby's `index`-th form render id (0-based, in the order the page first names it) becomes.
 *  @param {number} index */
export const ashbyRenderId = (index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

/**
 * Ashby's per-load ids, normalised in a converted frame's HTML (see the header): every render id a data-field-entry-id
 * names is replaced wherever it stands (the radios' and checkboxes' id, name and for embed it), and the CSP nonce's
 * content becomes REDACTED. Answers the text, the ids replaced (never their values) and the nonces redacted.
 * @param {string} html @returns {{ text: string; renderIds: string[]; nonces: number }}
 */
export function normaliseAshby(html) {
  /** @type {string[]} */
  const renderIds = [];
  for (const match of html.matchAll(ASHBY_RENDER_ID)) {
    const id = match[1] ?? '';
    if (!renderIds.includes(id)) renderIds.push(id);
  }
  let text = html;
  renderIds.forEach((id, index) => {
    text = text.split(id).join(ashbyRenderId(index));
  });
  let nonces = 0;
  text = text.replace(/<meta\b[^>]*\bname="csp-nonce"[^>]*>/gi, (meta) => meta.replace(/\bcontent="[^"]*"/i, () => {
    nonces += 1;
    return `content="${REDACTED}"`;
  }));
  return { text, renderIds, nonces };
}

/** @param {string} message @returns {never} */
function fail(message) {
  throw new ConversionError([message]);
}

/** Why a capture was not converted: each reason names a check, never a value. */
export class ConversionError extends Error {
  /** @param {string[]} reasons */
  constructor(reasons) {
    super(reasons.join('\n'));
    this.name = 'ConversionError';
    this.reasons = reasons;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The capture's MIME parts
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{ contentType: string; charset: string | null; contentId: string | null; location: string | null;
 *   body: Buffer }} MimePart
 * @typedef {{ snapshotUrl: string | null; date: string | null; parts: MimePart[] }} Mhtml
 */

/** A MIME header block, folded lines joined, names in lower case. @param {string} block */
function readHeaders(block) {
  /** @type {Map<string, string>} */
  const headers = new Map();
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

/** A header parameter such as boundary="…" or charset=utf-8. @param {string} header @param {string} name */
function headerParam(header, name) {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(header);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/** Quoted-printable text (a latin1 string, one character per byte) to bytes. @param {string} text */
function decodeQuotedPrintable(text) {
  const joined = text.replace(/=\r?\n/g, '');
  return Buffer.from(joined.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
}

/**
 * Reads an MHTML archive into its parts: each one's type, Content-ID, Content-Location and decoded bytes.
 * @param {Buffer} bytes @returns {Mhtml}
 */
export function parseMhtml(bytes) {
  const text = bytes.toString('latin1');
  const headerEnd = text.search(/\r?\n\r?\n/);
  if (headerEnd < 0) fail('not an MHTML file: no header block');
  const top = readHeaders(text.slice(0, headerEnd));
  const type = top.get('content-type') ?? '';
  const boundary = headerParam(type, 'boundary');
  if (!/^multipart\/related/i.test(type) || !boundary) fail('not an MHTML file: no multipart/related boundary');
  /** @type {MimePart[]} */
  const parts = [];
  const chunks = text.slice(headerEnd).split(`--${boundary}`);
  for (const chunk of chunks.slice(1)) {
    if (chunk.startsWith('--')) break;
    const body = chunk.replace(/^\r?\n/, '');
    const end = body.search(/\r?\n\r?\n/);
    if (end < 0) continue;
    const headers = readHeaders(body.slice(0, end));
    const raw = body.slice(end).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, '');
    const encoding = (headers.get('content-transfer-encoding') ?? '').toLowerCase();
    const decoded = encoding === 'quoted-printable' ? decodeQuotedPrintable(raw)
      : encoding === 'base64' ? Buffer.from(raw.replace(/\s+/g, ''), 'base64')
        : Buffer.from(raw, 'latin1');
    const partType = headers.get('content-type') ?? '';
    const id = headers.get('content-id') ?? null;
    parts.push({
      contentType: (partType.split(';')[0] ?? '').trim().toLowerCase(),
      charset: headerParam(partType, 'charset'),
      contentId: id ? `cid:${id.replace(/^<|>$/g, '')}` : null,
      location: headers.get('content-location') ?? null,
      body: decoded,
    });
  }
  if (parts.length === 0) fail('the MHTML file holds no parts');
  return { snapshotUrl: top.get('snapshot-content-location') ?? null, date: top.get('date') ?? null, parts };
}

// ---------------------------------------------------------------------------------------------------------------------
// Resources: stylesheet text and images, keyed by every address a page may use for them
// ---------------------------------------------------------------------------------------------------------------------

/** The image type from its first bytes, else null. @param {Buffer} bytes */
function sniffImageType(bytes) {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x00000100) return 'image/x-icon';
  const head = bytes.toString('utf8', 0, Math.min(bytes.length, 512)).trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

/**
 * An image's pixel size from its header (PNG, GIF, JPEG, WebP), else null.
 * @param {Buffer} bytes @returns {{ width: number; height: number } | null}
 */
export function imageSize(bytes) {
  const type = sniffImageType(bytes);
  if (type === 'image/png' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (type === 'image/gif' && bytes.length >= 10) return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (type === 'image/jpeg') {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1] ?? 0;
      const length = bytes.readUInt16BE(at + 2);
      // Start-of-frame markers, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
      }
      at += 2 + length;
    }
    return null;
  }
  if (type === 'image/webp' && bytes.length >= 30) {
    const chunk = bytes.toString('latin1', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/** A grey SVG with the image's own size, so layout and visibility stay as they were. @param {{ width: number; height: number }} size */
function placeholderImage({ width, height }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="#d0d0d0"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/** A stylesheet part as text, in the charset its @charset rule or Content-Type names, with LF line ends (the archive's
 *  CRLF would otherwise reach the fixture, which git stores with LF). @param {MimePart} part */
function cssText(part) {
  const declared = /^@charset\s+"([^"]+)"/i.exec(part.body.toString('latin1', 0, 64))?.[1] ?? part.charset ?? 'utf-8';
  let text;
  try {
    text = new TextDecoder(declared).decode(part.body);
  } catch {
    text = new TextDecoder('utf-8').decode(part.body);
  }
  return text.replace(/\r\n?/g, '\n');
}

/**
 * @typedef {{ css?: { text: string; base: string }; dataUri?: string; placeholder?: boolean }} Resource
 */

/**
 * Every stylesheet and image in the archive, under its Content-Location and its cid: address.
 * @param {Mhtml} mhtml @returns {Record<string, Resource>}
 */
function resourcesOf(mhtml) {
  /** @type {Record<string, Resource>} */
  const resources = {};
  for (const part of mhtml.parts) {
    /** @type {Resource | null} */
    let resource = null;
    const base = part.location ?? part.contentId ?? '';
    if (part.contentType === 'text/css') {
      resource = { css: { text: cssText(part), base } };
    } else if (part.contentType.startsWith('image/') || part.contentType === 'application/octet-stream') {
      const type = sniffImageType(part.body) ?? (part.contentType.startsWith('image/') ? part.contentType : null);
      if (type === null) continue;
      const size = part.body.length > IMAGE_INLINE_MAX ? imageSize(part.body) : null;
      resource = size
        ? { dataUri: placeholderImage(size), placeholder: true }
        : { dataUri: `data:${type};base64,${part.body.toString('base64')}`, placeholder: false };
    }
    if (resource === null) continue;
    for (const key of [part.location, part.contentId]) if (key && !(key in resources)) resources[key] = resource;
  }
  return resources;
}

// ---------------------------------------------------------------------------------------------------------------------
// Redaction patterns, built in Node and handed to the page as sources
// ---------------------------------------------------------------------------------------------------------------------

/** The redact file's strings: one per line, # comments and blank lines skipped. @param {string} text */
export function readRedactList(text) {
  const strings = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  for (const [index, entry] of strings.entries()) {
    if (entry.length < 3) fail(`redact file: entry ${index + 1} is shorter than 3 characters, which would redact too much`);
  }
  return strings;
}

/** Escapes a string for use inside a RegExp. @param {string} text */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Each redact string as a case-insensitive pattern source. One that looks like a phone number (digits and phone
 * punctuation only, at least 7 digits) matches its digits with any punctuation between them.
 * @param {string[]} strings @returns {string[]}
 */
export function redactSources(strings) {
  return strings.map((entry) => {
    const digits = entry.replace(/\D/g, '');
    if (/^[\d\s().+-]+$/.test(entry) && digits.length >= 7) {
      return `(?<!\\d)${[...digits].join('[\\s().+-]*')}(?!\\d)`;
    }
    return escapeRegExp(entry);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Code that runs in the page. Each function is serialized by Playwright, so it may use nothing from this module: what
// it needs comes in through its one argument.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Each body element's tag and whether Chromium shows it: checkVisibility (display, visibility, opacity,
 * content-visibility) and a box of at least 4 by 4 pixels. Elements the converter removes are left out on both sides,
 * so the two lists line up element for element.
 * @returns {string[]}
 */
export function measureInPage() {
  const doc = globalThis.document;
  const skip = 'script, noscript, template, style, link, meta, base, object, embed, applet, source, track';
  /** @type {string[]} */
  const states = [];
  if (!doc.body) return states;
  for (const element of doc.body.querySelectorAll('*')) {
    if (element.closest(skip)) continue;
    const rect = element.getBoundingClientRect();
    const shown = element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true,
      opacityProperty: true, visibilityProperty: true }) && rect.width >= 4 && rect.height >= 4;
    states.push(`${element.tagName.toLowerCase()}${shown ? '+' : '-'}`);
  }
  return states;
}

/**
 * Turns the frame's document into a fixture in place: inlining, removal, form actions and redaction. Returns counts,
 * the emails and phone numbers it found (kept in memory for the final check, never printed or written) and the
 * suspicious tokens left over.
 * @param {{ resources: Record<string, Resource>; frameUrls: Record<string, string | null>; frameUrl: string;
 *   redact: string[]; email: string; notEmail: string; phone: string;
 *   phoneDigits: { min: number; minWithPlus: number; max: number }; phoneAttributes: string[]; redacted: string }} input
 */
export function transformInPage(input) {
  const doc = globalThis.document;
  const { resources, frameUrls, frameUrl, redacted } = input;
  const counts = {
    typedValues: 0, checked: 0, selected: 0, hiddenValues: 0, widgetText: 0, emails: 0, phones: 0, listed: 0,
    scripts: 0, eventHandlers: 0, javascriptUrls: 0, bases: 0, metaHttpEquiv: 0, metaRefresh: 0, embeds: 0,
    links: 0, srcdoc: 0, stylesheets: 0, images: 0, placeholders: 0, missing: 0, forms: 0, frames: 0,
    framesDropped: 0, shadowRoots: 0,
  };
  /** @type {Set<string>} */
  const found = new Set();
  const notes = [];

  /** An address resolved against the frame's original URL, or null. @param {string} ref @param {string} base */
  const resolveUrl = (ref, base) => {
    try {
      return new URL(ref, base).href;
    } catch {
      try {
        return new URL(ref, frameUrl).href;
      } catch {
        return null;
      }
    }
  };
  /** A data: URI for an archived image, or "data:," when the archive lacks it. @param {string | null} url */
  const imageFor = (url) => {
    const resource = url ? resources[url] ?? resources[url.split('#')[0] ?? ''] : undefined;
    if (resource?.dataUri) {
      counts.images += 1;
      if (resource.placeholder) counts.placeholders += 1;
      return resource.dataUri;
    }
    counts.missing += 1;
    return 'data:,';
  };

  /**
   * Stylesheet text with @charset dropped, @import inlined from the archive and every url() a data: URI.
   * @param {string} text @param {string} base @param {number} depth @returns {string}
   */
  const rewriteCss = (text, base, depth) => {
    let css = text.replace(/@charset\s+(?:"[^"]*"|'[^']*')\s*;/gi, '');
    css = css.replace(/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')\s*([^;]*);/gi,
      (_match, a, b, c, d, e, condition) => {
        const url = resolveUrl(a ?? b ?? c ?? d ?? e ?? '', base);
        const sheet = url ? resources[url]?.css : undefined;
        if (!sheet || depth > 4) {
          counts.missing += 1;
          return '';
        }
        const inner = rewriteCss(sheet.text, sheet.base, depth + 1);
        const media = String(condition).trim();
        if (media && !/^(?:layer|supports)\b/i.test(media)) return `@media ${media} {\n${inner}\n}`;
        if (media) notes.push('an @import with layer() or supports() was inlined without its condition');
        return inner;
      });
    return css.replace(/url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|((?:[^)\s\\'"]|\\.)*))\s*\)/gi,
      (match, a, b, c) => {
        const ref = String(a ?? b ?? c ?? '').replace(/\\(.)/g, '$1').trim();
        if (!ref || ref.startsWith('#') || /^data:/i.test(ref)) return match;
        return `url("${imageFor(resolveUrl(ref, base))}")`;
      });
  };

  // Shadow roots would be lost on serialization: refuse rather than drop them silently.
  for (const element of doc.querySelectorAll('*')) if (element.shadowRoot) counts.shadowRoots += 1;

  // Active content.
  for (const element of doc.querySelectorAll('script, noscript')) {
    element.remove();
    counts.scripts += 1;
  }
  for (const element of doc.querySelectorAll('object, embed, applet')) {
    element.remove();
    counts.embeds += 1;
  }
  for (const element of doc.querySelectorAll('base')) {
    element.remove();
    counts.bases += 1;
  }
  for (const element of doc.querySelectorAll('meta[http-equiv]')) {
    if ((element.getAttribute('http-equiv') ?? '').toLowerCase() === 'refresh') counts.metaRefresh += 1;
    else counts.metaHttpEquiv += 1;
    element.remove();
  }
  for (const element of doc.querySelectorAll('[srcdoc]')) {
    element.removeAttribute('srcdoc');
    counts.srcdoc += 1;
  }
  const urlAttributes = ['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'background', 'ping'];
  /** An address as a URL parser reads it: tabs and newlines removed, leading spaces and controls ignored. */
  const asParsed = (/** @type {string} */ value) => {
    const compact = value.replace(/[\t\n\r]/g, '');
    let start = 0;
    while (start < compact.length && compact.charCodeAt(start) <= 0x20) start += 1;
    return compact.slice(start);
  };
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        counts.eventHandlers += 1;
      } else if (urlAttributes.includes(name) && /^javascript:/i.test(asParsed(attribute.value))) {
        if (name === 'href') element.setAttribute(attribute.name, '#');
        else element.removeAttribute(attribute.name);
        counts.javascriptUrls += 1;
      }
    }
  }

  // Stylesheets: the page's own <style> elements first, then each <link> becomes a <style> in its place, so the
  // cascade order is kept. A "</style" inside the text would end the element when the fixture is parsed again.
  for (const style of doc.querySelectorAll('style')) {
    if (/url\(|@import/i.test(style.textContent ?? '')) style.textContent = rewriteCss(style.textContent ?? '', frameUrl, 0);
  }
  for (const link of doc.querySelectorAll('link')) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('stylesheet') && !rel.includes('alternate')) {
      const sheet = resources[link.href]?.css;
      if (!sheet) {
        counts.missing += 1;
        link.remove();
        continue;
      }
      const style = doc.createElement('style');
      const media = link.getAttribute('media');
      if (media && media.trim().toLowerCase() !== 'all') style.setAttribute('media', media);
      style.textContent = rewriteCss(sheet.text, sheet.base, 0);
      link.replaceWith(style);
      counts.stylesheets += 1;
    } else if (!rel.includes('canonical')) {
      link.remove();
      counts.links += 1;
    }
  }
  for (const style of doc.querySelectorAll('style')) {
    const text = style.textContent ?? '';
    if (/<\/style/i.test(text)) style.textContent = text.replace(/<\/style/gi, '<\\/style');
  }
  for (const element of doc.querySelectorAll('[style]')) {
    const value = element.getAttribute('style') ?? '';
    if (/url\(/i.test(value)) element.setAttribute('style', rewriteCss(value, frameUrl, 0));
  }

  // Images and other fetched media.
  for (const image of doc.querySelectorAll('img')) {
    image.setAttribute('src', imageFor(image.currentSrc || resolveUrl(image.getAttribute('src') ?? '', frameUrl)));
    for (const name of ['srcset', 'sizes', 'loading']) image.removeAttribute(name);
  }
  for (const source of doc.querySelectorAll('picture source, video source, audio source, track')) source.remove();
  for (const media of doc.querySelectorAll('video, audio')) {
    media.removeAttribute('src');
    media.removeAttribute('poster');
  }
  for (const input of doc.querySelectorAll('input[type="image" i][src]')) {
    input.setAttribute('src', imageFor(resolveUrl(input.getAttribute('src') ?? '', frameUrl)));
  }
  for (const element of doc.querySelectorAll('[background]')) {
    element.setAttribute('background', imageFor(resolveUrl(element.getAttribute('background') ?? '', frameUrl)));
  }
  for (const element of doc.querySelectorAll('image, feImage, use')) {
    for (const name of ['href', 'xlink:href']) {
      const value = element.getAttribute(name);
      if (value === null || value.startsWith('#') || value.startsWith('data:')) continue;
      if (element.localName === 'use') element.removeAttribute(name);
      else element.setAttribute(name, imageFor(resolveUrl(value, frameUrl)));
    }
  }

  // Frames: an archived frame's cid: address becomes its own URL (served from the route map); one without a web
  // address is left blank, and so is any other address but a web one (a data: frame would run its own scripts). A web
  // address the archive lacks stays, and the final check refuses the request it makes.
  /** @type {string[]} */
  const linkedFrames = [];
  for (const frame of doc.querySelectorAll('iframe[src], frame[src]')) {
    const src = frame.getAttribute('src') ?? '';
    if (!src.startsWith('cid:')) {
      if (!/^https?:/i.test(src.trim())) {
        frame.removeAttribute('src');
        counts.framesDropped += 1;
      }
      continue;
    }
    const url = frameUrls[src] ?? null;
    if (url) {
      frame.setAttribute('src', url);
      linkedFrames.push(url);
      counts.frames += 1;
    } else {
      frame.removeAttribute('src');
      counts.framesDropped += 1;
    }
  }

  // Forms never reach the site: the e2e harness records any request to /__submitted as a failure.
  for (const form of doc.querySelectorAll('form')) {
    form.setAttribute('action', '/__submitted');
    form.setAttribute('method', 'post');
    counts.forms += 1;
  }
  for (const control of doc.querySelectorAll('[formaction]')) control.setAttribute('formaction', '/__submitted');
  for (const control of doc.querySelectorAll('[formmethod]')) control.removeAttribute('formmethod');

  // Typed values, choices and hidden values.
  const keepValue = ['checkbox', 'radio', 'submit', 'button', 'reset', 'image'];
  for (const input of doc.querySelectorAll('input')) {
    const type = (input.getAttribute('type') ?? 'text').trim().toLowerCase();
    if (type === 'hidden') {
      if (input.getAttribute('value')) {
        input.setAttribute('value', redacted);
        counts.hiddenValues += 1;
      }
    } else if (type === 'checkbox' || type === 'radio') {
      if (input.hasAttribute('checked')) {
        input.removeAttribute('checked');
        counts.checked += 1;
      }
    } else if (type === 'file') {
      input.removeAttribute('value');
    } else if (!keepValue.includes(type) && input.hasAttribute('value')) {
      if (input.getAttribute('value') !== '') counts.typedValues += 1;
      input.setAttribute('value', '');
      // A widget's mirror of what was typed (react-select keeps it in data-value on the input's container).
      const mirror = input.parentElement?.closest('[data-value]');
      if (mirror && mirror.getAttribute('data-value') !== '') {
        mirror.setAttribute('data-value', '');
        counts.typedValues += 1;
      }
    }
  }
  for (const textarea of doc.querySelectorAll('textarea')) {
    if (textarea.textContent) {
      textarea.textContent = '';
      counts.typedValues += 1;
    }
  }
  for (const option of doc.querySelectorAll('option[selected]')) {
    option.removeAttribute('selected');
    counts.selected += 1;
  }
  for (const editable of doc.querySelectorAll('[contenteditable]:not([contenteditable="false" i])')) {
    if (editable.textContent?.trim()) {
      editable.replaceChildren();
      counts.typedValues += 1;
    }
  }

  // The text a listbox or combobox trigger shows is the chosen value, and so is a chip's: both become REDACTED.
  const widgetValues = [
    '[role="combobox"]:not(input, select, textarea)', '[aria-haspopup="listbox" i]:not(input, select, textarea)',
    '[class*="singlevalue" i]', '[class*="single-value" i]', '[class*="multivalue" i]', '[class*="multi-value" i]',
    '[class*="chip" i]', '[data-automation-id="selectedItem"]',
  ].join(', ');
  for (const widget of doc.querySelectorAll(widgetValues)) {
    // A chip's label inside the chip is the same value: the outermost match redacts it once.
    if (widget.parentElement?.closest(widgetValues)) continue;
    // Every text node becomes REDACTED rather than empty, so no box collapses and visibility stays as it was.
    const walker = doc.createTreeWalker(widget, 4 /* NodeFilter.SHOW_TEXT */);
    let changed = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim() || node.parentElement?.closest('[role="listbox"], [role="option"], style')) continue;
      node.nodeValue = redacted;
      changed = true;
    }
    if (changed) counts.widgetText += 1;
  }

  // Emails, phone numbers and the listed strings, in text, comments and attributes.
  const listed = input.redact.map((source) => new RegExp(source, 'gi'));
  const email = new RegExp(input.email, 'g');
  const notEmail = new RegExp(input.notEmail, 'i');
  const phone = new RegExp(input.phone, 'g');
  /** @param {string} match */
  const phoneDigitsOk = (match) => {
    const digits = match.replace(/\D/g, '').length;
    const min = match.trimStart().startsWith('+') ? input.phoneDigits.minWithPlus : input.phoneDigits.min;
    return digits >= min && digits <= input.phoneDigits.max;
  };
  /** @param {string} text @param {boolean} phones */
  const scrub = (text, phones) => {
    let out = text;
    for (const pattern of listed) {
      out = out.replace(pattern, () => {
        counts.listed += 1;
        return redacted;
      });
    }
    out = out.replace(email, (match) => {
      if (notEmail.test(match)) return match;
      counts.emails += 1;
      found.add(match);
      return redacted;
    });
    if (phones) {
      out = out.replace(phone, (match) => {
        if (!phoneDigitsOk(match)) return match;
        counts.phones += 1;
        found.add(match.trim());
        return redacted;
      });
    }
    return out;
  };
  const walker = doc.createTreeWalker(doc, 4 | 128 /* NodeFilter.SHOW_TEXT | SHOW_COMMENT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3 && node.parentElement?.closest('style')) continue;
    const value = node.nodeValue ?? '';
    const clean = scrub(value, true);
    if (clean !== value) node.nodeValue = clean;
  }
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^\s*data:/i.test(attribute.value)) continue;
      const name = attribute.name.toLowerCase();
      const lowerValue = attribute.value.trim().toLowerCase();
      const phones = input.phoneAttributes.includes(name) || name.startsWith('data-') ||
        (name === 'href' && (lowerValue.startsWith('tel:') || lowerValue.startsWith('sms:')));
      const clean = scrub(attribute.value, phones);
      if (clean !== attribute.value) element.setAttribute(attribute.name, clean);
    }
  }

  // The fixture is written as UTF-8.
  const head = doc.head ?? doc.documentElement.insertBefore(doc.createElement('head'), doc.body);
  for (const meta of doc.querySelectorAll('meta[charset]')) meta.remove();
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  head.prepend(charset);

  // Long random-looking strings that survived, for a person to look at.
  const ignored = new Set(['class', 'style', 'id', 'for', 'name', 'd', 'points', 'viewbox', 'transform', 'srcset',
    'aria-describedby', 'aria-labelledby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-errormessage',
    'headers', 'list', 'form']);
  /** @type {Map<string, string>} */
  const tokens = new Map();
  /** @param {string} text @param {string} where */
  const collect = (text, where) => {
    for (const match of text.matchAll(/[A-Za-z0-9+/_=.~-]{24,}/g)) {
      const token = match[0];
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) continue;
      const digits = token.replace(/\D/g, '').length;
      const letters = token.replace(/[^A-Za-z]/g, '').length;
      if (digits < 2 || letters < 2 || new Set(token).size < 10 || /^https?:/i.test(token)) continue;
      if (!tokens.has(token)) tokens.set(token, where);
    }
  };
  const tokenWalker = doc.createTreeWalker(doc, 4 | 128);
  for (let node = tokenWalker.nextNode(); node; node = tokenWalker.nextNode()) {
    if (node.parentElement?.closest('style')) continue;
    collect(node.nodeValue ?? '', node.nodeType === 8 ? 'comment' : `text in <${node.parentElement?.localName ?? '?'}>`);
  }
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (ignored.has(name) || /^\s*data:/i.test(attribute.value)) continue;
      // In an address only the query and fragment can carry a token; its path is the site's own.
      const isUrl = urlAttributes.includes(name) || /^\s*(?:https?:)?\/\//i.test(attribute.value);
      const value = isUrl ? attribute.value.replace(/^[^?#]*/, '').split(/[?&=#]/).join(' ') : attribute.value;
      collect(value, `${attribute.name} on <${element.localName}>`);
    }
  }

  return { counts, found: [...found], tokens: [...tokens].map(([token, where]) => ({ token, where })), notes,
    linkedFrames };
}

/** The frame's document as text: its doctype, if it had one, then the root element. @returns {string} */
export function serializeInPage() {
  const doc = globalThis.document;
  const type = doc.doctype;
  let doctype = '';
  if (type) {
    const ids = type.publicId ? ` PUBLIC "${type.publicId}"${type.systemId ? ` "${type.systemId}"` : ''}`
      : type.systemId ? ` SYSTEM "${type.systemId}"` : '';
    doctype = `<!DOCTYPE ${type.name}${ids}>`;
  }
  return JSON.stringify({ doctype, html: doc.documentElement.outerHTML });
}

/**
 * Searches the loaded fixture the way the redaction did: text, comments and attributes, for emails, phone numbers and
 * the listed strings. Returns how many of each it found, never the values.
 * @param {{ redact: string[]; email: string; notEmail: string; phone: string;
 *   phoneDigits: { min: number; minWithPlus: number; max: number }; phoneAttributes: string[]; found: string[] }} input
 */
export function rescanInPage(input) {
  const doc = globalThis.document;
  const listed = input.redact.map((source) => new RegExp(source, 'i'));
  const email = new RegExp(input.email, 'g');
  const notEmail = new RegExp(input.notEmail, 'i');
  const phone = new RegExp(input.phone, 'g');
  const foundEmails = input.found.filter((text) => text.includes('@')).map((text) => text.toLowerCase());
  const foundPhones = input.found.filter((text) => !text.includes('@'));
  const hits = { emails: 0, phones: 0, listed: 0, found: 0 };
  /** @param {string} text @param {boolean} phones */
  const check = (text, phones) => {
    if (listed.some((pattern) => pattern.test(text))) hits.listed += 1;
    const lower = text.toLowerCase();
    if (foundEmails.some((value) => lower.includes(value)) || (phones && foundPhones.some((value) => text.includes(value)))) {
      hits.found += 1;
    }
    for (const match of text.matchAll(email)) if (!notEmail.test(match[0])) hits.emails += 1;
    if (!phones) return;
    for (const match of text.matchAll(phone)) {
      const digits = match[0].replace(/\D/g, '').length;
      const min = match[0].trimStart().startsWith('+') ? input.phoneDigits.minWithPlus : input.phoneDigits.min;
      if (digits >= min && digits <= input.phoneDigits.max) hits.phones += 1;
    }
  };
  const walker = doc.createTreeWalker(doc, 4 | 128);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3 && node.parentElement?.closest('style')) continue;
    check(node.nodeValue ?? '', true);
  }
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^\s*data:/i.test(attribute.value)) continue;
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      check(attribute.value, input.phoneAttributes.includes(name) || name.startsWith('data-') ||
        (name === 'href' && (value.startsWith('tel:') || value.startsWith('sms:'))));
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------------------------------
// The checks on the written text
// ---------------------------------------------------------------------------------------------------------------------

/** Decodes the HTML entities a serializer writes (named basics and numeric). @param {string} text */
function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    const lower = String(name).toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return /** @type {Record<string, string>} */ (named)[lower] ?? match;
  });
}

/** Percent-decodes every %XX run that decodes as UTF-8, leaving the rest. @param {string} text */
function decodePercents(text) {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * The written text as the final check reads it: base64 payloads and the inlined stylesheets (page assets, not page
 * text) masked out, then the text as written, with entities decoded, and percent-decoded, all in lower case.
 * @param {string} text @returns {string[]}
 */
export function checkedForms(text) {
  const masked = text
    .replace(/(data:[^,"'\s)]*;base64,)[A-Za-z0-9+/=\s]+/gi, '$1')
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, '$1$2');
  const entities = decodeEntities(masked);
  return [masked, entities, decodePercents(entities)].map((form) => form.toLowerCase());
}

// ---------------------------------------------------------------------------------------------------------------------
// The conversion
// ---------------------------------------------------------------------------------------------------------------------

/** The URL without its fragment, as a request carries it. @param {string} url */
const withoutFragment = (url) => {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.href;
};

/** Whether an address is on a host the extension runs on (https only, as the manifest matches). @param {string} url */
export function onAtsHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ATS_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** A JSON value that can sit inside an HTML comment: "--" never appears. @param {unknown} value */
const commentJson = (value) => JSON.stringify(value).replace(/--/g, '-\\u002d');

/**
 * @typedef {{ path: string; text: string }} OutputFile
 * @typedef {{ files: OutputFile[]; routes: Record<string, string>; chrome: string; tokens: Array<{ token: string;
 *   where: string; file: string }>; notes: string[]; counts: Record<string, Record<string, number>> }} Conversion
 */

/**
 * Converts a capture into fixture files, in memory: nothing is written. Throws a ConversionError, naming each failed
 * check, when the result would leak a listed string, an email or a phone number, when it would make a request, or when
 * visibility changed.
 * @param {{ file: string; platform: string; caseName: string; redact?: string[]; outDir?: string }} options
 * @returns {Promise<Conversion>}
 */
export async function convertMhtml({ file, platform, caseName, redact = [], outDir = join(ROOT, 'fixtures') }) {
  if (!FIXTURE_PLATFORMS.includes(platform)) fail(`--platform must be one of ${FIXTURE_PLATFORMS.join(', ')}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(caseName)) fail('--case must be lower-case words joined by hyphens');
  if (!/\.mht(?:ml)?$/i.test(file)) fail('the capture must be an .mhtml file');
  const mhtml = parseMhtml(readFileSync(file));
  const htmlParts = mhtml.parts.filter((part) => part.contentType === 'text/html');
  const main = htmlParts[0];
  const mainUrl = main?.location ?? mhtml.snapshotUrl;
  if (!main || !mainUrl || !/^https?:/i.test(mainUrl)) fail('the capture names no web address for its page');
  const captured = mhtml.date && !Number.isNaN(Date.parse(mhtml.date)) ? new Date(mhtml.date).toISOString() : null;

  const folder = join(outDir, platform);
  /** The path a route map gives for a file: repo-relative with forward slashes, or absolute outside the repo. */
  const routePath = (/** @type {string} */ path) => {
    const rel = relative(ROOT, path);
    return rel.startsWith('..') || isAbsolute(rel) ? path.split('\\').join('/') : rel.split('\\').join('/');
  };

  // cid: address of each archived frame -> its own URL (fragment kept), or null without a web address.
  /** @type {Record<string, string | null>} */
  const frameUrls = {};
  for (const part of htmlParts.slice(1)) {
    if (part.contentId) frameUrls[part.contentId] = part.location && /^https?:/i.test(part.location) ? part.location : null;
  }
  const resources = resourcesOf(mhtml);
  const patterns = { redact: redactSources(redact), email: EMAIL_SOURCE, notEmail: NOT_EMAIL_SOURCE, phone: PHONE_SOURCE,
    phoneDigits: PHONE_DIGITS, phoneAttributes: PHONE_ATTRIBUTES };

  const browser = await chromium.launch({ headless: true });
  try {
    const chrome = browser.version();
    // The capture renders from its own parts, without the page's CSP (the fixture drops it, and a CSP meta would block
    // the archive's own cid: sheets and frames); nothing may reach the network.
    const context = await browser.newContext({ javaScriptEnabled: false, bypassCSP: true, viewport: VIEWPORT });
    await context.route(/^https?:/i, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(pathToFileURL(resolve(file)).href, { waitUntil: 'load' });

    // The frames to convert: the page, and each frame on an ATS host inside a converted frame.
    /** @type {Array<{ frame: import('playwright').Frame; url: string; path: string }>} */
    const converted = [{ frame: page.mainFrame(), url: mainUrl, path: join(folder, `${caseName}.html`) }];
    for (let index = 0; index < converted.length; index += 1) {
      const parent = converted[index];
      if (!parent) break;
      for (const child of parent.frame.childFrames()) {
        const url = frameUrls[child.url()] ?? null;
        if (url !== null && onAtsHost(url)) {
          converted.push({ frame: child, url, path: join(folder, `${caseName}.frame-${converted.length}.html`) });
        }
      }
    }

    /** @type {Conversion} */
    const result = { files: [], routes: {}, chrome, tokens: [], notes: [], counts: {} };
    /** @type {string[]} */
    const reasons = [];
    /** Every third-party frame a converted frame links to: each is answered by the stand-in page. */
    /** @type {Set<string>} */
    const thirdParty = new Set();
    /** @type {string[][]} */
    const before = [];
    for (const { frame } of converted) before.push(await frame.evaluate(measureInPage));

    /** @type {Set<string>} */
    const found = new Set();
    const thirdPartyPath = join(folder, `${caseName}.third-party-frame.html`);
    for (const [index, { frame, url, path }] of converted.entries()) {
      const outcome = await frame.evaluate(transformInPage, { resources, frameUrls, frameUrl: url, redacted: REDACTED,
        ...patterns });
      if (outcome.counts.shadowRoots > 0) fail(`${basename(path)}: the page has shadow roots, which the converter cannot keep yet`);
      for (const link of outcome.linkedFrames) {
        if (!onAtsHost(link)) thirdParty.add(link);
        else if (!converted.some((entry) => entry.url === link)) {
          reasons.push(`${basename(path)}: its frame on ${new URL(link).host} did not render from the capture, so it could not be converted`);
        }
      }
      for (const value of outcome.found) found.add(value);
      result.notes.push(...outcome.notes.map((note) => `${basename(path)}: ${note}`));
      const serialized = JSON.parse(await frame.evaluate(serializeInPage));
      const { doctype } = serialized;
      const normalised = platform === 'ashby' ? normaliseAshby(serialized.html) : null;
      const html = normalised?.text ?? serialized.html;
      // A token the normalisation replaced (a render id, the CSP nonce) is gone from the files: it is not listed.
      result.tokens.push(...outcome.tokens.filter(({ token }) => normalised === null
        || !normalised.renderIds.some((id) => token.includes(id)) && !(normalised.nonces > 0 && !html.includes(token)))
        .map((token) => ({ ...token, file: basename(path) })));
      const { counts } = outcome;
      const header = {
        fixture: `${platform}/${basename(path, '.html')}`,
        source: url,
        captured,
        chrome,
        redacted: { typedValues: counts.typedValues, checked: counts.checked, selected: counts.selected,
          hiddenValues: counts.hiddenValues, widgetText: counts.widgetText, emails: counts.emails, phones: counts.phones,
          listed: counts.listed },
        removed: { scripts: counts.scripts, eventHandlers: counts.eventHandlers, javascriptUrls: counts.javascriptUrls,
          bases: counts.bases, metaRefresh: counts.metaRefresh, metaHttpEquiv: counts.metaHttpEquiv,
          embeds: counts.embeds, links: counts.links, srcdoc: counts.srcdoc },
        inlined: { stylesheets: counts.stylesheets, images: counts.images, placeholders: counts.placeholders,
          missing: counts.missing },
        frames: { linked: counts.frames, blanked: counts.framesDropped },
        forms: counts.forms,
        ...(normalised === null ? {} : { normalised: { renderIds: normalised.renderIds.length, nonces: normalised.nonces } }),
      };
      result.counts[basename(path)] = { ...counts };
      const comment = `<!-- TailorIT fixture, converted by scripts/mhtml-to-fixture.mjs: convert the capture again ` +
        `rather than editing it.\n${commentJson(header)} -->`;
      // LF line ends throughout: HTML parsing treats CR LF as LF anyway, and git stores the fixture with LF.
      result.files.push({ path, text: `${doctype ? `${doctype}\n` : ''}${comment}\n${html.replace(/\r\n?/g, '\n')}\n` });
      if (index > 0 && withoutFragment(url) in result.routes) {
        result.notes.push(`${basename(path)}: another frame has the same address, so the route map serves the first`);
      } else {
        result.routes[withoutFragment(url)] = routePath(path);
      }
    }
    if (thirdParty.size > 0) {
      const header = { fixture: `${platform}/${caseName}.third-party-frame`, source: 'a stand-in for third-party frames',
        captured, chrome, hosts: [...new Set([...thirdParty].map((url) => new URL(url).hostname))].sort() };
      result.files.push({ path: thirdPartyPath, text: `<!DOCTYPE html>\n<!-- TailorIT fixture: the extension never runs ` +
        `in a third-party frame, so its content is not kept.\n${commentJson(header)} -->\n<html><head><meta ` +
        `charset="utf-8"><title>Third-party frame</title></head><body></body></html>\n` });
      for (const url of thirdParty) {
        const key = withoutFragment(url);
        if (!(key in result.routes)) result.routes[key] = routePath(thirdPartyPath);
      }
    }
    await context.close();

    // Reload the result as the e2e harness serves it, JavaScript on, and check it.
    const served = new Map(Object.entries(result.routes).map(([url, path]) => [url,
      result.files.find((output) => routePath(output.path) === path)?.text ?? '']));
    const check = await browser.newContext({ viewport: VIEWPORT });
    /** @type {string[]} */
    const requests = [];
    await check.route('**/*', (route) => {
      const url = route.request().url();
      const body = served.get(url);
      if (body !== undefined) return route.fulfill({ status: 200, contentType: 'text/html', body });
      // The browser asks for a favicon on its own, as the e2e harness also allows.
      if (!url.startsWith('data:') && new URL(url).pathname !== '/favicon.ico') requests.push(url);
      return route.abort();
    });
    const reloaded = await check.newPage();
    await reloaded.goto(withoutFragment(mainUrl), { waitUntil: 'load' });
    for (const [index, { url, path }] of converted.entries()) {
      const frame = index === 0 ? reloaded.mainFrame()
        : reloaded.frames().find((candidate) => withoutFragment(candidate.url()) === withoutFragment(url));
      if (!frame) {
        reasons.push(`${basename(path)}: the frame did not load from the route map`);
        continue;
      }
      const after = await frame.evaluate(measureInPage);
      const was = before[index] ?? [];
      result.notes.push(`${basename(path)}: visibility compared for ${was.length} elements ` +
        `(${was.filter((state) => state.endsWith('+')).length} shown)`);
      if (after.length !== was.length) {
        reasons.push(`${basename(path)}: ${was.length} elements before conversion, ${after.length} after`);
      } else {
        const changed = after.flatMap((state, at) => (state === was[at] ? [] : [`#${at} ${was[at]} -> ${state}`]));
        if (changed.length > 0) reasons.push(`${basename(path)}: visibility changed for ${changed.length} elements (${changed.slice(0, 5).join(', ')})`);
      }
      const hits = await frame.evaluate(rescanInPage, { ...patterns, found: [...found] });
      for (const [kind, count] of Object.entries(hits)) {
        if (count > 0) reasons.push(`${basename(path)}: ${count} ${kind === 'found' ? 'redacted values' : kind} still in the page`);
      }
    }
    await check.close();
    if (requests.length > 0) reasons.push(`the fixture requests ${requests.length} addresses the route map does not answer: ${[...new Set(requests.map((url) => new URL(url).host))].join(', ')}`);

    // The written text itself, with encodings undone: no listed string and no found email may remain.
    const needles = [...redact.map((entry, index) => ({ label: `redact entry ${index + 1}`, pattern: new RegExp(redactSources([entry])[0] ?? '', 'i') })),
      ...[...found].filter((value) => value.includes('@')).map((value) => ({ label: 'a redacted email', pattern: new RegExp(escapeRegExp(value), 'i') }))];
    for (const output of [...result.files, { path: join(folder, `${caseName}.routes.json`), text: JSON.stringify(result.routes) }]) {
      const forms = checkedForms(output.text);
      for (const { label, pattern } of needles) {
        if (forms.some((form) => pattern.test(form))) reasons.push(`${basename(output.path)}: ${label} is still in the file`);
      }
    }
    if (reasons.length > 0) throw new ConversionError(reasons);
    return result;
  } finally {
    await browser.close();
  }
}

/**
 * Writes a conversion: its files, then the route map, replacing an earlier conversion of the same case.
 * @param {Conversion} conversion @param {string} folder @param {string} caseName @returns {string[]}
 */
export function writeConversion(conversion, folder, caseName) {
  mkdirSync(folder, { recursive: true });
  for (const name of readdirSync(folder)) {
    if (name.startsWith(`${caseName}.frame-`) || name === `${caseName}.third-party-frame.html`) rmSync(join(folder, name));
  }
  const written = [];
  for (const output of conversion.files) {
    writeFileSync(output.path, output.text, 'utf8');
    written.push(output.path);
  }
  const routes = join(folder, `${caseName}.routes.json`);
  writeFileSync(routes, `${JSON.stringify(conversion.routes, null, 2)}\n`, 'utf8');
  written.push(routes);
  return written;
}

// ---------------------------------------------------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const options = {};
  /** @type {string[]} */
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (['--platform', '--case', '--redact', '--out'].includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`);
      options[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith('--')) {
      fail(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1 || !options.platform || !options.case) {
    fail('usage: node scripts/mhtml-to-fixture.mjs <file.mhtml> --platform <platform> --case <name> [--redact <file>] [--out <folder>]');
  }
  return { file: positional[0] ?? '', platform: options.platform, caseName: options.case, redactFile: options.redact,
    outDir: options.out ? resolve(options.out) : join(ROOT, 'fixtures') };
}

async function main() {
  try {
    const { file, platform, caseName, redactFile, outDir } = parseArgs(process.argv.slice(2));
    if (!existsSync(file)) fail(`${file} does not exist`);
    if (redactFile !== undefined && !existsSync(redactFile)) fail(`${redactFile} does not exist`);
    const redact = redactFile === undefined ? [] : readRedactList(readFileSync(redactFile, 'utf8'));
    const conversion = await convertMhtml({ file, platform, caseName, redact, outDir });
    const written = writeConversion(conversion, join(outDir, platform), caseName);
    console.log(paint('green', `✓ ${basename(file)} -> ${platform}/${caseName} (Chromium ${conversion.chrome})`));
    for (const path of written) {
      console.log(`  ${relative(ROOT, path).split('\\').join('/')}  ${(statSync(path).size / 1024).toFixed(1)} KiB`);
    }
    for (const [name, counts] of Object.entries(conversion.counts)) {
      const shown = Object.entries(counts).filter(([, count]) => count > 0).map(([key, count]) => `${key} ${count}`);
      console.log(paint('gray', `  ${name}: ${shown.join(', ')}`));
    }
    for (const note of conversion.notes) console.log(paint('yellow', `  note: ${note}`));
    if (conversion.tokens.length > 0) {
      console.log(paint('yellow', `  ${conversion.tokens.length} suspicious tokens left; add any that is personal to a redact file:`));
      for (const { token, where, file: name } of conversion.tokens.slice(0, 60)) {
        console.log(`    ${token.length > 72 ? `${token.slice(0, 72)}…` : token}  (${name}, ${where})`);
      }
      if (conversion.tokens.length > 60) console.log(`    … and ${conversion.tokens.length - 60} more`);
    }
  } catch (error) {
    const reasons = error instanceof ConversionError ? error.reasons : [String(error instanceof Error ? error.stack : error)];
    console.error(paint('red', '✗ mhtml-to-fixture: nothing was written'));
    for (const reason of reasons) console.error(paint('red', `  ${reason}`));
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
