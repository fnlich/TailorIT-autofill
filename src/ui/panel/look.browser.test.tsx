/*
 * The side panel in TailorIT's look (Phase F): the brand header with a gear to the settings, the connection, one strip
 * for where the tab stands, the notices above Autofill, the main button's constant name with a spinner while it
 * works, Review with the completion and the rows, and the links to the person's TailorIT. The extension's page reads
 * as TailorIT's: light only, on its canvas.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { COPY } from '../../shared/copy';
import { adoptPageStyles } from '../page/styles';
import { authStatus, button, createFakeWorker, frameReport, mount, row, settle, unmountAll, type FakeWorker } from '../ui.testkit';
import { Panel } from './Panel';

async function open(worker: FakeWorker, pinnedTabId: number | null): Promise<HTMLElement> {
  adoptPageStyles(document);
  const root = await mount(<Panel platform={worker.platform} pinnedTabId={pinnedTabId} />);
  await settle();
  return root;
}

/** Whether `a` comes before `b` in the document. */
const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('the side panel in TailorIT’s look', () => {
  afterEach(() => unmountAll());

  it("heads the panel with TailorIT's mark and name, a gear to the settings, and links to the person's TailorIT", async () => {
    const root = await open(createFakeWorker(), 5);
    const title = root.querySelector('h1')!;
    expect(title.textContent).toBe(COPY.appName);
    expect(title.querySelector('svg.tia-mark')?.getAttribute('aria-hidden')).toBe('true');
    expect(getComputedStyle(title.querySelector('.tia-wordmark__it')!).color).toBe('rgb(8, 117, 140)');
    const gear = root.querySelector<HTMLAnchorElement>('a[data-open-settings]')!;
    expect([gear.getAttribute('href'), gear.getAttribute('aria-label'), gear.target, gear.textContent])
      .toEqual(['chrome-extension://memory-extension/options.html', COPY.panel.settings, '_blank', '']);
    expect([...root.querySelectorAll<HTMLAnchorElement>('a[data-tailorit-link]')].map((link) => [link.textContent, link.href]))
      .toEqual([[COPY.panel.autofillInfo, 'http://localhost:3100/settings/autofill'], [COPY.panel.openJobs, 'http://localhost:3100/jobs']]);
    // Light only, on TailorIT's canvas, whatever the system's scheme.
    expect(getComputedStyle(root.querySelector('main')!).backgroundColor).toBe('rgb(252, 252, 252)');
    expect(getComputedStyle(document.documentElement).colorScheme).toBe('light');
  });

  it('names the main button Autofill in every state, and keeps it and Dry run, Continue, Cancel enabled while a run fills', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(0, { status: 'fill-step', fields: [row('first')] })]);
    const root = await open(worker, 5);
    const cta = root.querySelector<HTMLButtonElement>('button.tia-cta')!;
    expect(cta.textContent).toBe(COPY.panel.fill);
    expect(button(root, COPY.panel.fill)).toBe(cta);
    expect([cta.dataset.working, cta.querySelector('.tia-spin')?.getAttribute('aria-hidden')]).toEqual(['true', 'true']);
    for (const name of [COPY.panel.fill, COPY.panel.dryRun, COPY.panel.continue, COPY.panel.cancel]) {
      expect([name, button(root, name)!.disabled]).toEqual([name, false]);
    }
    // While a run works, Cancel is the one to reach for; while one waits for the person, Continue.
    expect(button(root, COPY.panel.cancel)!.hasAttribute('data-emphasis')).toBe(true);
    expect(button(root, COPY.panel.continue)!.hasAttribute('data-emphasis')).toBe(false);
    worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { status: 'handoff', pauseReason: 'captcha' })] });
    await settle();
    expect([cta.textContent, cta.dataset.working, cta.querySelector('svg')]).toEqual([COPY.panel.fill, undefined, null]);
    expect(button(root, COPY.panel.continue)!.hasAttribute('data-emphasis')).toBe(true);
    expect(button(root, COPY.panel.cancel)!.hasAttribute('data-emphasis')).toBe(false);
    // Large, bold and white on TailorIT's teal (3.05:1, large text).
    const style = getComputedStyle(cta);
    expect([style.fontSize, style.fontWeight, style.color, style.backgroundColor])
      .toEqual(['19px', '800', 'rgb(255, 255, 255)', 'rgb(20, 161, 192)']);
  });

  it("shows one strip: no tab to follow, or the run's status toned by what waits for the person", async () => {
    const noTab = await open(createFakeWorker({ activeTabId: null }), null);
    expect([...noTab.querySelectorAll<HTMLElement>('.tia-strip')].map((strip) => [strip.dataset.strip, strip.dataset.tone,
      strip.textContent])).toEqual([['no-tab', 'neutral', COPY.panel.noTab]]);

    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(0, { fields: [row('first'), row('second', { status: 'flagged', needsUserAction: true })] })]);
    const root = await open(worker, 5);
    const strips = [...root.querySelectorAll<HTMLElement>('.tia-strip')];
    expect(strips.map((strip) => [strip.dataset.runStatus, strip.dataset.tone, strip.textContent]))
      .toEqual([['review', 'attention', COPY.runStatuses.review]]);
    worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { fields: [row('first')] })] });
    await settle();
    expect(root.querySelector<HTMLElement>('.tia-strip')!.dataset.tone).toBe('done');
  });

  it('puts the notices and the policy card above Autofill, and the completion and the rows under Review', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(0, { status: 'policy-notice', notices: [{ code: 'policy' }, { code: 'tripwire' }],
      fields: [row('first')] })]);
    const root = await open(worker, 5);
    const cta = root.querySelector('button.tia-cta')!;
    const card = root.querySelector('[data-notice="policy"]')!;
    const tripwire = root.querySelector('[data-notice="tripwire"]')!;
    expect([before(card, cta), before(tripwire, cta)]).toEqual([true, true]);
    expect(root.querySelectorAll('[data-notice="policy"]')).toHaveLength(1);
    const review = root.querySelector('section.tia-dashboard')!;
    expect(review.querySelector('h2')!.textContent).toBe(COPY.panelTitle);
    expect(review.querySelector('[data-completion]')).not.toBeNull();
    expect(review.querySelector('li[data-field-key="first"]')).not.toBeNull();
    expect(review.querySelector('[data-notice]')).toBeNull();
    expect(before(cta, review)).toBe(true);
  });

  it("draws a connection problem as a strip whose link keeps the strip's own text colour", async () => {
    const worker = createFakeWorker();
    worker.script.auth = authStatus({ connection: 'expired', account: null });
    const root = await open(worker, 5);
    const line = root.querySelector<HTMLElement>('[data-connection="expired"]')!;
    expect([line.classList.contains('tia-strip'), line.dataset.tone]).toEqual([true, 'problem']);
    const link = line.querySelector('a')!;
    expect(getComputedStyle(link).color).toBe(getComputedStyle(line).color);
    expect(getComputedStyle(link).textDecorationLine).toBe('underline');
  });
});
