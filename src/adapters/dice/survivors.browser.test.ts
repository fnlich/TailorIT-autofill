/*
 * Dice's finality rules the behaviour review of 2026-11-06 found untested (FINDINGS.md minor 16, D2 and D5), pinned on
 * the owner's snapshots (fixtures/dice a-step2 [dice-0] and a-review [dice-1]): the review's Submit is a type=button
 * told apart by its words, shown only where the step holds no form, so a step whose form shows has no Submit (D2); and
 * a step is not final only while its Next shows and no Submit does: a page showing both is unknown, nothing pressed
 * (D5).
 */
import { afterEach, describe, expect, it } from 'vitest';
import reviewAHtml from '../../../fixtures/dice/a-review.html?raw';
import step2Html from '../../../fixtures/dice/a-step2.html?raw';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { diceAdapter } from './index';

const WIZARD = 'div:has(> div[role="meter"][aria-label="Application progress"])';

afterEach(() => removeFixtures(document));

const open = (html: string): Promise<Fixture> => loadFixture(document, html, SNAPSHOT_VIEWPORT);
/** A wizard button by its own words. */
const named = (fixture: Fixture, word: string) => Array.from(fixture.doc.querySelectorAll<HTMLElement>(`${WIZARD} button`))
  .find((button) => (button.textContent ?? '').replace(/\s+/g, ' ').trim() === word) ?? null;

describe('Dice: Submit and finality', () => {
  it('D2: a step whose form shows has no Submit, even a type=button reading "Submit" (a-step2)', async () => {
    const fixture = await open(step2Html);
    const root = diceAdapter.detect(fixture.doc)!.formRoot;
    expect(root.querySelector(':scope > form')).not.toBeNull();
    // A button of the step's own kind (its Back, type=button) reading "Submit".
    const back = named(fixture, 'Back')!;
    const stray = back.cloneNode(true) as HTMLElement;
    stray.textContent = 'Submit';
    back.after(stray);
    expect(named(fixture, 'Submit')).toBe(stray);
    expect(diceAdapter.submitButton?.(root) ?? null).toBeNull();
    expect(diceAdapter.isFinalStep?.(fixture.doc)).toBe('not-final');
  });

  it('D5: a page that shows a Next beside the review\'s Submit is unknown, never not-final (a-review)', async () => {
    const fixture = await open(reviewAHtml);
    const root = diceAdapter.detect(fixture.doc)!.formRoot;
    expect(diceAdapter.isFinalStep?.(fixture.doc)).toBe('final');
    // A second wizard after it, a step with its form and Next (the shape of a-step2's), shown at the same time.
    const other = fixture.doc.createElement('div');
    const meter = fixture.doc.createElement('div');
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-label', 'Application progress');
    meter.setAttribute('aria-valuenow', '2');
    meter.setAttribute('aria-valuemax', '3');
    meter.textContent = '2 of 3';
    const form = fixture.doc.createElement('form');
    const next = fixture.doc.createElement('button');
    next.type = 'submit';
    next.textContent = 'Next';
    form.append(next);
    other.append(meter, form);
    root.after(other);
    expect(diceAdapter.nextButton?.(root)).toBe(other.querySelector('button'));
    expect(diceAdapter.submitButton?.(root)).toBe(named(fixture, 'Submit'));
    expect(diceAdapter.isFinalStep?.(fixture.doc)).toBe('unknown');
  });
});
