/*
 * The launcher's badge (the Phase F1 review, 3 and 4; v4, D11: "Never flag to the user"): it shows progress only, the
 * percent of the required fields filled by the review's own rule (shared/report.ts progressOf), or a tick once every
 * one is; never a count of fields "needing you", never a "!" for a notice. Only a failure shows "!".
 */
import { afterEach, describe, expect, it } from 'vitest';
import trap01 from '../../fixtures/traps/01-white-on-white.html?raw';
import type { PlanOutput } from '../core/plan/types';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, trapUrl } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { createLauncher } from './ui/launcher';

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

describe('the launcher’s badge (v4, D11: progress only)', () => {
  it('shows the percent while short of 100, a tick at 100 or when nothing counts, and "!" only for a failure', () => {
    const launcher = createLauncher(document, () => undefined);
    const badge = launcher.el.querySelector<HTMLElement>('.badge')!;
    launcher.set({ state: 'review', action: 'open-review', percent: 40 });
    expect([badge.hidden, badge.dataset.tone, badge.textContent]).toEqual([false, 'brand', '40%']);
    launcher.set({ state: 'review', action: 'open-review', percent: 100 });
    expect([badge.hidden, badge.dataset.tone, badge.textContent]).toEqual([false, 'success', '']);
    expect(badge.querySelector('svg')).not.toBeNull();
    launcher.set({ state: 'review', action: 'open-review' });
    expect([badge.dataset.tone, badge.textContent]).toEqual(['success', '']);
    // At a pause: its progress, never a "needs you" "!".
    launcher.set({ state: 'needs-you', action: 'continue', reason: 'pause', percent: 25 });
    expect([badge.dataset.tone, badge.textContent]).toEqual(['brand', '25%']);
    expect(launcher.el.title).not.toMatch(/needs you/i);
    launcher.set({ state: 'error', action: 'fill', reason: 'failed' });
    expect([badge.dataset.tone, badge.textContent]).toEqual(['danger', '!']);
  });

  it('counts nothing for a blocked row (D8): a run that ends in review with a refused and empty fields shows its progress, never a count', async () => {
    const fixture = await loadFixture(document, trap01);
    // The plan's first row blocked, the rest left empty and required: progress 0%, never "1 needs you".
    const editPlan = (plan: PlanOutput) => ({ ...plan, writes: [], results: plan.results.map((row, at) => (at === 0
      ? { ...row, status: 'blocked' as const, wrote: false, provenance: null, reason: 'policy-violation' as const,
        needsUserAction: false }
      : { ...row, required: true, status: 'flagged' as const, wrote: false, provenance: null,
        reason: 'no-profile-value' as const, needsUserAction: true })) });
    const worker = createFakeWorker({ editPlan });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl('01'), isTop: true,
      settle: { quietMs: 60 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('review');
    const view = runtime.ui!.launcher.view;
    expect(view).toMatchObject({ state: 'review', percent: 0 });
    expect('count' in view).toBe(false);
    expect(runtime.ui!.launcher.el.querySelector('.badge')!.textContent).toBe('0%');
  });
});
