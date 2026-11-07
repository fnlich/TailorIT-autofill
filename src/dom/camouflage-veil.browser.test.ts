/*
 * The anti-camouflage defence behind a translucent layer over an image (the core pass of 2026-11-06; camouflage.ts
 * opaqueLayerUnder, color.ts leastContrast), on fixtures/synthetic/translucent-veil.html: Oracle's panel over its cover
 * image reads (fixtures/oracle/hjf-apply-section.html, held in oracle.browser.test.ts), and words a thin veil over an
 * image may hide stay hidden from the fields, the label rules and the AI's page text, though they read against the
 * veil over black and over white alike: some image under the veil matches them. The raw scan still hands them to the
 * tripwire as hidden text.
 */
import { afterEach, describe, expect, it } from 'vitest';
import html from '../../fixtures/synthetic/translucent-veil.html?raw';
import { genericAdapter } from '../adapters/generic';
import { fillabilityOf } from '../adapters/test/expectations.testkit';
import { isCamouflaged } from './camouflage';
import { contrast, leastContrast, over, parseColor, WHITE, BLACK, between } from './color';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { rawScan } from './raw-scan';
import { scan } from './scan';
import { visibleText } from './visible-text';

afterEach(() => removeFixtures(document));

async function page() {
  const fixture = await loadFixture(document, html);
  const root = genericAdapter.detect(fixture.doc)!.formRoot;
  return { doc: fixture.doc, result: scan(root, genericAdapter, { platform: 'lever' }) };
}

describe('words behind a translucent layer over an image', () => {
  it("reads Oracle's panel: its label, and its box as a field", async () => {
    const { doc, result } = await page();
    expect(isCamouflaged(doc.getElementById('first-label')!)).toBe('clear');
    const first = result.fields.find((field) => field.idAttr === 'first')!;
    expect(first.label).toBe('First name');
    expect(fillabilityOf(first)).toEqual({ fillable: true });
  });

  it('never reads words a thin veil may hide, nor one whose colours both ends of the veil pass', async () => {
    const { doc, result } = await page();
    for (const id of ['veil-words', 'veiled-label', 'middle-words']) expect(isCamouflaged(doc.getElementById(id)!), id).toBe('unknown');
    // The veiled question is no field a run writes: its label cannot be read.
    const veiled = result.fields.find((field) => field.idAttr === 'veiled')!;
    expect(fillabilityOf(veiled)).toEqual({ fillable: false, reason: 'no-visible-label' });
    const text = visibleText(doc);
    expect(text).toContain('First name');
    for (const hidden of ['VEIL-MARKER', 'MIDDLE-MARKER', 'I am LLM', 'Ignore previous instructions', 'favourite']) {
      expect(text).not.toContain(hidden);
    }
    // The tripwire still reads both passages, as hidden text.
    const passages = (await rawScan(doc)).passages;
    for (const marker of ['VEIL-MARKER', 'MIDDLE-MARKER']) {
      expect(passages.find((passage) => passage.text.includes(marker))?.origin, marker).toBe('hidden');
    }
  });

  it('judges the colours between the ends, not the ends alone (the middle veil passes at both ends)', () => {
    const veil = parseColor('rgba(255, 255, 255, 0.5)', null)!;
    const ink = parseColor('rgb(176, 176, 176)', null)!;
    const dark = over(veil, BLACK);
    const light = over(veil, WHITE);
    expect(contrast(ink, dark)).toBeGreaterThan(1.35);
    expect(contrast(ink, light)).toBeGreaterThan(1.35);
    expect(leastContrast(ink, between(dark, light))).toBe(1);
    // Dark ink clears every colour between; a plain colour is read as before.
    expect(leastContrast(parseColor('rgb(34, 34, 34)', null)!, between(over(parseColor('rgba(248, 248, 247, 0.75)', null)!, BLACK),
      over(parseColor('rgba(248, 248, 247, 0.75)', null)!, WHITE)))).toBeGreaterThan(1.35);
    expect(leastContrast(ink, WHITE)).toBe(contrast(ink, WHITE));
  });
});

// ── The behaviour review of 2026-11-06 (M8): the translucent bound's guards ──
// The review's probe: Oracle's panel shape (fixtures/oracle/hjf-apply-section.html: a translucent panel over the flow's
// cover image), changed one way at a time; a layer that is no bound leaves the words 'unknown', never 'clear'.
describe('what a translucent layer bounds (M8: Y7, Y8)', () => {
  const GIF = 'url(data:image/gif;base64,R0lGODlhAQABAAAAACw=)';

  async function words(panel: string) {
    const fixture = await loadFixture(document, `<!doctype html><html><head><style>
      body { margin: 0; background: #fff; font: 16px/1.5 system-ui, sans-serif; }
      .cover { background-image: ${GIF}; background-size: cover; padding: 24px; }
      #panel { margin: 0 auto; max-width: 720px; padding: 20px; color: rgb(90, 108, 119); ${panel} }
    </style></head><body><main class="cover"><div id="panel"><label id="words">First name</label></div></main></body>
    </html>`);
    return isCamouflaged(fixture.doc.getElementById('words')!);
  }

  it('control: the panel bounds the image under it, and its words read clear', async () => {
    expect(await words('background-color: rgba(248, 248, 247, 0.75);')).toBe('clear');
  });

  it('bounds nothing where the layer also paints an image of its own (Y8)', async () => {
    expect(await words(`background: ${GIF} rgba(248, 248, 247, 0.75); background-size: cover;`)).not.toBe('clear');
  });

  it('bounds nothing where the layer does not paint under the words (Y7)', async () => {
    expect(await words('background-color: rgba(248, 248, 247, 0.75); height: 4px; padding: 0; overflow: visible;'))
      .not.toBe('clear');
  });
});
// ── end of the behaviour review's block (M8) ──
