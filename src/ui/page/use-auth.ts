/*
 * The connection as the side panel and the options page show it: auth/status, read when the page opens, whenever it
 * becomes visible or takes the focus again (pairing finishes in TailorIT's own tab, so the person comes back to a page
 * that may be out of date) and whenever the page asks. An AuthStatus another answer carried (auth/redeemCode,
 * auth/disconnect) replaces it at once. It holds the account's name and email, which the pages show; never a token,
 * which no answer carries.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { AuthStatus } from '../../messaging/schemas';
import type { PagePlatform } from '../../platform/types';
import { request } from './request';

/** The connection and how to refresh it. */
export interface AuthState {
  /** Null until the first answer. */
  status: AuthStatus | null;
  /** The last read failed (the worker did not answer, or answered something unreadable). */
  failed: boolean;
  refresh(): void;
  /** Shows an AuthStatus another answer carried. */
  accept(status: AuthStatus): void;
}

/** `anchor` is an element of the page: its document says when the page becomes visible again. */
export function useAuthStatus(platform: PagePlatform, anchor: RefObject<Element | null>): AuthState {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [failed, setFailed] = useState(false);
  // Only the latest read may land: an older answer never overwrites a newer one.
  const latest = useRef(0);

  const refresh = useCallback(() => {
    latest.current += 1;
    const ask = latest.current;
    void request(platform, { v: 1, type: 'auth/status' }).then((answer) => {
      if (ask !== latest.current) return;
      if (answer.ok) {
        setStatus(answer.data);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
  }, [platform]);

  const accept = useCallback((next: AuthStatus) => {
    latest.current += 1;
    setStatus(next);
    setFailed(false);
  }, []);

  useEffect(() => {
    refresh();
    const doc = anchor.current?.ownerDocument;
    if (!doc) return undefined;
    const view = doc.defaultView;
    const onVisible = () => {
      if (doc.visibilityState === 'visible') refresh();
    };
    // Focus too: TailorIT may sit in another window beside this one, so the page never stopped being visible.
    const onFocus = () => refresh();
    doc.addEventListener('visibilitychange', onVisible);
    view?.addEventListener('focus', onFocus);
    return () => {
      doc.removeEventListener('visibilitychange', onVisible);
      view?.removeEventListener('focus', onFocus);
    };
  }, [refresh, anchor]);

  return { status, failed, refresh, accept };
}
