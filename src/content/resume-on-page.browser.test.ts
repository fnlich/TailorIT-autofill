/*
 * The owner's setting "Résumé already on the page" (the behaviour review of 2026-11-06, M2; core/types/settings.ts
 * version 5), run by the content runtime with the fake worker planning each pass over the golden profile and its
 * résumé, on the owner's snapshots of a page that already shows a résumé:
 * - Workday's My Experience after "Autofill with Resume" (fixtures/workday/web-my-experience.html, resolvetech-my-
 *   experience.html: Resume/CV's "Successfully Uploaded!" beside the file's name, Adapter.uploadHeld);
 * - Rippling's application with its résumé's chip (fixtures/rippling/smartsuite-uploaded.html, the configured layer's
 *   uploadHeld from its `done` sign).
 * Keep it (the default): the page's file stays, the row prefill-kept, nothing put into the input. Upload mine again: the
 * person's chosen résumé goes into that field's own file input, through the run's one upload path. Neither presses the
 * page's Delete or remove control. Where the input is gone by the write, the row says so (resume-held-no-input).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import ripplingHtml from '../../fixtures/rippling/smartsuite-uploaded.html?raw';
import ripplingRoutes from '../../fixtures/rippling/smartsuite-uploaded.routes.json';
import resolvetechHtml from '../../fixtures/workday/resolvetech-my-experience.html?raw';
import resolvetechRoutes from '../../fixtures/workday/resolvetech-my-experience.routes.json';
import webHtml from '../../fixtures/workday/web-my-experience.html?raw';
import webRoutes from '../../fixtures/workday/web-my-experience.routes.json';
import type { FillResult } from '../core/types/fill';
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, fakePdf, GOLDEN_RESUME, testVocab, type FakeWorker } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const runtimes: ContentRuntime[] = [];
beforeAll(() => {
  testVocab();
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

const withMode = (resumeOnPage: Settings['modes']['resumeOnPage']): Settings =>
  ({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, resumeOnPage } });

interface Page {
  name: string;
  html: string;
  href: string;
  /** The résumé field's file input. */
  input: string;
  /** The page's own controls that remove its file: never pressed. */
  removers: string;
}

const PAGES: Page[] = [
  // Resume/CV's drop zone (its group "Resume/CV") comes before Additional Attachments'.
  { name: 'Workday web-my-experience', html: webHtml, href: Object.keys(webRoutes)[0]!,
    input: '[aria-labelledby="Resume/CV-section"] input[data-automation-id="file-upload-input-ref"]',
    removers: 'button[data-automation-id="delete-file"]' },
  { name: 'Workday resolvetech-my-experience', html: resolvetechHtml, href: Object.keys(resolvetechRoutes)[0]!,
    input: '[aria-labelledby="Resume/CV-section"] input[data-automation-id="file-upload-input-ref"]',
    removers: 'button[data-automation-id="delete-file"]' },
  { name: 'Rippling smartsuite-uploaded', html: ripplingHtml, href: Object.keys(ripplingRoutes)[0]!,
    input: 'input[data-testid="input-resume"]', removers: '[data-testid="chip"] [role="button"]' },
];

/** Fills the page with the setting, and answers the résumé's row, its input and the presses of the page's removers.
 *  `before` changes the page before the run (the name its résumé's field shows). */
async function fillWith(page: Page, mode: Settings['modes']['resumeOnPage'],
  editPlan?: (doc: Document) => void, before?: (doc: Document) => void): Promise<{ row: FillResult;
    input: HTMLInputElement; removed: number; worker: FakeWorker }> {
  const fixture = await loadFixture(document, page.html, { width: 1280, height: 2600 });
  const doc = fixture.doc;
  before?.(doc);
  // The first résumé input the page shows held (Workday's Resume/CV comes before its Additional Attachments).
  const input = doc.querySelector<HTMLInputElement>(page.input)!;
  let removed = 0;
  for (const remover of Array.from(doc.querySelectorAll(page.removers))) {
    remover.addEventListener('click', () => { removed += 1; }, { capture: true });
  }
  const worker = createFakeWorker({ settings: withMode(mode),
    resume: { bytes: fakePdf(48_213), name: GOLDEN_RESUME.fileName, mime: 'application/pdf' },
    // No cover letter for the job: its upload is left at once (the setting is the résumé's alone).
    letter: { state: { state: 'none', reason: 'cover-letter-none' } },
    ...(editPlan === undefined ? {} : { editPlan: (plan) => {
      if (plan.writes.some((write) => write.value.kind === 'file')) editPlan(doc);
      return plan;
    } }) });
  const runtime = await startContentRuntime(worker.platform, doc, { href: () => page.href, isTop: true,
    settle: { quietMs: 200 } });
  runtimes.push(runtime);
  await runtime.fill({});
  const report = worker.reports.at(-1) ?? worker.liveReports.at(-1);
  const row = report!.fields.find((each) => each.category === 'file.resume') as FillResult;
  return { row, input, removed, worker };
}

describe('"Résumé already on the page"', () => {
  for (const page of PAGES) {
    it(`${page.name}: Keep it (the default) keeps the page's résumé, flagged prefill-kept; nothing goes into its input`,
      async () => {
        expect(DEFAULT_SETTINGS.modes.resumeOnPage).toBe('keep');
        const { row, input, removed } = await fillWith(page, 'keep');
        expect(row).toMatchObject({ status: 'flagged', reason: 'prefill-kept', wrote: false, needsUserAction: true });
        expect(input.files?.length ?? 0).toBe(0);
        expect(removed).toBe(0);
      }, 60_000);

    it(`${page.name}: Upload mine again puts the person's résumé into that field's own input; the page's remover is never pressed`,
      async () => {
        const { row, input, removed } = await fillWith(page, 'upload');
        expect(row).toMatchObject({ wrote: true, provenance: 'profile' });
        expect(row.reason).not.toBe('prefill-kept');
        expect(input.files?.[0]?.name).toBe(GOLDEN_RESUME.fileName);
        expect(removed).toBe(0);
      }, 60_000);
  }

  // The integration of 2026-11-06, the duplicate guard: Workday's drop zone takes several files, so under Upload mine
  // again the person's résumé goes in beside the page's file, and a later fill would put it in once more. A field
  // showing a file named exactly as the person's chosen résumé keeps it; one showing another name gets theirs. (The
  // fixtures' shown names are redacted: the test names the Resume/CV field's file.)
  for (const page of PAGES.slice(0, 2)) {
    const showing = (name: string) => (doc: Document) => {
      const names = doc.querySelectorAll('[aria-labelledby="Resume/CV-section"] [data-automation-id="file-upload-item-name"]');
      expect(names).toHaveLength(1);
      names[0]!.textContent = name;
    };

    it(`${page.name}: Upload mine again keeps a résumé the page shows under the chosen résumé's own name, flagged prefill-kept`,
      async () => {
        const { row, input, removed } = await fillWith(page, 'upload', undefined, showing(GOLDEN_RESUME.fileName));
        expect(row).toMatchObject({ status: 'flagged', reason: 'prefill-kept', wrote: false, needsUserAction: true });
        expect(input.files?.length ?? 0).toBe(0);
        expect(removed).toBe(0);
      }, 60_000);

    it(`${page.name}: Upload mine again puts the person's résumé beside a file of another name`, async () => {
      const { row, input, removed } = await fillWith(page, 'upload', undefined, showing('Resume.pdf'));
      expect(row).toMatchObject({ wrote: true, provenance: 'profile' });
      expect(input.files?.[0]?.name).toBe(GOLDEN_RESUME.fileName);
      expect(removed).toBe(0);
    }, 60_000);

    it(`${page.name}: Keep it (the default) keeps the page's résumé under the chosen résumé's own name too`, async () => {
      const { row, input } = await fillWith(page, 'keep', undefined, showing(GOLDEN_RESUME.fileName));
      expect(row).toMatchObject({ status: 'flagged', reason: 'prefill-kept', wrote: false });
      expect(input.files?.length ?? 0).toBe(0);
    }, 60_000);
  }

  // Rippling's input is hidden behind its drop zone: a hidden input the page disables or takes away is no field of the
  // scan any more (dom/proxy.ts), so the loop rows it field-disappeared and nothing is written into it.
  for (const [what, withdraw] of [['disables', (input: HTMLInputElement) => { input.disabled = true; }],
    ['takes away', (input: HTMLInputElement) => input.remove()]] as const) {
    it(`Upload mine again: where the page ${what} the résumé's hidden input before the write, nothing is written and nothing pressed`,
      async () => {
        const page = PAGES[2]!;
        const { row, input, removed } = await fillWith(page, 'upload', (doc) => withdraw(doc.querySelector<HTMLInputElement>(page.input)!));
        expect(row).toMatchObject({ reason: 'field-disappeared', wrote: false });
        expect(input.files?.length ?? 0).toBe(0);
        expect(removed).toBe(0);
      }, 60_000);
  }
});
