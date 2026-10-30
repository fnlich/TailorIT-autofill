/*
 * Notices (docs/design/runtime.md §10.1; docs/ARCHITECTURE.md "UI"): a stack under the launcher holding the run's
 * notices in the plan's words (COPY.notices: the tripwire banner, "couldn't read this posting", "this form sits inside
 * another site's page", and the rest), and the policy card: "This posting says AI-assisted applications are not
 * allowed. Filling is your decision." with Fill anyway and Cancel. Every button takes trusted clicks only, so a page
 * can neither accept the policy for the person nor dismiss what it was told; the card's two also count only while a
 * person can see them (page-ui.ts decides, from the visibility watch, with the button it is handed). A dismissed
 * notice leaves the stack only; the report keeps it, and the side panel mirrors every notice, because a page could
 * draw over this one.
 */
import { COPY } from '../../shared/copy';
import type { FrameReport } from '../../shared/report';

/** A report notice's code. */
export type NoticeCode = FrameReport['notices'][number]['code'];

/** The person's answer on the policy card. */
export type PolicyChoice = 'accepted' | 'declined';

/** The notices layer. */
export interface Notices {
  readonly el: HTMLElement;
  /** Shows these notices (in this order), apart from any the person dismissed in this run. */
  set(codes: readonly NoticeCode[]): void;
  /** Forgets what the person dismissed: a new run shows its notices afresh. */
  reset(): void;
  showPolicyCard(options: { fromStoredCopy: boolean }): void;
  hidePolicyCard(): void;
  readonly cardShown: boolean;
  /** The card's Cancel and Fill anyway buttons. */
  readonly cardButtons: readonly HTMLButtonElement[];
  /** The codes shown now (for tests). */
  readonly shown: readonly NoticeCode[];
}

/** Creates the notices stack. `onPolicyChoice` is called inside a trusted click's handler, with the button clicked. */
export function createNotices(doc: Document, onPolicyChoice: (choice: PolicyChoice, button: HTMLButtonElement) => void):
  Notices {
  const el = doc.createElement('div');
  el.className = 'notices';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', COPY.appName);
  const card = doc.createElement('div');
  card.className = 'card';
  card.setAttribute('role', 'alertdialog');
  const sentence = doc.createElement('p');
  sentence.textContent = COPY.notices.policy;
  const source = doc.createElement('p');
  source.className = 'source';
  source.textContent = COPY.policyFromStoredCopy;
  const actions = doc.createElement('div');
  actions.className = 'actions';
  const cancel = button(doc, COPY.policyCancel, 'action secondary');
  const fill = button(doc, COPY.policyFillAnyway, 'action');
  actions.append(cancel, fill);
  card.append(sentence, source, actions);
  card.hidden = true;
  el.append(card);
  cancel.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    onPolicyChoice('declined', cancel);
  });
  fill.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    onPolicyChoice('accepted', fill);
  });

  const dismissed = new Set<NoticeCode>();
  let codes: readonly NoticeCode[] = [];
  let items: HTMLElement[] = [];

  function render(): void {
    for (const item of items) item.remove();
    items = codes.filter((code) => !dismissed.has(code)).map((code) => {
      const item = doc.createElement('div');
      item.className = 'notice';
      item.dataset.code = code;
      item.setAttribute('role', code === 'tripwire' ? 'alert' : 'status');
      const text = doc.createElement('p');
      text.textContent = COPY.notices[code];
      // The glyph is drawn by the stylesheet, so the notice's text is exactly its sentence.
      const close = button(doc, '', 'dismiss');
      close.setAttribute('aria-label', COPY.dismiss);
      close.title = COPY.dismiss;
      close.addEventListener('click', (event) => {
        if (!event.isTrusted) return;
        dismissed.add(code);
        render();
      });
      item.append(text, close);
      el.append(item);
      return item;
    });
    el.hidden = card.hidden && items.length === 0;
  }
  render();

  return {
    el,
    set(next) {
      codes = [...new Set(next)];
      render();
    },
    reset() {
      dismissed.clear();
      render();
    },
    showPolicyCard({ fromStoredCopy }) {
      source.hidden = !fromStoredCopy;
      card.hidden = false;
      render();
    },
    hidePolicyCard() {
      card.hidden = true;
      render();
    },
    get cardShown() {
      return !card.hidden;
    },
    cardButtons: [cancel, fill],
    get shown() {
      return items.map((item) => item.dataset.code as NoticeCode);
    },
  };
}

function button(doc: Document, text: string, className: string): HTMLButtonElement {
  const el = doc.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = text;
  return el;
}
