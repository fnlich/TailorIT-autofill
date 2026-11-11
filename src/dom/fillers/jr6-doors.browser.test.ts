/*
 * jr6 ENGINE E2 (FIXPLAN §6.2 item 9, JZ-4): the upload filler's reveal door. JazzHR's classic layout keeps its resume
 * input (#resumator-resume-value) in a display:none wrapper until "Attach resume" (#resumator-choose-upload, a link to
 * the posting itself) is pressed (the jr6 JazzHR audit's JZ-4, snapshot6 applytojob, the case jr6-centroid-form). The
 * configured upload rule declares that link its reveal (UploadRule.reveal); the upload filler (fillers/upload.ts
 * revealUpload) presses it through its own door (not-submit.ts clickUploadReveal) at most once per document, only while
 * the input is hidden and the link shows inside the rule's area, then settles at least 300 ms (Jobright's JazzHR
 * uploadResume), finds the input again and writes only once a person can see it; otherwise the row is the person's.
 * The page never navigates: with the page's own handler (which cancels the link, as JazzHR's does, or leaves it) and
 * without one. The link stays never-pressed for every other path. The page is synthetic, shaped as the audit
 * describes jr6-centroid-form; the adapter is the configured layer over JazzHR's own config with the upload rule the
 * JAZZHR package declares (FIXPLAN §6.8, JZ-4 (a) and (b)); the file is a fake PDF named as the golden resume.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { configuredAdapter } from '../../adapters/configured';
import type { AtsConfig, UploadRule } from '../../adapters/configured/types';
import { JAZZHR_CONFIG } from '../../adapters/jazzhr/config';
import type { Adapter } from '../../adapters/types';
import type { FillResult, PlannedWrite } from '../../core/types/fill';
import { createFakeWorker, fakePdf, GOLDEN_RESUME } from '../../content/content.testkit';
import { writeField, type PassEnv } from '../../content/pass';
import { loadFixture, removeFixtures } from '../fixture.testkit';
import { scan } from '../scan';
import { deadline } from '../time';
import { assertNotSubmit, clickIfAllowed } from './not-submit';
import { revealUpload } from './upload';

afterEach(() => removeFixtures(document));

/** jr6-centroid-form's résumé question, as the audit describes it: the options ("Attach resume" or "Paste resume"),
 *  links to the posting's own address (here about:blank with a fragment: a navigation the test can see, which loads
 *  nothing; a fragment alone would resolve against the test runner's own address in a srcdoc frame), the upload
 *  wrapper with its file input and the paste wrapper, both display:none (class "none") until one is chosen. */
const CENTROID = `<!doctype html><html><head><style>
  body { font: 14px sans-serif; margin: 16px; } .none { display: none; } input, textarea { display: block; width: 300px; }
</style></head><body>
  <form id="form_submit_new_resume" method="post" action="about:blank#sent">
    <div class="resumator-field-wrapper"><label for="resumator-firstname-value">First Name</label>
      <input id="resumator-firstname-value" name="resumator-firstname-value"></div>
    <div class="resumator-field-wrapper resumator-resume-text" id="resumator-resume">
      <label class="resumator-label" for="resumator-resume-value" id="resumator-resume-label">Resume</label>
      <div id="resumator-resume-options"><p><a id="resumator-choose-upload" class="resumator-resume-action"
        href="about:blank#upload">Attach resume</a> or <a id="resumator-choose-paste" class="resumator-resume-action"
        href="about:blank#paste">Paste resume</a></p></div>
      <div id="resumator-resume-upload-wrapper" class="none"><div class="resumator-input" id="resumator-resume-field">
        <input type="file" id="resumator-resume-value" name="resumator-resume-value"></div></div>
      <div id="resumator-resume-paste-wrapper" class="none"><textarea id="resumator-resumetext-value"></textarea></div>
    </div>
    <div id="resumator-submit"><a id="resumator-submit-resume" href="about:blank#sent">Submit Application</a></div>
  </form></body></html>`;

/** The upload rule JAZZHR declares (JZ-4 (a)), with its reveal (JZ-4 (b)); `reveal` overrides the reveal's selector
 *  (null: none declared). */
function jazzhr(reveal: string | null = '#resumator-choose-upload'): Adapter {
  const upload: UploadRule = { input: '#resumator-resume-value', control: '#resumator-choose-upload, #resumator-resume-field',
    area: '#resumator-resume', ...(reveal === null ? {} : { reveal }), from: 'jr6 JZ-4, synthetic' };
  const config: AtsConfig = { ...JAZZHR_CONFIG, uploads: [upload] };
  return configuredAdapter(config);
}

/** JazzHR's own toggle: "Attach resume" shows the upload wrapper and hides the options; `cancels`, as JazzHR's script
 *  does, cancels the link's default. */
function pageToggle(doc: Document, cancels: boolean): void {
  doc.getElementById('resumator-choose-upload')!.addEventListener('click', (event) => {
    if (cancels) event.preventDefault();
    doc.getElementById('resumator-resume-upload-wrapper')!.classList.remove('none');
    doc.getElementById('resumator-resume-options')!.classList.add('none');
  });
}

async function centroid(change?: (doc: Document) => void) {
  const fixture = await loadFixture(document, CENTROID, { width: 1280, height: 900 });
  const doc = fixture.doc;
  change?.(doc);
  const link = doc.getElementById('resumator-choose-upload')!;
  const input = () => doc.getElementById('resumator-resume-value') as HTMLInputElement;
  let presses = 0;
  link.addEventListener('click', () => {
    presses += 1;
  }, { capture: true });
  let clicks = 0;
  doc.addEventListener('click', () => {
    clicks += 1;
  }, { capture: true });
  let hashChanges = 0;
  fixture.view.addEventListener('hashchange', () => {
    hashChanges += 1;
  });
  let loads = 0;
  fixture.frame.addEventListener('load', () => {
    loads += 1;
  });
  const address = fixture.view.location.href;
  return { fixture, doc, link, input,
    presses: () => presses,
    /** Every click the page received, on any element. */
    clicks: () => clicks,
    /** Whether the page navigated: its frame loaded again, its address changed, or a hashchange came. */
    navigated: async () => {
      await deadline(150);
      return loads > 0 || fixture.view.location.href !== address || hashChanges > 0;
    },
    // The settle as the filler times it (UPLOAD_REVEAL_SETTLE_MS); the cap shorter, for the cases that reach it.
    reveal: (adapter: Adapter, signal?: AbortSignal) => revealUpload(adapter, input(), input, signal, { capMs: 1_200 }) };
}

describe('jr6 E2 item 9 (JZ-4): the upload filler presses a declared reveal once, and the page never navigates', () => {
  it('control: the link pressed with no guard navigates this page (so the tests below would see it)', async () => {
    const page = await centroid();
    page.link.click();
    expect(await page.navigated()).toBe(true);
  });

  it('with the page’s handler cancelling the link: pressed once, the input shows, no navigation', async () => {
    const page = await centroid((doc) => pageToggle(doc, true));
    const started = performance.now();
    const result = await page.reveal(jazzhr());
    expect(performance.now() - started).toBeGreaterThanOrEqual(290);
    expect(result).toEqual({ outcome: 'revealed', input: page.input() });
    expect(page.presses()).toBe(1);
    expect(await page.navigated()).toBe(false);
  });

  it('with the page’s handler leaving the link’s default: the door cancels it, the input shows', async () => {
    const page = await centroid((doc) => pageToggle(doc, false));
    expect((await page.reveal(jazzhr())).outcome).toBe('revealed');
    expect(page.presses()).toBe(1);
    expect(await page.navigated()).toBe(false);
  });

  it('with no page handler: pressed once, no navigation, the input stays hidden and the row is the person’s',
    async () => {
      const page = await centroid();
      expect(await page.reveal(jazzhr())).toEqual({ outcome: 'refused', input: null });
      expect(page.presses()).toBe(1);
      expect(await page.navigated()).toBe(false);
      // Never a second press in this document, though the input is still hidden.
      expect((await page.reveal(jazzhr())).outcome).toBe('refused');
      expect(page.presses()).toBe(1);
      expect(await page.navigated()).toBe(false);
    });

  it('presses nothing for an input a person sees already, or one whose adapter declares no reveal', async () => {
    const shown = await centroid((doc) => doc.getElementById('resumator-resume-upload-wrapper')!.classList.remove('none'));
    expect(await shown.reveal(jazzhr())).toEqual({ outcome: 'shown', input: shown.input() });
    expect(shown.presses()).toBe(0);
    removeFixtures(document);
    const none = await centroid((doc) => pageToggle(doc, true));
    expect((await none.reveal(jazzhr(null))).outcome).toBe('none');
    expect(none.presses()).toBe(0);
  });

  it('presses no link that is hidden, outside the area, a submit control, or near another never-pressed control',
    async () => {
      const cases: Array<[string, (doc: Document) => void, string | undefined]> = [
        ['hidden', (doc) => doc.getElementById('resumator-resume-options')!.classList.add('none'), undefined],
        ['outside the area', (doc) => doc.getElementById('form_submit_new_resume')!
          .prepend(doc.getElementById('resumator-choose-upload')!), undefined],
        ['submit words', (doc) => { doc.getElementById('resumator-choose-upload')!.textContent = 'Submit resume'; },
          undefined],
        ['inside a submit button', (doc) => {
          const link = doc.getElementById('resumator-choose-upload')!;
          const button = doc.createElement('button');
          button.type = 'submit';
          link.replaceWith(button);
          button.append(link);
        }, undefined],
        ['the application’s Submit', () => undefined, '#resumator-submit-resume'],
        ['holding another never-pressed control', () => undefined, '#resumator-resume-options'],
        ['inside another never-pressed control', (doc) => {
          const paste = doc.getElementById('resumator-choose-paste')!;
          const inner = doc.createElement('span');
          inner.id = 'inner';
          inner.textContent = 'Attach';
          paste.append(inner);
          doc.getElementById('resumator-resume')!.append(paste);
        }, '#inner'],
      ];
      for (const [name, change, reveal] of cases) {
        const page = await centroid((doc) => {
          pageToggle(doc, true);
          change(doc);
        });
        expect((await page.reveal(jazzhr(reveal ?? '#resumator-choose-upload'))).outcome, name).toBe('refused');
        expect(page.clicks(), name).toBe(0);
        expect(await page.navigated(), name).toBe(false);
        removeFixtures(document);
      }
    });

  it('leaves the link never-pressed for every other path', async () => {
    const page = await centroid((doc) => pageToggle(doc, true));
    const adapter = jazzhr();
    const root = page.doc.getElementById('form_submit_new_resume')!;
    expect(assertNotSubmit(page.link, { adapter, root })).toEqual({ ok: false, refusal: 'adapter-never-press' });
    expect(clickIfAllowed(page.link, { adapter, root })).toBe(false);
    expect(page.presses()).toBe(0);
  });
});

describe('jr6 E2 item 9 (JZ-4): the pass writes the résumé once the reveal showed its input', () => {
  /** The pass's write of the résumé into the scan's Resume field, the file served by the fake worker. */
  async function writeResume(change: (doc: Document) => void) {
    const page = await centroid(change);
    const adapter = jazzhr();
    const root = page.doc.getElementById('form_submit_new_resume')!;
    const last = scan(root, adapter, { platform: 'jazzhr', frameId: 0 });
    const field = last.fields.find((each) => each.kind === 'file')!;
    const worker = createFakeWorker({ resume: { bytes: fakePdf(1200), name: GOLDEN_RESUME.fileName,
      mime: 'application/pdf' } });
    const env = { adapter, root, platform: 'jazzhr', frameId: 0, dryRun: false, canaries: [], content: worker.platform,
      signal: new AbortController().signal, valid: () => true, stopped: () => false, runId: () => 'run',
      heldBy: () => null } as unknown as PassEnv;
    const write = { key: field.key, value: { kind: 'file', ref: 'resume' },
      origin: { provenance: 'profile', path: 'resume' },
      match: { stage: 'not-applicable', optionIndex: null, rule: null, confidence: 1, flags: [], suggestions: [],
        reason: 'ok' } } as unknown as PlannedWrite;
    const planned = { key: field.key, label: 'Resume', kind: 'file', category: 'file.resume', section: field.section.id,
      required: true, status: 'filled', provenance: 'profile', matcherStage: 'not-applicable', confidence: 1,
      reason: 'ok', wrote: false, verification: 'not-checked', needsUserAction: false } as FillResult;
    const result = await writeField(env, last, field, write, planned, new WeakMap());
    result.written?.resume?.release();
    return { page, field, result };
  }

  it('scans the hidden input as the Resume field, through its declared control', async () => {
    const page = await centroid();
    const result = scan(page.doc.getElementById('form_submit_new_resume')!, jazzhr(), { platform: 'jazzhr' });
    expect(result.fields.find((each) => each.kind === 'file')).toMatchObject({ label: 'Resume',
      visibility: 'hidden-file-with-visible-control' });
  });

  it('with the page’s handler: the reveal pressed once, the file written and read back, no navigation', async () => {
    const { page, result } = await writeResume((doc) => pageToggle(doc, true));
    expect(result.row).toMatchObject({ wrote: true, verification: 'verified' });
    expect(page.input().files?.[0]?.name).toBe(GOLDEN_RESUME.fileName);
    expect(page.presses()).toBe(1);
    expect(await page.navigated()).toBe(false);
  });

  it('with no page handler: nothing written, the row the person’s (needs-your-click), no navigation', async () => {
    const { page, result } = await writeResume(() => undefined);
    expect(result.row).toMatchObject({ wrote: false, reason: 'needs-your-click' });
    expect(page.input().files?.length ?? 0).toBe(0);
    expect(page.presses()).toBe(1);
    expect(await page.navigated()).toBe(false);
  });
});
