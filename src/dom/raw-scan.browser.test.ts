import { afterEach, describe, expect, it } from 'vitest';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { rawScan, type RawOrigin } from './raw-scan';

const PAGE = `<!doctype html><head>
  <meta name="description" content="Meta description words">
  <meta property="og:description" content="Open graph words">
  <script type="application/ld+json">{"@type":"JobPosting","description":"Structured posting words"}</script>
  <script>var code = "script words";</script><style>.x::before { content: "style words"; }</style>
</head><body>
  <p>Visible words. <span style="color:#fff">Camouflaged words.</span> More visible words.</p>
  <p style="display:none">Hidden paragraph words.</p>
  <!-- Comment words -->
  <template><p>Template words</p></template>
  <noscript>Noscript words</noscript>
  <img alt="Alt words" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" title="Title words">
  <div aria-label="Aria label words" aria-description="Aria description words" data-note="Data words"></div>
  <input placeholder="Placeholder words" value="Typed value words" aria-placeholder="Aria placeholder words">
  <textarea>Textarea value words</textarea>
  <select><option>Option words</option></select>
  <div id="host"></div>
  <p>Visible words. <span style="color:#fff">Camouflaged words.</span> More visible words.</p>
</body>`;

describe('rawScan', () => {
  afterEach(() => removeFixtures(document));

  it('reads hidden text, comments, templates, structured data, metas and attributes, never a control value', async () => {
    const fixture = await loadFixture(document, PAGE);
    const shadow = fixture.doc.getElementById('host')!.attachShadow({ mode: 'open' });
    const inner = fixture.doc.createElement('p');
    inner.textContent = 'Shadow words';
    shadow.append(inner);
    const { passages, truncated } = await rawScan(fixture.doc);
    expect(truncated).toBe(false);
    const pairs = passages.map((passage) => [passage.origin, passage.text] as [RawOrigin, string]);
    expect(pairs).toEqual(expect.arrayContaining([
      ['meta', 'Meta description words'],
      ['meta', 'Open graph words'],
      ['structured-data', '{"@type":"JobPosting","description":"Structured posting words"}'],
      ['visible', 'Visible words.'],
      ['hidden', 'Camouflaged words.'],
      ['visible', 'More visible words.'],
      ['hidden', 'Hidden paragraph words.'],
      ['comment', 'Comment words'],
      ['hidden', 'Template words'],
      ['hidden', 'Noscript words'],
      ['attribute', 'Alt words'],
      ['attribute', 'Title words'],
      ['attribute', 'Aria label words'],
      ['attribute', 'Aria description words'],
      ['attribute', 'Data words'],
      ['attribute', 'Placeholder words'],
      ['attribute', 'Aria placeholder words'],
      ['option', 'Option words'],
      ['visible', 'Shadow words'],
    ]));
    const all = passages.map((passage) => passage.text).join('\n');
    for (const never of ['Typed value words', 'Textarea value words', 'var code', 'style words']) {
      expect(all).not.toContain(never);
    }
  });

  it('keeps each passage once', async () => {
    const fixture = await loadFixture(document, PAGE);
    const { passages } = await rawScan(fixture.doc);
    expect(passages.filter((passage) => passage.text === 'Camouflaged words.')).toHaveLength(1);
  });

  it('stops at its node budget, and when its signal aborts', async () => {
    const fixture = await loadFixture(document, PAGE);
    const capped = await rawScan(fixture.doc, { maxNodes: 5 });
    expect(capped.truncated).toBe(true);
    expect(capped.nodes).toBe(5);
    const controller = new AbortController();
    controller.abort();
    expect((await rawScan(fixture.doc, { signal: controller.signal })).truncated).toBe(true);
  });

  it('yields between slices and still reads everything', async () => {
    const fixture = await loadFixture(document, PAGE);
    const sliced = await rawScan(fixture.doc, { sliceMs: 0 });
    const whole = await rawScan(fixture.doc);
    expect(sliced.passages).toEqual(whole.passages);
  });

  it('scans a subtree a settle added', async () => {
    const fixture = await loadFixture(document, PAGE);
    const added = fixture.doc.createElement('div');
    const paragraph = fixture.doc.createElement('p');
    paragraph.style.opacity = '0';
    paragraph.textContent = 'Added later words';
    added.append(paragraph);
    fixture.doc.body.append(added);
    const { passages } = await rawScan(added);
    expect(passages).toEqual([{ origin: 'hidden', text: 'Added later words' }]);
  });
});
