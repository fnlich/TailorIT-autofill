/*
 * The Workday adapter's rules the behaviour review of 2026-11-06 found untested (FINDINGS.md minor 16: W03, W04, W11,
 * W12, W14, W15), each pinned on the owner's snapshots (fixtures/workday) so that a mutation of the rule fails its test:
 * - W03, W04 (application.ts isFinalStep): a step page this adapter does not know, or a known one whose footer button
 *   a person cannot see, is of unknown finality (nothing pressed), never 'not-final';
 * - W11, W12 (uploadHeld): a field holds a file only while its "Successfully Uploaded!" shows, beside the file's name;
 * - W14, W15 (requiredFor, starDrawn): the star counts only while it is drawn.
 */
import { afterEach, describe, expect, it } from 'vitest';
import sourceOpenHtml from '../../../fixtures/workday/resolvetech-source-open.html?raw';
import webExpHtml from '../../../fixtures/workday/web-my-experience.html?raw';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { workdayAdapter } from './index';

afterEach(() => removeFixtures(document));

const load = (html: string): Promise<Fixture> => loadFixture(document, html, SNAPSHOT_VIEWPORT);
const q = <T extends Element = HTMLElement>(fixture: Fixture, selector: string) => fixture.doc.querySelector<T>(selector)!;

describe('isFinalStep: a step it cannot read is unknown (resolvetech-source-open, My Information)', () => {
  it('W03: a step page whose id this adapter does not know is unknown, though its footer button shows', async () => {
    const fixture = await load(sourceOpenHtml);
    expect(workdayAdapter.isFinalStep!(fixture.doc)).toBe('not-final');
    // The same page, its step named by an id no snapshot shows ("applyFlow…Page" all the same).
    q(fixture, '[data-automation-id="applyFlowMyInfoPage"]').setAttribute('data-automation-id', 'applyFlowUnseenPage');
    expect(q(fixture, '[data-automation-id="pageFooterNextButton"]').isConnected).toBe(true);
    expect(workdayAdapter.isFinalStep!(fixture.doc)).toBe('unknown');
    expect(workdayAdapter.nextButton!(fixture.doc.body)).toBeNull();
  });

  it("W04: a known step before the last whose footer button a person cannot see is unknown, never not-final", async () => {
    const fixture = await load(sourceOpenHtml);
    q(fixture, '[data-automation-id="pageFooterNextButton"]').style.display = 'none';
    expect(workdayAdapter.isFinalStep!(fixture.doc)).toBe('unknown');
  });
});

describe('uploadHeld: a file held only beside its name, while shown (web-my-experience, after Autofill with Resume)', () => {
  const resume = (fixture: Fixture) => workdayAdapter.uploadWidgets!(workdayAdapter.detect(fixture.doc)!.formRoot)
    .find((widget) => widget.control.id.startsWith('resumeAttachments'))!.input;

  it('W11: a "Successfully Uploaded!" a person cannot see holds nothing', async () => {
    const fixture = await load(webExpHtml);
    const input = resume(fixture);
    expect(workdayAdapter.uploadHeld!(input)).toBe(true);
    const field = input.closest('[data-automation-id^="formField-"]')!;
    for (const done of Array.from(field.querySelectorAll<HTMLElement>('[data-automation-id="file-upload-successful"]'))) {
      done.style.display = 'none';
    }
    expect(workdayAdapter.uploadHeld!(input)).toBe(false);
  });

  it("W12: a stray \"Successfully Uploaded!\" with no file's name beside it holds nothing", async () => {
    const fixture = await load(webExpHtml);
    const input = resume(fixture);
    const field = input.closest('[data-automation-id^="formField-"]')!;
    for (const name of Array.from(field.querySelectorAll('[data-automation-id="file-upload-item-name"]'))) name.remove();
    // The word still shows in the field, alone.
    const done = field.querySelector('[data-automation-id="file-upload-successful"]')!;
    expect(done.isConnected).toBe(true);
    expect(workdayAdapter.uploadHeld!(input)).toBe(false);
  });
});

describe("requiredFor: the star only while drawn (resolvetech-source-open, Country's label)", () => {
  it('W14, W15: a star the page does not draw (opacity 0) makes nothing required', async () => {
    const fixture = await load(sourceOpenHtml);
    const country = q(fixture, '#country--country');
    expect(workdayAdapter.requiredFor!(country)).toBe(true);
    q(fixture, 'label[for="country--country"] abbr').style.opacity = '0';
    expect(workdayAdapter.requiredFor!(country)).toBe(false);
  });
});
