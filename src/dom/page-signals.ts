/*
 * What a company's own page says of itself (v3 Phase 8, docs/SPEC-AMENDMENTS.md §12 Decision 13): read by the
 * sentinel (src/sentinel/recognise.ts) to recognise the page, and by the application-form score (form-score.ts), which
 * the sentinel and the site adapter share, for the page's job context. Everything here reads the document and its
 * address and writes nothing; it imports only the host list, so the sentinel's bundle stays small.
 * - Every read of a page's text is bounded (textOf: a few text nodes, TEXT_CAP characters, never a whole subtree's
 *   textContent), and so is every list of elements read (MAX_ELEMENTS) and the JSON-LD read (JSON_LD_BLOCKS blocks of
 *   JSON_LD_CHARS characters at most, read as text for a JobPosting's @type, never parsed): a page cannot make a reading
 *   cost more than a long form does (the Phase 8 review, P2).
 * - The job signals: the address names an embedded posting (ats-param); a company's own careers site, by host and path
 *   (career-site); a career-site platform's fingerprint (platform); JSON-LD naming a JobPosting (job-posting).
 * - The job words (round 2 of the Phase 8 review, J1). In the page's address (its host's labels, its path's segments:
 *   addressNamesAJob) only the unambiguous ones: careers, jobs, job, vacancy, vacancies, requisition, recruiting,
 *   recruitment; never its title or a heading anywhere on the page (a footer's "Careers", an article "on hiring
 *   engineers"). In a container's own legend, headings and buttons, or the heading just above it (containerNamesAJob),
 *   those, a résumé or CV, and the ambiguous words only in a phrase that names a job: a talent community, network or pool;
 *   we're or now hiring; a candidate profile; an application for the position; open positions; an employment
 *   application ("Hire top talent", "Meet the candidates", "an employment verification", "the positions workshop" name
 *   none). "Apply" and "application" alone never count: a loan, a rental and a credit card have applications too
 *   (the Phase 8 review, B1).
 * - An embedded applicant-tracking system (an ATS's frame or its loader): its own frame serves the form, so the page
 *   around it claims none (B3). A payment frame (a card's fields, served by a payment provider) rules the page out (P5).
 */
import { careerSiteOf, onAtsMatch } from '../shared/hosts';

/** The query parameters an ATS embed's host page carries; gh_jid and ashby_jid name the posting itself. */
export const ATS_PARAMS = ['gh_jid', 'ashby_jid', 'gh_src', 'LeverAppId'] as const;
/** The embed loaders' scripts. */
const LOADER = /^https:\/\/(?:(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/embed\/job_board\/js|jobs\.ashbyhq\.com\/[^/?#]+\/embed)/i;
/** The most elements of one kind read (frames, scripts, headings). */
export const MAX_ELEMENTS = 50;
/** The most characters of an element's text read. */
export const TEXT_CAP = 300;
/** The most text nodes one bounded read visits. */
const TEXT_NODES = 64;
/** The most JSON-LD blocks parsed, and the most characters of one. */
export const JSON_LD_BLOCKS = 4;
export const JSON_LD_CHARS = 64_000;

/** The words that name a job wherever they stand (the module header). */
const JOB_WORDS = /\b(?:careers?|jobs?|vacanc(?:y|ies)|requisitions?|recruit(?:ing|ment))\b/i;
/** The ambiguous words, only in a phrase that names a job (the module header), read in a container alone (its text's
 *  whitespace collapsed by textOf). */
const JOB_PHRASES = /talent (?:community|network|pool)|join our talent|(?:we['’]?re|we are|now) hiring|candidate (?:profile|information|portal)|for (?:the|this) (?:position|role)|position applied|(?:open|current) (?:positions|openings)|employment application|for employment/i;
/** A résumé or CV named as such: the accented word, "CV" or "curriculum vitae", or "resume" where it is a noun (after
 *  upload, attach, drop, your..., or as "resume/CV"); never the verb ("uploads pause and resume"). */
export const RESUME_NOUN = /(?:^|[^\p{L}])(?:r(?:ésumé|esumé|ésume)s?|cv|curriculum vitae)(?![\p{L}])|\b(?:upload|attach|add|drop|select|choose|submit|send|your|my)\b[^.!?]{0,30}?\bresumes?\b|\bresumes?\s*(?:\/|or|and|&)\s*(?:cv|cover letters?)\b/iu;

/** An element's (or a shadow root's) text, bounded: at most TEXT_NODES text nodes and `cap` characters once its
 *  whitespace is collapsed, each node read only as far as needed (never a whole subtree's textContent). A text longer
 *  than `cap` comes back `cap` long, so a caller can tell it was cut. */
export function textOf(node: Node | null | undefined, cap = TEXT_CAP): string {
  if (node === null || node === undefined) return '';
  const doc = node.ownerDocument ?? (node as Document);
  // 4: NodeFilter.SHOW_TEXT.
  const walker = doc.createTreeWalker(node, 4);
  let out = '';
  for (let visited = 0, at = walker.nextNode(); at !== null && out.length <= cap && visited < TEXT_NODES;
    visited += 1, at = walker.nextNode()) {
    const data = at as CharacterData;
    // Enough of the node for what is left, its whitespace collapsed.
    const want = (cap + 1 - out.length) * 4 + 16;
    out = `${out}${data.substringData(0, Math.min(data.length, want))}`.replace(/\s+/g, ' ');
  }
  return out.trim().slice(0, cap);
}

/** An attribute's value, its first `cap` characters, in lower case where asked ('' when absent). */
export function attr(el: Element, name: string, cap = 300): string {
  return (el.getAttribute(name) ?? '').slice(0, cap);
}

/** The address, or null when it does not read. */
export function urlOf(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/** An element's address attribute read as an absolute address against the document, or ''. */
function addressOf(el: Element, attribute: string): string {
  const raw = el.getAttribute(attribute);
  if (raw === null || raw.trim() === '') return '';
  try {
    return new URL(raw, el.ownerDocument.baseURI).href;
  } catch {
    return '';
  }
}

/** Whether one of the first MAX_ELEMENTS elements `selector` finds passes `test`. */
function some(doc: Document, selector: string, test: (el: Element) => boolean): boolean {
  const found = doc.querySelectorAll(selector);
  for (let index = 0; index < found.length && index < MAX_ELEMENTS; index += 1) {
    if (test(found[index]!)) return true;
  }
  return false;
}

/** Whether the address names an embedded posting (an ATS embed's host page). */
export function atsParam(url: URL): boolean {
  return ATS_PARAMS.some((name) => url.searchParams.has(name));
}

/** Whether a frame of the page is on an applicant-tracking host (one the static content script runs on: ATS_MATCHES),
 *  or an ATS's embed loader is on it (Greenhouse's job_board script or #grnhse_app, Ashby's embed): the ATS's own frame
 *  serves its form (B3). */
export function embedsAts(doc: Document): boolean {
  if (some(doc, 'iframe[src], frame[src]', (frame) => onAtsMatch(addressOf(frame, 'src')))) return true;
  return doc.querySelector('#grnhse_app, #ashby_embed') !== null
    || some(doc, 'script[src]', (script) => LOADER.test(addressOf(script, 'src')));
}

/** The payment providers whose frames hold a card's fields, by their host's name (Stripe, Braintree, PayPal, Adyen,
 *  Square, Checkout.com, Shopify's card fields, Authorize.net, Recurly, Chargebee, Worldpay, Klarna, Affirm, Paddle,
 *  CyberSource, Mollie), and a frame titled for a card or a payment. */
const PAYMENT_HOSTS = /^https:\/\/[^/?#]*(?:stripe|braintree|paypal|adyen|square|checkout\.com|shopifycs|authorize\.net|recurly|chargebee|worldpay|klarna|affirm|paddle|cybersource|mollie)/i;
const PAYMENT_TITLE = /\b(?:card|payment|cvv|cvc)\b|^__privateStripeFrame/i;

/** Whether the page holds a payment frame (a card's fields): its form is a checkout, never an application (P5). */
export function paymentFrame(doc: Document): boolean {
  return some(doc, 'iframe', (frame) => PAYMENT_HOSTS.test(addressOf(frame, 'src'))
    || PAYMENT_TITLE.test(attr(frame, 'name')) || PAYMENT_TITLE.test(attr(frame, 'title')));
}

/** A career-site platform's fingerprint (the capture of 2026-11-04: Intuit's Avature, Adobe's and Cisco's Phenom,
 *  Intuit's TalentBrew, Netflix's Eightfold). */
export function platformFingerprint(doc: Document): boolean {
  if (doc.querySelector('meta[name^="avature.portal" i], [data-ph-id], #EightfoldBranding, [class*="eightfold-"]') !== null) {
    return true;
  }
  return some(doc, 'script[src], link[href]', (el) => /^https:\/\/[^/]*(?:phenompeople\.com|talentbrew\.com|eightfold\.ai)\//i
    .test(addressOf(el, el.tagName === 'LINK' ? 'href' : 'src')));
}

/** A JSON-LD @type naming a JobPosting, alone or in a list of types; read as text, never parsed. */
const JOB_POSTING_TYPE = /"@type"\s*:\s*(?:\[[^\]]{0,200}?)?"JobPosting"/;

/** The length of an element's text, read from its text nodes' lengths (nothing copied). */
function lengthOf(el: Element): number {
  let length = 0;
  for (let child = el.firstChild; child !== null; child = child.nextSibling) {
    if (child.nodeType === 3) length += (child as CharacterData).length;
  }
  return length;
}

/** Whether the page's JSON-LD names a JobPosting (an @type, anywhere in a block, an @graph's included): the first
 *  JSON_LD_BLOCKS blocks, each of JSON_LD_CHARS at most (a longer one is passed over unread), read as text and never
 *  parsed. Read to recognise the page, and for nothing else: never sent. */
export function jobPosting(doc: Document): boolean {
  const scripts = doc.querySelectorAll('script[type="application/ld+json" i]');
  for (let index = 0; index < scripts.length && index < JSON_LD_BLOCKS; index += 1) {
    const script = scripts[index]!;
    if (lengthOf(script) <= JSON_LD_CHARS && JOB_POSTING_TYPE.test(script.textContent ?? '')) return true;
  }
  return false;
}

/** The job signals a page is recognised by (the module header), but the score's. */
export type JobSignal = 'career-site' | 'platform' | 'job-posting';

/** The first job signal the page shows, in this order: its address a career site's, a platform's fingerprint, a
 *  JobPosting in its JSON-LD; or null. */
export function jobSignalOf(doc: Document, url: URL): JobSignal | null {
  if (careerSiteOf(url.href) !== null) return 'career-site';
  if (platformFingerprint(doc)) return 'platform';
  if (jobPosting(doc)) return 'job-posting';
  return null;
}

/** Whether the page's address names a job (the module header): a label of its host or a segment of its path. */
export function addressNamesAJob(url: URL | null): boolean {
  if (url === null) return false;
  if (JOB_WORDS.test(url.hostname.split('.').join(' '))) return true;
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // The path as written.
  }
  return JOB_WORDS.test(path.replace(/[/_.+-]+/g, ' '));
}

/** The headings a container is read by: its own (legends, headings, the role=heading) and the one just above it. */
const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role=heading i]';

/** The heading just above an element: its nearest previous sibling (or a previous sibling's last heading) that is one,
 *  climbing a few levels; null when none is near. */
function headingAbove(el: Element): Element | null {
  let at: Element | null = el;
  for (let level = 0; at !== null && level < 6 && at.tagName !== 'BODY'; level += 1, at = at.parentElement) {
    let sibling = at.previousElementSibling;
    for (let step = 0; sibling !== null && step < 8; step += 1, sibling = sibling.previousElementSibling) {
      if (sibling.matches(HEADINGS)) return sibling;
      const inner = sibling.querySelectorAll(HEADINGS);
      if (inner.length > 0) return inner[inner.length - 1]!;
    }
  }
  return null;
}

/** Whether a container names a job (the module header): its own legend, headings and buttons, or the heading just above
 *  it, name one (a job word, a résumé or CV, or a job's phrase: "Join our talent community"). */
export function containerNamesAJob(container: Element): boolean {
  const names = (text: string) => JOB_WORDS.test(text) || RESUME_NOUN.test(text) || JOB_PHRASES.test(text);
  const own = container.querySelectorAll(`legend, ${HEADINGS}, button, input[type=submit i]`);
  for (let index = 0; index < own.length && index < 20; index += 1) {
    const el = own[index]!;
    if (names(el.tagName === 'INPUT' ? attr(el, 'value', 120) : textOf(el, 120))) return true;
  }
  return names(textOf(headingAbove(container), 120));
}

/** The most added nodes of one batch of mutations addsFormParts looks at, and the most elements it walks in them: past
 *  either, the batch asks for a reading at once (rate-limited as any is) rather than walk on (round 2 of the Phase 8
 *  review, M1: a page moving a huge subtree costs the mutation's own task nothing more). */
export const LOOK_NODES = 200;
export const LOOK_ELEMENTS = 1000;
/** The elements that make a reading worth its cost. */
const FORM_TAGS = new Set(['form', 'input', 'textarea', 'select']);

/** Whether an element is a form's part: a form or a control, JSON-LD, or a shadow host. */
function formPart(el: Element): boolean {
  return FORM_TAGS.has(el.localName) || el.shadowRoot !== null
    || (el.localName === 'script' && /^application\/ld\+json$/i.test(attr(el, 'type')));
}

/** Whether a batch of mutations added a form, a control or JSON-LD, or a shadow host, or more than it looks at (module
 *  constants above): read by tag and attribute alone, never text or layout, walking at most LOOK_ELEMENTS elements in all
 *  (the Phase 8 review, B5, P2 and M1). The sentinel's watch and the site runtime's (content/late-form.ts
 *  watchForSiteForm) read a page again only then. */
export function addsFormParts(records: readonly MutationRecord[]): boolean {
  let seen = 0;
  let walked = 0;
  for (const record of records) {
    const added = record.addedNodes;
    for (let index = 0; index < added.length; index += 1) {
      seen += 1;
      if (seen > LOOK_NODES) return true;
      const node = added[index]!;
      if (node.nodeType !== 1) continue;
      // 1: NodeFilter.SHOW_ELEMENT.
      const walker = node.ownerDocument!.createTreeWalker(node, 1);
      for (let at: Node | null = node; at !== null; at = walker.nextNode()) {
        walked += 1;
        if (walked > LOOK_ELEMENTS || formPart(at as Element)) return true;
      }
    }
  }
  return false;
}
