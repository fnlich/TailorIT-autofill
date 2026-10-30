/*
 * The generic adapter's pure address rules (docs/design/runtime.md §9). It is the fallback for any page no platform
 * adapter claims, so it handles every web address, and its canonical application URL, from which the applicationKey
 * is hashed, is the page's origin and path: the query and fragment carry tracking and state, not the application.
 */

/** Any http or https address: the generic adapter is the fallback. */
export function matchesGenericUrl(url: URL): boolean {
  return url.protocol === 'https:' || url.protocol === 'http:';
}

/** The page's origin and path, or null for an address that is not a web page. */
export function genericCanonicalUrl(url: URL): string | null {
  if (!matchesGenericUrl(url)) return null;
  return `${url.origin}${url.pathname}`;
}
