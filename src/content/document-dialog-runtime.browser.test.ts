/*
 * v1.5 X (PLAN decisions 2 and 3) in the content runtime: preview/show and edit/confirm, the worker's word, show the
 * documents' dialogs over the page in the top frame alone, and only from the worker's own script: an extension page's
 * word, or one to a frame inside another page, shows nothing. The preview's frame is the address the worker named, with
 * the tab, the document and the grant; the confirm's Continue and the preview's Open In A New Tab go to the worker.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import trap11 from '../../fixtures/traps/11-forged-wxt-events.html?raw';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab, trapUrl } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { documentDialogShown, type DocumentDialog } from './ui/document-dialog';
import { CONTROL_SEEN_MS } from './ui/visible';

const plain = trap11.replace(/<script>[\s\S]*<\/script>/, '');
const GRANT = '0123456789abcdef0123456789abcdef';
const PAGE = 'chrome-extension://abcdefghijklmnop/preview.html';
const SHOW = { v: 1, type: 'preview/show', tabId: 7, kind: 'resume', kinds: ['resume', 'coverLetter'], grant: GRANT,
  names: { resume: 'Elena Ruiz Resume.pdf' }, page: PAGE };
const CONFIRM = { v: 1, type: 'edit/confirm', grant: GRANT };

beforeAll(() => {
  testVocab();
});

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  documentDialogShown(document)?.remove();
  removeFixtures(document);
});

/** The runtime on a fixture frame's page, or (`own`) on the test page itself, where a person's click can reach the
 *  dialog (the test's clicks reach no fixture frame as a person's would). */
async function startOn(isTop: boolean, own = false) {
  const fixture = own ? { doc: document } : await loadFixture(document, plain);
  const fake = createFakeWorker();
  const runtime = await startContentRuntime(fake.platform, fixture.doc, { href: () => trapUrl('documents'), isTop,
    settle: { quietMs: 60 } });
  runtimes.push(runtime);
  return { fixture, fake, runtime };
}

/** A person's click on a control of the dialog, once it has been seen long enough. */
async function press(dialog: DocumentDialog, selector: string): Promise<void> {
  const target = dialog.dialog.querySelector(selector)!;
  // The control's own seen time (CONTROL_SEEN_MS) and the watch's first notice.
  const until = performance.now() + CONTROL_SEEN_MS + 300;
  await vi.waitFor(() => expect(performance.now()).toBeGreaterThan(until), { timeout: 3_000, interval: 50 });
  const host = dialog.host.getBoundingClientRect();
  const at = target.getBoundingClientRect();
  await userEvent.click(dialog.host, { force: true, position: { x: at.left - host.left + at.width / 2,
    y: at.top - host.top + at.height / 2 } });
}

describe('the documents’ dialogs in the content runtime (v1.5 X)', () => {
  it('shows the preview in the top frame on the worker’s word, its frame at the named address with the tab, the document and the grant', async () => {
    const { fixture, fake } = await startOn(true, true);
    const page = { id: fake.platform.runtime.id!, url: `chrome-extension://${fake.platform.runtime.id!}/sidepanel.html` };
    expect(await fake.platform.deliverFrom(SHOW, page)).toEqual({ ok: false, error: 'bad_sender' });
    expect(documentDialogShown(fixture.doc)).toBeNull();
    expect(await fake.platform.deliver(SHOW)).toEqual({ ok: true, data: { shown: true } });
    const shown = documentDialogShown(fixture.doc)!;
    expect(shown.dialog.open).toBe(true);
    const [address, query] = shown.dialog.querySelector('iframe')!.src.split('?');
    expect(address).toBe(PAGE);
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({ tabId: '7', kind: 'resume', grant: GRANT });
    // Open In A New Tab goes to the worker, on the document shown.
    await press(shown, '[data-dialog-action="open-tab"]');
    await vi.waitFor(() => expect(fake.messages.filter((message) => (message as { type?: unknown }).type
      === 'preview/openTab')).toEqual([{ v: 1, type: 'preview/openTab', kind: 'resume' }]));
  });

  it('refuses a message that names an address not the extension’s preview page', async () => {
    const { fixture, fake } = await startOn(true);
    expect(await fake.platform.deliver({ ...SHOW, page: 'https://evil.example/preview.html' }))
      .toEqual({ ok: false, error: 'bad_message' });
    expect(await fake.platform.deliver({ ...SHOW, kinds: ['coverLetter'] })).toEqual({ ok: false, error: 'bad_message' });
    expect(documentDialogShown(fixture.doc)).toBeNull();
  });

  it('shows the upload edit confirm on the worker’s word, and sends its Continue with the grant and the box', async () => {
    const { fixture, fake } = await startOn(true, true);
    expect(await fake.platform.deliver(CONFIRM)).toEqual({ ok: true, data: { shown: true } });
    const shown = documentDialogShown(fixture.doc)!;
    await press(shown, '[data-dialog-setting="dont-show"]');
    await press(shown, '[data-dialog-action="continue"]');
    await vi.waitFor(() => expect(fake.messages.filter((message) => (message as { type?: unknown }).type
      === 'edit/confirmed')).toEqual([{ v: 1, type: 'edit/confirmed', grant: GRANT, skip: true }]));
    await shown.closed;
  });

  it('takes its dialog away when the script stops', async () => {
    const { fake, runtime } = await startOn(true, true);
    expect(await fake.platform.deliver(SHOW)).toEqual({ ok: true, data: { shown: true } });
    const shown = documentDialogShown(document)!;
    runtime.stop();
    await shown.closed;
    expect(shown.host.isConnected).toBe(false);
  });

  it('shows nothing in a frame inside another page', async () => {
    const { fixture, fake } = await startOn(false);
    expect(await fake.platform.deliver(SHOW)).toEqual({ ok: true, data: { shown: false } });
    expect(await fake.platform.deliver(CONFIRM)).toEqual({ ok: true, data: { shown: false } });
    expect(documentDialogShown(fixture.doc)).toBeNull();
  });
});
