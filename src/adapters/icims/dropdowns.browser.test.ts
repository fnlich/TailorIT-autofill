/*
 * iCIMS's own dropdowns and their native selects (the core pass of 2026-11-06, CORE-BLOCKERS item 4: "where the markup
 * shows a native <select> that the form submits, fill the native select"). Every iCIMS dropdown in the owner's
 * snapshots (a.dropdown-select[role=combobox] over select[icimsdropdown-enabled="1"].dropdown-hide, its list loaded from
 * the server: icimsdropdown-ajax="1") keeps one option in its native select at most: the answer it holds, never the
 * list a person chooses from. The raw snapshots say the same (61 such selects on 7 portals, each with one option), so
 * no native select of an iCIMS dropdown is there to fill: those dropdowns stay the person's (widget-phase-4), and the
 * selects iCIMS draws natively (icimsdropdown-enabled="0") are fields filled as any select is. A future snapshot whose
 * dropdown's select holds its options fails this test, which is then the place to fill it natively.
 */
import { describe, expect, it } from 'vitest';

const PAGES = import.meta.glob('../../../fixtures/icims/*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;

/** Each committed iCIMS page's selects, as its markup holds them. */
function selectsOf(html: string): HTMLSelectElement[] {
  return Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('select'));
}

describe("iCIMS's dropdowns (the owner's snapshots of 2026-11-06)", () => {
  it('keep no list in their native select: one option at most, the select hidden behind the dropdown', () => {
    const dropdowns = Object.entries(PAGES).flatMap(([path, html]) => selectsOf(html)
      .filter((select) => select.getAttribute('icimsdropdown-enabled') === '1').map((select) => ({ path, select })));
    expect(dropdowns.length).toBeGreaterThan(10);
    for (const { path, select } of dropdowns) {
      expect(select.options.length, `${path} ${select.id}`).toBeLessThanOrEqual(1);
      expect(select.classList.contains('dropdown-hide'), `${path} ${select.id}`).toBe(true);
      expect(select.getAttribute('icimsdropdown-ajax'), `${path} ${select.id}`).toBe('1');
    }
  });

  it('draw the rest as native selects that hold their list (filled as any select is)', () => {
    const natives = Object.entries(PAGES).flatMap(([path, html]) => selectsOf(html)
      .filter((select) => select.getAttribute('icimsdropdown-enabled') === '0').map((select) => ({ path, select })));
    expect(natives.length).toBeGreaterThan(10);
    for (const { path, select } of natives) {
      expect(select.classList.contains('dropdown-hide'), `${path} ${select.id}`).toBe(false);
      expect(select.options.length, `${path} ${select.id}`).toBeGreaterThan(1);
    }
  });
});
