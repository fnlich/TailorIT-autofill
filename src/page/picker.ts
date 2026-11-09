/*
 * v5 p2-fill (PLAN decision 14, Jobright's file-picker interception in our own design): a page's own file picker,
 * armed for one press of a résumé control its adapter declares (Adapter.uploadPickers), in the page's own world
 * (page/patches.ts makes this arm only once first asked).
 * - picker.arm, sent by the isolated world on the control right before it presses it (dom/fillers/picker.ts), shadows
 *   HTMLInputElement.prototype.click with a wrapper and, where the browser has it, window.showOpenFilePicker; they are
 *   put back as they were at the first of: the page opening its picker once, picker.disarm, or PICKER_ARM_MS.
 * - While armed, the page's click() on a file input of this document opens no picker: the patch tells the isolated
 *   world which input it was (PICKED on the armed control, the input as its relatedTarget, detail PICKED_INPUT),
 *   and the isolated world puts the chosen résumé into that input itself, as any file is put in (fillers/file.ts). A
 *   click() on any other input, and every call once disarmed, goes to the page's own click as before.
 * - v5 p2-fill review (security 7c): the element armed is the pressed control's scope (its parent, or what its adapter
 *   declares: Adapter.uploadPickerScope), and only a file input inside it (open shadow roots included), or one made at
 *   the press and never put in the page, is taken; a click() on any other file input (another upload's, the person's
 *   own press elsewhere) opens the page's picker as always. The isolated world also disarms at the person's own pointer
 *   or key during the press's wait (dom/fillers/picker.ts).
 * - While armed, the page's showOpenFilePicker() is answered with a promise and PICKED (no input, detail
 *   PICKED_FILE_SYSTEM); the isolated world answers with SUPPLY on the armed control, its relatedTarget a detached
 *   file input holding the one file, and the promise resolves with one handle (kind 'file', the file's name, getFile).
 *   No answer within PICKER_ARM_MS, or an answer without exactly one file, rejects it as a person's Cancel would
 *   (AbortError).
 * - It holds no data: the armed control while armed, and a pending promise's resolution. The résumé crosses into this
 *   world only in answer to the page's own showOpenFilePicker during the arm, to the page that asked for a file, as the
 *   upload itself hands it to the page.
 * The page fully controls this world: it can call the click it kept, see the wrappers, and forge PICKED during
 * an arm (the isolated world then puts the résumé into an input of the page's own choosing on this document: the page
 * the résumé is being uploaded to).
 */
import { PICKED, PICKED_FILE_SYSTEM, PICKED_INPUT, PICKER_ARM_MS, SUPPLY } from '../dom/patch-protocol';

/** v5 p2-fill review (security 7c): whether `input` lies inside `scope`, across open shadow roots, or was never put in
 *  the page (made at the press). */
function inScope(scope: Element, input: Node): boolean {
  if (!input.isConnected) return true;
  for (let at: Node | null = input; at !== null; at = at.parentNode ?? (at as ShadowRoot).host ?? null) {
    if (at === scope) return true;
  }
  return false;
}

/** A page's own file picker, armed for one press at a time. */
export interface PickerArm {
  /** Arms the picker for a press of `control` (a second arm replaces the first). Answers whether it was armed. */
  arm(control: Element): boolean;
  /** Puts back what the arm shadowed, if it is still armed. */
  disarm(): void;
}

/** A file handle as showOpenFilePicker resolves with one, as far as pages read it. */
interface Handle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

/** The page's picker for `doc`, in its window `view` (see the header). */
export function pickerArm(doc: Document, view: Window & typeof globalThis): PickerArm {
  let armed: { control: Element; restore(): void; timer: number } | null = null;

  const disarm = (): void => {
    const was = armed;
    armed = null;
    if (was === null) return;
    view.clearTimeout(was.timer);
    was.restore();
  };

  /** Tells the isolated world, on the armed control, what the page opened. */
  const tell = (control: Element, input: HTMLInputElement | null, detail: number): void => {
    try {
      control.dispatchEvent(new view.FocusEvent(PICKED, { relatedTarget: input, detail, bubbles: false,
        cancelable: false, composed: false }));
    } catch {
      // Nothing heard: the isolated world's wait ends by itself.
    }
  };

  /** showOpenFilePicker's answer, by the isolated world's SUPPLY on `control`, or a Cancel. */
  const supplied = (control: Element): Promise<Handle[]> => new view.Promise<Handle[]>((resolve, reject) => {
    let timer = 0;
    const onSupply = (event: Event): void => {
      if (event.target !== control) return;
      control.removeEventListener(SUPPLY, onSupply);
      view.clearTimeout(timer);
      const carrier = (event as FocusEvent).relatedTarget;
      const files = carrier instanceof view.HTMLInputElement && carrier.type === 'file' ? carrier.files : null;
      const file = files !== null && files.length === 1 ? files[0] : undefined;
      if (file === undefined) {
        reject(new view.DOMException('The user aborted a request.', 'AbortError'));
        return;
      }
      resolve([{ kind: 'file', name: file.name, getFile: () => view.Promise.resolve(file) }]);
    };
    control.addEventListener(SUPPLY, onSupply);
    timer = view.setTimeout(() => {
      control.removeEventListener(SUPPLY, onSupply);
      reject(new view.DOMException('The user aborted a request.', 'AbortError'));
    }, PICKER_ARM_MS);
  });

  const arm = (control: Element): boolean => {
    disarm();
    const proto = view.HTMLInputElement?.prototype;
    if (proto === undefined) return false;
    const ownClick = Object.getOwnPropertyDescriptor(proto, 'click');
    const pageClick = proto.click;
    const picker = (view as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    const ownPicker = Object.getOwnPropertyDescriptor(view, 'showOpenFilePicker');
    const click = function (this: HTMLInputElement): void {
      const now = armed;
      if (now !== null && this instanceof view.HTMLInputElement && this.type === 'file' && this.ownerDocument === doc
        && inScope(now.control, this)) {
        disarm();
        tell(now.control, this, PICKED_INPUT);
        return;
      }
      Reflect.apply(pageClick, this, []);
    };
    const filePicker = function (this: unknown, ...args: unknown[]): unknown {
      const now = armed;
      if (now === null || typeof picker !== 'function') {
        return Reflect.apply(picker as (...a: unknown[]) => unknown, this, args);
      }
      disarm();
      const answer = supplied(now.control);
      tell(now.control, null, PICKED_FILE_SYSTEM);
      return answer;
    };
    const restores: Array<() => void> = [];
    try {
      Object.defineProperty(proto, 'click', { configurable: true, enumerable: true, writable: true, value: click });
      restores.push(() => {
        if (proto.click !== click) return;
        if (ownClick === undefined) delete (proto as unknown as Record<string, unknown>).click;
        else Object.defineProperty(proto, 'click', ownClick);
      });
      if (typeof picker === 'function') {
        Object.defineProperty(view, 'showOpenFilePicker', { configurable: true, enumerable: true, writable: true,
          value: filePicker });
        restores.push(() => {
          const record = view as unknown as Record<string, unknown>;
          if (record.showOpenFilePicker !== filePicker) return;
          if (ownPicker === undefined) delete record.showOpenFilePicker;
          else Object.defineProperty(view, 'showOpenFilePicker', ownPicker);
        });
      }
    } catch {
      restores.forEach((step) => step());
      return false;
    }
    armed = { control, restore: () => restores.forEach((step) => step()), timer: view.setTimeout(disarm, PICKER_ARM_MS) };
    return true;
  };

  return { arm, disarm };
}
