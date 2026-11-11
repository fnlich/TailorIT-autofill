/*
 * The basis of a right to work (the owner's decisions of 2026-11-01, docs/SPEC-AMENDMENTS.md §11; the live BeyondTrust
 * form): a work-authorization question whose options say on what basis the person may work, not yes or no: "I have the
 * right to work in the country of employment on a permanent basis", "I have or will obtain a work permit not requiring
 * sponsorship/immigration support from BeyondTrust", "I will require sponsorship or other immigration support to obtain
 * the right to work in the country of employment". The polarity rule finds no yes among them, so each option is read
 * by its meaning, never by its exact words:
 * - sponsorship: it names sponsorship (or immigration or visa support, an H-1B) and no word right before it denies the
 *   need ("I will require sponsorship", "Visa holder, sponsorship required");
 * - permanent: it names a permanent right (permanent, a citizen, a green card, indefinite leave, settled status) and no
 *   permit or visa, and any sponsorship it names is denied ("Citizen / Permanent Resident"); a non-citizen is none
 *   (jr6 RULES, JZ-7: "Non-citizen allowed to work for any employer");
 * - permit: it names a permit or a visa, no permanent right, and denies needing sponsorship ("a work permit not
 *   requiring sponsorship", "Visa holder (no sponsorship needed)");
 * - none (jr6 RULES, SR-12: SmartRecruiters' Xplor, "I do not currently have any US work rights"): it denies any right
 *   to work, or any authorization.
 * A list is a basis set when every option it offers (a placeholder, a decline, "Other" and "None of the above" aside)
 * reads as exactly one of these, none with injected text cut, and it offers the permanent one and the sponsorship one.
 * jr6 RULES (SR-12): a class may hold several options ("I am a US citizen" and "I am a US lawful permanent resident
 * (Green Card holder)", both permanent): the policy chooses among them by the person's status. Any other list is read as
 * before. Which option the person's answers give is the policy's (policy.ts legalValue); this file only reads the
 * options. Pure: page text is read, nothing is kept.
 */
import { prepareOptions } from '../matcher/prepare';
import { normalize } from '../text/normalize';
import type { FieldSpec } from '../types/field';
import type { Vocab } from '../vocab/types';

/** What a basis option says of the person's right to work. */
export const BASIS_CLASSES = ['permanent', 'permit', 'sponsorship', 'none'] as const;
export type BasisClass = (typeof BASIS_CLASSES)[number];

/** Sponsorship, or the support that stands for it. */
const SPONSOR = /\b(?:sponsor\w*|immigration\s+(?:support|assistance|help)|visa\s+(?:support|assistance|transfer)|h\s?1\s?b)\b/;
/** A need of sponsorship denied right before it ("not requiring sponsorship", "no sponsorship", "don't need visa
 *  support", "without any sponsorship"), or right after it ("sponsorship not required"). A denial further off belongs
 *  to another clause ("I am not a citizen and will require sponsorship"). */
const SPONSOR_DENIED = /\b(?:not|no|never|without|dont|doesnt|wont|nor)\s+(?:\w+\s+)?(?:requir\w*|need\w*|sponsor\w*|immigration\s+(?:support|assistance|help)|visa\s+(?:support|assistance))\b|\bsponsor\w*\s+(?:is\s+|are\s+)?(?:not|never)\s+(?:required|needed|necessary)\b/;
/** A permanent right to work. */
const PERMANENT = /\b(?:permanent\w*|citizen\w*|green\s+card\w*|indefinite\w*|settled\s+status|naturali[sz]ed)\b/;
/** jr6 RULES (JZ-7): a non-citizen, which PERMANENT's "citizen" must never read as one. */
const NON_CITIZEN = /\bnon\s?citizens?\b/g;
/** A permit or a visa held. */
const PERMIT = /\b(?:permits?|visas?|ead|temporar\w*)\b/;
/** jr6 RULES (SR-12): no right to work at all ("I do not currently have any US work rights", "I am not authorized to
 *  work in the US"). */
const NO_RIGHT = /\b(?:do\s+not|dont|does\s+not|doesnt|not|no)\s+(?:currently\s+)?(?:have\s+|hold\s+|possess\s+)?(?:a\s+|any\s+)?(?:legal\s+)?(?:\w+\s+)?(?:work\s+rights?|rights?\s+to\s+work|work\s+authori[sz]ation)\b|\bnot\s+(?:currently\s+)?(?:legally\s+)?(?:authori[sz]ed|eligible|permitted|entitled)\s+to\s+work\b/;

/** An option's words as the rules read them: folded, its brackets' words kept, nothing left out. */
function wordsOf(label: string): string {
  return normalize(label.replace(/[()[\]]/g, ' '), 'label').folded;
}

/** What one option's label says of the person's right to work, or null when it says none of them. */
export function basisClassOf(label: string): BasisClass | null {
  const words = wordsOf(label);
  const sponsor = SPONSOR.test(words);
  const denied = sponsor && SPONSOR_DENIED.test(words);
  if (sponsor && !denied) return 'sponsorship';
  if (NO_RIGHT.test(words)) return 'none';
  const permanent = PERMANENT.test(words.replace(NON_CITIZEN, ' '));
  const permit = PERMIT.test(words);
  if (permanent && !permit) return 'permanent';
  if (permit && !permanent && denied) return 'permit';
  return null;
}

/** One basis option: its index among the field's options and its clean label. */
export interface BasisOption {
  index: number;
  clean: string;
}

/** A basis set read: each class's options, in the list's order. */
export type BasisOptions = ReadonlyMap<BasisClass, readonly BasisOption[]>;

/** The field's options as a basis set (module header), or null: options not read (or read in part), an option with
 *  injected text cut, an option that reads as none of the classes, or no permanent or no sponsorship option. */
export function readBasisOptions(spec: Pick<FieldSpec, 'options' | 'optionsPartial'>, vocab: Vocab): BasisOptions | null {
  if (spec.options === 'lazy' || spec.optionsPartial === true) return null;
  const options = new Map<BasisClass, BasisOption[]>();
  for (const option of prepareOptions(spec.options, 'generic', vocab).list) {
    if (option.injected) return null;
    if (option.unusable || option.decline || option.other || option.exclusive) continue;
    const kind = basisClassOf(option.clean);
    if (kind === null) return null;
    options.set(kind, [...(options.get(kind) ?? []), { index: option.index, clean: option.clean }]);
  }
  return options.has('permanent') && options.has('sponsorship') ? options : null;
}

/** The class of the option at `index` in a basis set, or null when it is none of the set's. */
export function basisClassAt(options: BasisOptions, index: number): BasisClass | null {
  for (const [kind, list] of options) if (list.some((option) => option.index === index)) return kind;
  return null;
}
