/*
 * v5 p1-panel (PLAN decision 5) in the content runtime: applied/popup, the worker's word that TailorIT recorded the
 * tab's application, shows "Application Submitted!" over the page in the top frame only, and only from the worker's
 * own script: an extension page's word, or one to a frame inside another page, shows nothing.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import trap11 from '../../fixtures/traps/11-forged-wxt-events.html?raw';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab, trapUrl } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { appliedShown } from './ui/applied';

const plain = trap11.replace(/<script>[\s\S]*<\/script>/, '');
const POPUP = { v: 1, type: 'applied/popup' };

beforeAll(() => {
  testVocab();
});

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

async function startOn(isTop: boolean) {
  const fixture = await loadFixture(document, plain);
  const fake = createFakeWorker();
  const runtime = await startContentRuntime(fake.platform, fixture.doc, { href: () => trapUrl('applied'), isTop,
    settle: { quietMs: 60 } });
  runtimes.push(runtime);
  return { fixture, fake, runtime };
}

describe('the applied popup in the content runtime (v5)', () => {
  it('shows the window in the top frame on the worker’s word, never on an extension page’s', async () => {
    const { fixture, fake } = await startOn(true);
    const page = { id: fake.platform.runtime.id!, url: `chrome-extension://${fake.platform.runtime.id!}/sidepanel.html` };
    expect(await fake.platform.deliverFrom(POPUP, page)).toEqual({ ok: false, error: 'bad_sender' });
    expect(appliedShown(fixture.doc)).toBeNull();
    expect(await fake.platform.deliver(POPUP)).toEqual({ ok: true, data: {} });
    const shown = appliedShown(fixture.doc)!;
    expect(shown.dialog.open).toBe(true);
    shown.remove();
  });

  it('shows nothing in a frame inside another page', async () => {
    const { fixture, fake } = await startOn(false);
    expect(await fake.platform.deliver(POPUP)).toEqual({ ok: false, error: 'expired' });
    expect(appliedShown(fixture.doc)).toBeNull();
  });
});
