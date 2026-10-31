/*
 * Where the 4-step wizard fixture is served (fixtures/synthetic/wizard-4-step; docs/FIXTURES.md "wizard-4-step"): the
 * reserved fixture board's wizard-4-step application, and one more per e2e case (wizard-4-step-<case>), so each case
 * has a RunState of its own. Pure: it reads the address it is given, never the page, so the e2e helpers (which run in
 * Node) share it with the wizard's test adapter (./wizard.ts).
 */

/** The wizard's first address. */
export const WIZARD_URL = 'https://jobs.lever.co/tailorit-fixture/wizard-4-step/apply';

/** The wizard's paths: wizard-4-step, or wizard-4-step-<case> in lower-case words joined by hyphens, then /apply. */
const WIZARD_PATH = /^\/tailorit-fixture\/wizard-4-step(?:-[a-z0-9]+)*\/apply$/;

/** Whether an address shows the wizard (its query and fragment aside). */
export function isWizardUrl(url: URL): boolean {
  return url.origin === 'https://jobs.lever.co' && WIZARD_PATH.test(url.pathname);
}
