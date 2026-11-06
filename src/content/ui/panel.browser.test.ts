/*
 * The in-page review panel (panel.tsx) in the page UI's closed root: the report components mounted there with the
 * report's stylesheet adopted beside the page UI's, trusted clicks only, its actions on this frame's own rows, room in
 * a small embedded frame, and the notices it mirrors in the page's own words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { deadline } from '../../dom/time';
import { COPY } from '../../shared/copy';
import type { FrameReport } from '../../shared/report';
import { mountPageUi, type PageUi } from './page-ui';
import { clickTimes, ready, uncoveredAsThePointerComes } from './ui.testkit';
import { CONTROL_SEEN_MS } from './visible';

type Row = FrameReport['fields'][number];

/** A value-free report row. */
const row = (key: string, overrides: Partial<Row> = {}): Row => ({ key, label: `Label of ${key}`, kind: 'text',
  category: 'unknown', section: 'Contact', required: false, status: 'verified', provenance: 'profile',
  matcherStage: 'not-applicable', confidence: 1, reason: 'ok', wrote: true, verification: 'verified', needsUserAction: false,
  ...overrides });

const report = (frameId: number, overrides: Partial<FrameReport> = {}): FrameReport => ({ v: 1, runId: `run-${frameId}`, frameId,
  platform: 'lever', adapter: 'lever', mode: 'fill', status: 'review', pauseReason: null, fields: [], notices: [],
  counters: { passes: 1, hiddenControlsIgnored: 0, deferredFields: 0 }, updatedAt: 1, ...overrides });

/** A trusted click (Playwright's input) at an element of the closed root, aimed through the host's box. */
async function trustedClick(ui: PageUi, target: Element): Promise<void> {
  target.scrollIntoView({ block: 'nearest' });
  const host = ui.host.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  await userEvent.click(ui.host, { force: true, position: { x: box.left - host.left + box.width / 2,
    y: box.top - host.top + box.height / 2 } });
}

function formRoot(doc: Document = document): HTMLElement {
  const form = doc.createElement('form');
  form.style.cssText = 'display:block;width:900px;height:300px;margin:40px;border:1px solid #888';
  form.dataset.testRoot = '';
  doc.body.append(form);
  return form;
}

interface Calls {
  shown: string[];
  described: string[];
  confirmed: string[];
  closed: number;
  pressed: Array<[string, boolean]>;
}

const mounted: PageUi[] = [];
function mount(doc: Document = document, frameId = 2, options: { confirm?: boolean } = {}) {
  const calls: Calls = { shown: [], described: [], confirmed: [], closed: 0, pressed: [] };
  const ui = mountPageUi(doc, {
    onLauncher: () => undefined,
    onPolicyChoice: () => undefined,
    panel: {
      frameId: () => frameId,
      showField: (key) => calls.shown.push(key),
      describeField: async (key) => {
        calls.described.push(key);
        return [{ index: 1, label: 'Bachelor of Science' }];
      },
      ...(options.confirm ? { confirmDraft: async (key: string) => {
        calls.confirmed.push(key);
        return COPY.panel.draftConfirmed;
      } } : {}),
      closed: () => {
        calls.closed += 1;
      },
      // v3 Phase 4: the dock's Next and Submit, for this frame's own run.
      press: async (target, confirmed) => {
        calls.pressed.push([target, confirmed]);
        return { outcome: 'pressed' as const };
      },
    },
  });
  mounted.push(ui);
  ui.anchorTo(formRoot(doc));
  return { ui, calls };
}

const panelOf = (ui: PageUi) => ui.shadow.querySelector<HTMLElement>('[data-panel="in-page"]')!;

/** Unfolds a row with the person's own click: rows are folded at first, their icon and label shown (v3 Phase 3
 *  review). */
async function unfold(ui: PageUi, key: string): Promise<void> {
  const toggle = panelOf(ui).querySelector<HTMLButtonElement>(`li[data-field-key="${key}"] button.tia-row__toggle`)!;
  if (toggle.getAttribute('aria-expanded') === 'true') return;
  await ready(ui, panelOf(ui));
  await trustedClick(ui, toggle);
  await vi.waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));
}
const buttonIn = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find((each) => each.textContent?.trim() === text) ?? null;

describe('the in-page panel', () => {
  afterEach(() => {
    for (const ui of mounted.splice(0)) ui.destroy();
    document.querySelectorAll('[data-test-root]').forEach((el) => el.remove());
    removeFixtures(document);
  });

  it('mounts the report in the closed root, under the launcher, with the report’s stylesheet beside the page UI’s', () => {
    const { ui } = mount();
    expect(ui.panel?.open).toBe(false);
    expect(panelOf(ui).hidden).toBe(true);
    expect(ui.panelFits()).toBe(true);
    expect(ui.openPanel()).toBe(true);
    expect(panelOf(ui).hidden).toBe(false);
    // Until the worker's report/update arrives it says so.
    expect(panelOf(ui).textContent).toContain(COPY.inPage.loading);
    ui.updatePanel([report(2, { fields: [row('own')] })]);
    expect(ui.shadow.querySelector('li[data-field-key="own"]')).not.toBeNull();
    const rules = ui.shadow.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText));
    expect(rules.some((rule) => rule.startsWith('.launcher'))).toBe(true);
    expect(rules.some((rule) => rule.startsWith('.tia-report'))).toBe(true);
    // Nothing of it reaches the page: the page sees only the host, whose root it cannot open.
    expect(ui.host.shadowRoot).toBeNull();
    expect(document.querySelector('li[data-field-key]')).toBeNull();
    // Under the launcher, so it never covers it.
    expect(panelOf(ui).getBoundingClientRect().top).toBeGreaterThanOrEqual(ui.launcher.el.getBoundingClientRect().bottom);
  });

  it('shows the tab’s frames, the run’s status with the adapter’s progress line, and acts on its own frame’s rows only', async () => {
    const { ui, calls } = mount();
    ui.openPanel();
    ui.updatePanel([
      report(0, { fields: [row('top')] }),
      report(2, { platform: 'greenhouse', adapter: 'greenhouse', step: { index: 1, progress: 'Step 2 of 4' }, fields: [
        row('degree', { status: 'flagged', provenance: null, matcherStage: 'none', reason: 'ambiguous-options', wrote: false,
          verification: 'not-checked', needsUserAction: true,
          detail: { suggestions: [{ index: 1, score: 0.8 }] } }),
      ] }),
    ]);
    const panel = panelOf(ui);
    expect([...panel.querySelectorAll<HTMLElement>('[data-frame-id]')].map((frame) => frame.dataset.frameId)).toEqual(['0', '2']);
    expect(panel.querySelector('.tia-run-status')?.textContent).toBe(`${COPY.runStatuses.review} · Step 2 of 4`);
    const top = panel.querySelector('li[data-field-key="top"]')!;
    const degree = panel.querySelector('li[data-field-key="degree"]')!;
    // Another frame's row has no action: its label shows nothing and its detail holds no button but its fold (v3 Phase 3).
    expect(top.querySelector('button.tia-row__go, [data-action]')).toBeNull();
    await unfold(ui, 'degree');

    await trustedClick(ui, buttonIn(degree, COPY.report.showOnPage)!);
    expect(calls.shown).toEqual(['degree']);
    await trustedClick(ui, buttonIn(degree, COPY.report.showSuggestions(1))!);
    await vi.waitFor(() => expect(panel.textContent).toContain('Bachelor of Science (80%)'));
    expect(calls.described).toEqual(['degree']);
  });

  it('takes the person’s own clicks only: an untrusted one never reaches its buttons', async () => {
    const { ui, calls } = mount();
    ui.openPanel();
    ui.updatePanel([report(2, { fields: [row('own')] })]);
    // v3 Phase 3: the row's label is its Show on page.
    const show = panelOf(ui).querySelector<HTMLButtonElement>('li[data-field-key="own"] button.tia-row__go')!;
    const close = panelOf(ui).querySelector<HTMLButtonElement>('button.panel__close')!;
    show.click();
    show.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    close.click();
    expect(calls).toMatchObject({ shown: [], closed: 0 });
    await ready(ui, panelOf(ui));
    await trustedClick(ui, close);
    expect(calls.closed).toBe(1);
    expect(close.getAttribute('aria-label')).toBe(COPY.inPage.close);
  });

  it('presses the page’s own Submit only for the person’s visible click on its dock: a page can never trigger it (v3 Phase 4)', async () => {
    const { ui, calls } = mount();
    ui.openPanel();
    ui.updatePanel([report(2, { status: 'review', fields: [row('own')],
      buttons: { final: 'final', next: false, submit: true } })]);
    const panel = panelOf(ui);
    const submit = panel.querySelector<HTMLButtonElement>('button[data-step-action="submit"]')!;
    expect(submit.textContent).toContain(COPY.panel.step.submit);
    // A page's script: click(), a dispatched click, a click on the host the closed root hangs from.
    submit.click();
    submit.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    ui.host.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await deadline(50);
    expect(calls.pressed).toEqual([]);
    // The panel itself is seen long enough, so only the dock's own time decides below.
    await ready(ui, panel);
    // Another frame's step offers nothing here: the panel acts on its own frame alone. Its own step again draws the
    // dock anew, the moment before the click.
    ui.updatePanel([report(5, { status: 'review', buttons: { final: 'final', next: false, submit: true } })]);
    expect(panel.querySelector('button[data-step-action]')).toBeNull();
    ui.updatePanel([report(2, { status: 'review', fields: [row('own')],
      buttons: { final: 'final', next: false, submit: true } })]);
    // The dock's button itself must have been seen for CONTROL_SEEN_MS (the review, 12; 600 ms since the audit of
    // 2026-11-06): a click on it the moment it is drawn does not count.
    const dock = () => panel.querySelector<HTMLButtonElement>('button[data-step-action="submit"]')!;
    await trustedClick(ui, dock());
    await deadline(50);
    expect(calls.pressed).toEqual([]);
    await vi.waitFor(() => expect(ui.visibleNow(dock())).toBe(true));
    await ready(ui, dock());
    await trustedClick(ui, dock());
    await vi.waitFor(() => expect(calls.pressed).toEqual([['submit', false]]));
  });

  it('confirms a draft only for a click made while the panel could be seen', async () => {
    const { ui, calls } = mount(document, 2, { confirm: true });
    ui.openPanel();
    ui.updatePanel([report(2, { fields: [row('why', { kind: 'textarea', category: 'freeText.whyCompany', status: 'flagged',
      provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation', needsUserAction: true })] })]);
    const panel = panelOf(ui);
    const confirm = () => buttonIn(panel, COPY.report.confirmDraft)!;
    await unfold(ui, 'why');
    await ready(ui, panel);
    await trustedClick(ui, confirm());
    expect(calls.confirmed).toEqual(['why']);
    // Phase 6, wave 2: the panel says what came of it, under its title.
    await vi.waitFor(() => expect(panel.querySelector('[data-panel-feedback]')?.textContent).toBe(COPY.panel.draftConfirmed));

    // A page layer drawn over the panel that lets clicks through: the person saw the layer, not our button.
    const decoy = document.createElement('div');
    decoy.dataset.testRoot = '';
    const box = panel.getBoundingClientRect();
    decoy.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;`
      + 'background:rgba(255,255,255,0.9);z-index:2147483647;pointer-events:none';
    document.documentElement.append(decoy);
    await vi.waitFor(() => expect(ui.visibleNow(panel)).toBe(false));
    await trustedClick(ui, confirm());
    expect(calls.confirmed).toEqual(['why']);
  });

  // The Phase 6 review, E1: the rows overflowed the 70vh box the watch observes, so a click through a page decoy over
  // the overflow reached Confirm draft.
  it('scrolls its rows inside its box, so a row past the box can be neither seen nor clicked there', async () => {
    const { ui, calls } = mount(document, 2, { confirm: true });
    ui.openPanel();
    const draft = row('why', { kind: 'textarea', category: 'freeText.whyCompany', status: 'flagged',
      provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation', needsUserAction: true });
    ui.updatePanel([report(2, { fields: [...Array.from({ length: 40 }, (_, at) => row(`r${at}`)), draft] })]);
    const panel = panelOf(ui);
    const body = panel.querySelector<HTMLElement>('.panel__body')!;
    // Its detail unfolded (rows are folded at first), then the list back at its top.
    await unfold(ui, 'why');
    body.scrollTop = 0;
    const box = panel.getBoundingClientRect();
    expect(box.height).toBeLessThanOrEqual(innerHeight * 0.7 + 1);
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    expect(body.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.bottom + 1);
    const confirm = buttonIn(panel, COPY.report.confirmDraft)!;
    const button = confirm.getBoundingClientRect();
    expect(button.top).toBeGreaterThan(box.bottom);
    await vi.waitFor(() => expect(ui.visibleNow(panel)).toBe(true));
    // A trusted click where the button would be drawn, were it not clipped: it lands on the page, never on the panel.
    const host = ui.host.getBoundingClientRect();
    await userEvent.click(ui.host, { force: true, position: { x: button.left - host.left + button.width / 2,
      y: Math.min(button.top + button.height / 2, innerHeight - 2) - host.top } });
    expect(calls.confirmed).toEqual([]);
    // Scrolled into view inside the body, it is the person's to click.
    confirm.scrollIntoView({ block: 'nearest' });
    expect(confirm.getBoundingClientRect().bottom).toBeLessThanOrEqual(body.getBoundingClientRect().bottom + 1);
    await ready(ui, panel);
    await trustedClick(ui, confirm);
    expect(calls.confirmed).toEqual(['why']);
  });

  it('follows the row being written inside its own box, never scrolling the page around it (v3 Phase 3 review)', async () => {
    const { ui } = mount();
    // A page taller than the window, scrolled on past the form: the panel at the form's corner is out of view.
    const tall = document.createElement('div');
    tall.dataset.testRoot = '';
    tall.style.height = '4000px';
    document.body.append(tall);
    ui.openPanel();
    window.scrollTo(0, 2000);
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
    const rows = Array.from({ length: 40 }, (_, at) => row(`r${at}`, { wrote: false, verification: 'not-checked' }));
    ui.updatePanel([report(2, { status: 'fill-step', fields: rows, filling: { current: 'r0', pending: ['r0'] } })]);
    ui.updatePanel([report(2, { status: 'fill-step', fields: rows, filling: { current: 'r39', pending: ['r39'] } })]);
    const body = panelOf(ui).querySelector<HTMLElement>('.panel__body')!;
    const current = panelOf(ui).querySelector<HTMLElement>('li[data-field-key="r39"]')!;
    await vi.waitFor(() => expect(current.getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(body.getBoundingClientRect().bottom + 1));
    expect(window.scrollY).toBe(2000);
  });

  it('refuses a click outside the box it watches, even if a row were drawn there', async () => {
    const { ui, calls } = mount(document, 2, { confirm: true });
    ui.openPanel();
    const draft = row('why', { kind: 'textarea', category: 'freeText.whyCompany', status: 'flagged',
      provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation', needsUserAction: true });
    const panel = panelOf(ui);
    // The draft's detail unfolded first (rows are folded at first).
    ui.updatePanel([report(2, { fields: [draft] })]);
    await unfold(ui, 'why');
    // As the panel drew before the fix: nothing clipped, the rows spilling past its box.
    const spill = document.createElement('style');
    spill.textContent = '.panel, .panel__body { overflow: visible !important; } .panel__root { display: block !important; }';
    ui.shadow.append(spill);
    const confirm = () => buttonIn(panel, COPY.report.confirmDraft)!;
    // Rows before the draft until its button lies just past the box, still in the viewport.
    const rows: Row[] = [];
    for (let at = 0; at < 60; at += 1) {
      ui.updatePanel([report(2, { fields: [...rows, draft] })]);
      if (confirm().getBoundingClientRect().top > panel.getBoundingClientRect().bottom + 4) break;
      rows.push(row(`r${at}`));
    }
    const box = panel.getBoundingClientRect();
    const button = confirm().getBoundingClientRect();
    expect(button.top).toBeGreaterThan(box.bottom);
    expect(button.bottom).toBeLessThan(innerHeight);
    // The page's decoy over the spill, letting clicks through: the watch still sees the box clear.
    const decoy = document.createElement('div');
    decoy.dataset.testRoot = '';
    decoy.style.cssText = `position:fixed;left:${box.left - 10}px;top:${box.bottom + 2}px;width:${box.width + 20}px;`
      + `height:${innerHeight - box.bottom - 2}px;background:#fff;z-index:2147483647;pointer-events:none`;
    document.documentElement.append(decoy);
    await vi.waitFor(() => expect(ui.visibleNow(panel)).toBe(true));
    const host = ui.host.getBoundingClientRect();
    await userEvent.click(ui.host, { force: true, position: { x: button.left - host.left + button.width / 2,
      y: button.top - host.top + button.height / 2 } });
    expect(calls.confirmed).toEqual([]);
  });

  it('refuses its buttons’ clicks when the page uncovered it a moment before, and never counts them later (the audit of 2026-11-06, S-1)',
    async () => {
      const { ui, calls } = mount(document, 2, { confirm: true });
      ui.openPanel();
      ui.updatePanel([report(2, { fields: [row('why', { kind: 'textarea', category: 'freeText.whyCompany',
        status: 'flagged', provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation', needsUserAction: true })],
      buttons: { final: 'final', next: false, submit: true } })]);
      const panel = panelOf(ui);
      await unfold(ui, 'why');
      const confirm = buttonIn(panel, COPY.report.confirmDraft)!;
      const close = panel.querySelector<HTMLButtonElement>('button.panel__close')!;
      const dock = panel.querySelector<HTMLButtonElement>('button[data-step-action="submit"]')!;
      for (const el of [panel, dock]) await ready(ui, el);
      const clicks = clickTimes(ui);
      // The auditor's decoy over the whole panel, gone as the pointer comes: Confirm draft, the dock and Close.
      for (const target of [confirm, dock, close]) {
        const gone = await uncoveredAsThePointerComes(ui, panel);
        await trustedClick(ui, target);
        expect(clicks.at(-1)! - gone).toBeLessThan(CONTROL_SEEN_MS);
      }
      await deadline(CONTROL_SEEN_MS + 100);
      expect([calls.confirmed, calls.pressed, calls.closed]).toEqual([[], [], 0]);
      // Seen without a break for CONTROL_SEEN_MS, the person's clicks count.
      await ready(ui, panel);
      await trustedClick(ui, confirm);
      expect(calls.confirmed).toEqual(['why']);
      await ready(ui, dock);
      await trustedClick(ui, dock);
      await vi.waitFor(() => expect(calls.pressed).toEqual([['submit', false]]));
    });

  it('refuses a click on itself made the moment it opened (S-1)', async () => {
    const { ui, calls } = mount();
    ui.openPanel();
    ui.updatePanel([report(2, { fields: [row('own')] })]);
    const close = panelOf(ui).querySelector<HTMLButtonElement>('button.panel__close')!;
    await vi.waitFor(() => expect(ui.visibleNow(panelOf(ui))).toBe(true));
    await trustedClick(ui, close);
    expect(calls.closed).toBe(0);
    await ready(ui, panelOf(ui));
    await trustedClick(ui, close);
    expect(calls.closed).toBe(1);
  });

  // The Phase 6 review, E7: a closed panel kept the tab's reports, other frames' labels included, and its tree.
  it('keeps nothing once closed: its reports are dropped and its rows gone until a fresh report', () => {
    const { ui } = mount();
    ui.openPanel();
    ui.updatePanel([report(0, { fields: [row('other-frame', { label: 'Label from another frame' })] }),
      report(2, { fields: [row('own')] })]);
    expect(ui.shadow.querySelectorAll('li[data-field-key]').length).toBe(2);
    ui.closePanel();
    expect(ui.panel?.open).toBe(false);
    expect(ui.panel?.reports).toBeNull();
    expect(ui.shadow.querySelectorAll('li[data-field-key]').length).toBe(0);
    expect(panelOf(ui).textContent).not.toContain('Label from another frame');
    // Opened again, it waits for the worker's report.
    ui.openPanel();
    expect(panelOf(ui).textContent).toContain(COPY.inPage.loading);
    ui.updatePanel([report(2, { fields: [row('own')] })]);
    expect(ui.shadow.querySelectorAll('li[data-field-key]').length).toBe(1);
  });

  it('hides the page’s plain notices while it is open, keeping the policy card, and says them in the same words', () => {
    const { ui } = mount();
    ui.setNotices(['tripwire', 'validation']);
    ui.showPolicyCard({ fromStoredCopy: true });
    const pageTexts = [...ui.shadow.querySelectorAll<HTMLElement>('.notices .notice p')].map((p) => p.textContent);
    const cardTexts = [...ui.shadow.querySelectorAll<HTMLElement>('.card p')].map((p) => p.textContent);
    ui.openPanel();
    expect(ui.shadow.querySelector('.notices')?.classList.contains('with-panel')).toBe(true);
    expect([...ui.shadow.querySelectorAll<HTMLElement>('.notices .notice')].every((item) => getComputedStyle(item).display === 'none'))
      .toBe(true);
    expect(getComputedStyle(ui.shadow.querySelector('.card')!).display).not.toBe('none');
    ui.updatePanel([report(2, { status: 'policy-notice', notices: [{ code: 'tripwire' }, { code: 'validation' },
      { code: 'policy' }, { code: 'policy-stored-copy' }] })]);
    const panel = panelOf(ui);
    // The same sentences as the page's own notices and card; the panel's policy notice has no buttons of its own.
    expect([...panel.querySelectorAll('[data-notice="tripwire"], [data-notice="validation"]')].map((each) => each.textContent))
      .toEqual(pageTexts);
    expect([...panel.querySelectorAll('[data-notice="policy"] p')].map((p) => p.textContent)).toEqual(cardTexts);
    expect(buttonIn(panel, COPY.policyFillAnyway)).toBeNull();
    ui.closePanel();
    expect(ui.shadow.querySelector('.notices')?.classList.contains('with-panel')).toBe(false);
  });

  it('does not open in a small embedded frame, which leaves the review to the side panel', async () => {
    for (const [width, height, fits] of [[360, 600, false], [800, 300, false], [800, 600, true]] as const) {
      const fixture = await loadFixture(document, '<!doctype html><body style="margin:0"></body>', { width, height });
      const { ui } = mount(fixture.doc);
      expect([width, height, ui.panelFits(), ui.openPanel()]).toEqual([width, height, fits, fits]);
      expect(ui.panel?.open).toBe(fits);
      removeFixtures(document);
    }
  });
});
