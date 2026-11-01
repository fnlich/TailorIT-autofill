/*
 * The job card's relay in the content script (v2; docs/ARCHITECTURE.md "The job card"). The worker has no page address:
 * Chrome tells it a content message's sender address, so the worker asks the form frame to relay.
 * - job/refresh {action}: the frame sends job/lookup or job/add, with no payload, and answers {} once the worker
 *   answered it. Both answers carry nothing: what TailorIT said of the job never reaches the page's process. A frame
 *   with no form of ours relays nothing ('expired').
 * - job/postingText: for the side panel's custom question, the posting's visible text outside the form root, as a draft
 *   reads it (the top frame only: '' in a frame inside another site's page), the page's canaries (its text addressed
 *   to AI tools, hidden or not), so TailorIT and the worker refuse an answer that holds one, and whether the frame's
 *   visible text says AI-assisted applications are not allowed (the policy patterns, as a run's gate reads them), so the
 *   panel shows that notice with the answer even before any run. Page text, never kept.
 * - Phase G: postingNamesOf, the company and job title the frame's own page title names (Greenhouse's "Job Application
 *   for <title> at <company>", Lever's "<company> - <title>"), for a cover letter of a posting TailorIT does not have;
 *   job/postingText carries them (`names`), and so does a plan/request that plans an upload (`posting`). A title that
 *   speaks to AI tools (a tripwire), or one of another shape, names nothing. job/postingText also says when the form's
 *   fields state "I did not use AI" (`attestation`, read as planFrame reads it: the Phase G review, MINOR 5), so the
 *   side panel's Write it now writes nothing there before any run.
 */
import type { Platform } from '../core/enums';
import { scanTripwires, tripwireHits } from '../core/guard/tripwire';
import { holdsNoAiAttestation } from '../core/plan/attestation';
import { capCodePoints } from '../core/text/fold';
import type { FieldSpec } from '../core/types/field';
import type { VisibleText } from '../core/types/text';
import { rawScan } from '../dom/raw-scan';
import { visibleTextWithout } from '../dom/visible-text';
import { ok, refuse, type Answer } from '../messaging/envelope';
import { MAX_POSTING_NAME, MAX_POSTING_TEXT, type JobRelayAction } from '../messaging/schemas';
import type { Channel } from './channel';
import { frameHitsOf } from './policy';

/** job/refresh: relays the action to the worker; {} once it answered, or why it would not. */
export async function relayJob(channel: Channel, action: JobRelayAction, hasForm: boolean):
  Promise<Answer<Record<string, never>>> {
  if (!hasForm) return refuse('expired');
  const answer = await channel.request({ v: 1, type: action === 'lookup' ? 'job/lookup' : 'job/add' });
  return answer.ok ? ok({}) : refuse(answer.error === 'rate_limited' ? 'rate_limited' : 'unavailable');
}

/** The company and the job title a page's title names (module header). */
export interface PostingNames {
  company: string;
  title: string;
}

/** One name as a page's title gives it: control and format characters gone, spaces folded, at most MAX_POSTING_NAME. */
const nameOf = (text: string) => capCodePoints(text.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim(),
  MAX_POSTING_NAME).trim();

/** The company and job title the frame's own page title names, by its platform's shape; null for none (module
 *  header). */
export function postingNamesOf(doc: Document, platform: Platform | null): PostingNames | null {
  const heading = nameOf(doc.title ?? '');
  if (heading === '' || tripwireHits(heading as VisibleText).length > 0) return null;
  let names: PostingNames | null = null;
  if (platform === 'greenhouse') {
    const match = /^Job Application for (.+) at (.+)$/i.exec(heading);
    if (match !== null) names = { title: nameOf(match[1]!), company: nameOf(match[2]!) };
  } else if (platform === 'lever') {
    const at = heading.indexOf(' - ');
    if (at > 0) names = { company: nameOf(heading.slice(0, at)), title: nameOf(heading.slice(at + 3)) };
  }
  return names !== null && names.company !== '' && names.title !== '' ? names : null;
}

/** job/postingText: the posting's visible text outside `root` (top frame only), the page's nearest canaries, whether
 *  the frame's visible text forbids AI, the names its page title gives (Phase G), and whether the form's fields
 *  (`specs`, its scan) state "I did not use AI" (the Phase G review, MINOR 5: read as planFrame reads it). */
export async function postingTextOf(doc: Document, root: Element | null, isTop: boolean, signal: AbortSignal,
  platform: Platform | null = null, specs: readonly FieldSpec[] = []):
  Promise<{ text: string; canaries: string[]; policy: boolean; names?: PostingNames; attestation?: true }> {
  const body = doc.body;
  const text = isTop && body !== null ? visibleTextWithout(body, root === null ? [] : [root], { cap: MAX_POSTING_TEXT }).trim()
    : '';
  const raw = await rawScan(doc, { signal });
  const names = postingNamesOf(doc, platform);
  return { text, canaries: scanTripwires(raw.passages).canaries.filter((canary) => canary.length <= 120).slice(0, 32),
    policy: frameHitsOf(doc).length > 0, ...(names === null ? {} : { names }),
    ...(holdsNoAiAttestation(specs) ? { attestation: true as const } : {}) };
}
