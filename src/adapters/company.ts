/*
 * The company a form's address names, for answers saved for one company (Phase 6; docs/ARCHITECTURE.md "Saved
 * answers"): its platform and its board (a Greenhouse board, a Lever site) as the extension's own URL parsers read it,
 * in lower case. The worker reads it at each plan from the frame's address; the frame reads it from its own at Save my
 * answer, so a worker stopped meanwhile still knows it (the Phase 6 review, E5). Nothing stores it: it goes to TailorIT
 * only as a free-text answer's scope.
 */
import type { CompanyScope } from '../core/resolver/saved';
import { parseGreenhouseUrl } from './greenhouse/url';
import { parseLeverUrl } from './lever/url';

/**
 * The company an address names: its platform and board in lower case; null when it names none (an embedded form
 * without its board, a platform with no parser yet, the reserved fixture board), or is no address.
 */
export function companyOfUrl(address: string): CompanyScope | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const parsed = parseLeverUrl(url) ?? parseGreenhouseUrl(url);
  if (parsed === null || parsed.board === null || parsed.board === '' || /\s/.test(parsed.board)) return null;
  return { platform: parsed.platform, board: parsed.board.toLowerCase() };
}

/** A company scope as TailorIT keeps it: '<platform>:<board>'. */
export const scopeOf = (company: CompanyScope): string => `${company.platform}:${company.board}`;
