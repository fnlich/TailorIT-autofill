/*
 * The auto-apply agent as the side panel and the options page show it (v3 Phase 5; docs/SPEC-AMENDMENTS.md §12
 * Decision 9): "Auto-apply: running <job> · N done today · last: <state (reason)>", a Stop button (agent/stop: the job
 * running now is left for the person, and Run auto-apply goes off) and a link to TailorIT's Auto-apply page. Value-free:
 * the job's title and company as TailorIT named them, counts, states and reasons.
 * useAgentStatus reads agent/status when the page opens, when it is seen again, when the worker says the agent changed
 * (panel/changed {what: 'agent'}: the side panel's port; the options page listens on a port of its own) and after the
 * person's own actions.
 * v2.0 P9 (autofill API 8): while TailorIT's daily auto-apply limit holds the agent (blocked 'daily-limit'), the line is
 * followed by TailorIT's own words for it, as they are, and Subscribe (TailorIT's Settings › Account, in a new tab).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { AgentStatus } from '../../messaging/schemas';
import { PanelPortMessageSchema } from '../../messaging/page-schemas';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { API8_COPY } from '../options/copy-api8'; // v2.0 P9
import { request } from './request';

/** TailorIT's Auto-apply page, where the queue and every result are listed. */
export const AUTO_APPLY_URL = `${__TAILORIT_ORIGIN__}/auto-apply`;
/** v2.0 P9: TailorIT's Settings › Account, where a Free account subscribes. */
export const SUBSCRIBE_URL = `${__TAILORIT_ORIGIN__}/settings#account`;

/** The agent's status, and how to refresh it or show one an answer carried. */
export interface AgentState {
  status: AgentStatus | null;
  refresh(): void;
  accept(status: AgentStatus): void;
}

/** `changes` counts the worker's agent changes (the side panel's port); `listen` opens a port of the page's own for
 *  them (the options page). `anchor` is an element of the page: its document says when the page is seen again. */
export function useAgentStatus(platform: PagePlatform, anchor: RefObject<Element | null>,
  options: { changes?: number; listen?: boolean } = {}): AgentState {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [heard, setHeard] = useState(0);
  const latest = useRef(0);
  const refresh = useCallback(() => {
    latest.current += 1;
    const ask = latest.current;
    void request(platform, { v: 1, type: 'agent/status' }).then((answer) => {
      if (ask === latest.current && answer.ok) setStatus(answer.data);
    });
  }, [platform]);
  const accept = useCallback((next: AgentStatus) => {
    latest.current += 1;
    setStatus(next);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, options.changes, heard]);

  useEffect(() => {
    const doc = anchor.current?.ownerDocument;
    if (!doc) return undefined;
    const onVisible = () => {
      if (doc.visibilityState === 'visible') refresh();
    };
    const view = doc.defaultView;
    doc.addEventListener('visibilitychange', onVisible);
    view?.addEventListener('focus', refresh);
    return () => {
      doc.removeEventListener('visibilitychange', onVisible);
      view?.removeEventListener('focus', refresh);
    };
  }, [refresh, anchor]);

  const listen = options.listen === true;
  useEffect(() => {
    if (!listen) return undefined;
    let port: ReturnType<PagePlatform['runtime']['connect']>;
    try {
      port = platform.runtime.connect('panel');
    } catch {
      return undefined;
    }
    const stop = port.onMessage((raw) => {
      const parsed = PanelPortMessageSchema.safeParse(raw);
      if (parsed.success && parsed.data.type === 'panel/changed'
        && (parsed.data.what === 'agent' || parsed.data.what === 'connection')) setHeard((count) => count + 1);
    });
    return () => {
      stop();
      try {
        port.disconnect();
      } catch {
        // Gone already.
      }
    };
  }, [platform, listen]);

  return { status, refresh, accept };
}

/** The status line, with Stop while the agent is on, and the link to TailorIT's Auto-apply page. */
export function AgentStatusLine({ platform, agent, className }: {
  platform: PagePlatform;
  agent: AgentState;
  className?: string;
}) {
  const [stopping, setStopping] = useState(false);
  const { status } = agent;
  if (status === null) return null;
  const stop = () => {
    setStopping(true);
    void request(platform, { v: 1, type: 'agent/stop' }).then((answer) => {
      setStopping(false);
      if (answer.ok) agent.accept(answer.data);
      else agent.refresh();
    });
  };
  return (
    <div className={className ?? 'tia-strip tia-agent'} data-tone="neutral" data-agent={status.phase} role="status">
      <span data-agent-line="">{COPY.agent.line(status)}</span>
      {/* v2.0 P9 (API 8): TailorIT's daily auto-apply limit, in its own words, and Subscribe. */}
      {status.blocked === 'daily-limit' && (
        <span data-agent-limit="" style={{ flexBasis: '100%' }}>
          {status.limit?.message ?? API8_COPY.limitReached(status.limit?.resetsAt ?? null)}{' '}
          <a href={SUBSCRIBE_URL} target="_blank" rel="noreferrer" data-tailorit-link="subscribe">{API8_COPY.subscribe}</a>
        </span>
      )}
      <span className="tia-agent__actions">
        {status.on && (
          <button type="button" className="tia-button" data-action="agent-stop" disabled={stopping} onClick={stop}>
            {COPY.agent.stop}
          </button>
        )}
        <a href={AUTO_APPLY_URL} target="_blank" rel="noreferrer" data-tailorit-link="auto-apply">{COPY.agent.open}</a>
      </span>
    </div>
  );
}
