/*
 * jr7 BOARDS-7 P1 (FIX7PLAN §6.13 item 7, J7-DC-2): Dice on the owner's snapshot7 dice1 captures
 * (fixtures/dice/jr7-dice1-posting, -step1, -review). The audit read step 1's inert wizard as held by the cookie-consent
 * box, div#cmpbox[role=dialog], and the plan asked for a page state of it whose pause says why. Measured on the
 * capture, the dialog shown there is Dice's own File options menu on the résumé card (React Aria's MenuTrigger popover,
 * its Replace and Delete items), the same state as d-step1-menu; #cmpbox is closed (cmpboxclosed, display: none) in
 * every Dice capture. So no #cmpbox rule is written (the configured layer writes no rule a capture does not show), and
 * the step reads as d-step1-menu does: nothing read, nothing pressed, no pause; once the person closes the menu the
 * wizard reads as before. These tests hold that verdict; a capture with the consent box open would revisit it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import reviewAHtml from '../../../fixtures/dice/a-review.html?raw';
import step2Html from '../../../fixtures/dice/a-step2.html?raw';
import step1BHtml from '../../../fixtures/dice/b-step1.html?raw';
import reviewDHtml from '../../../fixtures/dice/d-review.html?raw';
import menuHtml from '../../../fixtures/dice/d-step1-menu.html?raw';
import jr7PostingHtml from '../../../fixtures/dice/jr7-dice1-posting.html?raw';
import jr7ReviewHtml from '../../../fixtures/dice/jr7-dice1-review.html?raw';
import jr7Step1Html from '../../../fixtures/dice/jr7-dice1-step1.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan } from '../../dom/scan';
import { isUserVisible } from '../../dom/visibility';
import { platformOfUrl } from '../../shared/hosts';
import { adaptersFor } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { diceAdapter } from './index';

const sourceOf = (html: string): string => /"source":"([^"]+)"/.exec(html)![1]!;
const WIZARD = 'div:has(> div[role="meter"][aria-label="Application progress"])';
const open = (html: string) => loadFixture(document, html, SNAPSHOT_VIEWPORT);

afterEach(() => removeFixtures(document));

describe('J7-DC-2: what holds Dice\'s step 1 inert in snapshot7', () => {
  it.each([
    ['a-step2', step2Html], ['a-review', reviewAHtml], ['b-step1', step1BHtml], ['d-step1-menu', menuHtml],
    ['d-review', reviewDHtml], ['jr7-dice1-posting', jr7PostingHtml], ['jr7-dice1-step1', jr7Step1Html],
    ['jr7-dice1-review', jr7ReviewHtml],
  ])('%s: the cookie-consent box is closed', async (_name, html) => {
    const { doc } = await open(html);
    // consentmanager's box sits in its wrapper's open shadow root (div#cmpwrapper > #shadow-root > div#cmpbox).
    const box = doc.querySelector('div#cmpwrapper')!.shadowRoot!.querySelector<HTMLElement>('div#cmpbox[role="dialog"]')!;
    expect(box.classList.contains('cmpboxclosed')).toBe(true);
    expect(isUserVisible(box)).toBe(false);
  });

  it('jr7-dice1-step1: the dialog shown is the résumé card\'s File options menu, as on d-step1-menu', async () => {
    for (const html of [jr7Step1Html, menuHtml]) {
      const { doc } = await open(html);
      const shown = Array.from(doc.querySelectorAll('[role="dialog"]')).filter((dialog) => isUserVisible(dialog));
      expect(shown.map((dialog) => [dialog.getAttribute('data-trigger'),
        Array.from(dialog.querySelectorAll('[role="menuitem"]')).map((item) => item.getAttribute('data-key'))]))
        .toEqual([['MenuTrigger', ['replace', 'delete']]]);
      expect(doc.querySelector(WIZARD)!.closest('[inert]')).not.toBeNull();
      removeFixtures(document);
    }
  });

  it('jr7-dice1-step1: reads nothing, presses nothing, pauses for nothing while the menu is open', async () => {
    const url = new URL(sourceOf(jr7Step1Html));
    expect(platformOfUrl(url.href)).toBe('dice');
    const fixture = await open(jr7Step1Html);
    const { doc } = fixture;
    expect(adaptersFor(url, doc)[0]).toBe(diceAdapter);
    expect(diceAdapter.detect(doc)).toBeNull();
    expect(diceAdapter.isFinalStep!(doc)).toBe('unknown');
    expect(diceAdapter.authState?.(doc) ?? null).toBeNull();
    expect(diceAdapter.entryControl?.(doc) ?? null).toBeNull();
    expect(detectPause(doc, null, diceAdapter)).toBeNull();
    const never = diceAdapter.neverPress!(doc.documentElement);
    for (const key of ['replace', 'delete']) {
      expect(never).toContain(doc.querySelector(`[role="menuitem"][data-key="${key}"]`));
    }
  });

  it('jr7-dice1-step1 with the menu closed (a DOM variant): the wizard, not final, Next, the cover letter', async () => {
    const { doc } = await open(jr7Step1Html);
    doc.querySelector('[role="dialog"][data-trigger="MenuTrigger"]')!.remove();
    for (const el of Array.from(doc.querySelectorAll('[inert]'))) el.removeAttribute('inert');
    const root = diceAdapter.detect(doc)?.formRoot ?? null;
    expect(root?.matches(WIZARD)).toBe(true);
    expect(diceAdapter.isFinalStep!(doc)).toBe('not-final');
    expect(diceAdapter.nextButton!(root!)?.textContent?.trim()).toBe('Next');
    expect(scan(root!, diceAdapter, { platform: 'dice' }).fields.map((field) => [field.label, field.kind, field.required]))
      .toEqual([['Cover letter', 'file', false]]);
  });

  it('jr7-dice1-review: the wizard\'s last step, its Submit; the posting is off the matched path', async () => {
    const { doc } = await open(jr7ReviewHtml);
    const root = diceAdapter.detect(doc)?.formRoot ?? null;
    expect(root?.matches(WIZARD)).toBe(true);
    expect(diceAdapter.isFinalStep!(doc)).toBe('final');
    expect(diceAdapter.submitButton!(root!)?.textContent?.trim()).toBe('Submit');
    expect(platformOfUrl(sourceOf(jr7PostingHtml))).toBeNull();
  });
});
