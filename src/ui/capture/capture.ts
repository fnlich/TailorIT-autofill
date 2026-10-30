/*
 * The development build's capture page (src/entrypoints/capture), which the worker's snapshot hotkeys open beside the
 * captured tab, in the background. It asks pageCapture for the tab's live page, every frame included, as MHTML, and
 * offers an <a download> link named after the page's host and the local time of the capture, such as
 * "jobs.lever.co-20261030-142501.mhtml". Nothing is uploaded: the file goes only where the developer saves it, and
 * the object URL is released when the page goes away. Plain DOM, built in the document of the root it is given.
 */
import type { CapturePagePlatform } from '../../platform/types';
import { CAPTURE_COPY } from '../../shared/copy';

/** Where the page's object URL comes from and goes (URL.createObjectURL and URL.revokeObjectURL). */
export interface ObjectUrls {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

/** What the capture page runs on. */
export interface CaptureDeps {
  /** The element the page draws into. */
  root: HTMLElement;
  /** The tab to save, from ?tabId=N; null when the address names none. */
  tabId: number | null;
  platform: CapturePagePlatform;
  urls: ObjectUrls;
  now(): Date;
}

/** The tab ?tabId=N names, or null. */
export function captureTabOf(search: string): number | null {
  const raw = new URLSearchParams(search).get('tabId');
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** The host Chrome's MHTML header says was saved (Snapshot-Content-Location), or null when it names none. */
export function snapshotHost(head: string): string | null {
  const match = /^Snapshot-Content-Location:[ \t]*(\S+)/im.exec(head);
  if (!match) return null;
  try {
    const host = new URL(match[1]!).hostname.toLowerCase();
    return /^[a-z0-9.-]{1,253}$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** "<host>-<yyyymmdd>-<hhmmss>.mhtml" in local time; "page-…" without a host. */
export function captureFileName(host: string | null, at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const day = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}`;
  const time = `${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
  return `${host ?? 'page'}-${day}-${time}.mhtml`;
}

/** A file size in KB or MB, one decimal. */
export function sizeText(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Saves the tab and offers the file. Resolves once the link is offered, or the reason it is not is shown. */
export async function runCapture(deps: CaptureDeps): Promise<void> {
  const { root } = deps;
  const doc = root.ownerDocument;
  doc.title = CAPTURE_COPY.title;
  const heading = doc.createElement('h1');
  heading.textContent = CAPTURE_COPY.title;
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  root.replaceChildren(heading, status);
  if (deps.tabId === null) {
    status.textContent = CAPTURE_COPY.noTab;
    return;
  }
  status.textContent = CAPTURE_COPY.saving;
  let saved: Blob;
  try {
    saved = await deps.platform.saveAsMHTML(deps.tabId);
  } catch {
    // Chrome's message may name the page's address: the page shows its own sentence instead.
    status.textContent = CAPTURE_COPY.failed;
    return;
  }
  const name = captureFileName(snapshotHost(await saved.slice(0, 4096).text()), deps.now());
  const url = deps.urls.createObjectURL(saved);
  doc.defaultView?.addEventListener('pagehide', () => deps.urls.revokeObjectURL(url), { once: true });
  status.textContent = CAPTURE_COPY.saved(sizeText(saved.size));
  const link = doc.createElement('a');
  link.href = url;
  link.download = name;
  link.className = 'tia-button tia-button--primary';
  link.textContent = CAPTURE_COPY.save(name);
  const next = doc.createElement('p');
  next.textContent = CAPTURE_COPY.next;
  root.append(link, next);
}
