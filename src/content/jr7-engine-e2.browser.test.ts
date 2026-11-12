/*
 * jr7 ENGINE-7 E2 (FIX7PLAN §6.2), the content half: how a run drives the doors and the step, through the content
 * runtime with a fake worker, on synthetic pages shaped as the jr7 audits describe each platform. Every value synthetic.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { greenhouseAdapter } from '../adapters/greenhouse';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

const HREF = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4403';

async function start(page: string, adapter: Adapter) {
  testVocab();
  const fixture = await loadFixture(document, page, { width: 1100, height: 1200 });
  const worker = createFakeWorker();
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
    adapters: () => [adapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  return { fixture, worker, runtime };
}

// ── item 5 (UKGR-9): the run opens the declared single-entry editor and fills what it draws ─────────────────────────
describe('item 5 (UKGR-9): a step whose editor opens on its Edit', () => {
  /** UKG Ready's Contact summary (snapshot7 secure7.saashr): "Missing Information" and its Edit, which draws the
   *  editor holding Last Name. */
  const PAGE = `<!doctype html><html><head><title>Apply</title></head><body><main><form id="application-form">
    <div><label for="first_name">First Name</label><input id="first_name" type="text"></div>
    <section id="contact"><h3>Contact</h3><p id="summary">Missing Information</p>
      <button type="button" id="edit">Edit</button>
      <div id="editor" hidden><label for="last_name">Last Name</label><input id="last_name" type="text"></div></section>
    <button id="submit" type="submit">Submit application</button></form></main>
    <script>
      window.edits = 0;
      document.getElementById('edit').addEventListener('click', () => {
        window.edits += 1;
        document.getElementById('editor').hidden = false;
      });
    </script></body></html>`;
  const contact = (declared: boolean): Adapter => ({ ...greenhouseAdapter,
    detect: (doc) => {
      const formRoot = doc.getElementById('application-form');
      return formRoot === null ? null : { formRoot };
    },
    submitButton: (root) => root.ownerDocument.getElementById('submit'),
    isFinalStep: () => 'final',
    neverPress: (root) => [root.ownerDocument.getElementById('edit')!],
    ...(declared ? { editorOpener: (root: Element) => {
      const edit = root.ownerDocument.getElementById('edit');
      return edit !== null && root.ownerDocument.getElementById('editor')!.hidden ? [edit] : [];
    } } : {}) });
  const lastName = (fixture: Fixture) => (fixture.doc.getElementById('last_name') as HTMLInputElement).value;
  const edits = (fixture: Fixture) => (fixture.view as unknown as { edits: number }).edits;

  it('opens it once and fills its fields; with no opener declared the editor stays shut', async () => {
    const opened = await start(PAGE, contact(true));
    expect(await opened.runtime.fill()).toBe('review');
    expect(edits(opened.fixture)).toBe(1);
    expect(lastName(opened.fixture)).not.toBe('');
    removeFixtures(document);
    const shut = await start(PAGE, contact(false));
    expect(await shut.runtime.fill()).toBe('review');
    expect([edits(shut.fixture), lastName(shut.fixture)]).toEqual([0, '']);
  });
});
