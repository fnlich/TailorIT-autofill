/*
 * The Jibe adapter (jr7 ICIMS-7: ICIMS7-11, FIX7PLAN §5 D-6 and §6.7 item 4; ENGINE-7 E0's stub before it): Jibe is
 * iCIMS's candidate front, <customer>.jibeapply.com, whose application is on iCIMS (./url.ts). Written from the owner's
 * snapshot7 of 2026-11-11 (icims2: oneblood.jibeapply.com/jobs/<id>, converted as
 * fixtures/jibe/jr7-icims2-jibe-posting.html, an Angular page saved with its scripts off: no form, no input). A
 * posting-only adapter:
 * - no form root, ever (detect null): the application is iCIMS's, which the iCIMS adapter fills there;
 * - the posting's own text (postingText): its description, article#description-body;
 * - its entry (entryControl): the Apply a person sees, a#link-apply, only where its href is the same job's iCIMS email
 *   gate (url.ts icimsPostingOf). It leads to another origin, so the entry door refuses it 'elsewhere' and presses
 *   nothing (src/dom/fillers/not-submit.ts entryWhereRefusal; APPLYPLAN OQ4 and the owner's Q7-13, by default no): the
 *   person follows it, and on iCIMS Autofill goes on as on any iCIMS job;
 * - the address TailorIT is given (tailoritAddress, D-6): the job's iCIMS posting, built from that link's parts, so Add
 *   job, the lookup and Applied name an ordinary iCIMS job, which Run auto-apply and the Queue tab open on iCIMS directly;
 * - never pressed (neverPress): every other link and button of the page (the site's menus, "Donate Now", the cookie
 *   banner's, the share buttons); Apply too, but by the entry door (entryNeverPressed).
 * Jobright reads such a page as iCIMS's and leaves the Apply click to the person (~core/icims-branded
 * readIcimsBrandedJob, ./shared/branded-ats-entry; cited as its behaviour). Nothing here reads, logs or sends a value.
 */
import { newScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import { platformOfUrl } from '../../shared/hosts';
import type { Adapter } from '../types';
import { canonicalApplicationUrl, icimsPostingOf } from './url';

/** The snapshots the hooks were written from. */
export const JIBE_SNAPSHOTS = ['fixtures/jibe/jr7-icims2-jibe-posting.html'] as const;

/** The posting's description: jr7-icims2-jibe-posting.html's <div class="job-description-container"> ... <article
 *  id="description-body" itemprop="description" aria-labelledby="jobDescriptionHeading" class="main-description-body">,
 *  under its h2#jobDescriptionHeading. */
function postingText(doc: Document): Element | null {
  const cache = newScanCache();
  return Array.from(doc.querySelectorAll('article#description-body')).find((el) => isUserVisible(el, cache)) ?? null;
}

/** Apply: jr7-icims2-jibe-posting.html's <a id="link-apply" class="apply __button btn-primary primary-bg-color"
 *  href="https://arc-onesolutions.icims.com/jobs/<id>/login" aria-label="Apply : <title>">Apply</a>, in the right rail
 *  (aside#right-column span#social-share), no target. */
const APPLY = 'a#link-apply[href]';

/** The Apply links a person sees and the iCIMS posting each leads to (url.ts icimsPostingOf, against `here`, the Jibe
 *  posting's own address): its href written whole (https://...), never resolved against the page's base. */
function applyLinksOf(doc: Document, here: URL): Array<{ link: HTMLElement; posting: string | null }> {
  const cache = newScanCache();
  return Array.from(doc.querySelectorAll<HTMLElement>(APPLY)).filter((link) => isUserVisible(link, cache))
    .map((link) => {
      let posting: string | null = null;
      try {
        posting = icimsPostingOf(here, new URL(link.getAttribute('href') ?? ''));
      } catch {
        posting = null;
      }
      return { link, posting };
    });
}

/** The one iCIMS posting every Apply a person sees leads to, with the first of them; null with none, or where one leads
 *  elsewhere or two disagree (Jobright's ./job-detail-entry presses an iCIMS Apply only where every visible copy leads
 *  to the same address; cited as its behaviour). */
function applyOf(doc: Document, here: URL): { link: HTMLElement; posting: string } | null {
  const links = applyLinksOf(doc, here);
  const first = links[0];
  if (first === undefined || first.posting === null) return null;
  return links.every((each) => each.posting === first.posting) ? { link: first.link, posting: first.posting } : null;
}

/** The document's own address, or null where it cannot be read (a fixture's srcdoc page). */
function hereOf(doc: Document): URL | null {
  try {
    return new URL(doc.location.href);
  } catch {
    return null;
  }
}

/** The posting's Apply (Adapter.entryControl): applyOf's link at the page's own address; null where the page shows no
 *  Apply that is the same job's iCIMS gate. The entry door refuses it 'elsewhere' (module header). */
function entryControl(doc: Document): HTMLElement | null {
  const here = hereOf(doc);
  return here === null ? null : applyOf(doc, here)?.link ?? null;
}

/** The address TailorIT is given for the page (Adapter.tailoritAddress; D-6): the job's iCIMS posting, read from the
 *  Apply a person sees (applyOf), built from its parts; null (the page's own address goes) where none shows. AUTO-7's
 *  worker checks it again (url.ts checkedIcimsPosting). */
function tailoritAddress(doc: Document, here: URL): string | null {
  return applyOf(doc, here)?.posting ?? null;
}

/** Every control a press could follow (module header): links, buttons and their roles, and form buttons. */
const PRESSABLE = ['a', 'area', 'button', 'summary', '[role="button" i]', '[role="link" i]', '[role="menuitem" i]',
  '[role="tab" i]', 'input[type="submit" i]', 'input[type="button" i]', 'input[type="image" i]',
  'input[type="reset" i]'].join(', ');

/** The controls never pressed (module header): every one of the page's (Apply's press is the entry door's alone). */
function neverPress(root: Element): Element[] {
  return Array.from(root.ownerDocument.querySelectorAll(PRESSABLE));
}

/** The Jibe adapter. */
export const jibeAdapter: Adapter = {
  id: 'jibe',
  /** Its candidate paths, as src/shared/hosts.ts names them. */
  matchesUrl: (url) => platformOfUrl(url.href) === 'jibe',
  canonicalApplicationUrl,
  detect: () => null,
  postingText,
  entryControl,
  entryNeverPressed: true,
  neverPress,
  tailoritAddress,
};
