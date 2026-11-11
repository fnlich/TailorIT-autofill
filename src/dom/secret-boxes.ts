/*
 * The jr6 review (sec-5): the boxes a sign-in typed the job-site password into (content/sign-in.ts), kept as elements
 * alone (a WeakSet: nothing of their values, and nothing kept once the page drops them). A box stays one whatever the
 * page later makes of it: a page's "Show password" turns it into a text box, which the scanner would otherwise read as
 * a field (a plan could write over it, and v1.3 B's capture would read the password as an answer and send it to
 * TailorIT). dom/kinds.ts kindOf reads it, so the scanner, the planner, the pre-write guard and the capture all keep
 * treating such a box as the password box it is (an auth field: never a field, and its step is filled no further).
 */

/** The boxes the job-site password was typed into, in every document of this frame. */
const typed = new WeakSet<Element>();

/** Marks `box` as one the job-site password was typed into (content/sign-in.ts alone). */
export function markSecretBox(box: Element): void {
  typed.add(box);
}

/** Whether the job-site password was typed into `el` (module header). */
export function isSecretBox(el: Element): boolean {
  return typed.has(el);
}
