/*
 * Which section a field sits in (docs/design/runtime.md §5.9), part of its key: the adapter's section (with the block
 * index in a repeatable section), else the nearest fieldset's visible legend, else the nearest preceding visible
 * heading (h1 to h6 or role=heading) inside the form root, else 'main'. A fieldset whose legend is the field's own
 * label (a radio group's question) is skipped, so a group is not its own section. Ids are slugs of page text, built by
 * the core's headingSlug, so the worker and every frame agree on them.
 */
import type { Adapter } from '../adapters/types';
import { headingSlug } from '../core/text/keys';
import type { SectionRef } from '../core/types/field';
import { capCodePoints } from '../core/text/fold';
import { legendOf } from './labels';
import type { ScanCache } from './scan-cache';
import { TEXT_CAP_SECTION } from './thresholds';
import { visibleText } from './visible-text';
import { isUserVisible } from './visibility';

/** The section id when nothing names one. */
export const DEFAULT_SECTION = 'main';

/** Finds sections for the fields of one form root. */
export interface SectionFinder {
  /** The section of the field whose control (or group container) is `target`. `ownLabel` is the element its label
   *  was read from, so a fieldset whose legend that is gets skipped. */
  sectionOf(target: Element, ownLabel: Element | null): SectionRef;
}

/** A section finder for one scan of `root`. */
export function sectionFinder(root: Element, adapter: Adapter | null, cache: ScanCache): SectionFinder {
  const declared = adapter?.sections?.(root) ?? [];
  const repeatables = (adapter?.repeatables?.(root) ?? []).map((entry) => ({ kind: entry.kind, blocks: entry.blocks() }));
  const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'))
    .filter((heading) => isUserVisible(heading, cache))
    .map((heading) => ({ el: heading, slug: slugOf(visibleText(heading, { singleLine: true, cache })) }))
    .filter((heading) => heading.slug !== '');

  return {
    sectionOf(target, ownLabel) {
      for (const repeatable of repeatables) {
        const block = repeatable.blocks.findIndex((el) => el.contains(target));
        if (block >= 0) return { id: repeatable.kind, block };
      }
      let best: { el: Element; id: string } | null = null;
      for (const section of declared) {
        if (!section.el.contains(target)) continue;
        if (best !== null && !best.el.contains(section.el)) continue;
        const id = section.kind ?? slugOf(section.label);
        if (id !== '') best = { el: section.el, id };
      }
      if (best !== null) return { id: best.id };
      for (let fieldset = target.closest('fieldset'); fieldset !== null;
        fieldset = fieldset.parentElement?.closest('fieldset') ?? null) {
        const legend = legendOf(fieldset);
        if (legend === null || legend === ownLabel || !isUserVisible(legend, cache)) continue;
        const slug = slugOf(visibleText(legend, { singleLine: true, cache }));
        if (slug !== '') return { id: slug };
      }
      const heading = precedingHeading(headings, target);
      return { id: heading ?? DEFAULT_SECTION };
    },
  };
}

/** Node.DOCUMENT_POSITION_FOLLOWING, without reaching for a page global. */
const FOLLOWING = 4;

function slugOf(text: string): string {
  return capCodePoints(headingSlug(text), TEXT_CAP_SECTION);
}

/** The slug of the last heading before `target` in document order (a binary search over the visible headings). */
function precedingHeading(headings: ReadonlyArray<{ el: Element; slug: string }>, target: Element): string | null {
  let low = 0;
  let high = headings.length - 1;
  let found: string | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const heading = headings[mid]!;
    const follows = (heading.el.compareDocumentPosition(target) & FOLLOWING) !== 0 && !heading.el.contains(target);
    if (follows) {
      found = heading.slug;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
