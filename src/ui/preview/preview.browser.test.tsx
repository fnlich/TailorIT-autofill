/*
 * v1.4 F (PLAN decision 17): the full-window preview page (preview.html): its address, its two tabs, each document
 * fetched over the preview port when it is shown and drawn from this page's own blob: address, one transfer per tab
 * shown whatever the page draws meanwhile, the port let go (and the address revoked) when another tab is shown, and
 * Edit In TailorIT through the worker.
 */
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '../../shared/copy';
import { click, createFakeWorker, mount, settle, unmountAll, type FakeWorker } from '../ui.testkit';
import { PreviewPage, previewTargetOf } from './PreviewPage';

afterEach(() => unmountAll());

const WORDS = COPY.previewPage;
const asked = (worker: FakeWorker) => worker.posted.filter((message) => (message as { type?: unknown }).type
  === 'preview/request');

/** A small PDF, and the worker's transfer of it over the newest port: its header, one chunk, the end. */
async function sendPdf(worker: FakeWorker): Promise<void> {
  const bytes = new TextEncoder().encode('%PDF-1.7\n% a tailored resume\n');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const port = worker.ports.at(-1)!;
  await act(async () => {
    port.post({ v: 1, type: 'resume/header', name: 'resume.pdf', mime: 'application/pdf', size: bytes.byteLength,
      sha256, chunkCount: 1 });
    port.post({ v: 1, type: 'resume/chunk', index: 0, data: btoa(String.fromCharCode(...bytes)) });
    port.post({ v: 1, type: 'resume/end' });
  });
  await settle();
}

describe('the full-window preview page (v1.4 F)', () => {
  it('reads its tab and its first document from its address, and nothing else', () => {
    expect(previewTargetOf('?tabId=12&kind=coverLetter')).toEqual({ tabId: 12, kind: 'coverLetter', grant: null });
    expect(previewTargetOf('?tabId=3')).toEqual({ tabId: 3, kind: 'resume', grant: null });
    expect(previewTargetOf('?tabId=x&kind=letter')).toEqual({ tabId: null, kind: 'resume', grant: null });
    // v1.5 X: the page's dialog's grant, 32 hex digits, else none.
    expect(previewTargetOf(`?tabId=3&grant=${'a1'.repeat(16)}`).grant).toBe('a1'.repeat(16));
    expect(previewTargetOf('?tabId=3&grant=XYZ').grant).toBeNull();
  });

  it('shows the résumé from the worker’s checked bytes, then the letter on its own tab, one transfer each', async () => {
    const worker = createFakeWorker();
    const root = await mount(<PreviewPage platform={worker.platform} search="?tabId=7&kind=resume" close={() => undefined} />);
    await settle();
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')]))
      .toEqual([[WORDS.tabs.resume, 'true'], [WORDS.tabs.coverLetter, 'false']]);
    expect(asked(worker)).toEqual([{ v: 1, type: 'preview/request', tabId: 7 }]);
    expect(root.textContent).toContain(COPY.job.preview.loading);
    await sendPdf(worker);
    // The hash is checked asynchronously.
    await vi.waitFor(() => expect(root.querySelector('iframe[data-preview-frame]')).not.toBeNull());
    const frame = root.querySelector<HTMLIFrameElement>('iframe[data-preview-frame]')!;
    expect(frame.src).toMatch(/^blob:/);
    // The page draws again: no second transfer.
    await click(root.querySelector('[data-preview-edit]'));
    expect(asked(worker)).toHaveLength(1);
    expect(worker.sentOfType('panel/openDocument')).toEqual([{ v: 1, type: 'panel/openDocument', tabId: 7,
      kind: 'resume', how: 'edit' }]);
    // The letter's tab: its own transfer, the résumé's frame gone.
    await click(tabs[1]);
    expect(asked(worker)).toEqual([{ v: 1, type: 'preview/request', tabId: 7 },
      { v: 1, type: 'preview/request', tabId: 7, kind: 'coverLetter' }]);
    expect(root.querySelector('iframe')).toBeNull();
    // The worker has no letter to send: the letter's own words.
    await act(async () => worker.ports.at(-1)!.post({ v: 1, type: 'resume/error', reason: 'resume-unavailable' }));
    await settle();
    expect(root.querySelector('[data-preview-failed]')?.textContent).toBe(COPY.mainView.letterPreview.unavailable);
  });

  it('lets a transfer go when its tab is left before the bytes came, says when Edit has nothing to open, and closes', async () => {
    const worker = createFakeWorker();
    worker.on('panel/openDocument', () => ({ ok: true, data: { opened: false } }));
    const closed: number[] = [];
    const root = await mount(<PreviewPage platform={worker.platform} search="?tabId=7&kind=coverLetter"
      close={() => closed.push(1)} />);
    await settle();
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(WORDS.tabs.coverLetter);
    let dropped = false;
    worker.ports.at(-1)!.onDisconnect(() => {
      dropped = true;
    });
    await click(root.querySelector('[data-preview-tab="resume"]'));
    expect(dropped).toBe(true);
    await click(root.querySelector('[data-preview-edit]'));
    expect(root.querySelector('[data-preview-note]')?.textContent).toBe(COPY.tailor.nothingToOpen);
    await click(root.querySelector('[data-preview-close]'));
    expect(closed).toEqual([1]);
  });

  it('names no tab: nothing is asked', async () => {
    const worker = createFakeWorker();
    const root = await mount(<PreviewPage platform={worker.platform} search="" close={() => undefined} />);
    await settle();
    expect(root.querySelector('[data-preview-failed]')?.textContent).toBe(WORDS.noTab);
    expect(asked(worker)).toEqual([]);
    expect(root.querySelector('[data-preview-edit]')).toBeNull();
  });
});
