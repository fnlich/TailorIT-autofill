/*
 * scripts/provenance.mjs (jr7 review A-4): the exact list of the adapters' provenance that scripts/check-build.mjs
 * holds every bundle to (scripts/provenance-values.json). The committed list is the sources' own; every provenance key
 * under src/adapters (a rule's `from`, a config's `snapshots`, a widget's or a date's `snapshot`) is behind its
 * __PROVENANCE__ gate, so no build holds it; each value the configs and success rules hold at run time (Vitest defines
 * __PROVENANCE__ true) is in the list; and the scan reads what a gate holds, never the code around it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROVENANCE_LIST, provenanceListText, provenanceScan } from '../scripts/provenance.mjs';
import { ATS_CONFIGS } from '../src/adapters/configured/registry';
import { SMARTRECRUITERS_SUCCESS } from '../src/adapters/smartrecruiters';
import { SUCCESSFACTORS_SUCCESS } from '../src/adapters/successfactors';
import { WORKDAY_CONGRATULATIONS, WORKDAY_SUCCESS } from '../src/adapters/workday';

const ROOT = resolve(import.meta.dirname, '..');

let scanned: ReturnType<typeof provenanceScan> | null = null;
/** The scan of the extension's own sources, once. */
const scan = () => (scanned ??= provenanceScan(ROOT));

/** Every `from`, `snapshot` and `snapshots` string under `value`, walked as data (functions and elements aside). */
function provenanceOf(value: unknown, out: string[] = [], seen = new Set<object>()): string[] {
  if (value === null || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  for (const [key, inner] of Object.entries(value)) {
    if ((key === 'from' || key === 'snapshot') && typeof inner === 'string') out.push(inner);
    else if (key === 'snapshots' && Array.isArray(inner)) out.push(...inner.filter((each) => typeof each === 'string'));
    else provenanceOf(inner, out, seen);
  }
  return out;
}

describe("the adapters' provenance list (jr7 review A-4)", () => {
  it('is the sources\' own, as committed', () => {
    expect(readFileSync(join(ROOT, PROVENANCE_LIST), 'utf8')).toBe(provenanceListText(scan().values));
  }, 60_000);

  it('finds every provenance key under src/adapters behind its __PROVENANCE__ gate, and reads every gate', () => {
    expect(scan().ungated).toEqual([]);
    expect(scan().unread).toEqual([]);
  }, 60_000);

  it("holds the three widget captures that shipped before the review, and ClearCompany's case names", () => {
    expect(scan().values).toEqual(expect.arrayContaining(['jr7-paycomonline1-apply-2', 'jr7-bamboohr1-form-filled',
      'jr7-rippling1-apply-blank, jr7-rippling2-apply-blank', 'vafb-account', 'fixtures/lever/location-open.html',
      'fixtures/ashby/openai-closed.html', 'ultipro-0']));
  }, 60_000);

  it('holds every provenance value the configs and the success rules hold at run time', () => {
    const live = provenanceOf([ATS_CONFIGS, SMARTRECRUITERS_SUCCESS, SUCCESSFACTORS_SUCCESS, WORKDAY_SUCCESS,
      WORKDAY_CONGRATULATIONS]);
    // Vitest defines __PROVENANCE__ true: the configs carry theirs (configProblems reads them).
    expect(live.length).toBeGreaterThan(300);
    const values = new Set(scan().values);
    expect(live.filter((value) => value.length >= 4 && !values.has(value))).toEqual([]);
  }, 60_000);
});

describe("the provenance scan's reading", () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  /** A copy of `files` (paths under src/) in a new folder, scanned. */
  function scanOf(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'tailorit-provenance-'));
    folders.push(root);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, 'src', path)), { recursive: true });
      writeFileSync(join(root, 'src', path), text);
    }
    return provenanceScan(root);
  }

  it("reads a gate's literals, the constants it names (its file's, imported), a mapped list, a joined note", () => {
    const { values, ungated, unread } = scanOf({
      'adapters/acme/cases.ts': "export const ACME_CASES = ['acme-1-form', 'acme-1-thanks'] as const;\n",
      'adapters/acme/config.ts': [
        "import { ACME_CASES } from './cases';",
        "const ACME_PATHS = ACME_CASES.map((name) => `fixtures/acme/${name}.html`);",
        "const NOTE = 'acme-2-capture';",
        'export const CONFIG = {',
        '  ...(__PROVENANCE__ && { snapshots: [',
        "    ...ACME_PATHS.map((path) => path.replace(/^fixtures\\/acme\\//g, ''))] }),",
        "  root: { css: 'form.apply', ...(__PROVENANCE__ && { from: 'acme-0, acme-1' }) },",
        "  ...(__PROVENANCE__ && { from: 'Jobright 9.9 rule; ' + 'snapshot9 acme1' }),",
        '};',
        'export function widgetFor(el: Element) {',
        "  return { kind: 'combobox', opener: el,",
        "    ...(__PROVENANCE__ && { snapshot: el.matches('select.acme-menu') ? ACME_PATHS[0] : `${NOTE}` }) };",
        '}',
      ].join('\n'),
    });
    expect(ungated).toEqual([]);
    expect(unread).toEqual([]);
    expect(values).toEqual(['Jobright 9.9 rule; ', 'Jobright 9.9 rule; snapshot9 acme1', 'acme-0, acme-1',
      'acme-1-form.html', 'acme-1-thanks.html', 'acme-2-capture', 'fixtures/acme/acme-1-form.html',
      'fixtures/acme/acme-1-thanks.html', 'snapshot9 acme1']);
    // The code around a gate is never provenance: a condition's selector, a rule's selector.
    expect(values).not.toContain('select.acme-menu');
    expect(values).not.toContain('form.apply');
  });

  it('reports a provenance key under src/adapters outside its gate (its value listed too), and none elsewhere', () => {
    const { values, ungated } = scanOf({
      'adapters/acme/widgets.ts':
        "export const w = (el: Element) => ({ kind: 'radio', opener: el, snapshot: 'acme-3-open' });\n",
      'background/range.ts': "export const range = { from: '2020-01', to: '2021-02' };\n",
    });
    expect(ungated).toEqual(['src/adapters/acme/widgets.ts:1 snapshot']);
    expect(values).toEqual(['acme-3-open']);
  });

  it('reports a gate whose value names nothing it can read', () => {
    const { unread } = scanOf({
      'adapters/acme/config.ts':
        "import { CASES } from 'elsewhere';\nexport const C = { ...(__PROVENANCE__ && { snapshots: CASES }) };\n",
    });
    expect(unread).toEqual(['src/adapters/acme/config.ts:2 __PROVENANCE__']);
  });
});
