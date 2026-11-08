/*
 * s2 core-wd: "three styles, then Other or leave" in the content runtime (content/pass.ts searchField's "Other"
 * query; plan/frame.ts planNoMatchOther; the owner, 2026-11-07: "there is no matched after with 3 different style
 * value, last will be other or don't write (user can set on setting it)"). The fake worker plans each pass with the
 * real planFrame over the golden profile (The University of Texas at Austin). The page is a remote typeahead in the
 * synthetic remote-typeahead page's own shape (an ARIA combobox over a listbox its script fills 60 ms after each input
 * event of three characters or more) whose school list holds no Texas school: only "Other" finds anything, the list's
 * own "Other" and a school whose name holds the word; choosing "Other" reveals an "If other, please specify" box.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FillResult } from '../core/types/fill';
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import { CAUTIOUS_SETTINGS } from '../core/plan/settings.testkit';
import { loadFixture, logEvents, removeFixtures, untrustedViolations } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

beforeAll(() => {
  testVocab();
});

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** The page (see the header). `answers` names what the script lists for a query (lower case), [] for any other. */
const page = (answers: Record<string, string[]>) => `<!doctype html><html lang="en"><body><main>
  <h1>Data Analyst</h1>
  <form id="application" action="/__submitted" method="post">
    <label for="name">Full name</label><input id="name" name="name" required>
    <h2>Education</h2>
    <div id="school-field">
      <label for="school">School</label>
      <input id="school" name="school" role="combobox" aria-autocomplete="list" aria-expanded="false"
        aria-controls="school-listbox" autocomplete="off">
      <ul id="school-listbox" role="listbox" aria-label="Schools" hidden></ul>
    </div>
    <button type="submit">Submit application</button>
  </form></main>
  <script>
    (() => {
      const ANSWERS = ${JSON.stringify(answers)};
      const input = document.getElementById('school');
      const list = document.getElementById('school-listbox');
      window.__queries = [];
      window.__resultClicks = [];
      let pending = 0;
      const show = (open) => { list.hidden = !open; input.setAttribute('aria-expanded', String(open)); };
      input.addEventListener('input', () => {
        pending += 1;
        const mine = pending;
        const query = input.value.trim();
        list.replaceChildren();
        show(false);
        if (query.length < 3) return;
        window.__queries.push(query);
        setTimeout(() => {
          if (mine !== pending) return;
          const results = ANSWERS[query.toLowerCase()] ?? [];
          list.replaceChildren(...results.map((label, at) => {
            const option = document.createElement('li');
            option.id = 'school-option-' + at;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', 'false');
            option.textContent = label;
            option.addEventListener('click', () => {
              window.__resultClicks.push(label);
              input.value = label;
              list.replaceChildren();
              show(false);
              if (label !== 'Other' || document.getElementById('specify')) return;
              const box = document.createElement('label');
              box.htmlFor = 'specify';
              box.textContent = 'If other, please specify';
              const field = document.createElement('input');
              field.id = 'specify';
              field.name = 'specify';
              document.getElementById('school-field').after(box, field);
            });
            return option;
          }));
          show(results.length > 0);
        }, 60);
      });
      input.addEventListener('focusout', () => show(false));
    })();
  </script></body></html>`;

const OTHER_LISTED = page({ other: ['Otterbein University', 'Other'] });
const STYLES = ['University of Texas at Austin', 'UT Austin', 'University of Texas'];

async function fill(html: string, settings: Settings) {
  const fixture = await loadFixture(document, html, { width: 1280, height: 900 });
  const events = logEvents(fixture.doc);
  const worker = createFakeWorker({ settings });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, {
    href: () => 'https://jobs.lever.co/tailorit-fixture/no-match-other/apply', isTop: true, settle: { quietMs: 200 } });
  runtimes.push(runtime);
  await runtime.fill({});
  const report = worker.reports.at(-1)!;
  const row = (label: string) => report.fields.find((each) => each.label === label) as FillResult;
  const counter = <T>(name: string) => (fixture.view as unknown as Record<string, T>)[name]!;
  return { fixture, events, worker, row, counter };
}

const withNoMatch = (noMatch: 'other' | 'leave'): Settings => ({ ...CAUTIOUS_SETTINGS,
  modes: { ...CAUTIOUS_SETTINGS.modes, noMatch } });

describe('s2 core-wd: three styles, then the list\'s own "Other"', () => {
  it('types the three styles, then "Other", chooses the list\'s own "Other", and types the school into its box', async () => {
    const ran = await fill(OTHER_LISTED, withNoMatch('other'));
    expect(ran.counter<string[]>('__queries')).toEqual([...STYLES, 'Other']);
    expect(ran.counter<string[]>('__resultClicks')).toEqual(['Other']);
    expect((ran.fixture.doc.getElementById('school') as HTMLInputElement).value).toBe('Other');
    expect(ran.row('School')).toMatchObject({ category: 'education.school', kind: 'typeahead-remote', wrote: true,
      provenance: 'profile', matcherStage: 'other', reason: 'other-option-with-free-text' });
    // The box "Other" revealed gets the person's school (the reactive loop's follow-up, rule other.free-text).
    expect((ran.fixture.doc.getElementById('specify') as HTMLInputElement).value)
      .toBe('The University of Texas at Austin');
    // The worker read the "Other" query's results marked so, and only those.
    const asked = ran.worker.of('plan/request').flatMap((message) => message.specs as Array<{ label: string;
      searchOther?: true; options: unknown }>).filter((spec) => spec.label === 'School' && Array.isArray(spec.options)
      && (spec.options as unknown[]).length > 0);
    expect(asked.map((spec) => spec.searchOther ?? false)).toEqual([true]);
    expect(untrustedViolations(ran.events.events)).toEqual([]);
  });

  it('is the default: a setting that does not name it reads as \'other\'', async () => {
    // A worker's message from before settings version 7 names no noMatch: the content schema's default reads 'other'.
    const { noMatch: _unnamed, ...modes } = CAUTIOUS_SETTINGS.modes;
    const ran = await fill(OTHER_LISTED, { ...CAUTIOUS_SETTINGS, modes } as unknown as typeof CAUTIOUS_SETTINGS);
    expect(ran.counter<string[]>('__queries')).toEqual([...STYLES, 'Other']);
    expect(ran.row('School')).toMatchObject({ wrote: true, matcherStage: 'other' });
    expect(DEFAULT_SETTINGS.modes.noMatch).toBe('other');
  });

  it('types three styles and nothing more under \'leave\': the field stays empty', async () => {
    const ran = await fill(OTHER_LISTED, withNoMatch('leave'));
    expect(ran.counter<string[]>('__queries')).toEqual(STYLES);
    expect(ran.counter<string[]>('__resultClicks')).toEqual([]);
    expect((ran.fixture.doc.getElementById('school') as HTMLInputElement).value).toBe('');
    expect(ran.row('School')).toMatchObject({ wrote: false, status: 'flagged', reason: 'no-match' });
  });

  it('chooses nothing when what "Other" lists has no strict "Other" ("None of the above"): the box is put back', async () => {
    const ran = await fill(page({ other: ['None of the above', 'Otterbein University'] }), withNoMatch('other'));
    expect(ran.counter<string[]>('__queries')).toEqual([...STYLES, 'Other']);
    expect(ran.counter<string[]>('__resultClicks')).toEqual([]);
    expect((ran.fixture.doc.getElementById('school') as HTMLInputElement).value).toBe('');
    expect(ran.row('School')).toMatchObject({ wrote: false, status: 'flagged', reason: 'no-match' });
  });

  it('never types "Other" once a style found the school', async () => {
    const ran = await fill(page({ 'ut austin': ['University of Texas at Austin'], other: ['Other'] }),
      withNoMatch('other'));
    expect(ran.counter<string[]>('__queries')).toEqual(STYLES.slice(0, 2));
    expect(ran.counter<string[]>('__resultClicks')).toEqual(['University of Texas at Austin']);
    expect(ran.row('School')).toMatchObject({ wrote: true, status: 'verified' });
  });
});
