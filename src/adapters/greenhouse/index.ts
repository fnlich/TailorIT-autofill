/*
 * The Greenhouse adapter (docs/design/runtime.md §9; docs/ARCHITECTURE.md "Adapters"): the quirks of
 * job-boards.greenhouse.io's application form, on a job page (/<board>/jobs/<id>) and in the embed (/embed/job_app),
 * which show the same markup. Every hook was read from the owner's four snapshots, fixtures/greenhouse/gitlab-job.html,
 * discord-job.html, figma-legacy-host.html and gitlab-embed.html (captured 2026-10-29), and names the markup it relies
 * on. Legacy boards.greenhouse.io addresses redirect to job-boards (the figma capture), so this is the only form markup.
 * - Form root: form#application-form.application--form.
 * - Sections: the question blocks, named by the "Apply for this job" heading that stands above the form (outside it,
 *   where the scanner's own heading rule cannot see it); the EEOC block and a company's own demographic block, each by
 *   its heading.
 * - Upload groups (Resume/CV, Cover Letter): the file input and its label[for] ("Attach") are visually hidden. The
 *   visible Attach button beside them is the input's upload widget, and the group's div#upload-label-* its label.
 * - Widgets: the react-select inputs carry role="combobox", so the scanner reports them as lazy ARIA comboboxes, which
 *   the widget helpers (Phase 4) open with one click(). react-select opens on a mousedown, which an adapter must
 *   declare from a snapshot taken with a dropdown open; none is declared here yet, so on a live page they end flagged
 *   (or, where the question takes a search, are searched by typing).
 * - Submit: the button in .application--submit, identified so it is never clicked. The form is a single step, so a
 *   page showing the form and its Submit is the final step.
 * - Errors: the standard aria-invalid="true", which every control in the snapshots carries (as "false"). No snapshot
 *   shows Greenhouse's error text, so none is read.
 * No proxyFor: the one native checkbox (discord-job.html's consent) is drawn visible (appearance: none with a border)
 * beside its label[for].
 */
import { newScanCache } from '../../dom/scan-cache';
import { visibleText } from '../../dom/visible-text';
import { genericAdapter } from '../generic';
import type { Adapter } from '../types';
import { canonicalApplicationUrl, matchesUrl } from './url';

/** The snapshots the Greenhouse hooks were read from. */
export const GREENHOUSE_SNAPSHOTS = ['fixtures/greenhouse/gitlab-job.html', 'fixtures/greenhouse/discord-job.html',
  'fixtures/greenhouse/figma-legacy-host.html', 'fixtures/greenhouse/gitlab-embed.html'] as const;

/** Greenhouse's application form in a document, or null when the document shows none. */
function formOf(doc: Document): Element | null {
  // fixtures/greenhouse/*.html: <form method="post" id="application-form" class="application--form">
  return doc.querySelector('form#application-form.application--form');
}

/** The form's parts and their headings. */
function sections(root: Element): Array<{ el: Element; label: string }> {
  const cache = newScanCache();
  const found: Array<{ el: Element; label: string }> = [];
  const named = (el: Element, heading: Element | null | undefined) => {
    const label = heading ? visibleText(heading, { singleLine: true, cache }) : '';
    if (label !== '') found.push({ el, label });
  };
  // fixtures/greenhouse/*.html: <div class="application--container"><div class="application--header"> ... <div
  // class="application--header--title"><h2 class="section-header font-primary">Apply for this job</h2> ... </div><form
  // id="application-form"> ... <div class="application--questions"> (two blocks: the standard questions with the
  // uploads, then the board's own questions).
  const title = root.closest('.application--container')?.querySelector('.application--header--title .section-header');
  for (const block of Array.from(root.querySelectorAll('div.application--questions'))) named(block, title);
  // fixtures/greenhouse/*.html: <div class="eeoc__container body"> ... <h2 class="section-header font-primary">
  // Voluntary Self-Identification</h2>; discord-job.html: <div id="demographic-section" class="demographic--container">
  // <h3 class="section-header font-primary">Voluntary Self Identification</h3>.
  for (const block of Array.from(root.querySelectorAll('div.eeoc__container, div.demographic--container'))) {
    named(block, block.querySelector('.section-header'));
  }
  return found;
}

/** An upload group's visible label for its file input. */
function labelFor(control: Element): Element | null {
  if (control.localName !== 'input' || (control as HTMLInputElement).type !== 'file') return null;
  // fixtures/greenhouse/*.html: <div class="file-upload" role="group" aria-labelledby="upload-label-resume"
  // aria-required="true"><div id="upload-label-resume" class="label upload-label">Resume/CV<span
  // class="required">*</span></div> ... <input id="resume" class="visually-hidden" type="file"> ... </div>
  const group = control.closest('div.file-upload[role="group"]');
  const id = (group?.getAttribute('aria-labelledby') ?? '').trim();
  if (group === null || id === '' || /\s/.test(id)) return null;
  const label = control.ownerDocument.getElementById(id);
  return label !== null && group.contains(label) ? label : null;
}

/** Each upload group's file input and the visible Attach button beside it. */
function uploadWidgets(root: Element): Array<{ control: Element; input: HTMLInputElement }> {
  // fixtures/greenhouse/*.html: <div class="secondary-button"><div><button class="btn btn--pill" type="button">Attach
  // </button><label class="visually-hidden" for="resume">Attach</label><input id="resume" class="visually-hidden"
  // type="file" accept=".pdf,.doc,.docx,.txt,.rtf"></div></div> (discord-job.html's button is btn--rounded, so the
  // button is found beside the input, not by its class).
  return Array.from(root.querySelectorAll<HTMLInputElement>('div.file-upload input[type="file"]')).flatMap((input) => {
    const control = Array.from(input.parentElement?.children ?? [])
      .find((el) => el.localName === 'button' && (el as HTMLButtonElement).type === 'button');
    return control === undefined ? [] : [{ control, input }];
  });
}

/** The Submit button: identified so it is never clicked. */
function submitButton(root: Element): HTMLElement | null {
  // fixtures/greenhouse/*.html: <div class="application--submit"><button class="btn btn--pill" type="submit">Submit
  // application</button></div> (btn--rounded in discord-job.html)
  return root.querySelector<HTMLElement>('.application--submit button[type="submit"]');
}

/** One step: the page is the final step when it shows the form and its Submit button. */
function isFinalStep(doc: Document): 'final' | 'unknown' {
  const root = formOf(doc);
  return root !== null && submitButton(root) !== null ? 'final' : 'unknown';
}

/** The Greenhouse adapter. */
export const greenhouseAdapter: Adapter = {
  id: 'greenhouse',
  matchesUrl,
  canonicalApplicationUrl,
  detect(doc) {
    const formRoot = formOf(doc);
    return formRoot === null ? null : { formRoot };
  },
  sections,
  labelFor,
  uploadWidgets,
  submitButton,
  isFinalStep,
  // fixtures/greenhouse/*.html: every input carries aria-invalid="false" and aria-describedby="<id>-error ...".
  errors: (root) => genericAdapter.errors?.(root) ?? [],
};
