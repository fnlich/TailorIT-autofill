/*
 * The side panel in TailorIT's look, laid out as Jobright's sidebar (v3 Phase 3): the brand header with the gear's menu
 * (the modes, and all the settings), problems only as strips, the notices above Autofill, the main button's constant
 * name with a spinner while it works and Dry run, Continue and Cancel on the strip under it while no run works, the
 * progress and the lists under it (Cancel on the progress line while a run works), a page Autofill does not work on,
 * the launcher brought back, and the person's TailorIT at the foot. The extension's page reads as TailorIT's: light
 * only, on its canvas.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { COPY } from '../../shared/copy';
import { adoptPageStyles } from '../page/styles';
import {
  authStatus, button, click, createFakeWorker, formPage, frameReport, mount, row, settle, unmountAll, type FakeWorker,
} from '../ui.testkit';
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

  it("heads the panel with TailorIT's mark and name, a gear that opens the modes, and links to the person's TailorIT", async () => {
    const worker = createFakeWorker();
    const root = await open(worker, 5);
    const title = root.querySelector('h1')!;
    expect(title.textContent).toBe(COPY.appName);
    expect(title.querySelector('svg.tia-mark')?.getAttribute('aria-hidden')).toBe('true');
    expect(getComputedStyle(title.querySelector('.tia-wordmark__it')!).color).toBe('rgb(8, 117, 140)');
    const gear = root.querySelector<HTMLButtonElement>('button[data-panel-menu]')!;
    expect([gear.getAttribute('aria-label'), gear.getAttribute('aria-expanded'), gear.textContent])
      .toEqual([COPY.panel.menu, 'false', '']);
    await click(gear);
    const menu = root.querySelector<HTMLElement>('[data-menu]')!;
    expect(menu.querySelector('h2')?.textContent).toBe(COPY.panel.modes);
    // The modes shown now, as the options page shows them; Submit since v3 Phase 4; Sign-in and the skip rules since
    // v3 Phase 5.
    expect([...menu.querySelectorAll<HTMLElement>('[data-setting-group]')].map((group) => group.dataset.settingGroup))
      .toEqual(['modes.signIn', 'modes.next', 'modes.afterPageTurn', 'modes.submit', 'modes.recordOwn', 'modes.consents',
        'modes.ai', 'view', 'modes.agentSkip']);
    const all = menu.querySelector<HTMLAnchorElement>('a[data-open-settings]')!;
    expect([all.getAttribute('href'), all.target, all.textContent])
      .toEqual(['chrome-extension://memory-extension/options.html#settings-modes', '_blank', COPY.panel.allSettings]);
    // A choice is saved at once, the whole settings with the one mode changed.
    await click(menu.querySelector<HTMLInputElement>('input[data-setting="modes.consents.required"]'));
    expect(worker.sentOfType('settings/save').at(-1)?.settings).toMatchObject({ modes: { consents: 'required', next: 'manual' } });
    expect(menu.querySelector<HTMLInputElement>('input[data-setting="modes.consents.required"]')!.checked).toBe(true);
    // v3 Phase 3b: "Your autofill information" opens the panel's own editor; the jobs link goes to TailorIT.
    expect([...root.querySelectorAll<HTMLAnchorElement>('a[data-tailorit-link]')].map((link) => [link.textContent, link.href]))
      .toEqual([[COPY.panel.openJobs, 'http://localhost:3100/jobs']]);
    expect(root.querySelector('.tia-panel__foot button[data-open-profile]')?.textContent).toBe(COPY.panel.autofillInfo);
    expect(root.querySelector('[data-connection="connected"]')?.textContent).toBe(COPY.panel.connectedAs('Morgan Lee'));
    // Light only, on TailorIT's canvas, whatever the system's scheme.
    expect(getComputedStyle(root.querySelector('main')!).backgroundColor).toBe('rgb(252, 252, 252)');
    expect(getComputedStyle(document.documentElement).colorScheme).toBe('light');
  });

  it('puts the progress where Autofill was while a run works, with its Cancel, and Autofill back with Continue marked while one waits', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(0, { status: 'fill-step', fields: [row('first')] })]);
    const root = await open(worker, 5);
    // While a run works, as Jobright's: no Autofill button, the progress with Cancel on its line in its place.
    expect(root.querySelector('button.tia-cta')).toBeNull();
    expect(button(root, COPY.panel.dryRun)).toBeNull();
    const cancel = root.querySelector<HTMLButtonElement>('.tia-progress-line button[data-action="cancel"]')!;
    expect(cancel.textContent).toBe(COPY.panel.cancel);
    await click(cancel);
    expect(worker.sentOfType('panel/cancel')).toEqual([{ v: 1, type: 'panel/cancel', tabId: 5 }]);
    worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { status: 'handoff', pauseReason: 'captcha' })] });
    await settle();
    // At rest, the main button is back, its constant name.
    const cta = root.querySelector<HTMLButtonElement>('button.tia-cta')!;
    expect(button(root, COPY.panel.fill)).toBe(cta);
    expect(cta.disabled).toBe(false);
    expect([cta.textContent, cta.dataset.working, cta.querySelector('svg')]).toEqual([COPY.panel.fill, undefined, null]);
    for (const name of [COPY.panel.dryRun, COPY.panel.continue, COPY.panel.cancel]) {
      expect([name, button(root, name)!.disabled]).toEqual([name, false]);
    }
    expect(button(root, COPY.panel.continue)!.hasAttribute('data-emphasis')).toBe(true);
    // The pause says why, under the progress line.
    expect(root.querySelector('.tia-frame__note--pause')?.textContent).toBe(COPY.pauseReasons.captcha);
    // Large, bold and white on TailorIT's teal (3.05:1, large text).
    const style = getComputedStyle(cta);
    expect([style.fontSize, style.fontWeight, style.color, style.backgroundColor])
      .toEqual(['19px', '800', 'rgb(255, 255, 255)', 'rgb(20, 161, 192)']);
  });

  it("shows no tab to follow, a page Autofill does not work on with the sites it does, and the form found", async () => {
    const noTab = await open(createFakeWorker({ activeTabId: null }), null);
    expect([...noTab.querySelectorAll<HTMLElement>('.tia-strip')].map((strip) => [strip.dataset.strip, strip.dataset.tone,
      strip.textContent])).toEqual([['no-tab', 'neutral', COPY.panel.noTab]]);

    const elsewhere = createFakeWorker();
    elsewhere.script.pages.set(5, { support: 'none', platform: null, formKey: null });
    const unsupported = await open(elsewhere, 5);
    const section = unsupported.querySelector<HTMLElement>('[data-unsupported]')!;
    expect(section.querySelector('h2')?.textContent).toBe(COPY.panel.unsupported.heading);
    // Workday is not listed until it has an adapter of its own (v3 Phase 3 review); Workable is since v3 Phase 7a.
    expect([...section.querySelectorAll('.tia-unsupported__name')].map((name) => name.textContent))
      .toEqual(['Greenhouse', 'Lever', 'Ashby', 'Workable']);
    // Nothing to fill there: no Autofill, no custom question.
    expect(unsupported.querySelector('button.tia-cta')).toBeNull();
    expect(unsupported.querySelector('[data-ask]')).toBeNull();
    unmountAll();

    // A page on a supported site that opened before the extension could read it: reloading it is all it takes.
    const stale = createFakeWorker();
    stale.script.pages.set(5, { support: 'none', platform: null, formKey: null, reload: true });
    const reload = (await open(stale, 5)).querySelector<HTMLElement>('[data-unsupported]')!;
    expect([reload.dataset.unsupported, reload.querySelector('h2')?.textContent, reload.querySelector('p')?.textContent])
      .toEqual(['reload', COPY.panel.unsupported.reloadHeading, COPY.panel.unsupported.reloadIntro]);
    expect(reload.querySelector('.tia-unsupported__sites')).toBeNull();

    const found = createFakeWorker();
    found.script.pages.set(5, formPage());
    const form = await open(found, 5);
    expect(form.querySelector('[data-strip="form"]')?.textContent).toBe(COPY.strip.form('Lever'));
  });

  it('puts the notices and the policy card above Autofill, and the progress and the lists under it', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(0, { status: 'policy-notice', notices: [{ code: 'policy' }, { code: 'tripwire' }],
      fields: [row('first', { required: true })] })]);
    const root = await open(worker, 5);
    const cta = root.querySelector('button.tia-cta')!;
    const card = root.querySelector('[data-notice="policy"]')!;
    const tripwire = root.querySelector('[data-notice="tripwire"]')!;
    expect([before(card, cta), before(tripwire, cta)]).toEqual([true, true]);
    expect(root.querySelectorAll('[data-notice="policy"]')).toHaveLength(1);
    const review = root.querySelector('section.tia-dashboard')!;
    expect(review.querySelector('h2')!.textContent).toBe(COPY.panelTitle);
    expect(review.querySelector('h2')!.classList.contains('tia-visually-hidden')).toBe(true);
    expect(review.querySelector('[data-progress]')).not.toBeNull();
    expect(review.querySelector('[data-group="required"] li[data-field-key="first"]')).not.toBeNull();
    expect(review.querySelector('[data-notice]')).toBeNull();
    expect(before(cta, review)).toBe(true);
  });

  it('folds the lists with the Minimized view the person chose', async () => {
    const worker = createFakeWorker();
    worker.script.settings = { ...worker.script.settings, view: 'minimized' };
    worker.script.reports.set(5, [frameReport(0, { fields: [row('first', { required: true })] })]);
    // The settings answer after the report came: the review waits for them, so the lists never show first, folded
    // only once the settings come (v3 Phase 3 review).
    let answer: (value: unknown) => void = () => undefined;
    worker.on('settings/get', () => new Promise((done) => {
      answer = done;
    }));
    const root = await open(worker, 5);
    expect(root.querySelector('li[data-field-key="first"]')).toBeNull();
    answer({ ok: true, data: { settings: worker.script.settings } });
    await settle();
    expect(root.querySelector('button[data-action="toggle-fields"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('li[data-field-key="first"]')).toBeNull();
    expect(root.querySelector('.tia-progress-line__percent')?.textContent).toBe('100%');
    await click(root.querySelector<HTMLButtonElement>('button[data-action="toggle-fields"]'));
    expect(root.querySelector('li[data-field-key="first"]')).not.toBeNull();
  });

  it('offers the TailorIT button again where the person hid it, on this site or everywhere', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, formPage());
    worker.script.launcherHidden = 'site';
    const root = await open(worker, 5);
    const strip = root.querySelector<HTMLElement>('[data-launcher-hidden]')!;
    expect([strip.dataset.launcherHidden, strip.querySelector('span')?.textContent])
      .toEqual(['site', COPY.panel.launcherHidden.site]);
    await click(button(root, COPY.panel.showLauncher));
    expect(worker.sentOfType('panel/showLauncher')).toEqual([{ v: 1, type: 'panel/showLauncher', tabId: 5 }]);
    expect(root.querySelector('[data-launcher-hidden]')).toBeNull();
    expect(root.textContent).toContain(COPY.panel.launcherShown);
  });

  it('offers the button back after "Hide until next visit", and from the side panel says when it shows again', async () => {
    // The browser's side panel (no pinned tab): the page keeps the button hidden while this panel shows its tab.
    const worker = createFakeWorker({ activeTabId: 5 });
    worker.script.pages.set(5, formPage());
    worker.script.launcherHidden = 'visit';
    const root = await open(worker, null);
    const strip = root.querySelector<HTMLElement>('[data-launcher-hidden]')!;
    expect([strip.dataset.launcherHidden, strip.querySelector('span')?.textContent])
      .toEqual(['visit', COPY.panel.launcherHidden.visit]);
    await click(button(root, COPY.panel.showLauncher));
    expect(root.textContent).toContain(COPY.panel.launcherShownAfterPanel);
    expect(root.textContent).not.toContain(COPY.panel.launcherShown);
  });

  it('shows one chevron on the custom question: down while folded, up while open', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, formPage());
    const root = await open(worker, 5);
    const ask = root.querySelector<HTMLDetailsElement>('[data-ask]')!;
    const shown = () => [...ask.querySelectorAll('summary .tia-chevron--down, summary .tia-chevron--up')]
      .filter((chevron) => getComputedStyle(chevron).display !== 'none')
      .map((chevron) => (chevron.classList.contains('tia-chevron--up') ? 'up' : 'down'));
    expect(shown()).toEqual(['down']);
    await click(ask.querySelector('summary'));
    expect(shown()).toEqual(['up']);
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
