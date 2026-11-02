/*
 * The page's own UI in TailorIT's look (Phase F), in the closed root: the launcher as TailorIT's tile with its state in
 * a badge that takes no clicks, the notices and the policy card as white cards named and toned, icons drawn node by
 * node with only the attributes allowed, and the in-page panel as a white card under the launcher whose head is
 * TailorIT's name and a round Close. No shadow of ours may cover another of our controls: IntersectionObserver v2
 * would then refuse the person's clicks on it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { COPY } from '../../shared/copy';
import type { IconDef } from '../../shared/icons';
import type { FrameReport } from '../../shared/report';
import type { LauncherAction, LauncherView } from './launcher';
import { mountPageUi, type PageUi } from './page-ui';
import { svgOf } from './svg';

type Row = FrameReport['fields'][number];

const row = (key: string, overrides: Partial<Row> = {}): Row => ({ key, label: `Label of ${key}`, kind: 'text',
  category: 'unknown', section: 'Contact', required: false, status: 'verified', provenance: 'profile',
  matcherStage: 'not-applicable', confidence: 1, reason: 'ok', wrote: true, verification: 'verified', needsUserAction: false,
  ...overrides });

const report = (frameId: number, overrides: Partial<FrameReport> = {}): FrameReport => ({ v: 1, runId: `run-${frameId}`, frameId,
  platform: 'lever', adapter: 'lever', mode: 'fill', status: 'review', pauseReason: null, fields: [], notices: [],
  counters: { passes: 1, hiddenControlsIgnored: 0, deferredFields: 0 }, updatedAt: 1, ...overrides });

/** A trusted click (Playwright's input) at a point of the page, aimed through the host's box. */
async function trustedClickAt(ui: PageUi, x: number, y: number): Promise<void> {
  const host = ui.host.getBoundingClientRect();
  await userEvent.click(ui.host, { force: true, position: { x: x - host.left, y: y - host.top } });
}

function formRoot(): HTMLElement {
  const form = document.createElement('form');
  form.style.cssText = 'display:block;width:900px;height:300px;margin:40px;border:1px solid #888';
  form.dataset.testRoot = '';
  document.body.append(form);
  return form;
}

const mounted: PageUi[] = [];
function mount(options: { panel?: boolean } = {}) {
  const actions: LauncherAction[] = [];
  const confirmed: string[] = [];
  const ui = mountPageUi(document, {
    onLauncher: (action) => actions.push(action),
    onPolicyChoice: () => undefined,
    ...(options.panel ? { panel: {
      frameId: () => 2,
      showField: () => undefined,
      describeField: async () => null,
      confirmDraft: async (key: string) => {
        confirmed.push(key);
        return COPY.panel.draftConfirmed;
      },
      closed: () => undefined,
    } } : {}),
  });
  mounted.push(ui);
  ui.anchorTo(formRoot());
  return { ui, actions, confirmed };
}

const panelOf = (ui: PageUi) => ui.shadow.querySelector<HTMLElement>('[data-panel="in-page"]')!;

describe('the page’s own UI in TailorIT’s look', () => {
  afterEach(() => {
    for (const ui of mounted.splice(0)) ui.destroy();
    document.querySelectorAll('[data-test-root]').forEach((el) => el.remove());
  });

  it("draws the launcher as TailorIT's mark in every state, 32 px, its state in a badge, named by COPY", () => {
    const { ui } = mount();
    const launcher = ui.launcher.el;
    const badge = launcher.querySelector<HTMLElement>('.badge')!;
    const glyph = launcher.querySelector('.glyph svg')!;
    expect([glyph.getAttribute('aria-hidden'), glyph.getAttribute('viewBox'), launcher.textContent]).toEqual(['true', '0 0 32 32', '']);
    const style = getComputedStyle(launcher);
    expect([style.width, style.height, style.borderRadius, style.backgroundColor])
      .toEqual(['32px', '32px', '9px', 'rgb(20, 161, 192)']);
    const views: Array<[LauncherView, string, string | null, string | null]> = [
      [{ state: 'idle', action: 'fill' }, COPY.launcherFill, null, null],
      [{ state: 'running', action: null }, COPY.launcherRunning, null, null],
      [{ state: 'needs-you', action: 'continue', reason: 'pause' }, COPY.launcherNeedsYou, 'warning', '!'],
      [{ state: 'review', action: 'open-review', count: 3 }, COPY.launcherReview(3), 'warning', '3'],
      [{ state: 'review', action: 'open-review', count: 120 }, COPY.launcherReview(120), 'warning', '99+'],
      [{ state: 'review', action: 'open-review', count: 0 }, COPY.launcherReview(0), 'success', ''],
      [{ state: 'error', action: 'fill', reason: 'not-connected' }, COPY.launcherNotConnected, 'danger', '!'],
    ];
    for (const [view, name, tone, text] of views) {
      ui.setLauncher(view);
      expect([view.state, launcher.getAttribute('aria-label'), launcher.title]).toEqual([view.state, name, name]);
      expect([view.state, badge.hidden ? null : badge.dataset.tone ?? null, badge.hidden ? null : badge.textContent])
        .toEqual([view.state, tone, text]);
      expect(launcher.getBoundingClientRect().width).toBe(32);
    }
    // Nothing to count: a tick, drawn, with no words.
    ui.setLauncher({ state: 'review', action: 'open-review', count: 0 });
    expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
  });

  it("does nothing for a click on the badge outside the launcher's box", async () => {
    const { ui, actions } = mount();
    ui.setLauncher({ state: 'review', action: 'open-review', count: 5 });
    const badge = ui.launcher.el.querySelector<HTMLElement>('.badge')!;
    expect(getComputedStyle(badge).pointerEvents).toBe('none');
    await vi.waitFor(() => expect(ui.visibleNow(ui.launcher.el)).toBe(true));
    const own = ui.launcher.el.getBoundingClientRect();
    const drawn = badge.getBoundingClientRect();
    // The badge's corner past the launcher's right and top edges.
    expect([drawn.right > own.right, drawn.top < own.top]).toEqual([true, true]);
    await trustedClickAt(ui, (own.right + drawn.right) / 2, (drawn.top + own.top) / 2);
    expect(actions).toEqual([]);
    await trustedClickAt(ui, own.left + own.width / 2, own.top + own.height / 2);
    expect(actions).toEqual(['open-review']);
  });

  it("names the policy card by TailorIT's mark and name, and draws the notices' icons with no words", () => {
    const { ui } = mount();
    ui.setNotices(['tripwire', 'posting-outside-frame']);
    ui.showPolicyCard({ fromStoredCopy: true });
    const card = ui.shadow.querySelector<HTMLElement>('.card')!;
    const name = ui.shadow.getElementById(card.getAttribute('aria-labelledby')!)!;
    expect([name.tagName, name.textContent]).toEqual(['DIV', COPY.appName]);
    expect([...card.querySelectorAll('p')].map((p) => p.textContent)).toEqual([COPY.notices.policy, COPY.policyFromStoredCopy]);
    const notices = [...ui.shadow.querySelectorAll<HTMLElement>('.notice')];
    expect(notices.map((notice) => [notice.dataset.code, notice.dataset.tone, notice.textContent])).toEqual([
      ['tripwire', 'danger', COPY.notices.tripwire], ['posting-outside-frame', 'info', COPY.notices['posting-outside-frame']]]);
    for (const svg of ui.shadow.querySelectorAll('.notices svg')) {
      expect([svg.getAttribute('aria-hidden'), svg.textContent]).toEqual(['true', '']);
    }
    expect(notices[0]!.querySelector('button.dismiss svg')).not.toBeNull();
    expect(getComputedStyle(notices[0]!).backgroundColor).toBe('rgb(251, 229, 229)');
    expect(getComputedStyle(card).borderRadius).toBe('12px');
  });

  it('draws only the shapes and attributes icons.ts allows, node by node', () => {
    const hostile = { viewBox: '0 0 20 20', stroked: false, parts: [
      { tag: 'circle', attrs: { cx: '10', cy: '10', r: '4', onload: 'alert(1)', style: 'display:none', href: '#x' } },
      { tag: 'foreignObject' as 'path', attrs: { width: '20', height: '20' } },
    ] } as const satisfies IconDef;
    const svg = svgOf(document, hostile, 20, 'probe');
    expect([svg.namespaceURI, svg.getAttribute('class'), svg.getAttribute('aria-hidden'), svg.getAttribute('fill')])
      .toEqual(['http://www.w3.org/2000/svg', 'probe', 'true', 'currentColor']);
    expect(svg.children).toHaveLength(1);
    expect(svg.children[0]!.getAttributeNames().sort()).toEqual(['cx', 'cy', 'r']);
  });

  it("frames the review as TailorIT's card: the mark, the title and Close, under the launcher", () => {
    const { ui } = mount({ panel: true });
    ui.openPanel();
    ui.updatePanel([report(2, { fields: [row('own')] })]);
    const panel = panelOf(ui);
    const title = panel.querySelector('h2.panel__title')!;
    expect(title.textContent).toBe(COPY.appName);
    expect(title.querySelector('svg.tia-mark')?.getAttribute('aria-hidden')).toBe('true');
    const close = panel.querySelector<HTMLButtonElement>('button.panel__close')!;
    expect([close.getAttribute('aria-label'), close.textContent, close.querySelector('svg')?.getAttribute('aria-hidden')])
      .toEqual([COPY.inPage.close, '', 'true']);
    const style = getComputedStyle(panel);
    expect([style.borderTopLeftRadius, style.backgroundColor, style.width, style.borderTopWidth])
      .toEqual(['20px', 'rgb(255, 255, 255)', '380px', '1px']);
    expect(getComputedStyle(close).borderRadius).not.toBe('0px');
    expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(ui.launcher.el.getBoundingClientRect().bottom);
    // No job facts in the page: the panel shows the review alone.
    expect(panel.querySelector('[data-job-card]')).toBeNull();
  });

  it('styles its status and feedback lines inside the closed root', async () => {
    const { ui } = mount({ panel: true });
    ui.openPanel();
    ui.updatePanel([report(2, { fields: [row('why', { kind: 'textarea', status: 'flagged', provenance: 'llm-draft',
      reason: 'llm-draft-needs-confirmation', needsUserAction: true })] })]);
    const panel = panelOf(ui);
    const strip = panel.querySelector<HTMLElement>('.tia-run-status')!;
    expect([strip.dataset.tone, getComputedStyle(strip).borderRadius, getComputedStyle(strip).backgroundColor])
      .toEqual(['attention', '12px', 'rgb(248, 244, 229)']);
    await vi.waitFor(() => expect(ui.visibleNow(panel)).toBe(true));
    // The row unfolded first, by the person's own click (rows are folded at first, v3 Phase 3 review).
    const toggle = panel.querySelector<HTMLButtonElement>('li[data-field-key="why"] button.tia-row__toggle')!;
    const fold = toggle.getBoundingClientRect();
    await trustedClickAt(ui, fold.left + fold.width / 2, fold.top + fold.height / 2);
    await vi.waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));
    const confirm = [...panel.querySelectorAll('button')].find((each) => each.textContent === COPY.report.confirmDraft)!;
    const box = confirm.getBoundingClientRect();
    await trustedClickAt(ui, box.left + box.width / 2, box.top + box.height / 2);
    const feedback = await vi.waitFor(() => {
      const line = panel.querySelector<HTMLElement>('[data-panel-feedback]');
      expect(line).not.toBeNull();
      return line!;
    });
    expect([feedback.textContent, getComputedStyle(feedback).borderRadius, getComputedStyle(feedback).backgroundColor])
      .toEqual([COPY.panel.draftConfirmed, '10px', 'rgb(248, 248, 248)']);
  });

  it("is seen under the launcher and the policy card, and leaves the card's buttons seen: no shadow of ours covers another",
    async () => {
      const { ui } = mount({ panel: true });
      ui.setLauncher({ state: 'review', action: 'open-review', count: 2 });
      ui.showPolicyCard({ fromStoredCopy: true });
      ui.openPanel();
      ui.updatePanel([report(2, { status: 'policy-notice', notices: [{ code: 'policy' }], fields: [row('own')] })]);
      const [cancel, fill] = [...ui.shadow.querySelectorAll<HTMLButtonElement>('.card button')];
      await vi.waitFor(() => expect([ui.visibleNow(ui.launcher.el), ui.visibleNow(cancel!), ui.visibleNow(fill!),
        ui.visibleNow(panelOf(ui))]).toEqual([true, true, true, true]), { timeout: 3000 });
    });
});
