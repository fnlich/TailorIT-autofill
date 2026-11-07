/*
 * The resume on Greenhouse's form, as the owner's captures of 2026-11-06 show its upload (fixtures/greenhouse/
 * axle-attached.html; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): once a file is in the resume's input, Greenhouse takes the input out of the
 * page and shows the file's name beside "Remove file" in its group. fixtures/synthetic/greenhouse-widgets draws the same,
 * and the content runtime fills it with the fake worker planning each pass over the golden profile and its resume. The
 * core pass of 2026-11-06: the upload the page shows done, whose input left the page, is verified (content/verify.ts)
 * and keeps that row through the loop's later scans (core/loop bookkeeping, ScanInput.uploaded), never
 * field-disappeared; "Remove file" is never pressed.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import pageHtml from '../../fixtures/synthetic/greenhouse-widgets/index.html?raw';
import { mountGreenhouseForm, mountHeaderButton, newLog } from '../../fixtures/synthetic/greenhouse-widgets/app';
import type { FillResult } from '../core/types/fill';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { installBridge } from '../page/bridge';
import { createFakeWorker, fakePdf, GOLDEN_RESUME, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const runtimes: ContentRuntime[] = [];
const removals: Array<() => void> = [];
beforeAll(() => {
  testVocab();
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  for (const remove of removals.splice(0)) remove();
  removeFixtures(document);
});

describe("the resume on Greenhouse's form", () => {
  it('is verified once the page shows it attached, though its input left the page; "Remove file" is never pressed',
    async () => {
      const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280, height: 2600 });
      const log = newLog();
      mountHeaderButton(fixture.doc.getElementById('autofill-host')!, log);
      removals.push(mountGreenhouseForm(fixture.doc.getElementById('gh-root')!, { styles: fixture.doc.head, log,
        degreeMs: 100, schoolPageMs: 100, searchMs: 100 }).unmount);
      removals.push(installBridge(fixture.doc));
      const worker = createFakeWorker({ settings: DEFAULT_SETTINGS,
        resume: { bytes: fakePdf(48_213), name: GOLDEN_RESUME.fileName, mime: 'application/pdf' } });
      const runtime = await startContentRuntime(worker.platform, fixture.doc, {
        href: () => 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9100', isTop: true, settle: { quietMs: 200 } });
      runtimes.push(runtime);
      expect(await runtime.fill({})).not.toBeNull();
      const report = worker.reports.at(-1)!;
      const row = report.fields.find((candidate) => candidate.label === 'Resume/CV') as FillResult;
      expect(row).toMatchObject({ category: 'file.resume', status: 'verified', wrote: true, verification: 'verified',
        reason: 'ok', needsUserAction: false });
      // The page took the input out, and shows the file in its place.
      expect(fixture.doc.getElementById('resume')).toBeNull();
      expect(fixture.doc.querySelector('.file-upload__filename button[aria-label="Remove file"]')).not.toBeNull();
      expect(log.pressed).toEqual([]);
    }, 60_000);
});
