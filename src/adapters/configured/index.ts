/*
 * The configured-adapter layer (DESIGN-NEW-ATS §3, Phase 0): an AtsConfig (./types.ts) turned into the real Adapter
 * contract (../types.ts) by one tested function, so a platform is a page of selectors, each naming the snapshot it was
 * read from, plus the few hooks no rule can say (`code`). configuredAdapter(config) is a whole adapter;
 * configuredHooks(config) the same hooks without its identity, for a full adapter (ADP's, UltiPro's) to spread under
 * its own. Pure DOM reads through the existing helpers (dom/visibility.ts isUserVisible, dom/visible-text.ts
 * visibleText, dom/scan-cache.ts); nothing runs at import. What each hook answers:
 * - detect: while a page state shows (the first of `states` whose `when` matches an element a person can see), that
 *   state's own root, or none; otherwise the first shown `root.css` that holds `root.holds`.
 * - authState: the shown state's `auth`; signInForm: its `signIn` form, for the wall its auth names (Sign-in mode Auto
 *   presses its button; without Auto the pause is the person's: account-creating and code-sending buttons follow the
 *   person's Sign-in mode, as Workday's create-account and Oracle's email gate do). A state with no signIn declares
 *   none, and the hook is always there, so Sign-in Auto never reads a standard form on a configured platform's page.
 * - entryControl: the shown entry-choice state's `entry`, else, where no form shows, `posting.entry`; every entry
 *   control is never pressed by a run (neverPress), which the entry door may press alone (entryNeverPressed).
 *   entryConsentForm (core pass Z1, item 27): the shown entry-choice state's `entrySubmits` form and selects.
 * - signInContainer (core pass Z1, item 24): the shown state's `signInContainer` (a state filled like a step).
 * - labelFor, descriptionFor, groupOf: the question rules (the first whose container holds the control); requiredFor:
 *   a required rule's mark a person sees, or its `is` on the question's title or container, the control's own labels
 *   or an ancestor.
 * - stepSignature, nextButton, isFinalStep: a shown state is its own step ('not-final' with its `next`, or with its
 *   sign-in container and that container's button shown, else 'unknown'); otherwise the steps' heading, progress, anchors and address part, Next and Submit (final when Submit
 *   shows and Next does not, not-final the other way round, unknown otherwise); a one-page form is final when Submit
 *   shows. stepSignature and nextButton exist only where the config declares steps or states.
 * - submitButton: the first shown `submit`, else its first match (identified so the fill never presses it).
 * - neverPress: every `neverPress`, steps.back, posting.entry and each state's entry, document-wide.
 * - errors: the generic aria-invalid ones and the shown `errors` inside the root; isBusy: a shown `busy` sign.
 * - widgets, checked, proxies, uploads, repeatables, sections, excluded, postingText: the rules of those names; uploadHeld
 *   (the behaviour review of 2026-11-06, M2): an upload rule's `done` sign shown in its area (naming a file, where the
 *   rule reads names), and uploadState confirms only the written file's name where the rule reads names.
 * - `code` is spread last: it wins over every rule-built hook.
 * configProblems(config) lists the contradictions a config may hold (every rule's `from`, an entry-choice state with a
 * root, an entry or a signIn its auth does not allow); its tests run it over ATS_CONFIGS.
 * Nothing here reads, logs or sends a value: only page markup and text.
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import { visibleText } from '../../dom/visible-text';
import { isUserVisible } from '../../dom/visibility';
import { platformOfUrl } from '../../shared/hosts';
import { genericAdapter } from '../generic';
import { successSignsOf } from '../success';
import type { Adapter, SignInForm, SignInWall, UploadState, WidgetDecl } from '../types';
import type { AtsConfig, ConfiguredHooks, Css, PageState, QuestionRule, StateAuth, UploadRule, WidgetRule } from './types';

export type { AtsConfig, ConfiguredHooks } from './types';

/** The walls a state's signIn answers (Adapter.signInForm's). */
const SIGN_IN_WALLS: readonly StateAuth[] = ['sign-in', 'create-account', 'email-gate'];

/** Every element matching `css` in `scope`, or none where the selector does not parse. */
function all<T extends Element = Element>(scope: ParentNode, css: Css): T[] {
  try {
    return Array.from(scope.querySelectorAll<T>(css));
  } catch {
    return [];
  }
}

/** Whether `el` matches `css` (false where the selector does not parse). */
function matches(el: Element, css: Css): boolean {
  try {
    return el.matches(css);
  } catch {
    return false;
  }
}

/** `el`'s nearest ancestor-or-self matching `css`, or null. */
function closest(el: Element, css: Css): Element | null {
  try {
    return el.closest(css);
  } catch {
    return null;
  }
}

/** The first of `elements` a person can see. */
function shown<T extends Element>(elements: readonly T[], cache: ScanCache): T | null {
  return elements.find((el) => isUserVisible(el, cache)) ?? null;
}

/** The first element of the document a person can see that matches `css`. */
function firstShown<T extends Element = HTMLElement>(doc: Document, css: Css, cache: ScanCache = newScanCache()): T | null {
  return shown(all<T>(doc, css), cache);
}

/** A relative lookup from a widget's match (WidgetRule): the match itself, else its first descendant, else its
 *  nearest ancestor. */
function near(match: Element, css: Css): Element | null {
  if (matches(match, css)) return match;
  return all(match, css)[0] ?? (match.parentElement === null ? null : closest(match.parentElement, css));
}

/** The visible text of an element on one line, capped as a label. */
const textOf = (el: Element, cache: ScanCache) => visibleText(el, { singleLine: true, cap: TEXT_CAP_LABEL, cache });

/** The page state the document shows (module header), or null for the application. */
function stateOf(config: AtsConfig, doc: Document, cache: ScanCache = newScanCache()): PageState | null {
  return config.states?.find((state) => shown(all(doc, state.when), cache) !== null) ?? null;
}

/** The application's root while no state shows: the first shown root.css holding root.holds. */
function applicationRoot(config: AtsConfig, doc: Document, cache: ScanCache): Element | null {
  const { css, holds } = config.root;
  return all(doc, css).find((el) => (holds === undefined || all(el, holds).length > 0) && isUserVisible(el, cache)) ?? null;
}

/** The form root detect answers (module header). */
function rootOf(config: AtsConfig, doc: Document, cache: ScanCache = newScanCache()): Element | null {
  const state = stateOf(config, doc, cache);
  if (state !== null) return state.root === undefined ? null : firstShown<Element>(doc, state.root, cache);
  return applicationRoot(config, doc, cache);
}

/** The question rule whose container holds the control (or a group's container), and that container. */
function questionOf(config: AtsConfig, control: Element): { rule: QuestionRule; container: Element } | null {
  for (const rule of config.questions ?? []) {
    const container = closest(control, rule.container);
    if (container !== null) return { rule, container };
  }
  return null;
}

/** A question's title: the first `title` inside its container that is no nested container's and does not hold the
 *  control, else the nearest preceding `titleBefore` among the container's previous siblings, up to another container. */
function titleOf(question: { rule: QuestionRule; container: Element }, control: Element): Element | null {
  const { rule, container } = question;
  if (rule.title !== undefined) {
    const title = all(container, rule.title).find((el) => el !== control && !el.contains(control)
      && closest(el, rule.container) === container);
    if (title !== undefined) return title;
  }
  if (rule.titleBefore !== undefined) {
    for (let at = container.previousElementSibling; at !== null; at = at.previousElementSibling) {
      if (matches(at, rule.titleBefore)) return at;
      if (matches(at, rule.container)) break;
    }
  }
  return null;
}

/** The control's own labels (a labelable control's; none for any other element). */
function labelsOf(control: Element): Element[] {
  return Array.from((control as HTMLInputElement).labels ?? []);
}

/** A widget declaration from its rule (module header: WidgetRule's lookups). */
function declOf(rule: WidgetRule, match: Element): WidgetDecl | null {
  const opener = rule.opener === undefined ? match : near(match, rule.opener);
  if (opener === null) return null;
  const decl: WidgetDecl = { kind: rule.kind, opener: opener as HTMLElement, snapshot: rule.from };
  if (rule.expanded !== undefined) {
    const expanded = near(match, rule.expanded);
    if (expanded !== null) decl.expanded = expanded;
  }
  if (rule.box !== undefined) {
    const box = near(match, rule.box);
    if (box !== null) decl.box = box;
  }
  if (rule.members !== undefined) decl.members = all<HTMLElement>(match, rule.members);
  if (rule.parts !== undefined) decl.parts = all(match, rule.parts);
  if (rule.optionLabel !== undefined) {
    const label = rule.optionLabel;
    decl.optionLabel = (option) => all(option, label)[0] ?? null;
  }
  if (rule.busy !== undefined) decl.busy = rule.busy;
  if (rule.activation !== undefined) decl.activation = [...rule.activation];
  if (rule.keys !== undefined) decl.keys = rule.keys;
  if (rule.keyTarget !== undefined) decl.keyTarget = rule.keyTarget;
  if (rule.readOnlyBox === true) decl.readOnlyBox = true;
  if (rule.listFollowsField === true) decl.listFollowsField = true;
  if (rule.highlightIsNoChoice === true) decl.highlightIsNoChoice = true;
  if (rule.hidesFormWhileOpen !== undefined) decl.hidesFormWhileOpen = rule.hidesFormWhileOpen;
  if (rule.emptyAfterMs !== undefined) decl.emptyAfterMs = rule.emptyAfterMs;
  if (rule.bridge !== undefined) decl.bridge = rule.bridge;
  return decl;
}

/** The upload rule of a file input, and the input's area. */
function uploadOf(config: AtsConfig, input: Element): { rule: UploadRule; area: Element | null } | null {
  const rule = (config.uploads ?? []).find((each) => matches(input, each.input));
  if (rule === undefined) return null;
  return { rule, area: rule.area === undefined ? null : closest(input, rule.area) };
}

/** An upload's visible control (UploadRule.control): inside its area, else inside its nearest ancestor holding one
 *  (the behaviour review of 2026-11-06, M2: Breezy's résumé area is the input's own container, its opener elsewhere in
 *  the form). */
function uploadControl(rule: UploadRule, input: Element, area: Element | null): Element | null {
  if (area !== null) {
    const inside = all(area, rule.control).find((el) => el !== input);
    if (inside !== undefined) return inside;
  }
  for (let at = (area ?? input).parentElement; at !== null; at = at.parentElement) {
    const found = all(at, rule.control).find((el) => el !== input);
    if (found !== undefined) return found;
  }
  return null;
}

// ── behaviour review 2026-11-06 (M2) ──
/** Words as compared: runs of white space as one space, trimmed. */
const words = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The `done` signs a person can see in an upload's area, each with the file's name it shows (UploadRule.name: the
 *  sign itself or its first match inside a person can see, its words as written, as Workday's file-upload-item-name is
 *  read: a page busy saving draws its veil over them, atlas-uploads-saving; '' when it names none), or null for a rule
 *  without `name`. */
function doneSigns(rule: UploadRule, area: Element, cache: ScanCache): Array<{ sign: Element; name: string | null }> {
  if (rule.done === undefined) return [];
  const name = rule.name;
  return all(area, rule.done).filter((sign) => isUserVisible(sign, cache)).map((sign) => {
    if (name === undefined) return { sign, name: null };
    const shownName = matches(sign, name) ? sign : shown(all(sign, name), cache);
    return { sign, name: shownName === null ? '' : words(shownName.textContent ?? '') };
  });
}
// ── end behaviour review (M2) ──

/** The step a shown state or the steps' rules read (stepSignature). */
function signatureOf(config: AtsConfig, doc: Document): ReturnType<NonNullable<Adapter['stepSignature']>> {
  const cache = newScanCache();
  const state = stateOf(config, doc, cache);
  if (state !== null) return { anchors: [`state:${state.name}`] };
  const steps = config.steps;
  if (steps === undefined || applicationRoot(config, doc, cache) === null) return { anchors: [] };
  const read = (css: Css | undefined) => {
    if (css === undefined) return undefined;
    const el = firstShown<Element>(doc, css, cache);
    return el === null ? '' : textOf(el, cache);
  };
  const signature: ReturnType<NonNullable<Adapter['stepSignature']>> = {
    // The behaviour review of 2026-11-06 (minor 1): an anchor with no `attr` reads as its place in the list, so the
    // signature's set of anchors (core/steps/signature.ts) keeps steps apart that each show a different one (ADP's
    // step bodies), where every one read 'shown' and folded into one.
    anchors: (steps.anchors ?? []).map(({ css, attr }, index) => {
      const el = firstShown<Element>(doc, css, cache);
      if (el === null) return '';
      return attr === undefined ? `${index}:shown` : el.getAttribute(attr) ?? '';
    }),
  };
  const heading = read(steps.heading);
  if (heading !== undefined) signature.heading = heading;
  const progress = read(steps.progress);
  if (progress !== undefined) signature.progress = progress;
  if (steps.urlPart !== undefined) {
    const location = doc.defaultView?.location;
    const part = steps.urlPart;
    signature.urlPart = location === undefined ? '' : part === 'path' ? location.pathname
      : part === 'hash' ? location.hash : new URLSearchParams(location.search).get(part.query) ?? '';
  }
  return signature;
}

/** Whether the shown step is the last (module header). */
function finalityOf(config: AtsConfig, doc: Document): 'final' | 'not-final' | 'unknown' {
  const cache = newScanCache();
  const state = stateOf(config, doc, cache);
  if (state !== null) {
    if (state.next !== undefined && firstShown(doc, state.next, cache) !== null) return 'not-final';
    // The behaviour review of 2026-11-06 (minor 2): a state filled like a step whose account part shows with its button
    // (ADP's guest Continue, UltiPro's Create account) leads on to the application: not its last step. Its button is
    // Sign-in mode's (signInContainer), never Next's (nextButton names the state's `next` alone), so the run waits for
    // the page to move on instead of resting at "can't tell" (the agent's needs-you unsupported_site).
    const container = state.auth === undefined ? state.signInContainer : undefined;
    if (container !== undefined && firstShown(doc, container.container, cache) !== null
      && firstShown(doc, container.button, cache) !== null) return 'not-final';
    return 'unknown';
  }
  if (applicationRoot(config, doc, cache) === null) return 'unknown';
  const submitShown = config.submit !== undefined && firstShown(doc, config.submit.css, cache) !== null;
  if (config.steps === undefined) return submitShown ? 'final' : 'unknown';
  const nextShown = firstShown(doc, config.steps.next, cache) !== null;
  if (submitShown && !nextShown) return 'final';
  if (nextShown && !submitShown) return 'not-final';
  return 'unknown';
}

/** The success signs a config's page draws (content/submitted.ts reads them, after a Submit was pressed, under its
 *  own rules): every element matching `success` that a person can see now. The behaviour review of 2026-11-06 (M1): a
 *  press arms with the signs shown at the press (content/runtime.ts `signsOf`), so a sign the page holds hidden from
 *  the start (Breezy's div.confirmation-container .application-confirmed, ng-hide in fixtures/breezy/concurrent-form)
 *  is never among them, and reads as new once the page shows it. */
export function configuredSuccessSigns(doc: Document, config: AtsConfig | undefined): Element[] {
  if (config?.success === undefined) return [];
  // v5 p2-detect: the rule's words and companion too, where it names them (adapters/success.ts).
  return successSignsOf(doc, [config.success]);
}

/** The hooks an AtsConfig builds (module header), without the adapter's identity: for a full adapter to spread. */
export function configuredHooks(config: AtsConfig): ConfiguredHooks {
  const stepped = config.steps !== undefined || (config.states?.length ?? 0) > 0;
  const entryCss = [config.posting?.entry, ...(config.states ?? []).map((state) => state.entry)]
    .filter((css): css is Css => css !== undefined);
  const hooks: ConfiguredHooks = {
    detect(doc) {
      const formRoot = rootOf(config, doc);
      return formRoot === null ? null : { formRoot };
    },
    authState: (doc) => stateOf(config, doc)?.auth ?? null,
    signInForm(doc: Document, wall: SignInWall): SignInForm | null {
      const state = stateOf(config, doc);
      const rule = state?.signIn;
      if (state === null || rule === undefined || state.auth !== wall || !SIGN_IN_WALLS.includes(state.auth)) return null;
      const form = firstShown<Element>(doc, rule.form);
      if (form === null || form.localName !== 'form') return null;
      const box = (css: Css | undefined) => (css === undefined ? null : all<HTMLInputElement>(form, css)[0] ?? null);
      const button = all<HTMLElement>(form, rule.button)[0] ?? null;
      if (button === null) return null;
      const terms = box(rule.terms);
      const declared: SignInForm = { email: box(rule.email), password: box(rule.password), confirm: box(rule.confirm),
        terms: terms === null ? [] : [terms], button, form: form as HTMLFormElement };
      if (rule.confirmEmail !== undefined) declared.confirmEmail = box(rule.confirmEmail);
      if (rule.colourUnknown !== undefined) {
        declared.colourUnknown = rule.colourUnknown.flatMap((css) => all<HTMLInputElement>(form, css));
      }
      if (rule.enablesWhenFilled === true) declared.enablesWhenFilled = true;
      if (rule.personPresses === true) declared.personPresses = true;
      if (rule.scriptSubmits === true) declared.scriptSubmits = true;
      return declared;
    },
    // ── snapshot build 2026-11-06 (core pass Z1, items 24 and 27) ──
    signInContainer(doc: Document): SignInForm | null {
      const cache = newScanCache();
      const state = stateOf(config, doc, cache);
      const rule = state?.signInContainer;
      if (state === null || rule === undefined || state.auth !== undefined) return null;
      const container = firstShown<Element>(doc, rule.container, cache);
      const button = firstShown<HTMLElement>(doc, rule.button, cache);
      if (container === null || button === null) return null;
      const box = (css: Css | undefined) => (css === undefined ? null : all<HTMLInputElement>(container, css)[0] ?? null);
      const terms = box(rule.terms);
      return { email: box(rule.email), password: null, confirm: null, terms: terms === null ? [] : [terms], button,
        container };
    },
    entryConsentForm(doc: Document) {
      const cache = newScanCache();
      const state = stateOf(config, doc, cache);
      const rule = state?.entrySubmits;
      if (state === null || rule === undefined || state.auth !== 'entry-choice') return null;
      const form = firstShown<Element>(doc, rule.form, cache);
      if (form === null || form.localName !== 'form') return null;
      return { form: form as HTMLFormElement, selects: rule.selects === undefined ? [] : all(form, rule.selects) };
    },
    // ── end core pass Z1, items 24 and 27 ──
    labelFor(control) {
      const question = questionOf(config, control);
      return question === null ? null : titleOf(question, control);
    },
    descriptionFor(control) {
      const question = questionOf(config, control);
      if (question === null || question.rule.help === undefined) return [];
      return all(question.container, question.rule.help).filter((help) => !help.contains(control));
    },
    groupOf(control) {
      for (const rule of config.questions ?? []) {
        if (rule.group !== true) continue;
        const container = closest(control, rule.container);
        if (container !== null) return container;
      }
      return null;
    },
    requiredFor(control) {
      const rules = config.required ?? [];
      if (rules.length === 0) return false;
      const cache = newScanCache();
      const question = questionOf(config, control);
      const title = question === null ? null : titleOf(question, control);
      const places = [...labelsOf(control), ...(title === null ? [] : [title]),
        ...(question === null ? [] : [question.container])];
      return rules.some((rule) => {
        if (rule.is !== undefined && (places.some((place) => matches(place, rule.is!)) || closest(control, rule.is) !== null)) {
          return true;
        }
        return rule.mark !== undefined && places.some((place) => shown(all(place, rule.mark!), cache) !== null);
      });
    },
    sections(root) {
      const cache = newScanCache();
      return (config.sections ?? []).flatMap((rule) => [...(matches(root, rule.container) ? [root] : []),
        ...all(root, rule.container)].flatMap((container) => {
        const heading = all(container, rule.heading).find((el) => closest(el, rule.container) === container);
        const label = heading === undefined ? '' : textOf(heading, cache);
        if (label === '') return [];
        return [{ el: container, label, ...(rule.kind === undefined ? {} : { kind: rule.kind }) }];
      }));
    },
    widgetRoots(root) {
      return (config.widgets ?? []).filter((rule) => rule.root === true).flatMap((rule) => all(root, rule.match));
    },
    widgetFor(control) {
      const rule = (config.widgets ?? []).find((each) => matches(control, each.match));
      return rule === undefined ? null : declOf(rule, control);
    },
    checkedOf(input) {
      const rule = (config.checked ?? []).find((each) => matches(input, each.input));
      if (rule === undefined) return null;
      const holder = closest(input, rule.holder);
      return holder === null ? null : matches(holder, rule.chosen);
    },
    proxyFor(input) {
      const rule = (config.proxies ?? []).find((each) => matches(input, each.input));
      if (rule === undefined) return null;
      if (rule.scope !== undefined) {
        const scope = closest(input, rule.scope);
        return scope === null ? null : all(scope, rule.proxy).find((el) => el !== input) ?? null;
      }
      const parent = input.parentElement;
      if (parent === null) return null;
      return closest(parent, rule.proxy) ?? all(parent, rule.proxy).find((el) => el !== input) ?? null;
    },
    uploadWidgets(root) {
      const doc = root.ownerDocument;
      return (config.uploads ?? []).flatMap((rule) => all<HTMLInputElement>(doc, rule.input).flatMap((input) => {
        if (input.localName !== 'input' || input.type !== 'file') return [];
        const control = uploadControl(rule, input, rule.area === undefined ? null : closest(input, rule.area));
        return control === null ? [] : [{ control, input }];
      }));
    },
    uploadState(input, fileName): UploadState | null {
      const upload = uploadOf(config, input);
      if (upload === null) return null;
      const { rule, area } = upload;
      if (rule.done === undefined && rule.pending === undefined && rule.failed === undefined) return null;
      if (area === null || !input.isConnected) return 'failed';
      const cache = newScanCache();
      const showing = (css: Css | undefined) => css !== undefined && shown(all(area, css), cache) !== null;
      if (showing(rule.failed)) return 'failed';
      if (showing(rule.pending)) return 'pending';
      // The behaviour review (M2): with a `name`, only a sign showing the written file's name confirms it.
      const wanted = words(fileName);
      return doneSigns(rule, area, cache).some((done) => done.name === null || (wanted !== '' && done.name === wanted))
        ? 'confirmed' : 'pending';
    },
    // ── behaviour review 2026-11-06 (M2) ──
    /** A file the page already shows in the input's area (a shown `done` sign, naming a file where the rule reads
     *  names), while the input itself holds none: dom/scan.ts reads the field as holding it (the planner keeps it, or
     *  uploads the person's again under "Résumé already on the page: Upload mine again"). */
    uploadHeld(input) {
      const upload = uploadOf(config, input);
      if (upload === null || upload.area === null || upload.rule.done === undefined) return false;
      return doneSigns(upload.rule, upload.area, newScanCache()).some((done) => done.name !== '');
    },
    // ── end behaviour review (M2) ──
    repeatables(root) {
      return (config.repeatables ?? []).flatMap((rule) => {
        const section = all(root, rule.section)[0];
        if (section === undefined) return [];
        const blocks = () => all(section, rule.block);
        return [{
          kind: rule.kind,
          blocks,
          addButton: () => shown(all<HTMLElement>(section, rule.add)
            .filter((add) => !blocks().some((block) => block.contains(add))), newScanCache()),
          ...(rule.currentlyHere === undefined ? {}
            : { currentlyHere: (block: Element) => all<HTMLInputElement>(block, rule.currentlyHere!)[0] ?? null }),
          ...(rule.save === undefined ? {} : { save: (block: Element) => all<HTMLElement>(block, rule.save!)[0] ?? null }),
        }];
      });
    },
    submitButton(root) {
      if (config.submit === undefined) return null;
      const found = all<HTMLElement>(root.ownerDocument, config.submit.css);
      return shown(found, newScanCache()) ?? found[0] ?? null;
    },
    neverPress(root) {
      const doc = root.ownerDocument;
      const css = [...(config.neverPress ?? []).map((rule) => rule.css), ...entryCss,
        ...(config.steps?.back === undefined ? [] : [config.steps.back])];
      return [...new Set(css.flatMap((each) => all(doc, each)))];
    },
    excluded(root) {
      return [...new Set((config.excluded ?? []).flatMap((rule) => all(root, rule.css)))];
    },
    errors(root) {
      const generic = genericAdapter.errors?.(root) ?? [];
      if (config.errors === undefined) return generic;
      const cache = newScanCache();
      const own = all(root, config.errors.css).filter((el) => isUserVisible(el, cache)
        && !generic.some((each) => each.el === el));
      return [...generic, ...own.map((el) => ({ el }))];
    },
    isBusy(doc) {
      const cache = newScanCache();
      return (config.busy ?? []).some((rule) => shown(all(doc, rule.css), cache) !== null);
    },
    postingText(doc) {
      return config.posting?.text === undefined ? null : firstShown<Element>(doc, config.posting.text);
    },
    entryControl(doc) {
      const cache = newScanCache();
      const state = stateOf(config, doc, cache);
      if (state !== null) {
        return state.auth === 'entry-choice' && state.entry !== undefined ? firstShown(doc, state.entry, cache) : null;
      }
      if (config.posting?.entry === undefined || applicationRoot(config, doc, cache) !== null) return null;
      return firstShown(doc, config.posting.entry, cache);
    },
    isFinalStep: (doc) => finalityOf(config, doc),
  };
  if (stepped) {
    hooks.stepSignature = (doc) => signatureOf(config, doc);
    hooks.nextButton = (root) => {
      const doc = root.ownerDocument;
      const cache = newScanCache();
      const state = stateOf(config, doc, cache);
      if (state !== null) return state.next === undefined ? null : firstShown(doc, state.next, cache);
      return config.steps === undefined ? null : firstShown(doc, config.steps.next, cache);
    };
  }
  if (entryCss.length > 0) hooks.entryNeverPressed = true;
  if (config.autosaves !== undefined) hooks.autosaves = config.autosaves;
  if (config.quirks !== undefined) hooks.quirks = config.quirks;
  return { ...hooks, ...config.code };
}

/** The Adapter an AtsConfig builds (module header). */
export function configuredAdapter(config: AtsConfig): Adapter {
  return {
    id: config.platform,
    matchesUrl: config.matchesUrl ?? ((url) => platformOfUrl(url.href) === config.platform),
    canonicalApplicationUrl(url) {
      const read = config.parse(url);
      return read?.page === 'application' ? read.applicationUrl : null;
    },
    ...configuredHooks(config),
  };
}

/** The contradictions a config holds (module header), each named by its rule; [] for a sound one. */
export function configProblems(config: AtsConfig): string[] {
  const problems: string[] = [];
  const need = (from: string | undefined, where: string) => {
    if (from === undefined || from.trim() === '') problems.push(`${where}: no snapshot named (from)`);
  };
  need(config.root.from, 'root');
  if (config.snapshots.length === 0) problems.push('snapshots: none named');
  const lists: Array<[string, ReadonlyArray<{ from: string }> | undefined]> = [['states', config.states],
    ['questions', config.questions], ['required', config.required], ['sections', config.sections],
    ['widgets', config.widgets], ['checked', config.checked], ['proxies', config.proxies], ['uploads', config.uploads],
    ['repeatables', config.repeatables], ['neverPress', config.neverPress], ['excluded', config.excluded],
    ['busy', config.busy]];
  for (const [name, list] of lists) list?.forEach((rule, index) => need(rule.from, `${name}[${index}]`));
  for (const [name, rule] of [['steps', config.steps], ['submit', config.submit], ['errors', config.errors],
    ['success', config.success], ['posting', config.posting]] as const) {
    if (rule !== undefined) need(rule.from, name);
  }
  for (const rule of config.required ?? []) {
    if (rule.mark === undefined && rule.is === undefined) problems.push(`required (${rule.from}): neither mark nor is`);
  }
  for (const rule of config.questions ?? []) {
    if (rule.title === undefined && rule.titleBefore === undefined && rule.help === undefined && rule.group !== true) {
      problems.push(`questions (${rule.from}): no title, titleBefore, help or group`);
    }
  }
  const names = new Set<string>();
  for (const state of config.states ?? []) {
    if (names.has(state.name)) problems.push(`states: ${state.name} named twice`);
    names.add(state.name);
    if (state.auth === 'entry-choice' && state.root !== undefined) {
      problems.push(`states.${state.name}: an entry-choice state takes no root (the entry presses only where no form shows)`);
    }
    if (state.entry !== undefined && state.auth !== 'entry-choice') {
      problems.push(`states.${state.name}: an entry only on an entry-choice state`);
    }
    if (state.signIn !== undefined && (state.auth === undefined || !SIGN_IN_WALLS.includes(state.auth))) {
      problems.push(`states.${state.name}: a signIn only on a sign-in, create-account or email-gate state`);
    }
    // ── snapshot build 2026-11-06 (core pass Z1, items 24 and 27) ──
    if (state.entrySubmits !== undefined && (state.auth !== 'entry-choice' || state.entry === undefined)) {
      problems.push(`states.${state.name}: an entrySubmits only on an entry-choice state with an entry`);
    }
    if (state.signInContainer !== undefined && (state.auth !== undefined || state.root === undefined)) {
      problems.push(`states.${state.name}: a signInContainer only on a state filled like a step (a root, no auth)`);
    }
    // ── end core pass Z1, items 24 and 27 ──
  }
  return problems;
}
