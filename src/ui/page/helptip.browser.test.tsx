/*
 * v4 ui: the "?" (HelpTip), the owner's "all explanation will be tooltip" (Jobright's screenshot 6): pointing at it or
 * focusing it shows the black bubble, its arrow at the "?", above it, or below where there is no room; Escape hides it
 * until the pointer and the focus come back; it is the button's description (role="tooltip", aria-describedby) whether it
 * shows or not.
 */
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { COPY } from '../../shared/copy';
import { mount, settle, unmountAll } from '../ui.testkit';
import { HelpTip } from './HelpTip';
import { adoptPageStyles } from './styles';

const TEXT = 'On applications with several pages, fill each new page as it appears, or wait until you choose Autofill again.';

async function draw(style = 'padding: 120px 40px'): Promise<{ button: HTMLButtonElement; bubble: HTMLElement }> {
  adoptPageStyles(document);
  const root = await mount(<div className="tia-page" style={{ cssText: style } as never}>
    <p>Autofill after page turn <HelpTip text={TEXT} topic="Autofill after page turn" /></p>
    <button type="button" data-elsewhere="">Elsewhere</button>
  </div>);
  const button = root.querySelector<HTMLButtonElement>('.tia-helptip__button')!;
  const bubble = document.getElementById(button.getAttribute('aria-describedby')!)!;
  return { button, bubble };
}

describe('the "?" tooltip (v4 ui)', () => {
  afterEach(() => unmountAll());

  it('is a named button described by its bubble, hidden until asked', async () => {
    const { button, bubble } = await draw();
    expect([button.getAttribute('aria-label'), button.type]).toEqual([COPY.help.about('Autofill after page turn'), 'button']);
    expect([bubble.getAttribute('role'), bubble.textContent, bubble.hidden]).toEqual(['tooltip', TEXT, true]);
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows on hover, as a black bubble with white text above the "?", its arrow at it, and hides when the pointer leaves', async () => {
    const { button, bubble } = await draw();
    await userEvent.hover(button);
    await settle();
    expect(bubble.hidden).toBe(false);
    const style = getComputedStyle(bubble);
    expect([style.backgroundColor, style.color, style.borderTopLeftRadius]).toEqual(['rgb(25, 25, 25)', 'rgb(255, 255, 255)', '8px']);
    expect(bubble.getBoundingClientRect().width).toBeLessThanOrEqual(260);
    const box = button.getBoundingClientRect();
    const tip = bubble.getBoundingClientRect();
    expect(bubble.dataset.place).toBe('above');
    expect(tip.bottom).toBeLessThanOrEqual(box.top);
    // The arrow points at the "?": its offset is the "?"'s centre within the bubble.
    const arrow = Number.parseFloat(bubble.style.getPropertyValue('--tia-tip-arrow'));
    expect(tip.left + arrow).toBeCloseTo(box.left + box.width / 2, 0);
    await userEvent.hover(document.querySelector('[data-elsewhere]')!);
    await settle();
    expect(bubble.hidden).toBe(true);
  });

  it('shows on keyboard focus, and Escape hides it until the focus comes back', async () => {
    const { button, bubble } = await draw();
    await act(async () => button.focus());
    expect(bubble.hidden).toBe(false);
    await userEvent.keyboard('{Escape}');
    await settle();
    expect(bubble.hidden).toBe(true);
    await act(async () => button.blur());
    await act(async () => button.focus());
    expect(bubble.hidden).toBe(false);
    await act(async () => button.blur());
    expect(bubble.hidden).toBe(true);
  });

  it('flips below the "?" when there is no room above, and stays inside the window at its edge', async () => {
    const { button, bubble } = await draw('position: fixed; top: 0; right: 0; padding: 0');
    await act(async () => button.focus());
    const box = button.getBoundingClientRect();
    const tip = bubble.getBoundingClientRect();
    expect(bubble.dataset.place).toBe('below');
    expect(tip.top).toBeGreaterThanOrEqual(box.bottom);
    expect(tip.right).toBeLessThanOrEqual(window.innerWidth);
    expect(tip.left).toBeGreaterThanOrEqual(0);
    const arrow = Number.parseFloat(bubble.style.getPropertyValue('--tia-tip-arrow'));
    expect(tip.left + arrow).toBeCloseTo(box.left + box.width / 2, 0);
  });
});
