/*
 * Address changes in a single-page application (docs/design/runtime.md §8.1). The address is always read from
 * location.href itself, never from an event's data, so a page that dispatches a forged navigation, popstate or
 * hashchange event changes nothing: the handler reads an unchanged address and returns. The Navigation API's
 * currententrychange says when to look; without it, dom/time.ts polls every URL_POLL_MS. WXT's own location watcher
 * (`wxt:locationchange`) is never used, because a page can reach WXT's context (forged.ts).
 */
import { URL_POLL_MS } from '../dom/thresholds';
import { every } from '../dom/time';

/** Calls `onChange` with the new address whenever `read()` gives a different one, until `signal` aborts. */
export function watchLocation(view: Window, read: () => string, onChange: (href: string) => void,
  signal: AbortSignal): void {
  let last = read();
  const check = () => {
    if (signal.aborted) return;
    const now = read();
    if (now === last) return;
    last = now;
    onChange(now);
  };
  const navigation = (view as Window & { navigation?: EventTarget }).navigation;
  if (navigation !== undefined && typeof navigation.addEventListener === 'function') {
    navigation.addEventListener('currententrychange', check, { signal });
  } else {
    every(URL_POLL_MS, check, signal);
  }
  view.addEventListener('popstate', check, { signal });
  view.addEventListener('hashchange', check, { signal });
}
