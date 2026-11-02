/*
 * The page-world bridge (docs/SPEC-AMENDMENTS.md §12; docs/ARCHITECTURE.md "Isolation"; docs/PRIVACY.md): the one
 * script the extension runs in a page's own world (entrypoints/page-bridge.content.ts: world MAIN, every ATS frame,
 * from document_start), so a React widget can be written by its own code, as the person's choice in it is, React first
 * like Jobright. It holds no data and keeps no state but its one listener, on the document, in the capture phase.
 * The protocol is dom/bridge-protocol.ts's: a command is a CustomEvent on the element it is about (composed, so one
 * from inside an open shadow root reaches the document; the element is the event's composed path's first, an element
 * of this document still in it), its detail a JSON string checked strictly; the bridge acknowledges it and answers it
 * on the same element, both inside the dispatch. The ops:
 * - react-select.choose {label, multi}: from the element's React fiber (its __reactFiber$ key) up to the react-select
 *   Select whose own text box the element is (its stateNode has selectOption and props.options, and its inputRef is the
 *   element), the one option of its options, groups flattened, whose label (props.getOptionLabel, as react-select reads
 *   it) is `label`, white space collapsed: none is 'no-match', two 'ambiguous'. A disabled option (react-select's own
 *   isOptionDisabled), a disabled select, a multi that is not one (or the reverse) and an option chosen already
 *   ('chosen': choosing a multi-select's again removes it) are refused. Otherwise react-select's own selectOption,
 *   which closes its menu and leaves its text box as its props say, exactly as a click on the option in its list does.
 *   Never an onChange with an object of ours, never an event;
 * - react.field: the nearest React component above the element whose props hold a field (props.field, else
 *   props.fieldEntry.field: Ashby's), read as {type, path}, each a short printable string; no value, no label.
 * The page fully controls this world: it can read every command, wrap every function the bridge calls, forge commands
 * (they can only make the bridge choose its own widget's own option, which the page could do itself) and forge
 * answers (the isolated world never trusts one: it reads the widget back itself). So nothing may be sent here that the
 * page should not read. A command carries its op, an option's label as the frame read it from the page (the answer
 * the fill is about to show the page anyway, a moment earlier), whether a multi-select's, and a random id; never a
 * profile value. Any later op
 * holds to the same rule: no text into this world but what is being written into that same field at that moment. A
 * page can also tell the extension is installed, from document_start, by the bridge's acknowledgement of a command.
 */
import {
  BRIDGE_COMMAND, BRIDGE_RESULT, bridgeLabel, encodeAnswer, fieldText, parseCommand, type BridgeAnswer,
  type BridgeCommand, type BridgeField,
} from '../dom/bridge-protocol';

/** The furthest up the fiber tree the bridge looks, from the element. */
const MAX_DEPTH = 60;
/** The most options of one select it reads. */
const MAX_OPTIONS = 5_000;

/** React's own key for an element's fiber: `__reactFiber$<random>`, `__reactInternalInstance$<random>` before 17. */
const FIBER_KEY = /^__react(?:Fiber|InternalInstance)\$/;

/** A fiber, as far as the bridge reads one. */
interface Fiber {
  return?: Fiber | null;
  type?: unknown;
  stateNode?: unknown;
  memoizedProps?: unknown;
}

/** A react-select Select instance, as far as the bridge reads one. */
interface SelectInstance {
  props: { options?: unknown; isMulti?: unknown; isDisabled?: unknown; getOptionLabel?: unknown };
  state?: { selectValue?: unknown };
  inputRef?: unknown;
  selectOption(option: unknown): void;
  isOptionDisabled?(option: unknown, selectValue: readonly unknown[]): boolean;
  isOptionSelected?(option: unknown, selectValue: readonly unknown[]): boolean;
}

type Outcome = Pick<BridgeAnswer, 'ok' | 'reason' | 'field'>;

/** Installs the bridge on a document; answers its removal (the tests remove it). */
export function installBridge(doc: Document): () => void {
  const view = doc.defaultView;
  if (view === null) return () => undefined;
  const isArray = Array.isArray;

  const fiberOf = (el: Element): Fiber | null => {
    const key = Object.keys(el).find((name) => FIBER_KEY.test(name));
    const fiber = key === undefined ? undefined : (el as unknown as Record<string, unknown>)[key];
    return typeof fiber === 'object' && fiber !== null ? fiber as Fiber : null;
  };

  /** The react-select Select whose own text box `el` is, walking up from its fiber. */
  const selectOf = (fiber: Fiber, el: Element): SelectInstance | null => {
    let at: Fiber | null | undefined = fiber;
    for (let depth = 0; at && depth < MAX_DEPTH; depth += 1, at = at.return) {
      const node = at.stateNode as Partial<SelectInstance> | null | undefined;
      if (typeof node !== 'object' || node === null || typeof node.selectOption !== 'function') continue;
      const props = node.props;
      if (typeof props !== 'object' || props === null || !isArray(props.options)) continue;
      return node.inputRef === el ? node as SelectInstance : null;
    }
    return null;
  };

  /** A select's options, its groups' options in their place. */
  const optionsOf = (select: SelectInstance): unknown[] => {
    const flat: unknown[] = [];
    for (const item of select.props.options as unknown[]) {
      const group = typeof item === 'object' && item !== null ? (item as { options?: unknown }).options : undefined;
      if (isArray(group)) flat.push(...group);
      else flat.push(item);
      if (flat.length >= MAX_OPTIONS) break;
    }
    return flat.slice(0, MAX_OPTIONS);
  };

  /** An option's label as react-select reads it (its getOptionLabel, else the option's own label). */
  const labelOf = (select: SelectInstance, option: unknown): string | null => {
    const read = select.props.getOptionLabel;
    const label = typeof read === 'function' ? (read as (option: unknown) => unknown).call(select.props, option)
      : (option as { label?: unknown } | null)?.label;
    return typeof label === 'string' ? bridgeLabel(label) : null;
  };

  type Choose = Extract<BridgeCommand, { op: 'react-select.choose' }>;
  const choose = (el: Element, fiber: Fiber, command: Choose): Outcome => {
    const select = selectOf(fiber, el);
    if (select === null) return { ok: false, reason: 'no-widget' };
    if ((select.props.isMulti === true) !== command.multi) return { ok: false, reason: 'wrong-kind' };
    if (select.props.isDisabled === true) return { ok: false, reason: 'disabled' };
    const wanted = bridgeLabel(command.label);
    const matches = optionsOf(select).filter((option) => labelOf(select, option) === wanted);
    if (matches.length === 0) return { ok: false, reason: 'no-match' };
    if (matches.length > 1) return { ok: false, reason: 'ambiguous' };
    const option = matches[0];
    const held = select.state?.selectValue;
    const chosen: readonly unknown[] = isArray(held) ? held : [];
    if (select.isOptionDisabled?.(option, chosen) === true) return { ok: false, reason: 'disabled' };
    if (select.isOptionSelected?.(option, chosen) === true) return { ok: false, reason: 'chosen' };
    select.selectOption(option);
    return { ok: true, reason: 'ok' };
  };

  const field = (fiber: Fiber): Outcome => {
    let at: Fiber | null | undefined = fiber;
    for (let depth = 0; at && depth < MAX_DEPTH; depth += 1, at = at.return) {
      if (typeof at.type === 'string') continue;
      const props = at.memoizedProps as { field?: unknown; fieldEntry?: { field?: unknown } | null } | null | undefined;
      if (typeof props !== 'object' || props === null) continue;
      const found = props.field ?? props.fieldEntry?.field;
      if (typeof found !== 'object' || found === null) continue;
      const read: BridgeField = {};
      const type = fieldText((found as { type?: unknown }).type);
      const path = fieldText((found as { path?: unknown }).path);
      if (type !== undefined) read.type = type;
      if (path !== undefined) read.path = path;
      if (type !== undefined || path !== undefined) return { ok: true, reason: 'ok', field: read };
    }
    return { ok: false, reason: 'no-field' };
  };

  const listener = (event: Event): void => {
    // The element itself, inside an open shadow root too (a closed root's is its host, which is no select's text box).
    const target = event.composedPath()[0] as Element | undefined;
    if (target === undefined || target.nodeType !== 1 || target.ownerDocument !== doc || !target.isConnected) return;
    const command = parseCommand((event as CustomEvent<unknown>).detail);
    if (command === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    let outcome: Outcome;
    try {
      const fiber = fiberOf(target);
      if (fiber === null) outcome = { ok: false, reason: 'no-react' };
      else outcome = command.op === 'react-select.choose' ? choose(target, fiber, command) : field(fiber);
    } catch {
      outcome = { ok: false, reason: 'failed' };
    }
    const detail = encodeAnswer({ v: 1, id: command.id, ...outcome });
    target.dispatchEvent(new view.CustomEvent(BRIDGE_RESULT, { detail, bubbles: false, cancelable: false,
      composed: false }));
  };
  doc.addEventListener(BRIDGE_COMMAND, listener, true);
  return () => doc.removeEventListener(BRIDGE_COMMAND, listener, true);
}
