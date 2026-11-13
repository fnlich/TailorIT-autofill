/*
 * jr7 JDEF-7, P2 (FIX7PLAN §6.15 "P2"; after jr7-engine-e2, jr7-rules-r2, jr7-auto-done and jr7-chain-done): the
 * shared outcomes on jobdiva2's captures, with the real content runtime, the JobDiva adapter and a fake worker:
 * - JDV-8 (with JDV-V2), the regression test FIX7PLAN §7 names: the run fills Quick Apply and presses its own Submit
 *   Application (Submit mode Auto), then fills the two "EEO Form" steps the dialog draws in place and presses their
 *   Next and Save (Next mode Auto), under the one arm, and the "Thank you!" is recorded once, as the arm's success
 *   sign, long before the run would rest SUBMIT_CONFIRM_MS (45 s) after its Submit;
 * - JDV-10: that sign is read through content/submitted.ts (success-message) only after a Submit of this document,
 *   never where no Submit was armed.
 * The test stands in for the portal's own script: each press draws the next capture's dialog in place (its content
 * from jr7-jobdiva2-eeo, -veteran and -confirmation), and a step's button enables once its questions are answered, as
 * the captures show (Next and Save disabled until answered). The plan's answers are the golden synthetic profile's.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import confirmationHtml from '../../../fixtures/jobdiva/jr7-jobdiva2-confirmation.html?raw';
import eeoHtml from '../../../fixtures/jobdiva/jr7-jobdiva2-eeo.html?raw';
import filledHtml from '../../../fixtures/jobdiva/jr7-jobdiva2-quick-apply-filled.html?raw';
import veteranHtml from '../../../fixtures/jobdiva/jr7-jobdiva2-veteran.html?raw';
import { createFakeWorker, testVocab } from '../../content/content.testkit';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { deadline } from '../../dom/time';
import { applicationOf } from '../index';
import { wordsOf } from '../success';
import { jobDivaAdapter } from './index';

const runtimes: ContentRuntime[] = [];
beforeAll(() => {
  testVocab();
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** The address jobdiva2 was captured at (its header's source, the job's route kept). */
const SOURCE = (JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(filledHtml)![1]!) as { source: string }).source;
const KEY = applicationOf(new URL(SOURCE))!.applicationKey;
/** Submit, Next and Save in Auto: the unattended run's modes (the agent's). */
const AUTO = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' as const, next: 'auto' as const } };

/** Draws a capture's open Quick Apply dialog content in place of `doc`'s (copied node by node from the parsed capture). */
function drawDialog(doc: Document, html: string): void {
  const from = new DOMParser().parseFromString(html, 'text/html').querySelector('#quickApplyModal .modal-content')!;
  doc.querySelector('#quickApplyModal .modal-content')!
    .replaceChildren(...Array.from(from.childNodes).map((node) => doc.importNode(node, true)));
}

/** The portal's own script, stood in (module header): what each press draws in place, and the step buttons enabling
 *  once their questions are answered. Every press is recorded by its words, and at each Next and Save the options
 *  chosen on that step, by their words. */
function portal(fixture: Fixture): { pressed: string[]; answers: string[][] } {
  const { doc } = fixture;
  const pressed: string[] = [];
  const answers: string[][] = [];
  const content = () => doc.querySelector('#quickApplyModal .modal-content')!;
  const draw = (html: string) => {
    drawDialog(doc, html);
    content().querySelectorAll<HTMLButtonElement>('.job-app-btns button.btn.jd-btn').forEach((button) => {
      button.disabled = true;
    });
  };
  doc.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('button');
    if (button === null) return;
    const words = wordsOf(button);
    pressed.push(words);
    event.preventDefault();
    if (words === 'Next' || words === 'Save') {
      answers.push(Array.from(content().querySelectorAll<HTMLInputElement>('input[type="radio"]:checked'))
        .map((radio) => wordsOf(radio.nextElementSibling!)));
    }
    if (words === 'Submit Application') draw(eeoHtml);
    else if (words === 'Next') draw(veteranHtml);
    else if (words === 'Save') draw(confirmationHtml);
  }, true);
  doc.addEventListener('change', () => {
    const groups = new Set(Array.from(content().querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .map((radio) => radio.name));
    const answered = [...groups].every((name) => content().querySelector(`input[type="radio"][name="${name}"]:checked`)
      !== null);
    const next = content().querySelector<HTMLButtonElement>('.job-app-btns button.btn.jd-btn');
    if (next !== null && groups.size > 0 && answered) next.disabled = false;
  }, true);
  return { pressed, answers };
}

async function start(settings = AUTO) {
  const fixture = await loadFixture(document, filledHtml, { width: 1280, height: 900 });
  const worker = createFakeWorker({ settings });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => SOURCE, isTop: true,
    adapters: () => [jobDivaAdapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  return { fixture, worker, runtime };
}

describe('JobDiva (jr7 JDEF-7 P2): Submit, the two EEO steps in place, and the Thank you', () => {
  it('JDV-8, JDV-10: one arm through Submit Application, Next and Save; the Thank you recorded once, at once', async () => {
    const { fixture, worker, runtime } = await start();
    const { pressed, answers } = portal(fixture);
    const began = Date.now();
    await runtime.fill();
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({ applicationKey: KEY,
      evidence: 'success-message' })]), { timeout: 30_000, interval: 100 });
    // Recorded well inside the arm's window, long before the 45 s rest after the Submit.
    expect(Date.now() - began).toBeLessThan(30_000);
    expect(pressed).toEqual(['Submit Application', 'Next', 'Save']);
    expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ applicationKey: KEY, by: 'auto' })]);
    // Each step's questions were answered before its button was pressed (JDV-9's options; the golden profile's EEO
    // answers: a decline where it gives none, not a protected veteran).
    expect(answers).toEqual([['I do not wish to provide this information', 'I do not wish to provide this information'],
      ['I am not a protected veteran']]);
    await deadline(400);
    expect(worker.of('submit/detected')).toHaveLength(1);
    expect(worker.of('submit/armed')).toHaveLength(1);
    // Return to Open Jobs, the sign's companion, is never pressed.
    expect(pressed).not.toContain('Return to Open Jobs');
  }, 60_000);

  it('JDV-10: the Thank you drawn with no Submit armed in the document is no sign', async () => {
    const { fixture, worker } = await start(DEFAULT_SETTINGS);
    drawDialog(fixture.doc, confirmationHtml);
    await deadline(1_500);
    expect(worker.of('submit/armed')).toEqual([]);
    expect(worker.of('submit/detected')).toEqual([]);
  });
});
