/*
 * An in-memory ContentPlatform for browser-mode tests: the content runtime takes its platform as a parameter, so a test
 * hands it this and a scripted worker double instead of a real extension.
 */
import type { ContentPlatform, Handler, PortLike } from './types';

/** A content platform whose worker is `worker`: every send is answered by it, in order. */
export function createMemoryContentPlatform(worker: (message: unknown) => Promise<unknown>): ContentPlatform & {
  sent: unknown[];
  deliver(message: unknown): Promise<unknown>;
} {
  const sent: unknown[] = [];
  let toFrame: Handler | null = null;
  return {
    sent,
    runtime: {
      id: 'memory-extension',
      async send(message) {
        sent.push(message);
        return worker(message);
      },
      connect(): PortLike {
        throw new Error('ports are added with the resume transfer (Phase 2)');
      },
      onMessage(handler) {
        toFrame = handler;
      },
      isValid: () => true,
    },
    now: () => 0,
    deliver: (message) => (toFrame ? toFrame(message, { id: 'memory-extension' }) : Promise.resolve(undefined)),
  };
}
