/*
 * The adapter-hook expectations of the v3 Phase 6 and 7b fixtures (docs/FIXTURES.md "Expectations", the `hooks` entry):
 * a posting or an account page holds few questions, and what the adapter must read there is its hooks. A case's
 * <case>.expect.json then carries, beside its `fields`, what each hook answers on the page, by CSS selector, written by
 * hand from the page itself:
 * - `detect`: the form root's selector, or null for a page with none (a posting);
 * - `authState`: the account page the adapter names, or null;
 * - `postingText`: the posting's own text's selector, or null;
 * - `entryControl`: the entry control's selector, or null;
 * Each selector names one element; one ending in " @<n>" names the n-th of those it matches (a page's copies).
 * - `signInForm`: for its `wall`, each slot's selector (`terms` and `colourUnknown` lists; `form`, the adapter's own
 *   form element, and `confirmEmail` where the page asks for the email twice), and the flags the adapter declares
 *   (`scriptSubmits`, `enablesWhenFilled`, `personPresses`); null when the page shows none for any wall;
 * - `signInPrelude`: for its `wall`, the control that shows the form, or null;
 * - `neverPress`: selectors whose every element the adapter names never to press; `pressable`: selectors none of whose
 *   elements it names so (Sign-in Auto's own controls).
 * compareHooks answers the differences as messages, so a test shows them all at once. A testkit, not a test: it imports
 * no test runner.
 */
import type { Adapter, SignInForm, SignInWall } from '../types';

/** A sign-in form, by selector. */
export interface ExpectedSignInForm {
  wall: SignInWall;
  email: string | null;
  confirmEmail?: string;
  password: string | null;
  confirm: string | null;
  terms: string[];
  button: string;
  /** The adapter's own form element (the v3 Phase 6/7b review, S8). */
  form: string;
  colourUnknown?: string[];
  enablesWhenFilled?: true;
  personPresses?: true;
  scriptSubmits?: true;
}

/** The `hooks` entry of a <case>.expect.json. */
export interface ExpectedHooks {
  detect: string | null;
  authState: ReturnType<NonNullable<Adapter['authState']>>;
  postingText: string | null;
  entryControl: string | null;
  signInForm: ExpectedSignInForm | null;
  signInPrelude: { wall: SignInWall; control: string } | null;
  neverPress: string[];
  pressable: string[];
}

const WALLS: readonly SignInWall[] = ['sign-in', 'create-account', 'email-gate'];

/** The `hooks` entry of a parsed expectation file, its shape checked. */
export function readHooks(json: unknown): ExpectedHooks {
  const hooks = (json as { hooks?: Partial<ExpectedHooks> } | null)?.hooks;
  if (hooks === undefined || hooks === null || typeof hooks !== 'object' || !Array.isArray(hooks.neverPress)
    || !Array.isArray(hooks.pressable) || !('detect' in hooks) || !('authState' in hooks) || !('signInForm' in hooks)) {
    throw new Error('not a hooks expectation');
  }
  return hooks as ExpectedHooks;
}

/** The one element `selector` names on the page, or a message. A selector ending in " @<n>" names the n-th (from 0) of
 *  those it matches, where the page holds copies (a posting's two Apply buttons, top and bottom). */
function one(doc: Document, selector: string): Element | string {
  const indexed = /^(.*) @(\d+)$/.exec(selector);
  const found = Array.from(doc.querySelectorAll(indexed === null ? selector : indexed[1]!));
  if (indexed !== null) return found[Number(indexed[2])] ?? `${selector}: ${found.length} elements`;
  return found.length === 1 ? found[0]! : `${selector}: ${found.length} elements`;
}

/** Whether `actual` is the one element `selector` names (null for null), or a message. */
function same(doc: Document, what: string, selector: string | null, actual: Element | null): string | null {
  if (selector === null) return actual === null ? null : `${what}: expected none, got <${actual.localName}>`;
  const wanted = one(doc, selector);
  if (typeof wanted === 'string') return `${what}: ${wanted}`;
  return actual === wanted ? null
    : `${what}: expected ${selector}, got ${actual === null ? 'none' : `<${actual.localName}>`}`;
}

/** A hook's answer, or the message of what it threw. */
function call<T>(hook: () => T): T | { threw: string } {
  try {
    return hook();
  } catch (failure) {
    return { threw: String(failure) };
  }
}

const threw = (value: unknown): value is { threw: string } =>
  typeof value === 'object' && value !== null && 'threw' in value;

/** The differences between the adapter's hooks on `doc` and `hooks`; [] when they agree. */
export function compareHooks(doc: Document, adapter: Adapter, hooks: ExpectedHooks): string[] {
  const out: string[] = [];
  const push = (message: string | null) => {
    if (message !== null) out.push(message);
  };
  const detected = call(() => adapter.detect(doc)?.formRoot ?? null);
  if (threw(detected)) out.push(`detect threw ${detected.threw}`);
  else push(same(doc, 'detect', hooks.detect, detected));
  const auth = call(() => adapter.authState?.(doc) ?? null);
  if (threw(auth) || auth !== hooks.authState) {
    out.push(`authState: expected ${hooks.authState}, got ${JSON.stringify(auth)}`);
  }
  const posting = call(() => adapter.postingText?.(doc) ?? null);
  if (threw(posting)) out.push(`postingText threw ${posting.threw}`);
  else push(same(doc, 'postingText', hooks.postingText, posting));
  const entry = call(() => adapter.entryControl?.(doc) ?? null);
  if (threw(entry)) out.push(`entryControl threw ${entry.threw}`);
  else push(same(doc, 'entryControl', hooks.entryControl, entry));
  for (const wall of WALLS) {
    const form = call(() => adapter.signInForm?.(doc, wall) ?? null);
    if (threw(form)) {
      out.push(`signInForm(${wall}) threw ${form.threw}`);
      continue;
    }
    const wanted = hooks.signInForm?.wall === wall ? hooks.signInForm : null;
    out.push(...compareForm(doc, wall, wanted, form));
    const prelude = call(() => adapter.signInPrelude?.(doc, wall) ?? null);
    if (threw(prelude)) out.push(`signInPrelude(${wall}) threw ${prelude.threw}`);
    else push(same(doc, `signInPrelude(${wall})`, hooks.signInPrelude?.wall === wall ? hooks.signInPrelude.control : null,
      prelude));
  }
  const never = call(() => adapter.neverPress?.(doc.documentElement) ?? []);
  if (threw(never)) {
    out.push(`neverPress threw ${never.threw}`);
    return out;
  }
  for (const selector of hooks.neverPress) {
    const elements = Array.from(doc.querySelectorAll(selector));
    if (elements.length === 0) out.push(`neverPress: ${selector} names nothing on the page`);
    for (const el of elements) if (!never.includes(el)) out.push(`neverPress: ${selector} is not listed`);
  }
  for (const selector of hooks.pressable) {
    const elements = Array.from(doc.querySelectorAll(selector));
    if (elements.length === 0) out.push(`pressable: ${selector} names nothing on the page`);
    for (const el of elements) {
      if (never.some((other) => other === el || other.contains(el) || el.contains(other))) {
        out.push(`pressable: ${selector} is never pressed, or near one`);
      }
    }
  }
  return out;
}

function compareForm(doc: Document, wall: SignInWall, wanted: ExpectedSignInForm | null, form: SignInForm | null):
  string[] {
  const what = `signInForm(${wall})`;
  if (wanted === null) return form === null ? [] : [`${what}: expected none, got one`];
  if (form === null) return [`${what}: expected one, got none`];
  const out: string[] = [];
  const slot = (name: 'email' | 'password' | 'confirm' | 'button') => {
    const message = same(doc, `${what}.${name}`, wanted[name], form[name]);
    if (message !== null) out.push(message);
  };
  slot('email');
  slot('password');
  slot('confirm');
  slot('button');
  const own = (name: string, selector: string | null, actual: Element | null) => {
    const message = same(doc, `${what}.${name}`, selector, actual);
    if (message !== null) out.push(message);
  };
  own('confirmEmail', wanted.confirmEmail ?? null, form.confirmEmail ?? null);
  own('form', wanted.form, form.form ?? null);
  const list = (name: 'terms' | 'colourUnknown', selectors: readonly string[], actual: readonly Element[]) => {
    const wantedEls = selectors.map((selector) => one(doc, selector));
    if (wantedEls.length !== actual.length || wantedEls.some((el, at) => el !== actual[at])) {
      out.push(`${what}.${name}: expected ${JSON.stringify(selectors)}, got ${actual.length} boxes`);
    }
  };
  list('terms', wanted.terms, form.terms);
  list('colourUnknown', wanted.colourUnknown ?? [], form.colourUnknown ?? []);
  for (const flag of ['scriptSubmits', 'enablesWhenFilled', 'personPresses'] as const) {
    if ((wanted[flag] ?? false) !== (form[flag] ?? false)) out.push(`${what}.${flag}: expected ${String(wanted[flag] ?? false)}`);
  }
  return out;
}
