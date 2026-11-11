/*
 * jr6 apply F3a (the session's jr6 APPLYPLAN §5 F3a): helpers for the worker's tests of the entry grant (sign-up.ts,
 * panel.ts, index.ts's entry/pressed and frame/wall). New helpers live here, not in worker.testkit.ts (APPLYPLAN §4).
 * Addresses are synthetic or those of committed fixtures; nothing here is a person's.
 */
import { vi } from 'vitest';
import { applicationOf } from '../adapters';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import type { RawSender, TabMessage } from '../platform/fake';
import {
  contentSender, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent, type TestWorker,
  type TestWorkerOptions,
} from './worker.testkit';

export const OPTIONS = pageSender('options.html');
export const PANEL = pageSender();
/** The tab the tests use. */
export const TAB = 12;

/** A Lever posting (its parser reads a posting) and its application form, at one key. */
export const LEVER_POSTING = 'https://jobs.lever.co/acme/1b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00';
export const LEVER_FORM = `${LEVER_POSTING}/apply`;
/** Another job's form on the same site. */
export const LEVER_OTHER = 'https://jobs.lever.co/acme/2c8e1d4f-2b5a-4f9c-8b6e-6a7f4d3c2b11/apply';
/** A Greenhouse form: another origin. */
export const GREENHOUSE_FORM = 'https://job-boards.greenhouse.io/acme/jobs/4012345678';

/** A worker connected, the disclosure acknowledged, with the default settings saved. */
export async function applyWorker(options: TestWorkerOptions = {}): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord(), ...options });
  await worker.deliver({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS }, OPTIONS);
  return worker;
}

/** A content frame of tab `tab` at `url`, in document `documentId` (the top frame unless `extra` says). */
export const at = (url: string, documentId: string, tab = TAB, extra: Partial<RawSender> = {}): RawSender =>
  contentSender({ url, tab: { id: tab, url }, documentId, ...extra });

/** The application key the address's parsers read (a hash), or undefined. */
export const keyOf = (url: string): string | undefined => applicationOf(new URL(url))?.applicationKey;

export const hello = (worker: TestWorker, sender: RawSender, hasForm: boolean, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: sender.frameId === 0 || sender.frameId === undefined, hasForm,
    ...extra }, sender);

export const wall = (worker: TestWorker, sender: RawSender, words: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/wall', wall: null, ...words }, sender);

export const fill = (worker: TestWorker, tabId = TAB, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'panel/fill', tabId, dryRun: false, ...extra }, PANEL);

export const cancel = (worker: TestWorker, tabId = TAB) => worker.deliver({ v: 1, type: 'panel/cancel', tabId }, PANEL);

/** entry/pressed from `sender`, with `nextKey` when given. */
export const press = (worker: TestWorker, sender: RawSender, nextKey?: string) =>
  worker.deliver({ v: 1, type: 'entry/pressed', ...(nextKey === undefined ? {} : { nextKey }) }, sender);

/** The tab's page state, as the panel reads it. */
export const pageOf = async (worker: TestWorker, tabId = TAB) => ((await worker.deliver({ v: 1, type: 'panel/reports',
  tabId }, PANEL)) as { data: { page?: Record<string, unknown> } }).data.page;

/** The run/starts the worker sent to frames. */
export const starts = (worker: TestWorker): TabMessage[] => sentToFrames(worker)
  .filter((sent) => typeOfSent(sent) === 'run/start');

/** Where each run/start went, and with what. */
export const startsAt = (worker: TestWorker) => starts(worker).map((sent) => ({ frameId: sent.options?.frameId,
  documentId: (sent.options as { documentId?: string } | undefined)?.documentId,
  signIn: (sent.message as { signIn?: true }).signIn === true }));

/** The run/cancels the worker sent to frames, by frame. */
export const cancelsAt = (worker: TestWorker) => sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'run/cancel')
  .map((sent) => sent.options?.frameId);

/** Lets the worker's background work (a microtask hop, a push) land. */
export async function settle(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Moves the worker's clock and its timers together. */
export function advance(worker: TestWorker, ms: number): void {
  worker.clock.now += ms;
  worker.timers.advance(ms);
}

/** Waits until `count` run/starts were sent, then lets anything more land, and answers how many there are. */
export async function startsAfter(worker: TestWorker, count: number): Promise<number> {
  await vi.waitFor(() => {
    if (starts(worker).length < count) throw new Error(`${starts(worker).length} run/start of ${count}`);
  });
  await settle();
  return starts(worker).length;
}

/** A posting at `url` in tab `tab`'s top frame, document `documentId`, whose adapter offers its own Apply (`entry`,
 *  unless `told` is false). */
export async function postingTab(worker: TestWorker, url: string, documentId = 'doc-posting', told = true,
  tab = TAB): Promise<RawSender> {
  const sender = at(url, documentId, tab);
  await hello(worker, sender, false);
  if (told) await wall(worker, sender, { entry: true });
  return sender;
}
