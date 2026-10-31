/*
 * The e2e-only test adapter's hooks for the 4-step wizard fixture (fixtures/synthetic/wizard-4-step/index.html, whose
 * header says what the page does; docs/FIXTURES.md "wizard-4-step"; docs/ARCHITECTURE.md "Testing" › "Synthetic
 * fixtures"). The generic adapter knows no steps (no Next, no Submit, every step 'unknown'), so the multi-step
 * machine meets the wizard through these hooks, as it will meet Workday's through Workday's own adapter:
 * - detect: the wizard's form, whatever its shown step holds (the Review step has no field);
 * - stepSignature: the shown step's heading, the "Step N of 4" line, the address's fragment (#step-N, '' on the first
 *   step) and the step's data-step-id as its one anchor. Page text and markup only, never a value;
 * - nextButton: the shown step's Next; none on the last step;
 * - submitButton: the final Submit, found whichever step is shown, so it is never clicked;
 * - isFinalStep: 'final' on the step that holds Submit and no Next (Review), 'not-final' on a step with Next and no
 *   Submit, 'unknown' otherwise (no step shown, or both);
 * - repeatables: the shown step's experience and education blocks, each kind with its Add button, and each experience
 *   block's "I currently work here" box.
 * Every hook names the markup it reads. ./index puts these hooks over the generic adapter, with the e2e marker, for
 * the wizard's addresses only (./wizard-url.ts), and only e2e builds reach ./index (it says why a production bundle
 * cannot hold this). Nothing here runs at import time: top-level constants and functions only.
 */
import { newScanCache } from '../../dom/scan-cache';
import { visibleText } from '../../dom/visible-text';
import { isUserVisible } from '../../dom/visibility';
import type { Adapter } from '../types';

export { isWizardUrl, WIZARD_URL } from './wizard-url';

/** The repeatable kinds the wizard draws, as the adapter interface names them. */
const REPEATABLE_KINDS = ['experience', 'education'] as const;
type WizardRepeatable = (typeof REPEATABLE_KINDS)[number];

const isRepeatableKind = (kind: string | undefined): kind is WizardRepeatable =>
  (REPEATABLE_KINDS as readonly (string | undefined)[]).includes(kind);

/** The wizard's form. */
function formOf(doc: Document): HTMLFormElement | null {
  // index.html: <form id="application" class="wizard" action="/__submitted" method="post" autocomplete="off">
  return doc.querySelector<HTMLFormElement>('form#application.wizard');
}

/** The one step section a person sees, or null when none (or more than one) is shown. */
function shownStep(root: ParentNode): HTMLElement | null {
  // index.html: <section class="step" data-step="2" data-step-id="experience" hidden>, one shown at a time.
  const cache = newScanCache();
  const shown = Array.from(root.querySelectorAll<HTMLElement>('section.step[data-step]'))
    .filter((section) => isUserVisible(section, cache));
  return shown.length === 1 ? shown[0]! : null;
}

/** A shown step's Next button. */
function nextOf(step: Element): HTMLElement | null {
  // index.html: <div class="actions"> ... <button type="button" id="next-details" data-action="next">Next</button>
  return step.querySelector<HTMLElement>('button[type="button"][data-action="next"]');
}

/** The final Submit, wherever it is. */
function submitOf(root: ParentNode): HTMLElement | null {
  // index.html, the Review step: <button type="submit" id="submit">Submit application</button>
  return root.querySelector<HTMLElement>('button#submit[type="submit"]');
}

/** The wizard's step parts, as the step machine hashes them. */
function stepSignature(doc: Document): { heading?: string; progress?: string; urlPart?: string; anchors: string[] } {
  const root = formOf(doc);
  const step = root === null ? null : shownStep(root);
  if (root === null || step === null) return { anchors: [] };
  const cache = newScanCache();
  // index.html: each step's <h2> (Your details, Experience, Education, Review), and <p id="progress"
  // class="progress">Step 1 of 4</p> above the steps, which the page script rewrites as the step changes.
  const heading = step.querySelector('h2');
  const progress = root.querySelector('#progress');
  return {
    heading: heading === null ? '' : visibleText(heading, { singleLine: true, cache }),
    progress: progress === null ? '' : visibleText(progress, { singleLine: true, cache }),
    // index.html's script: history.pushState to #step-N (2 to 4); the first step's address has no fragment.
    urlPart: doc.defaultView?.location.hash ?? '',
    anchors: [step.dataset.stepId ?? ''],
  };
}

/** Final when the shown step holds the Submit and no Next; not final when it holds a Next and no Submit. */
function isFinalStep(doc: Document): 'final' | 'not-final' | 'unknown' {
  const root = formOf(doc);
  const step = root === null ? null : shownStep(root);
  if (step === null) return 'unknown';
  const next = nextOf(step) !== null;
  const submit = submitOf(step) !== null;
  if (submit && !next) return 'final';
  return next && !submit ? 'not-final' : 'unknown';
}

/** A position block's "I currently work here" box. */
function currentlyHereOf(block: Element): HTMLInputElement | null {
  return block.querySelector<HTMLInputElement>('input[type="checkbox"][data-current]');
}

/** The shown step's repeatable sections. */
function repeatables(root: Element): ReturnType<NonNullable<Adapter['repeatables']>> {
  const step = shownStep(root);
  if (step === null) return [];
  // index.html: <div id="experience-blocks" data-repeatable="experience"><div class="block" id="experience-0"
  // data-block="0"> ... </div></div> and <button type="button" id="add-experience" class="add" data-add="experience">;
  // <div id="education-blocks" data-repeatable="education"></div> and <button id="add-education" class="add"
  // data-add="education"> (typeless: a submit button inside the form).
  return Array.from(step.querySelectorAll<HTMLElement>('[data-repeatable]')).flatMap((container) => {
    const kind = container.dataset.repeatable;
    if (!isRepeatableKind(kind)) return [];
    return [{
      kind,
      blocks: () => Array.from(container.querySelectorAll(':scope > .block[data-block]')),
      addButton: () => step.querySelector<HTMLElement>(`button[data-add="${kind}"]`),
      // index.html: <label class="check"><input type="checkbox" id="current-0" name="experience[0][current]"
      // data-current> I currently work here</label>, after the block's End date (<input ... type="month" data-end>).
      ...(kind === 'experience' ? { currentlyHere: currentlyHereOf } : {}),
    }];
  });
}

/** The wizard's hooks: everything but the adapter's identity (id, URL rules, marker), which ./index adds. */
export function wizardHooks(): Pick<Required<Adapter>, 'detect' | 'stepSignature' | 'nextButton' | 'submitButton'
  | 'isFinalStep' | 'repeatables'> {
  return {
    detect(doc) {
      const formRoot = formOf(doc);
      return formRoot === null ? null : { formRoot };
    },
    stepSignature,
    nextButton(root) {
      const step = shownStep(root);
      return step === null ? null : nextOf(step);
    },
    submitButton: submitOf,
    isFinalStep,
    repeatables,
  };
}
