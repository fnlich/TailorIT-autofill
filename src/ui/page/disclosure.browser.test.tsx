/*
 * v3.2 EXT (E5, the owner, 2026-11-18: "All description including extension should be very brief and all description
 * should be ?tooltip"): the first-run disclosure as every page draws it (DisclosureText): its summary in short lines,
 * then the full notice, unchanged, one click away, opened and closed from the keyboard alone; the "?" the brief pages
 * lean on is reached with Tab and shows its sentence on focus.
 */
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { COPY } from '../../shared/copy';
import { DISCLOSURE_PARAGRAPHS } from '../options/copy-api9';
import { mount, settle, unmountAll } from '../ui.testkit';
import { DisclosureText } from './disclosure';
import { HelpTip } from './HelpTip';
import { adoptPageStyles } from './styles';

const WORDS = COPY.options.connection;

async function draw(scroll: boolean): Promise<HTMLElement> {
  adoptPageStyles(document);
  return mount(<div className="tia-page">
    <button type="button" data-before="">Before</button>
    <div className="tia-disclosure"><DisclosureText scroll={scroll} /></div>
  </div>);
}

/** Whether the element is drawn (not inside a closed <details>, not display: none). */
const shown = (element: Element) => element.checkVisibility();

describe('the disclosure, brief (v3.2 EXT)', () => {
  afterEach(() => unmountAll());

  it('shows the summary and keeps the full notice, word for word, behind "Read the full notice"', async () => {
    const root = await draw(false);
    const lines = [...root.querySelectorAll('[data-disclosure-summary] li')];
    expect(lines.map((line) => line.textContent)).toEqual([...WORDS.summary]);
    expect(lines.every(shown)).toBe(true);
    const full = root.querySelector<HTMLDetailsElement>('details[data-disclosure-full]')!;
    const paragraphs = [...full.querySelectorAll('p')];
    expect(paragraphs.map((p) => p.textContent)).toEqual([...DISCLOSURE_PARAGRAPHS]);
    expect([full.open, paragraphs.some(shown)]).toEqual([false, false]);
    await userEvent.click(full.querySelector('summary')!);
    await settle();
    expect([full.open, paragraphs.every(shown)]).toEqual([true, true]);
  });

  it('opens and closes the full notice from the keyboard, and lets it scroll from the keyboard in the panel', async () => {
    const root = await draw(true);
    await act(async () => root.querySelector<HTMLButtonElement>('[data-before]')!.focus());
    await userEvent.keyboard('{Tab}');
    const summary = root.querySelector('summary')!;
    expect(document.activeElement).toBe(summary);
    expect(summary.textContent).toBe(WORDS.fullNotice);
    const full = summary.parentElement as HTMLDetailsElement;
    await userEvent.keyboard('{Enter}');
    await settle();
    expect(full.open).toBe(true);
    // The panel's notice scrolls in a named region of its own, which Tab reaches next.
    const region = full.querySelector<HTMLElement>('[role="region"]')!;
    expect([region.getAttribute('aria-label'), region.tabIndex]).toEqual([WORDS.disclosureHeading, 0]);
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(region);
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await userEvent.keyboard(' ');
    await settle();
    expect(full.open).toBe(false);
  });

  it('reaches a "?" with Tab and says its sentence on focus, as its button\'s description', async () => {
    adoptPageStyles(document);
    const root = await mount(<div className="tia-page">
      <button type="button" data-before="">Before</button>
      <h2>{COPY.setup.heading} <HelpTip text={COPY.setup.intro} topic={COPY.setup.heading} /></h2>
    </div>);
    await act(async () => root.querySelector<HTMLButtonElement>('[data-before]')!.focus());
    await userEvent.keyboard('{Tab}');
    const button = root.querySelector<HTMLButtonElement>('.tia-helptip__button')!;
    expect(document.activeElement).toBe(button);
    const bubble = document.getElementById(button.getAttribute('aria-describedby')!)!;
    expect([bubble.hidden, bubble.textContent, button.getAttribute('aria-label')])
      .toEqual([false, COPY.setup.intro, COPY.help.about(COPY.setup.heading)]);
  });
});
