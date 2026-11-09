/*
 * v1.5 X (PLAN decisions 2 and 3): the documents' dialogs over a job page, as a person meets them. The dialog is in a
 * closed shadow root of ours (PageUi reads it through DevTools); the preview's document is in a frame of the
 * extension's own preview page (preview.html, the extension's one web-accessible resource, at its address of the
 * session), which Playwright reaches as one of the page's frames, and the PDF inside it is that frame's own blob:
 * address. Nothing here writes to the page.
 */
import { expect, type Frame, type Page } from '@playwright/test';
import type { PageUi, UiElement } from './page-ui.ts';

/** The shown dialog of `kind` ('preview' or 'confirm') on the page, once it shows. */
export async function dialogOn(ui: PageUi, kind: 'preview' | 'confirm'): Promise<UiElement> {
  const selector = `dialog[data-document-dialog="${kind}"]`;
  await expect.poll(async () => (await ui.elements(selector))[0]?.shown ?? false,
    { message: `no ${kind} dialog showed`, timeout: 15_000 }).toBe(true);
  return (await ui.elements(selector))[0]!;
}

/** The embedded preview page of `kind` among the page's frames, once it is there. */
export async function previewFrameOn(page: Page, kind: 'resume' | 'coverLetter'): Promise<Frame> {
  const find = () => page.frames().find((frame) => /^[a-z-]*extension:\/\/[^/]+\/preview\.html\?/.test(frame.url())
    && new URLSearchParams(frame.url().split('?')[1]).get('kind') === kind);
  await expect.poll(() => find() !== undefined, { message: `no ${kind} preview frame`, timeout: 15_000 }).toBe(true);
  return find()!;
}

/** The preview frames of the page now (each document's frame goes when another tab is shown). */
export function previewFramesOn(page: Page): Frame[] {
  return page.frames().filter((frame) => /^[a-z-]*extension:\/\/[^/]+\/preview\.html\?/.test(frame.url()));
}

/** The SHA-256 of the PDF the embedded preview page shows, from its own blob: address, once it is drawn. */
export async function shownDigest(frame: Frame): Promise<{ src: string; digest: string }> {
  const drawn = frame.locator('iframe[data-preview-frame]');
  await expect(drawn).toBeVisible({ timeout: 15_000 });
  const src = (await drawn.getAttribute('src'))!;
  const digest = await frame.evaluate(async (address) => {
    const bytes = new Uint8Array(await (await fetch(address)).arrayBuffer());
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }, src);
  return { src, digest };
}
