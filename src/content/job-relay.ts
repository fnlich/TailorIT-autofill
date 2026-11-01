/*
 * The job card's relay in the content script (v2; docs/ARCHITECTURE.md "The job card"). The worker has no page address:
 * Chrome tells it a content message's sender address, so the worker asks the form frame to relay.
 * - job/refresh {action}: the frame sends job/lookup or job/add, with no payload, and answers {} once the worker
 *   answered it. Both answers carry nothing: what TailorIT said of the job never reaches the page's process. A frame
 *   with no form of ours relays nothing ('expired').
 * - job/postingText: for the side panel's custom question, the posting's visible text outside the form root, as a draft
 *   reads it (the top frame only: '' in a frame inside another site's page), and the page's canaries (its text addressed
 *   to AI tools, hidden or not), so TailorIT and the worker refuse an answer that holds one. Page text, never kept.
 */
import { scanTripwires } from '../core/guard/tripwire';
import { rawScan } from '../dom/raw-scan';
import { visibleTextWithout } from '../dom/visible-text';
import { ok, refuse, type Answer } from '../messaging/envelope';
import { MAX_POSTING_TEXT, type JobRelayAction } from '../messaging/schemas';
import type { Channel } from './channel';

/** job/refresh: relays the action to the worker; {} once it answered, or why it would not. */
export async function relayJob(channel: Channel, action: JobRelayAction, hasForm: boolean):
  Promise<Answer<Record<string, never>>> {
  if (!hasForm) return refuse('expired');
  const answer = await channel.request({ v: 1, type: action === 'lookup' ? 'job/lookup' : 'job/add' });
  return answer.ok ? ok({}) : refuse(answer.error === 'rate_limited' ? 'rate_limited' : 'unavailable');
}

/** job/postingText: the posting's visible text outside `root` (top frame only) and the page's nearest canaries. */
export async function postingTextOf(doc: Document, root: Element | null, isTop: boolean, signal: AbortSignal):
  Promise<{ text: string; canaries: string[] }> {
  const body = doc.body;
  const text = isTop && body !== null ? visibleTextWithout(body, root === null ? [] : [root], { cap: MAX_POSTING_TEXT }).trim()
    : '';
  const raw = await rawScan(doc, { signal });
  return { text, canaries: scanTripwires(raw.passages).canaries.filter((canary) => canary.length <= 120).slice(0, 32) };
}
