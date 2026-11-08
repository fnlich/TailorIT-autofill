/*
 * The dock's "Continue to the next page" and "Submit application" (v3 Phase 4, StepDock.tsx): offered only at rest for
 * the frame whose step offers it, Next on a step not final and Submit on the last; a Submit the frame answers
 * 'required-empty' asks the person's word first; "Submitting…" while it waits for the confirmation; never in a dry run.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PressAnswer, StepTarget } from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { button, click, frameReport, manualClock, mount, SEEN_AT_ONCE, unmountAll } from '../ui.testkit';
import { Report } from './Report';
import { dockOf } from './StepDock';
import { CONTROL_SEEN_MS } from '../panel/seen';

afterEach(() => unmountAll());

function presses(answers: PressAnswer[]) {
  const asked: Array<[number, StepTarget, boolean]> = [];
  const onPress = async (frameId: number, target: StepTarget, confirmed: boolean) => {
    asked.push([frameId, target, confirmed]);
    return answers.shift() ?? { outcome: 'pressed' as const };
  };
  return { asked, onPress };
}

describe('the step dock (v3 Phase 4)', () => {
  it('offers Submit on the last step, asks the person’s word while required fields are empty, then presses', async () => {
    const { asked, onPress } = presses([{ outcome: 'required-empty', count: 2 }, { outcome: 'pressed' }]);
    const reports = [frameReport(0, { status: 'review', buttons: { final: 'final', next: false, submit: true } })];
    const root = await mount(<Report reports={reports} onPress={onPress} clock={SEEN_AT_ONCE} />);
    const submit = button(root, COPY.panel.step.submit);
    expect(submit).not.toBeNull();
    await click(submit);
    expect(asked).toEqual([[0, 'submit', false]]);
    const question = root.querySelector('[data-step-confirm]');
    expect(question?.textContent).toContain(COPY.panel.step.confirmEmpty(2));
    await click(button(root, COPY.panel.step.submitAnyway));
    expect(asked).toEqual([[0, 'submit', false], [0, 'submit', true]]);
  });

  it('offers Next on a step not final, says a refusal, and offers nothing while a run works or in a dry run', async () => {
    const { asked, onPress } = presses([{ outcome: 'blocked' }]);
    const next = [frameReport(0, { status: 'review', buttons: { final: 'not-final', next: true, submit: false } })];
    const root = await mount(<Report reports={next} onPress={onPress} clock={SEEN_AT_ONCE} />);
    await click(button(root, COPY.panel.step.next));
    expect(asked).toEqual([[0, 'next', false]]);
    expect(root.querySelector('[data-step-said]')?.textContent).toBe(COPY.panel.step.outcomes.blocked);
    expect(dockOf([frameReport(0, { status: 'fill-step', buttons: { final: 'final', next: false, submit: true } })]))
      .toBeNull();
    expect(dockOf([frameReport(0, { status: 'review', mode: 'dry-run', buttons: { final: 'final', next: false, submit: true } })]))
      .toBeNull();
    // A step the adapter cannot tell, or one that shows neither: nothing.
    expect(dockOf([frameReport(0, { status: 'review', buttons: { final: 'unknown', next: true, submit: true } })])).toBeNull();
    // The in-page panel acts on its own frame alone.
    expect(dockOf([frameReport(3, { status: 'review', buttons: { final: 'final', next: false, submit: true } })], 0)).toBeNull();
  });

  it('reads "Submitting…" while a pressed Submit waits for its confirmation', async () => {
    const { onPress } = presses([]);
    const reports = [frameReport(0, { status: 'review', buttons: { final: 'final', next: false, submit: true,
      pressed: 'submit' } })];
    const root = await mount(<Report reports={reports} onPress={onPress} clock={SEEN_AT_ONCE} />);
    const dock = root.querySelector<HTMLButtonElement>('button[data-step-action="submit"]')!;
    expect(dock.textContent).toContain(COPY.panel.step.submitting);
    expect(dock.disabled).toBe(true);
  });

  it('keeps "Submitting…" while the page disables its own Submit as it sends, and says Submitted once confirmed (the review)', async () => {
    const { onPress } = presses([]);
    // The page disabled its Submit while it sends: the report says it no longer shows, but the press waits.
    const sending = [frameReport(0, { status: 'review', buttons: { final: 'final', next: false, submit: false,
      pressed: 'submit' } })];
    const root = await mount(<Report reports={sending} onPress={onPress} clock={SEEN_AT_ONCE} />);
    const dock = root.querySelector<HTMLButtonElement>('button[data-step-action="submit"]')!;
    expect(dock.textContent).toContain(COPY.panel.step.submitting);
    // The platform confirmed it: Submitted, and nothing to press.
    const done = await mount(<Report reports={[frameReport(0, { status: 'done' })]} onPress={onPress} submitted clock={SEEN_AT_ONCE} />);
    const submittedButton = done.querySelector<HTMLButtonElement>('button[data-step-action="submitted"]')!;
    expect(submittedButton.textContent).toContain(COPY.panel.step.submitted);
    expect(submittedButton.disabled).toBe(true);
    expect(done.querySelector('.tia-dock')).not.toBeNull();
  });

  it('says how many fields the page marked when it did not accept a press (the review)', async () => {
    const { onPress } = presses([{ outcome: 'not-accepted', count: 2 }]);
    const next = [frameReport(0, { status: 'review', buttons: { final: 'not-final', next: true, submit: false } })];
    const root = await mount(<Report reports={next} onPress={onPress} clock={SEEN_AT_ONCE} />);
    await click(button(root, COPY.panel.step.next));
    expect(root.querySelector('[data-step-said]')?.textContent).toBe(COPY.panel.step.notAccepted(2));
  });
});

// v5 p1-panel (the Phase 1 review, S2): the dock's meaning follows the page, so a changed meaning waits CONTROL_SEEN_MS.
describe('the step dock’s hold (v5)', () => {
  it('takes no click until what it says has been shown CONTROL_SEEN_MS, and again after Continue turns Submit', async () => {
    const clock = manualClock();
    const { asked, onPress } = presses([]);
    const next = [frameReport(0, { status: 'review', buttons: { final: 'not-final', next: true, submit: false } })];
    const last = [frameReport(0, { status: 'review', buttons: { final: 'final', next: false, submit: true } })];
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(<Report reports={next} onPress={onPress} clock={clock} />));
      const dock = () => container.querySelector<HTMLButtonElement>('button[data-step-action]')!;
      expect([dock().dataset.stepAction, dock().disabled]).toEqual(['next', true]);
      await click(dock());
      expect(asked).toEqual([]);
      clock.at += CONTROL_SEEN_MS - 1;
      await clock.flush();
      expect(dock().disabled).toBe(true);
      clock.at += 1;
      await clock.flush();
      expect(dock().disabled).toBe(false);
      // The page turned its step into the last one: Submit, drawn under the pointer, waits its own time.
      await act(async () => root.render(<Report reports={last} onPress={onPress} clock={clock} />));
      expect([dock().dataset.stepAction, dock().disabled]).toEqual(['submit', true]);
      await click(dock());
      expect(asked).toEqual([]);
      clock.at += CONTROL_SEEN_MS;
      await clock.flush();
      await click(dock());
      expect(asked).toEqual([[0, 'submit', false]]);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('never answers its own question with a double-click: Submit Anyway waits CONTROL_SEEN_MS', async () => {
    const clock = manualClock();
    const { asked, onPress } = presses([{ outcome: 'required-empty', count: 1 }, { outcome: 'pressed' }]);
    const reports = [frameReport(0, { status: 'review', buttons: { final: 'final', next: false, submit: true } })];
    const root = await mount(<Report reports={reports} onPress={onPress} clock={clock} />);
    clock.at += CONTROL_SEEN_MS;
    await clock.flush();
    await click(root.querySelector('button[data-step-action="submit"]'));
    // The second click of a double-click lands on Submit Anyway, just drawn there: refused.
    const anyway = root.querySelector<HTMLButtonElement>('button[data-step-action="confirm"]')!;
    expect(anyway.disabled).toBe(true);
    await click(anyway);
    expect(asked).toEqual([[0, 'submit', false]]);
    clock.at += CONTROL_SEEN_MS;
    await clock.flush();
    await click(root.querySelector('button[data-step-action="confirm"]'));
    expect(asked).toEqual([[0, 'submit', false], [0, 'submit', true]]);
  });
});
