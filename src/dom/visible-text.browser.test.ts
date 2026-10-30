import { afterEach, describe, expect, it } from 'vitest';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { readSelectOptions, readVisibleText, visiblePlaceholder, visibleText, visibleTextWithout } from './visible-text';

describe('visibleText', () => {
  afterEach(() => removeFixtures(document));

  it('reads only what a person can see, with blocks on their own lines', async () => {
    const fixture = await loadFixture(document, `<!doctype html><head><title>Title text</title>
      <style>.gone{display:none}</style><script>var inScript = 1;</script></head><body>
      <h1>Heading</h1><p>First <b>bold</b> paragraph.</p>
      <p>Second<!-- a comment --> paragraph<span class="gone"> hidden span</span>.</p>
      <p style="color:#fff">White on white</p>
      <noscript>No script</noscript><template><p>Template</p></template>
      <label>Name <input value="typed value"></label>
      <select><option>Option text</option></select><textarea>Area text</textarea>
      <div contenteditable="true">Editable</div>
      <svg><text>Drawing</text></svg>
      <p>Last line</p></body>`);
    expect(visibleText(fixture.doc)).toBe('Heading\nFirst bold paragraph.\nSecond paragraph.\nName\nLast line');
  });

  it('caps the text and reports the cut', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><p>${'word '.repeat(50)}</p></body>`);
    const result = readVisibleText(fixture.doc, { cap: 20 });
    expect(result.text).toBe('word word word word ');
    expect(result.truncated).toBe(true);
  });

  it('counts the text it drops, and joins a label onto one line when asked', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body>
      <label id="label"><span>Email</span><div>address</div><span style="color:#fff">secret</span><span hidden>skipped</span></label></body>`);
    const result = readVisibleText(fixture.doc.getElementById('label')!, { singleLine: true });
    expect(result.text).toBe('Email address');
    expect(result.dropped).toBe(1);
    expect(result.segments.map((segment) => segment.text)).toEqual(['Email', 'address']);
  });

  it('leaves out the subtrees it is told to, and nothing else', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body>
      <label id="label"><div>Resume/CV</div><a id="widget" href="#top"><span>ATTACH</span> RESUME/CV</a> <span>(PDF)</span></label></body>`);
    const label = fixture.doc.getElementById('label')!;
    expect(visibleText(label, { singleLine: true })).toBe('Resume/CV ATTACH RESUME/CV (PDF)');
    expect(visibleTextWithout(label, [fixture.doc.getElementById('widget')!], { singleLine: true })).toBe('Resume/CV (PDF)');
    expect(visibleTextWithout(label, [], { singleLine: true })).toBe('Resume/CV ATTACH RESUME/CV (PDF)');
  });

  it('walks open shadow roots and their slots', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><div id="host"><span slot="title">Slotted</span></div></body>`);
    const host = fixture.doc.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = fixture.doc.createElement('p');
    inner.append('Shadow text ');
    inner.append(fixture.doc.createElement('slot'));
    inner.lastElementChild!.setAttribute('name', 'title');
    shadow.append(inner);
    expect(visibleText(fixture.doc)).toBe('Shadow text Slotted');
  });
});

describe('the native <option> reader', () => {
  afterEach(() => removeFixtures(document));

  it('lists only options a person can see, and lists disabled ones without choosing them', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><select id="list">
      <option hidden value="x">Hidden first</option>
      <option value="" selected>Select...</option>
      <option style="display:none">Display none</option>
      <option style="color:#fff;background:#fff">White on white</option>
      <option value="a">  Shown   option </option>
      <option value="b" label="Label attribute">Text content</option>
      <option value="c" disabled>Disabled</option>
      <optgroup label="Group" hidden><option>In a hidden group</option></optgroup>
      <optgroup label="Open group" disabled><option value="d">In a disabled group</option></optgroup>
      <option value="e"></option>
    </select>
    <select id="hidden-select" style="display:none"><option>Unseen</option></select></body>`);
    const read = readSelectOptions(fixture.doc.getElementById('list') as HTMLSelectElement);
    expect(read.map(({ label, value, disabled, selected, group }) => ({ label, value, disabled, selected, group })))
      .toEqual([
        { label: 'Select...', value: '', disabled: false, selected: true, group: undefined },
        { label: 'Shown option', value: 'a', disabled: false, selected: false, group: undefined },
        { label: 'Label attribute', value: 'b', disabled: false, selected: false, group: undefined },
        { label: 'Disabled', value: 'c', disabled: true, selected: false, group: undefined },
        { label: 'In a disabled group', value: 'd', disabled: true, selected: false, group: 'Open group' },
      ]);
    expect(readSelectOptions(fixture.doc.getElementById('hidden-select') as HTMLSelectElement)).toEqual([]);
  });
});

describe('the placeholder reader', () => {
  afterEach(() => removeFixtures(document));

  it("smoke: Chromium reports a placeholder's computed style through getComputedStyle(el, '::placeholder')",
    async () => {
      // The plan's fallback (placeholders never make a control fillable) is needed only if this fails.
      const fixture = await loadFixture(document, `<!doctype html><head><style>
        #styled::placeholder { color: rgb(10, 20, 30); opacity: 0.25; font-size: 2px; }
        #clear::placeholder { color: transparent; }</style></head>
        <body><input id="styled" placeholder="a"><input id="clear" placeholder="b"></body>`);
      const styled = fixture.view.getComputedStyle(fixture.doc.getElementById('styled')!, '::placeholder');
      expect([styled.color, styled.opacity, styled.fontSize]).toEqual(['rgb(10, 20, 30)', '0.25', '2px']);
      const clear = fixture.view.getComputedStyle(fixture.doc.getElementById('clear')!, '::placeholder');
      expect(clear.color).toBe('rgba(0, 0, 0, 0)');
    });

  it('counts a placeholder only when the control is empty and its pseudo-element can be seen', async () => {
    const fixture = await loadFixture(document, `<!doctype html><head><style>
      #transparent::placeholder { color: transparent; }
      #faint::placeholder { opacity: 0.02; }
      #tiny::placeholder { font-size: 3px; }
      #white::placeholder { color: #fefefe; }
      </style></head><body style="background:#fff">
      <input id="shown" placeholder="  City   name ">
      <input id="filled" placeholder="City" value="Austin">
      <input id="transparent" placeholder="Transparent">
      <input id="faint" placeholder="Faint">
      <input id="tiny" placeholder="Tiny">
      <input id="white" placeholder="White">
      <textarea id="area" placeholder="Tell us more"></textarea>
      <select id="select"><option>Not a placeholder</option></select></body>`);
    const read = (id: string) => visiblePlaceholder(fixture.doc.getElementById(id)!);
    expect(read('shown')).toBe('City name');
    expect(read('area')).toBe('Tell us more');
    for (const id of ['filled', 'transparent', 'faint', 'tiny', 'white', 'select']) expect([id, read(id)]).toEqual([id, null]);
  });
});
