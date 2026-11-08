/*
 * The side panel in TailorIT's look, laid out as Jobright's sidebar (v3 Phase 3; v4 ui, the owner's screenshots): the
 * brand header with the gear that opens the Settings view (radio cards, Save pinned at the bottom), problems only as
 * strips, no notice, the big Autofill with its constant name and a spinner while a run works (no Dry run, Continue or
 * Cancel buttons), "Ask custom question" as an outline button, the progress and the lists under them (Cancel on the
 * progress line while a run works), a page Autofill does not work on (its explanations in a "?"), the launcher brought
 * back, and the set-up view's step cards. The extension's page reads as TailorIT's: light only, on its canvas.
 */
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { COPY } from '../../shared/copy';
import { adoptPageStyles } from '../page/styles';
import {
  authStatus, button, click, createFakeWorker, formPage, frameReport, jobCard, mount, row, SEEN_AT_ONCE, settle, unmountAll,
  type FakeWorker,
} from '../ui.testkit';
import { Panel } from './Panel';
import { SHEET_STRIP_PX } from './v5-styles';

async function open(worker: FakeWorker, pinnedTabId: number | null): Promise<HTMLElement> {
  adoptPageStyles(document);
  const root = await mount(<Panel platform={worker.platform} pinnedTabId={pinnedTabId} seenClock={SEEN_AT_ONCE} />);
  await settle();
  return root;
}

/** Whether `a` comes before `b` in the document. */
const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('the side panel in TailorIT’s look', () => {
  afterEach(() => unmountAll());

  it("heads the panel with TailorIT's mark and name and a gear that opens the Settings view: no menu, no foot (v4 ui)", async () => {
    const worker = createFakeWorker();
    const root = await open(worker, 5);
    const title = root.querySelector('h1')!;
    expect(title.textContent).toBe(COPY.appName);
    expect(title.querySelector('svg.tia-mark')?.getAttribute('aria-hidden')).toBe('true');
    expect(getComputedStyle(title.querySelector('.tia-wordmark__it')!).color).toBe('rgb(8, 117, 140)');
    const gear = root.querySelector<HTMLButtonElement>('button[data-panel-settings]')!;
    expect([gear.getAttribute('aria-label'), gear.getAttribute('aria-pressed'), gear.textContent])
      .toEqual([COPY.mainView.settings, 'false', '']);
    // The brand left, the gear right.
    const head = root.querySelector('.tia-panel__head')!.getBoundingClientRect();
    expect(gear.getBoundingClientRect().right).toBeCloseTo(head.right, 0);
    expect(root.querySelector('[data-menu], .tia-panel__foot, a[data-tailorit-link="jobs"]')).toBeNull();
    await click(gear);
    expect(gear.getAttribute('aria-pressed')).toBe('true');
    // The modes in the side panel's order, as the options page shows them; the view second.
    const settings = root.querySelector<HTMLElement>('[data-settings-view]')!;
    expect([...settings.querySelectorAll<HTMLElement>('[data-setting-group]')].map((group) => group.dataset.settingGroup))
      .toEqual(['modes.afterPageTurn', 'view', 'panel', 'modes.next', 'modes.submit', 'modes.signIn', 'modes.consents', 'modes.ai',
        'modes.resumeOnPage', 'modes.recordOwn', 'modes.noMatch', 'modes.notifications', 'modes.agentSkip']);
    // Radio cards (screenshot 5): a grey card per choice, the chosen one's ring holding a teal dot.
    const keep = settings.querySelector<HTMLInputElement>('input[data-setting="modes.resumeOnPage.keep"]')!;
    const card = keep.closest<HTMLElement>('.tia-radiocard')!;
    expect([keep.checked, getComputedStyle(card).backgroundColor, getComputedStyle(card).borderTopLeftRadius])
      .toEqual([true, 'rgb(242, 242, 242)', '10px']);
    expect(getComputedStyle(keep).backgroundColor).toBe('rgb(20, 161, 192)');
    expect(card.textContent).toBe(COPY.options.modes.resumeOnPage.keep);
    // Save is pinned at the bottom of the view, full width.
    const save = settings.querySelector<HTMLButtonElement>('button[data-action="save-settings"]')!;
    expect(getComputedStyle(save.parentElement!).position).toBe('sticky');
    expect(save.getBoundingClientRect().width).toBeGreaterThan(settings.getBoundingClientRect().width - 40);
    // Light only, on TailorIT's canvas, whatever the system's scheme.
    expect(getComputedStyle(root.querySelector('main')!).backgroundColor).toBe('rgb(252, 252, 252)');
    expect(getComputedStyle(document.documentElement).colorScheme).toBe('light');
  });
  it('keeps the big Autofill, spinning while a run works with Cancel on the progress, and the same Autofill to go on (v4 ui)', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(0, { status: 'fill-step', fields: [row('first')] })]);
    const root = await open(worker, 5);
    const working = root.querySelector<HTMLButtonElement>('button.tia-cta')!;
    expect([working.disabled, working.dataset.working, working.querySelector('svg.tia-spin') !== null])
      .toEqual([true, 'true', true]);
    for (const gone of [COPY.panel.dryRun, COPY.panel.continue]) expect(button(root, gone)).toBeNull();
    const cancel = root.querySelector<HTMLButtonElement>('.tia-progress-line button[data-action="cancel"]')!;
    expect(cancel.textContent).toBe(COPY.panel.cancel);
    await click(cancel);
    expect(worker.sentOfType('panel/cancel')).toEqual([{ v: 1, type: 'panel/cancel', tabId: 5 }]);
    worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { status: 'handoff', pauseReason: 'captcha' })] });
    await settle();
    // At rest, its constant name; it goes on with the paused run.
    const cta = root.querySelector<HTMLButtonElement>('button.tia-cta')!;
    expect(button(root, COPY.panel.fill)).toBe(cta);
    expect([cta.disabled, cta.textContent, cta.dataset.working, cta.dataset.mainAction, cta.querySelector('svg')])
      .toEqual([false, COPY.panel.fill, undefined, 'continue', null]);
    // D10: the pause's instruction is the page's notification, not the panel's.
    expect(root.querySelector('.tia-frame__note--pause')).toBeNull();
    // Large, bold and white on TailorIT's teal (3.05:1, large text), full width, rounded (screenshot 3).
    const style = getComputedStyle(cta);
    expect([style.fontSize, style.fontWeight, style.color, style.backgroundColor, style.borderTopLeftRadius])
      .toEqual(['19px', '800', 'rgb(255, 255, 255)', 'rgb(20, 161, 192)', '12px']);
    expect(cta.getBoundingClientRect().width).toBeCloseTo(root.querySelector('main .tia-toolbar')!.getBoundingClientRect().width, 0);
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
    // Workable is listed since v3 Phase 7a; Workday, iCIMS, Taleo, SuccessFactors and Oracle since v3 Phases 6 and 7b.
    // Since the owner's snapshots of 2026-11-06 Workday's, iCIMS's and Oracle's application forms are read, each note
    // saying what is left to the person, while Taleo's and SuccessFactors' still say their forms are to come;
    // SmartRecruiters follows them, then the new ATSs of DESIGN-NEW-ATS (Phase 0).
    expect([...section.querySelectorAll('.tia-unsupported__name')].map((name) => name.textContent))
      .toEqual(['Greenhouse', 'Lever', 'Ashby', 'Workable', 'Workday', 'iCIMS', 'Taleo', 'SuccessFactors',
        'Oracle Recruiting Cloud', 'SmartRecruiters', 'Jobvite', 'JazzHR', 'BambooHR', 'Rippling', 'Breezy HR', 'CareerPlug',
        'Pinpoint', 'Paycor', 'HiBob', 'UltiPro (UKG Pro)', 'Dayforce', 'Paylocity', 'Dice', 'ClearCompany', 'ADP Workforce Now']);
    // Each site's note as the copy writes it. The new ATSs (DESIGN-NEW-ATS §5): every one's adapter has landed (builders
    // A, B and C), so none carries Phase 0's standard-rules draft note; nor does SmartRecruiters.
    const notes = COPY.panel.unsupported.sites.map((site) => site.note);
    expect([...section.querySelectorAll('.tia-unsupported__site')].map((site) => site.querySelector('.tia-unsupported__note')
      ?.textContent ?? null)).toEqual(notes);
    const [workday, icims, taleo, successFactors, oracle] = notes.slice(4, 9);
    expect(notes.slice(0, 4)).toEqual([null, null, null, null]);
    expect(notes.slice(9)).toEqual(Array(16).fill(null));
    // Workday's, iCIMS's and Oracle's application forms are no longer "coming" (core-x, item 9, and the docs pass), and
    // each says something of its own; Taleo's and SuccessFactors' share the note that they are.
    for (const note of [workday, icims, oracle]) expect(note).not.toMatch(/coming/);
    expect(new Set([workday, icims, oracle, taleo]).size).toBe(4);
    expect(taleo).toMatch(/coming/);
    expect(successFactors).toBe(taleo);
    // The Phase 8 review (B10): it says where Company career sites works too; v4 ui: in the heading's "?".
    expect(section.querySelector('.tia-unsupported__head [role="tooltip"]')?.textContent).toBe(COPY.mainView.unsupportedHelp);
    expect(COPY.mainView.unsupportedHelp).toContain(COPY.panel.unsupported.embedded);
    expect(section.querySelector('.tia-help')).toBeNull();
    // Nothing to fill there: no Autofill, no custom question.
    expect(unsupported.querySelector('button.tia-cta')).toBeNull();
    expect(unsupported.querySelector('[data-ask]')).toBeNull();
    unmountAll();

    // A page on a supported site that opened before the extension could read it: reloading it is all it takes.
    const stale = createFakeWorker();
    stale.script.pages.set(5, { support: 'none', platform: null, formKey: null, reload: true });
    const reload = (await open(stale, 5)).querySelector<HTMLElement>('[data-unsupported]')!;
    expect([reload.dataset.unsupported, reload.querySelector('h2')?.textContent,
      reload.querySelector('[role="tooltip"]')?.textContent])
      .toEqual(['reload', COPY.panel.unsupported.reloadHeading, COPY.panel.unsupported.reloadIntro]);
    expect(reload.querySelector('.tia-unsupported__sites')).toBeNull();
    unmountAll();

    // A company's own page while Company career sites is on (the Phase 8 review, B10): a reload lets it be read.
    const company = createFakeWorker();
    company.script.pages.set(5, { support: 'none', platform: null, formKey: null, reload: true, site: true });
    const site = (await open(company, 5)).querySelector<HTMLElement>('[data-unsupported]')!;
    expect([site.dataset.unsupported, site.querySelector('h2')?.textContent, site.querySelector('[role="tooltip"]')?.textContent])
      .toEqual(['reload-site', COPY.panel.unsupported.reloadSiteHeading, COPY.panel.unsupported.reloadSiteIntro]);

    const found = createFakeWorker();
    found.script.pages.set(5, formPage());
    const form = await open(found, 5);
    expect(form.querySelector('[data-strip="form"]')?.textContent).toBe(COPY.strip.form('Lever'));
  });

  it('shows no notice and no policy card (D10), the progress and the lists under Autofill and Ask custom question', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(0, { status: 'policy-notice', notices: [{ code: 'policy' }, { code: 'tripwire' }],
      fields: [row('first', { required: true })] })]);
    const root = await open(worker, 5);
    const cta = root.querySelector('button.tia-cta')!;
    expect(root.querySelector('[data-notice]')).toBeNull();
    const ask = root.querySelector('[data-ask]')!;
    const review = root.querySelector('section.tia-dashboard')!;
    expect(review.querySelector('h2')!.textContent).toBe(COPY.panelTitle);
    expect(review.querySelector('h2')!.classList.contains('tia-visually-hidden')).toBe(true);
    expect(review.querySelector('[data-progress]')).not.toBeNull();
    expect(review.querySelector('[data-group="required"] li[data-field-key="first"]')).not.toBeNull();
    expect([before(cta, ask), before(ask, review)]).toEqual([true, true]);
  });
  // v5 p1-panel (PLAN decision 4): the progress sheet. The view setting no longer folds the lists (since v5 it says
  // whether the on-page sidebar opens by itself).
  it('raises the progress sheet while a run works, keeps it up at rest, and folds it to its strip from its header', async () => {
    // Positions without the slide (the sheet's 0.35 s), so they can be read at once.
    const still = document.createElement('style');
    still.textContent = '* { transition: none !important; }';
    document.head.append(still);
    const worker = createFakeWorker();
    worker.script.settings = { ...worker.script.settings, view: 'minimized' };
    worker.script.pages.set(5, formPage());
    worker.script.cards.set(5, jobCard());
    const fields = [row('first', { required: true })];
    worker.script.reports.set(5, [frameReport(0, { status: 'fill-step', fields, filling: { current: 'first', pending: [] } })]);
    const root = await open(worker, 5);
    const sheet = () => root.querySelector<HTMLElement>('section.tia-sheet')!;
    const stage = root.querySelector<HTMLElement>('.tia-stage')!;
    const anchor = root.querySelector<HTMLElement>('.tia-sheet-anchor')!;
    const push = async (status: 'fill-step' | 'review') => {
      await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { status, fields,
        ...(status === 'fill-step' ? { filling: { current: 'first', pending: [] } } : {}), updatedAt: Date.now() })] }));
      await settle();
    };
    // Up while the run works, from just under the job card's place (the anchor), its header no fold.
    expect(sheet().hasAttribute('data-open')).toBe(true);
    expect(root.querySelector('button[data-action="toggle-sheet"]')).toBeNull();
    expect(root.querySelector('li[data-field-key="first"]')).not.toBeNull();
    const top = Number.parseFloat(sheet().style.getPropertyValue('--tia-sheet-top'));
    expect(top).toBe(Math.max(0, Math.round(anchor.getBoundingClientRect().top - stage.getBoundingClientRect().top)));
    // Just under the job card: the card shows whole above it, the main button under it.
    const card = root.querySelector<HTMLElement>('section[data-job-card]')!;
    expect(top).toBeGreaterThan(0);
    expect(sheet().getBoundingClientRect().top).toBeGreaterThanOrEqual(card.getBoundingClientRect().bottom);
    expect(sheet().getBoundingClientRect().top - card.getBoundingClientRect().bottom).toBeLessThan(12);
    expect(Math.abs(sheet().getBoundingClientRect().top - stage.getBoundingClientRect().top - top)).toBeLessThan(1);
    expect(Math.abs(sheet().getBoundingClientRect().bottom - stage.getBoundingClientRect().bottom)).toBeLessThan(1);
    // The run comes to rest: the sheet stays up, and its header now folds it.
    await push('review');
    expect(sheet().hasAttribute('data-open')).toBe(true);
    const toggle = root.querySelector<HTMLButtonElement>('button[data-action="toggle-sheet"]')!;
    expect([toggle.getAttribute('aria-expanded'), toggle.title]).toEqual(['true', COPY.report.hideSheet]);
    await click(toggle);
    // Folded: a strip at the stage's bottom that says the count and the percent; the lists go.
    expect(sheet().hasAttribute('data-open')).toBe(false);
    expect(root.querySelector('li[data-field-key="first"]')).toBeNull();
    expect(Math.abs(sheet().getBoundingClientRect().top - (stage.getBoundingClientRect().bottom - SHEET_STRIP_PX)))
      .toBeLessThan(1);
    expect([root.querySelector('.tia-progress-line__title')?.textContent,
      root.querySelector('.tia-progress-line__percent')?.textContent]).toEqual([COPY.report.progressFilled(1, 1, true), '100%']);
    expect(root.querySelector('button[data-action="toggle-sheet"]')?.getAttribute('aria-expanded')).toBe('false');
    // Up again from the strip; and a run that starts again brings a folded sheet up, which stays up once it rests.
    await click(root.querySelector('button[data-action="toggle-sheet"]'));
    expect(sheet().hasAttribute('data-open')).toBe(true);
    await click(root.querySelector('button[data-action="toggle-sheet"]'));
    expect(sheet().hasAttribute('data-open')).toBe(false);
    await push('fill-step');
    expect(sheet().hasAttribute('data-open')).toBe(true);
    await push('review');
    expect(sheet().hasAttribute('data-open')).toBe(true);
    still.remove();
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

  it('draws "Ask custom question" as an outline button under Autofill that unfolds the box (v4 ui)', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, formPage());
    const root = await open(worker, 5);
    const open_ = root.querySelector<HTMLButtonElement>('[data-ask] button[data-ask-action="open"]')!;
    expect([open_.textContent, open_.getAttribute('aria-expanded')]).toEqual([COPY.mainView.ask, 'false']);
    const style = getComputedStyle(open_);
    expect([style.backgroundColor, style.borderTopStyle]).toEqual(['rgb(255, 255, 255)', 'solid']);
    const body = document.getElementById(open_.getAttribute('aria-controls')!)!;
    expect(body.hidden).toBe(true);
    await click(open_);
    expect([open_.getAttribute('aria-expanded'), body.hidden]).toEqual(['true', false]);
    expect(body.querySelector('textarea')).not.toBeNull();
    await click(open_);
    expect(body.hidden).toBe(true);
  });
  it("draws a problem that blocks everything as a strip whose link keeps the strip's own text colour", async () => {
    const worker = createFakeWorker();
    worker.script.auth = authStatus({ versionMismatch: true });
    const root = await open(worker, 5);
    const line = root.querySelector<HTMLElement>('.tia-connection--problem')!;
    expect([line.classList.contains('tia-strip'), line.dataset.tone]).toEqual([true, 'problem']);
    const link = line.querySelector('a')!;
    expect(getComputedStyle(link).color).toBe(getComputedStyle(line).color);
    expect(getComputedStyle(link).textDecorationLine).toBe('underline');
  });

  it('draws the set-up view as Jobright does: centred, a bolt, step cards with a tick or a dark GO, a grey Start applying', async () => {
    const worker = createFakeWorker();
    worker.script.auth = authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null });
    const root = await open(worker, 5);
    const setup = root.querySelector<HTMLElement>('[data-setup]')!;
    expect(getComputedStyle(setup).textAlign).toBe('center');
    expect(setup.querySelector('svg.tia-setup__bolt')?.getAttribute('aria-hidden')).toBe('true');
    const go = setup.querySelector<HTMLElement>('[data-step="account"] .tia-step__pill--go')!;
    expect([getComputedStyle(go).backgroundColor, getComputedStyle(go).color, getComputedStyle(go).borderTopLeftRadius])
      .toEqual(['rgb(25, 25, 25)', 'rgb(255, 255, 255)', '999px']);
    const step = setup.querySelector<HTMLElement>('[data-step="account"]')!;
    expect(getComputedStyle(step).borderTopLeftRadius).toBe('999px');
    const startButton = setup.querySelector<HTMLButtonElement>('button[data-action="start-applying"]')!;
    expect([startButton.disabled, getComputedStyle(startButton).backgroundColor, startButton.textContent])
      .toEqual([true, 'rgb(242, 242, 242)', COPY.setup.start]);
    // A done step's pill is teal with its tick.
    worker.script.auth = authStatus();
    worker.push({ v: 1, type: 'panel/changed', what: 'connection' });
    await settle();
    const done = setup.querySelector<HTMLElement>('[data-step="account"] .tia-step__pill--done')!;
    expect([getComputedStyle(done).backgroundColor, done.querySelector('svg') !== null]).toEqual(['rgb(20, 161, 192)', true]);
  });
});
