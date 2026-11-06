/*
 * The content runtime on a company's own page (v3 Phase 8), where the worker injected it once the sentinel recognised
 * the page: the site adapter claims a form by the application-form score alone, nothing is said to the worker until it
 * does (but a job page's form-less hello, the review's B10), an embedded ATS form is left to its own frame's script, a
 * sign-in is never claimed, a form drawn however late is claimed (B5), and the worker's site/stop ends it (P1/B8).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const AT = 'https://careers.acme-fixture.example/positions/1/apply';
const FORM = `<form><label for="fn">First name</label><input id="fn" name="first_name" autocomplete="given-name">
  <label for="ln">Last name</label><input id="ln" name="last_name" autocomplete="family-name">
  <label for="em">Email</label><input id="em" type="email" name="email">
  <label for="ph">Phone</label><input id="ph" type="tel" name="phone">
  <button type="submit">Submit application</button></form>`;
const APPLICATION = `<!doctype html><html><head><title>Platform Engineer | Acme Careers</title></head><body>
  <h1>Careers: Platform Engineer</h1>${FORM}</body></html>`;
const POSTING = '<script type="application/ld+json">{"@type":"JobPosting","title":"Platform Engineer"}</script>';

beforeAll(() => {
  testVocab();
});

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

async function startOn(html: string, options: Parameters<typeof createFakeWorker>[0] = {}) {
  const fixture = await loadFixture(document, html);
  const fake = createFakeWorker(options);
  const runtime = await startContentRuntime(fake.platform, fixture.doc, { href: () => AT, isTop: true, settle: { quietMs: 60 } });
  runtimes.push(runtime);
  return { fake, runtime, ...fixture };
}

const hellos = (fake: ReturnType<typeof createFakeWorker>) => fake.messages.filter((message) => message.type === 'frame/hello');
/** Two of the fixture frame's own frames. */
const frames = (view: Window) => new Promise<void>((resolve) => view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve())));

describe("the content runtime on a company's own page", () => {
  it('claims an application form by the score, as the site, and says hello with it', async () => {
    const { fake, runtime } = await startOn(APPLICATION);
    expect(runtime.page?.adapter.id).toBe('site');
    expect(runtime.page?.app).toMatchObject({ platform: 'site', page: 'application',
      applicationUrl: 'https://careers.acme-fixture.example/positions/1/apply' });
    expect(hellos(fake)).toEqual([expect.objectContaining({ hasForm: true, isTop: true })]);
  });

  it("says nothing on a page whose form the score does not claim: a sign-in, a newsletter, an embedded ATS form's page", async () => {
    for (const html of [
      // A sign-in on a careers site (a password beside an email alone: B9).
      '<!doctype html><title>Acme Careers</title><form><label for="e">Email</label><input id="e" type="email"><label for="pw">Password</label>'
        + '<input id="pw" type="password"><button>Sign in</button></form>',
      '<!doctype html><form><label for="e">Email for job alerts</label><input id="e" type="email"><button>Subscribe</button></form>',
      '<!doctype html><h1>Careers</h1><iframe src="https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1"></iframe>',
    ]) {
      const { fake, runtime } = await startOn(html);
      expect(runtime.page, html).toBeNull();
      expect(runtime.ui, html).toBeNull();
      expect(fake.messages.map((message) => message.type), html).not.toContain('frame/hello');
      runtime.stop();
      removeFixtures(document);
    }
  });

  it('says a form-less hello on a job page a job signal shows, so the side panel says it has no form (B10)', async () => {
    const posting = await startOn(`<!doctype html><title>Platform Engineer</title>${POSTING}<h1>Platform Engineer</h1><p>About the role</p>`);
    expect(posting.runtime.page).toBeNull();
    expect(hellos(posting.fake)).toEqual([expect.objectContaining({ hasForm: false, isTop: true })]);
    posting.runtime.stop();
    removeFixtures(document);
    // Beside an embedded ATS, whose own frame says hello: nothing.
    const embed = await startOn(`<!doctype html>${POSTING}<div id="grnhse_app"></div>${FORM}`);
    expect(embed.runtime.page).toBeNull();
    expect(hellos(embed.fake)).toEqual([]);
  });

  it("claims a form the page draws long after it loaded: the watch lasts the document's life (B5)", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'], shouldAdvanceTime: true });
    const { fake, runtime, doc, view } = await startOn('<!doctype html><title>Acme Careers</title><h1>Acme Careers</h1><main></main>');
    expect(runtime.page).toBeNull();
    // Past the 30 seconds the first build watched for.
    await vi.advanceTimersByTimeAsync(31_000);
    const main = doc.querySelector('main')!;
    main.append(...Array.from(new DOMParser().parseFromString(FORM, 'text/html').body.childNodes).map((node) => doc.adoptNode(node)));
    await vi.advanceTimersByTimeAsync(10);
    await frames(view);
    await vi.waitFor(() => expect(runtime.page?.adapter.id).toBe('site'));
    expect(hellos(fake).at(-1)).toMatchObject({ hasForm: true });
  });

  it("ends its run and removes its UI on the worker's site/stop, and only on the worker's (P1/B8)", async () => {
    const { fake, runtime } = await startOn(APPLICATION);
    expect(runtime.ui).not.toBeNull();
    // From a page of the extension's: refused.
    expect(await fake.platform.deliverFrom({ v: 1, type: 'site/stop' },
      { id: fake.platform.runtime.id, url: `chrome-extension://${fake.platform.runtime.id}/sidepanel.html` }))
      .toMatchObject({ ok: false, error: 'bad_sender' });
    expect(runtime.stopped).toBe(false);
    expect(await fake.platform.deliver({ v: 1, type: 'site/stop' })).toEqual({ ok: true, data: {} });
    expect(runtime.stopped).toBe(true);
    expect(runtime.ui).toBeNull();
  });

  it("ends a page the cache brings back once the worker no longer knows it, and nothing else (round 2, M3)", async () => {
    // The career sites stopped while the page was in the back/forward cache: the worker refuses its hello.
    const hellos: unknown[] = [];
    const refused = await startOn(APPLICATION, { script: { 'frame/hello': hellos } });
    expect(refused.runtime.ui).not.toBeNull();
    hellos.push({ ok: false, error: 'bad_sender' });
    await refused.runtime.restored();
    expect(refused.runtime.stopped).toBe(true);
    expect(refused.runtime.ui).toBeNull();
    refused.runtime.stop();
    removeFixtures(document);
    // Still known: it carries on.
    const known = await startOn(APPLICATION);
    await known.runtime.restored();
    expect(known.runtime.stopped).toBe(false);
    expect(known.runtime.ui).not.toBeNull();
    expect(hellos.length).toBe(0);
  });
});
