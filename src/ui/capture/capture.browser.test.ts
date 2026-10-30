import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryCapturePlatform } from '../../platform/memory';
import { CAPTURE_COPY } from '../../shared/copy';
import { captureFileName, captureTabOf, runCapture, sizeText, snapshotHost, type ObjectUrls } from './capture';

/** The first lines of a page Chrome saved, as pageCapture returns them. */
const MHTML_HEAD = 'From: <Saved by Blink>\r\nSnapshot-Content-Location: https://jobs.lever.co/acme/0b9f/apply\r\n'
  + 'Subject: Acme\r\nDate: Thu, 30 Oct 2026 21:25:01 GMT\r\nMIME-Version: 1.0\r\n\r\n';

function fakeUrls(): ObjectUrls & { created: Blob[]; revoked: string[] } {
  const created: Blob[] = [];
  const revoked: string[] = [];
  return {
    created,
    revoked,
    createObjectURL(blob) {
      created.push(blob);
      return `blob:chrome-extension://memory-extension/${created.length}`;
    },
    revokeObjectURL: (url) => void revoked.push(url),
  };
}

/** A page of its own (a same-origin frame), so its pagehide is not the test runner's. */
function page(): HTMLElement {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const doc = frame.contentDocument!;
  const root = doc.createElement('main');
  doc.body.append(root);
  return root;
}

describe('the capture page', () => {
  afterEach(() => document.querySelectorAll('iframe').forEach((frame) => frame.remove()));

  it('reads the tab to save from ?tabId=N', () => {
    expect(captureTabOf('?tabId=41')).toBe(41);
    for (const search of ['', '?tabId=', '?tabId=x', '?tabId=-2']) expect(captureTabOf(search), search).toBeNull();
  });

  it("names the file after the saved page's host and the local time of the capture", () => {
    expect(snapshotHost(MHTML_HEAD)).toBe('jobs.lever.co');
    expect(snapshotHost('From: <Saved by Blink>\r\n\r\n')).toBeNull();
    expect(snapshotHost('Snapshot-Content-Location: not a url\r\n')).toBeNull();
    const at = new Date(2026, 9, 30, 14, 25, 1);
    expect(captureFileName('jobs.lever.co', at)).toBe('jobs.lever.co-20261030-142501.mhtml');
    expect(captureFileName(null, new Date(2026, 0, 2, 3, 4, 5))).toBe('page-20260102-030405.mhtml');
    expect([sizeText(2048), sizeText(3 * 1024 * 1024 + 200_000)]).toEqual(['2.0 KB', '3.2 MB']);
  });

  it('saves the tab and offers a Save link, uploading nothing, and releases the file when the page goes', async () => {
    const urls = fakeUrls();
    const capture = createMemoryCapturePlatform(() => new Blob([MHTML_HEAD, 'x'.repeat(2000)], { type: 'multipart/related' }));
    const root = page();
    await runCapture({ root, tabId: 5, platform: capture, urls, now: () => new Date(2026, 9, 30, 14, 25, 1) });

    expect(capture.asked).toEqual([5]);
    const link = root.querySelector('a')!;
    expect(link.download).toBe('jobs.lever.co-20261030-142501.mhtml');
    expect(link.getAttribute('href')).toBe('blob:chrome-extension://memory-extension/1');
    expect(link.textContent).toBe(CAPTURE_COPY.save('jobs.lever.co-20261030-142501.mhtml'));
    expect(root.querySelector('[role="status"]')?.textContent).toBe(CAPTURE_COPY.saved(sizeText(urls.created[0]!.size)));
    expect(root.textContent).toContain(CAPTURE_COPY.next);
    expect(root.ownerDocument.title).toBe(CAPTURE_COPY.title);

    expect(urls.revoked).toEqual([]);
    const view = root.ownerDocument.defaultView!;
    view.dispatchEvent(new Event('pagehide'));
    view.dispatchEvent(new Event('pagehide'));
    expect(urls.revoked).toEqual(['blob:chrome-extension://memory-extension/1']);
  });

  it('says so, in its own words, when the tab cannot be saved', async () => {
    const urls = fakeUrls();
    const capture = createMemoryCapturePlatform(() => {
      throw new Error('Cannot access contents of url "https://jobs.lever.co/acme". Extension manifest must request permission.');
    });
    const root = page();
    await runCapture({ root, tabId: 5, platform: capture, urls, now: () => new Date() });
    expect(root.querySelector('[role="status"]')?.textContent).toBe(CAPTURE_COPY.failed);
    expect(root.textContent).not.toContain('jobs.lever.co');
    expect(root.querySelector('a')).toBeNull();
    expect(urls.created).toEqual([]);
  });

  it('saves nothing without a tab', async () => {
    const capture = createMemoryCapturePlatform(() => new Blob([MHTML_HEAD]));
    const root = page();
    await runCapture({ root, tabId: null, platform: capture, urls: fakeUrls(), now: () => new Date() });
    expect(root.querySelector('[role="status"]')?.textContent).toBe(CAPTURE_COPY.noTab);
    expect(capture.asked).toEqual([]);
  });
});
