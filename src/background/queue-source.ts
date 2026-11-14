/*
 * v1.5 QX (PLAN decision 6): what the sequential auto-apply reads of TailorIT's queue, as TailorIT v1.5 Q2's contract
 * (agent.ts, eafe54f) gives it, with a token of scope agent:run:
 * - GET /api/autofill/agent/queue?state=queued&limit=…&cursor=… (AutofillAgentQueueQuery): a page of the queued rows,
 *   oldest first, the order the agent takes them; `total` counts them all, `nextCursor` names the next page;
 * - POST /api/autofill/agent/:id/opened (AutofillAgentOpened): the run takes a queued row before it opens its tab, so
 *   the background agent never takes it; `item` is the task to open (its form's address and the resume to attach), or
 *   null when TailorIT finished the row at the claim (skipped, already applied; failed, closed or not one the agent
 *   opens), with that state and reason; 409 when the agent, another browser or an end took it, 404 when it is gone;
 * - POST /api/autofill/agent/:id/result: how it went, as the agent's.
 * v2.0 P9 (autofill API 8): a row TailorIT queued for the person to apply to by hand (run kind `manual`: a job neither
 * run can open) is never the runner's, should a list carry one (a token's list leaves them out): pageOf drops it.
 */
import {
  AUTOFILL_AGENT_QUEUE_PAGE_MAX, AutofillAgentQueueQuerySchema, type AutofillAgentQueueItem, type AutofillAgentQueueList,
} from '../contract/tailorit';

/** How many queued jobs one GET asks for: the most a page holds. */
export const QUEUE_SOURCE_PAGE = AUTOFILL_AGENT_QUEUE_PAGE_MAX;

/** One job of TailorIT's queue as the runner reads it. */
export type QueueTask = Pick<AutofillAgentQueueItem, 'id' | 'jobId' | 'title' | 'company' | 'url' | 'state' | 'reason'>;

/** A page of the queue: its jobs, how many there are in all, and the cursor of the next page (null: the last). */
export interface QueuePage {
  items: QueueTask[];
  total: number;
  next: string | null;
}

/** The contract's list as a page: v2.0 P9, never a `manual` row. */
export function pageOf(list: AutofillAgentQueueList): QueuePage {
  return { items: list.items.filter((item) => item.run !== 'manual'), total: list.total, next: list.nextCursor ?? null };
}

/** Whether a cursor is one the contract's query takes (it then goes into the query string as it is). */
export function cursorFits(cursor: string): boolean {
  return AutofillAgentQueueQuerySchema.safeParse({ cursor }).success;
}
