/*
 * The application-form score (v3 Phase 8, docs/SPEC-AMENDMENTS.md §12 Decision 13): whether a page that is no
 * applicant-tracking system's shows an application form. The sentinel reads it as its last recognition signal, and the
 * site adapter (src/adapters/site) claims a page by it, through one function (applicationFormOf, with the page's
 * address), so both say the same of a page. It is read from the page as a person sees it, writes nothing, and imports
 * only page-signals.ts, so the sentinel's bundle stays small.
 * - The containers: each form, and the controls outside any form together (scored against the body, or a shadow
 *   root's host), open shadow roots included (the scanner's traversal, bounded).
 * - A container is claimed (the Phase 8 review, B1, and its round 2, J1) when a person can see in it either:
 *   (a) a résumé or CV upload;
 *   (b) a name, an email and a phone box, all three, on a page about a job: a job signal of the page (an ATS's posting
 *   parameter, a career site's address, a career-site platform, a JobPosting) or a job word in its address (a host
 *   label or a path segment: page-signals.ts addressNamesAJob); never its title or a heading elsewhere on the page;
 *   (c) two of them in a container that itself names a job: its own legend, headings and buttons, or the heading just
 *   above it (page-signals.ts containerNamesAJob: "Join our talent community", "Send your CV").
 *   "Apply" and "application" never count: a contact, quote, checkout, booking, loan or comment form is never claimed.
 *   The words of the controls outside any form are read around them (their nearest common ancestor below the body).
 * - A résumé upload (B2): a file input whose own words (its name, id, labels) name a résumé or CV, or whose short
 *   surroundings (AROUND_CAP characters at most) name one as a noun ("Upload your resume", "Resume/CV"); a hidden file
 *   input counts only through a visible label, drop zone or button. A drop zone or upload button whose own short text
 *   names a résumé counts for its container when the page holds a file input (a Dropzone's input sits on the body).
 * - A search form (role=search, or a form whose action, id, name, label or class says search), a card payment (a
 *   card number, a CVV or CVC, autocomplete cc-*) and a comment form (its action, id, name, label or class says
 *   comment, as WordPress's #commentform and wp-comments-post do, or a textarea named or labelled "comment": J1) rule
 *   their container out, and a payment provider's frame rules the page out (P5). A password rules out only a sign-in
 *   (B9): the group around it (its nearest ancestor holding another control) without a résumé upload or a name and a
 *   phone; a sign-in box inside a page-wide form (ASP.NET) is passed over, and the rest of the form scored.
 * - A page embedding an applicant-tracking system (its frame or its loader) claims no form of its own: the ATS's frame
 *   serves its form (B3).
 * - Seen means rendered, at least MIN_CONTROL_PX square, on the page's canvas and at least MIN_OPACITY opaque (P4), and
 *   a label counts only when seen too; the site adapter adds the scanner's own visibility (`visible`).
 * - Every read is bounded (P2): MAX_CONTROLS controls, MAX_SCOPES shadow roots found among SHADOW_SCAN elements,
 *   bounded text reads (page-signals.ts textOf), each element's text read once; the words are read first, and only a
 *   control they name is measured.
 * Known limit: a form in a frame of the page's own origin is that frame's, which the top frame's sentinel does not read.
 */
import {
  addressNamesAJob, attr, atsParam, containerNamesAJob, embedsAts, jobSignalOf, paymentFrame, RESUME_NOUN, textOf,
  urlOf,
} from './page-signals';

/** What a container shows of an application form. */
export interface FormScore {
  container: Element;
  resume: boolean;
  name: boolean;
  email: boolean;
  phone: boolean;
  /** Where its job context comes from (read only when it shows two of name, email and phone and no résumé upload):
   *  the container's own words ('container', which takes two of the three), the page's signal or address ('page',
   *  which takes all three), or none (null). */
  job: 'container' | 'page' | null;
  /** Why it can never be an application form, or null. */
  ruledOut: 'password' | 'search' | 'card' | 'comment' | null;
}

export interface ScoreOptions {
  /** A job signal the caller read already (the sentinel: the address's ATS parameter alone, once no other held); read
   *  here when absent. */
  jobSignal?: boolean;
  /** The caller's own visibility, on top of the score's (the site adapter: the scanner's, camouflage included). */
  visible?: (el: Element) => boolean;
}

/** The most controls one reading looks at. */
export const MAX_CONTROLS = 400;
/** The most open shadow roots one reading looks into, and the most elements it walks to find them. */
const MAX_SCOPES = 16;
const SHADOW_SCAN = 20_000;
/** A control smaller than this either way is not one a person fills (P4). */
export const MIN_CONTROL_PX = 8;
/** A control fainter than this (its own opacity times its ancestors') is not one a person sees. */
const MIN_OPACITY = 0.1;
/** The most characters of a file input's surroundings read for a résumé (B2). */
export const AROUND_CAP = 160;
/** The most characters of one descriptive text read. */
const WORDS_CAP = 120;

const RESUME_WORD = /(?:^|[^\p{L}])(?:r[ée]sum[ée]s?|cv|curriculum vitae)(?![\p{L}])/iu;
const EMAIL = /\be[\s-]?mail/i;
const PHONE = /\b(?:(?:cell|mobile|tele)?phone(?:number)?|mobile(?:number)?|cell|tel)\b/i;
const NAME = /\b(?:(?:first|last|full|given|family|sur|middle|legal|preferred)\s*name|f\s?name|l\s?name|your name)\b/i;
/** A box named "Name" alone (name=name, a label "Name"): read per part of its words, so "Company name" is not. */
const PLAIN_NAME = /^(?:full\s*)?name\s*\*?$/i;
const NOT_A_PERSON = /\b(?:company|employer|school|user|file|business|organi[sz]ation|reference|referee|emergency|manager|recruiter|account)\b/i;
const USERNAME = /\b(?:user\s*(?:name|id)|username|login)\b/i;
const CARD = /\b(?:card\s*(?:number|no)|credit\s*card|cvv|cvc|cc\s?(?:number|num|csc|exp))\b/i;
const SEARCH = /\bsearch\b/i;
const COMMENT_FORM = /comment/i;
const COMMENT_LABEL = /^(?:(?:your|leave a|add a|post a) )?comment\W*$/i;
/** Input types that hold nothing of a person's. */
const NOT_A_FIELD = /^(?:hidden|submit|button|reset|image|checkbox|radio|search|range|color)$/;
/** A drop zone or an upload button, anywhere in a container (a Dropzone's input sits on the body). */
const DROP_ZONES = '[class*=drop i], [data-role=dropzone i], button, [role=button i]';
/** A wrapper of a hidden file input that is its drop zone or button: by its class, id or data-role, or its own text
 *  asking for a file. */
const UPLOAD_WRAPPER = /\b(?:drop|drag|upload|attach|file|browse|choose|select)/i;
/** The most characters of a button's own text that may name a résumé (a longer one is a banner's, not a button's). */
const BUTTON_CAP = 60;
/** How far above a hidden file input its labelled group (role=group, a fieldset) is looked for. */
const GROUP_LEVELS = 6;

type Kind = 'resume' | 'name' | 'email' | 'phone' | 'password' | 'card' | 'username';

/** One control as the score reads it. */
interface Read {
  el: Element;
  kind: Kind;
}

/** One reading's memory: each element's text read once, each tree's labels listed once. */
interface Reading {
  texts: Map<Node, string>;
  labels: Map<Node, Map<string, Element[]>>;
  visible: (el: Element) => boolean;
}

/** An element's bounded text (`cap` characters at most), read once per reading. */
function wordsOf(reading: Reading, node: Node | null, cap = WORDS_CAP): string {
  if (node === null) return '';
  let text = reading.texts.get(node);
  if (text === undefined) {
    text = textOf(node, AROUND_CAP + 1);
    reading.texts.set(node, text);
  }
  return text.slice(0, cap);
}

/** A descriptive word as the patterns read it: camelCase and separators spaced out. */
const spaced = (text: string) => text.slice(0, WORDS_CAP).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.[\]$:-]+/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** The element's parent, across a shadow root to its host. */
function parentOf(el: Element): Element | null {
  return el.parentElement ?? ((el.parentNode as ShadowRoot | null)?.host ?? null);
}

/** Whether a person can see an element: connected, rendered, at least `min` CSS px either way, on the page's canvas,
 *  at least MIN_OPACITY opaque with its ancestors, and seen by the caller's own reading too. */
function shown(reading: Reading, el: Element, min = MIN_CONTROL_PX): boolean {
  if (!el.isConnected) return false;
  const check = (el as Element & { checkVisibility?: (options: Record<string, boolean>) => boolean }).checkVisibility;
  if (typeof check === 'function' && !check.call(el, { opacityProperty: true, visibilityProperty: true,
    contentVisibilityAuto: true })) return false;
  const box = el.getBoundingClientRect();
  if (box.width < min || box.height < min) return false;
  const view = el.ownerDocument.defaultView;
  if (view === null) return false;
  if (box.right + view.scrollX <= 0 || box.bottom + view.scrollY <= 0) return false;
  let opacity = 1;
  for (let at: Element | null = el, level = 0; at !== null && level < 40; at = parentOf(at), level += 1) {
    const value = Number.parseFloat(view.getComputedStyle(at).opacity);
    if (Number.isFinite(value)) opacity *= value;
    if (opacity < MIN_OPACITY) return false;
  }
  return reading.visible(el);
}

/** The labels of a control: those whose `for` names it in its own tree (listed once per tree), and the one around it. */
function labelsOf(reading: Reading, el: Element): Element[] {
  const root = el.getRootNode() as Document | ShadowRoot;
  let byId = reading.labels.get(root);
  if (byId === undefined) {
    byId = new Map();
    const all = root.querySelectorAll('label[for]');
    for (let index = 0; index < all.length && index < MAX_CONTROLS; index += 1) {
      const label = all[index]!;
      const id = attr(label, 'for');
      byId.set(id, [...(byId.get(id) ?? []), label]);
    }
    reading.labels.set(root, byId);
  }
  const found = el.id === '' ? [] : (byId.get(el.id) ?? []).slice(0, 2);
  const around = el.closest('label');
  if (around !== null && !found.includes(around)) found.push(around);
  return found;
}

/** The elements a control's aria-labelledby names (each id once, four at most). */
function labelledByOf(el: Element): Element[] {
  const root = el.getRootNode() as Document | ShadowRoot;
  const ids = new Set(attr(el, 'aria-labelledby', 200).split(/\s+/).filter((id) => id !== ''));
  return [...ids].slice(0, 4).map((id) => root.getElementById(id)).filter((named): named is HTMLElement => named !== null);
}

/** A control's own words: its name, id, autocomplete, placeholder, title and aria-label, and the text of the elements
 *  its aria-labelledby names; its labels apart. */
function ownWordsOf(reading: Reading, el: Element): string[] {
  const parts = ['name', 'id', 'autocomplete', 'placeholder', 'title', 'aria-label'].map((attribute) => attr(el, attribute));
  for (const named of labelledByOf(el)) parts.push(wordsOf(reading, named));
  return parts.map(spaced).filter((part) => part !== '');
}

/** What a control's words name it, or null. */
function kindOf(type: string, autocomplete: string, parts: readonly string[], person: boolean): Kind | null {
  const tokens = autocomplete.split(/\s+/);
  if (type === 'password') return 'password';
  if (tokens.some((token) => token.startsWith('cc-')) || parts.some((part) => CARD.test(part))) return 'card';
  if (type === 'email' || tokens.includes('email') || parts.some((part) => EMAIL.test(part))) return 'email';
  if (type === 'tel' || tokens.some((token) => token === 'tel' || token.startsWith('tel-'))
    || parts.some((part) => PHONE.test(part))) return 'phone';
  if (tokens.includes('username') || parts.some((part) => USERNAME.test(part))) return 'username';
  if (person && (tokens.some((token) => /^(?:(?:given|family|additional)-)?name$/.test(token))
    || parts.some((part) => NAME.test(part) || PLAIN_NAME.test(part)))) return 'name';
  return null;
}

/** Whether a short text names a résumé where a file input stands (B2): as a noun, or as the field's own title
 *  ("Resume *"); never a longer text, which is the page's and not the field's. */
function namesResume(text: string): boolean {
  return text.length <= AROUND_CAP && (RESUME_NOUN.test(text) || /^\W*resumes?\b/i.test(text));
}

/** Whether a wrapper of a hidden file input is its drop zone or button (by tag, role, class, id or data-role, or its
 *  own text asking for a file). */
function uploadWrapper(el: Element, text: string): boolean {
  return ['LABEL', 'BUTTON'].includes(el.tagName) || attr(el, 'role').toLowerCase() === 'button'
    || [spaced(attr(el, 'class', 200)), spaced(attr(el, 'id')), attr(el, 'data-role'), text]
      .some((words) => UPLOAD_WRAPPER.test(words));
}

/** Whether a hidden file input's labelled group names a résumé (Greenhouse's role=group labelled "Resume/CV"): its
 *  nearest ancestor, within GROUP_LEVELS and below its form, that names itself (aria-labelledby, a fieldset's legend)
 *  decides, by its seen label's words. */
function groupNamesResume(reading: Reading, input: Element): boolean {
  let up = parentOf(input);
  for (let level = 0; up !== null && level < GROUP_LEVELS && !['FORM', 'BODY', 'HTML'].includes(up.tagName);
    level += 1, up = parentOf(up)) {
    const named = labelledByOf(up);
    const legend = up.tagName === 'FIELDSET' ? up.querySelector(':scope > legend') : null;
    if (legend !== null) named.push(legend);
    if (named.length > 0) return named.some((el) => RESUME_WORD.test(wordsOf(reading, el)) && shown(reading, el, 1));
  }
  return false;
}

/** Whether a file input is a résumé upload a person can reach (the module header, B2): its own words when it is seen;
 *  a seen label of it (its labels, the elements its aria-labelledby names) naming one; or its short surroundings, up
 *  to three levels, naming one as a noun: around a seen input, or a hidden input's drop zone or button that is seen. */
function resumeUpload(reading: Reading, input: Element): boolean {
  const seen = shown(reading, input);
  if (seen && ownWordsOf(reading, input).some((part) => RESUME_WORD.test(part))) return true;
  if ([...labelsOf(reading, input), ...labelledByOf(input)]
    .some((label) => RESUME_WORD.test(wordsOf(reading, label)) && shown(reading, label, 1))) return true;
  let up = parentOf(input);
  for (let level = 0; up !== null && level < 3 && up.tagName !== 'BODY' && up.tagName !== 'HTML'; level += 1, up = parentOf(up)) {
    const text = wordsOf(reading, up, AROUND_CAP + 1);
    if (text.length > AROUND_CAP) break;
    if (namesResume(text) && (seen || (uploadWrapper(up, text) && shown(reading, up)))) return true;
  }
  return !seen && groupNamesResume(reading, input);
}

/** Whether a container shows a drop zone or an upload button naming a résumé in its own short text (a Dropzone whose
 *  input sits elsewhere). */
function resumeDropZone(reading: Reading, container: Element): boolean {
  const parts = container.querySelectorAll(DROP_ZONES);
  for (let index = 0; index < parts.length && index < 20; index += 1) {
    const part = parts[index]!;
    const button = part.tagName === 'BUTTON' || attr(part, 'role').toLowerCase() === 'button';
    const text = wordsOf(reading, part, AROUND_CAP + 1);
    if ((!button || text.length <= BUTTON_CAP) && namesResume(text) && shown(reading, part)) return true;
  }
  return false;
}

/** How a control reads (null: nothing of an application's, or not seen). The words come first: only a control they
 *  name is measured. */
function readControl(reading: Reading, el: Element): Read | null {
  const type = attr(el, 'type').toLowerCase();
  if (el.tagName === 'INPUT' && type === 'file') return resumeUpload(reading, el) ? { el, kind: 'resume' } : null;
  if (el.tagName === 'SELECT' || (el.tagName === 'INPUT' && NOT_A_FIELD.test(type))) return null;
  // A search box inside a bigger container (a site-wide form, the page's header) is no part of an application.
  if (el.closest('[role=search i]') !== null) return null;
  const autocomplete = attr(el, 'autocomplete', 100).toLowerCase();
  const own = ownWordsOf(reading, el);
  const labels = labelsOf(reading, el);
  const labelled = labels.map((label) => spaced(wordsOf(reading, label))).filter((part) => part !== '');
  const person = ![...own, ...labelled].some((part) => NOT_A_PERSON.test(part));
  const kind = kindOf(type, autocomplete, [...own, ...labelled], person);
  if (kind === null) return null;
  // Named by its labels alone: one of them must be seen.
  if (kindOf(type, autocomplete, own, person) !== kind && !labels.some((label) => shown(reading, label, 1))) return null;
  return shown(reading, el) ? { el, kind } : null;
}

/** Whether a container is a search form: role=search (on it or above it), or its action, id, name or label says so. */
function searchForm(container: Element): boolean {
  return container.closest('[role=search i]') !== null || SEARCH.test(formWords(container));
}

/** A form's own words: its action, id, name, aria-label and class ('' for a container that is no form). */
const formWords = (container: Element) => (container.tagName === 'FORM'
  ? ['action', 'id', 'name', 'aria-label', 'class'].map((name) => attr(container, name)).join(' ') : '');

/** Whether a container is a comment form (the module header): its id, class, name or action says comment, or a
 *  textarea of it is named "comment" or labelled so. */
function commentForm(reading: Reading, container: Element, controls: readonly Element[]): boolean {
  return COMMENT_FORM.test(formWords(container)) || controls.some((el) => el.tagName === 'TEXTAREA'
    && (['name', 'id'].some((name) => attr(el, name).toLowerCase() === 'comment')
      || labelsOf(reading, el).some((label) => COMMENT_LABEL.test(wordsOf(reading, label)))));
}

const has = (reads: readonly Read[], kind: Kind) => reads.some((read) => read.kind === kind);

/** Where a container's own words are read (J1): a form itself; the controls outside any form around them, at their
 *  nearest common ancestor below the body (none when that is the body: a page's footer is no container's). */
function wordsScopeOf(container: Element, reads: readonly Read[]): Element | null {
  if (container.tagName === 'FORM') return container;
  let scope: Element | null = reads[0]?.el.parentElement ?? null;
  while (scope !== null && scope !== container && !reads.every((read) => scope!.contains(read.el))) scope = scope.parentElement;
  return scope === null || scope === container || scope.tagName === 'BODY' || scope.tagName === 'HTML' ? null : scope;
}

/** The controls around a password: those inside its nearest ancestor, below the container, that holds a control
 *  that is no password; the whole container's when there is none. */
function groupOf(password: Element, container: Element, reads: readonly Read[]): Read[] {
  for (let up = parentOf(password); up !== null && up !== container && container.contains(up); up = parentOf(up)) {
    const inside = reads.filter((read) => up.contains(read.el));
    if (inside.some((read) => read.kind !== 'password')) return inside;
  }
  return [...reads];
}

/** Scores one container over its controls; answers the controls it counted too. */
function scoreOf(reading: Reading, container: Element, controls: readonly Element[]): { score: FormScore; reads: Read[] } {
  const score: FormScore = { container, resume: false, name: false, email: false, phone: false, job: null,
    ruledOut: searchForm(container) ? 'search' : commentForm(reading, container, controls) ? 'comment' : null };
  if (score.ruledOut !== null) return { score, reads: [] };
  let reads: Read[] = [];
  for (const el of controls) {
    const read = readControl(reading, el);
    if (read === null) continue;
    if (read.kind === 'card') {
      score.ruledOut = 'card';
      return { score, reads: [] };
    }
    reads.push(read);
  }
  // A password rules out a sign-in alone (B9): the group around it with neither a résumé nor a name and a phone. A
  // sign-in box inside a bigger container is passed over; one that is the whole container rules it out.
  for (const password of reads.filter((read) => read.kind === 'password')) {
    if (!reads.includes(password)) continue;
    const group = groupOf(password.el, container, reads);
    if (has(group, 'resume') || (has(group, 'name') && has(group, 'phone'))) continue;
    if (group.length === reads.length) {
      score.ruledOut = 'password';
      return { score, reads: [] };
    }
    reads = reads.filter((read) => !group.includes(read));
  }
  score.resume = has(reads, 'resume');
  score.name = has(reads, 'name');
  score.email = has(reads, 'email');
  score.phone = has(reads, 'phone');
  return { score, reads };
}

/** Every container's controls, open shadow roots included: each form's, then each tree's loose ones (against the body,
 *  or the shadow root's host). */
function containersOf(doc: Document): Array<[Element, Element[]]> {
  const scopes: Array<Document | ShadowRoot> = [doc];
  for (let at = 0; at < scopes.length && scopes.length < MAX_SCOPES; at += 1) {
    // The document's live collection is read only as far as the bound (nothing past it is listed).
    const scope = scopes[at]!;
    const all = scope === doc ? doc.getElementsByTagName('*') : scope.querySelectorAll('*');
    for (let index = 0; index < SHADOW_SCAN && scopes.length < MAX_SCOPES; index += 1) {
      const el = all[index];
      if (el === undefined) break;
      if (el.shadowRoot !== null) scopes.push(el.shadowRoot);
    }
  }
  const byContainer = new Map<Element, Element[]>();
  let count = 0;
  for (const scope of scopes) {
    const controls = scope.querySelectorAll('input, textarea, select');
    const loose = scope === doc ? doc.body : (scope as ShadowRoot).host;
    for (let index = 0; index < controls.length && count < MAX_CONTROLS; index += 1, count += 1) {
      const el = controls[index]!;
      const container = (el as HTMLInputElement).form ?? loose;
      if (container === null) continue;
      const list = byContainer.get(container);
      if (list === undefined) byContainer.set(container, [el]);
      else list.push(el);
    }
  }
  return [...byContainer];
}

/** Each container's score: every form, then the controls outside any form. `href` is the page's address (its job
 *  context). */
export function formScores(doc: Document, href: string, options: ScoreOptions = {}): FormScore[] {
  const reading: Reading = { texts: new Map(), labels: new Map(), visible: options.visible ?? (() => true) };
  const url = urlOf(href);
  let pageJob: boolean | undefined;
  const jobPage = (): boolean => {
    pageJob ??= (options.jobSignal ?? (url !== null && (atsParam(url) || jobSignalOf(doc, url) !== null)))
      || addressNamesAJob(url);
    return pageJob;
  };
  const fileOnPage = doc.querySelector('input[type=file i]') !== null;
  return containersOf(doc).map(([container, controls]) => {
    const { score, reads } = scoreOf(reading, container, controls);
    if (score.ruledOut !== null) return score;
    if (!score.resume && fileOnPage && resumeDropZone(reading, container)) score.resume = true;
    if (!score.resume && countOf(score) >= 2) {
      const scope = wordsScopeOf(container, reads);
      score.job = scope !== null && containerNamesAJob(scope) ? 'container' : jobPage() ? 'page' : null;
    }
    return score;
  });
}

/** How many of a name, an email and a phone a container shows. */
const countOf = (score: FormScore) => [score.name, score.email, score.phone].filter(Boolean).length;

/** Whether a container's score makes it an application form (the module header): a résumé upload; all three of name,
 *  email and phone in a job context; or two of them in a container that names a job itself. */
export const claims = (score: FormScore) => score.ruledOut === null
  && (score.resume || (countOf(score) === 3 && score.job !== null) || (countOf(score) >= 2 && score.job === 'container'));

/** The page's application form: the first container the score claims, or null; none on a page that embeds an ATS or
 *  holds a payment frame. The one reading of the sentinel and the site adapter. */
export function applicationFormOf(doc: Document, href: string, options: ScoreOptions = {}): Element | null {
  if (embedsAts(doc) || paymentFrame(doc)) return null;
  return formScores(doc, href, options).find(claims)?.container ?? null;
}
