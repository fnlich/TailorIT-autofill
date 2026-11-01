/*
 * The launcher's review badge (the Phase F1 review, 3 and 4): it counts the rows that need the person by the review's
 * own rule (needsPerson: a blocked row counts even without needsUserAction), and with nothing counted it shows a tick
 * only when no notice stands, as the report shows its all-clear only then.
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

describe('the launcher’s review badge', () => {
  it('shows "!" rather than a tick when nothing is counted but a notice stands, and the count otherwise', () => {
    const launcher = createLauncher(document, () => undefined);
    const badge = launcher.el.querySelector<HTMLElement>('.badge')!;
    launcher.set({ state: 'review', action: 'open-review', count: 0, notices: true });
    expect([badge.hidden, badge.dataset.tone, badge.textContent]).toEqual([false, 'warning', '!']);
    launcher.set({ state: 'review', action: 'open-review', count: 0, notices: false });
    expect([badge.hidden, badge.dataset.tone, badge.textContent]).toEqual([false, 'success', '']);
    expect(badge.querySelector('svg')).not.toBeNull();
    launcher.set({ state: 'review', action: 'open-review', count: 3, notices: true });
    expect([badge.dataset.tone, badge.textContent]).toEqual(['warning', '3']);
  });

  it('counts a blocked row whose needsUserAction is false: a run that ends in review gives {state: review, count: 1}', async () => {
    const fixture = await loadFixture(document, trap01);
    // The plan's first row blocked, asking nothing of the person: the review's rule still counts it.
    const editPlan = (plan: PlanOutput) => ({ ...plan, writes: [], results: plan.results.map((row, at) => (at === 0
      ? { ...row, status: 'blocked' as const, wrote: false, provenance: null, reason: 'policy-violation' as const,
        needsUserAction: false }
      : { ...row, status: 'skipped' as const, wrote: false, provenance: null, reason: 'no-profile-value' as const,
        needsUserAction: false })) });
    const worker = createFakeWorker({ editPlan });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl('01'), isTop: true,
      settle: { quietMs: 60 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('review');
    expect(runtime.ui!.launcher.view).toMatchObject({ state: 'review', count: 1 });
  });
});
