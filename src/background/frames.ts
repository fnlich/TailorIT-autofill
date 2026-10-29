/*
 * The frames that announced themselves, per tab, in storage.session (memory only, gone when the browser restarts).
 * The panel's Fill starts every registered frame that has a form. An entry keeps the frame's origin and platform,
 * never its full address: page URLs stay out of storage.
 */
import type { Platform } from '../core/enums';
import type { StorageArea } from '../platform/types';
import { platformOfUrl } from '../shared/hosts';

export interface FrameEntry {
  tabId: number;
  frameId: number;
  documentId: string | null;
  origin: string;
  platform: Platform | null;
  isTop: boolean;
  hasForm: boolean;
  registeredAt: number;
}

const keyOf = (tabId: number, frameId: number) => `frames:${tabId}:${frameId}`;

/** Records a frame. One key per frame, so frames of one tab registering at once never overwrite each other. */
export async function registerFrame(
  session: StorageArea,
  frame: { tabId: number; frameId: number; documentId: string | undefined; url: string; isTop: boolean; hasForm: boolean },
  now: number,
): Promise<FrameEntry> {
  const entry: FrameEntry = {
    tabId: frame.tabId,
    frameId: frame.frameId,
    documentId: frame.documentId ?? null,
    origin: new URL(frame.url).origin,
    platform: platformOfUrl(frame.url),
    isTop: frame.isTop,
    hasForm: frame.hasForm,
    registeredAt: now,
  };
  await session.set({ [keyOf(frame.tabId, frame.frameId)]: entry });
  return entry;
}

/** Every registered frame of a tab. */
export async function framesOfTab(session: StorageArea, tabId: number): Promise<FrameEntry[]> {
  return Object.values(await session.getMany(`frames:${tabId}:`)) as FrameEntry[];
}

/** Forgets a closed tab's frames. */
export async function forgetTab(session: StorageArea, tabId: number): Promise<void> {
  await session.remove(Object.keys(await session.getMany(`frames:${tabId}:`)));
}
