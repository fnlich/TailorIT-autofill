import { afterEach, describe, expect, it } from 'vitest';
import { guardWriteInFrame } from '../../core/guard/write';
import type { PlannedWrite } from '../../core/types/fill';
import type { ProfilePath, WriteValue } from '../../core/types/intent';
import {
  loadFixture, logEvents, removeFixtures, untrustedViolations, type Fixture, type LoggedEvent,
} from '../fixture.testkit';
import { domGuardBeforeWrite } from '../guard';
import { scan, toFieldSpec } from '../scan';
import type { FieldTarget } from '../types';
import { ALLOWED_EVENTS, DOCX_MIME, fill, sameText, verifyAfterSettle } from './index';

const OPTIONS = { platform: 'lever' as const };

/** The live target of the field whose control (or group's name) is `id`. */
function targetOf(fixture: Fixture, id: string): FieldTarget {
  const root = fixture.doc.querySelector('form')!;
  const result = scan(root, null, OPTIONS);
  const field = result.fields.find((candidate) => candidate.idAttr === id || candidate.nameAttr === id);
  if (field === undefined) throw new Error(`no field ${id}`);
  return result.target(field.key)!;
}

function fillIn(fixture: Fixture, id: string, value: WriteValue, extra: { file?: File } = {}) {
  return fill(targetOf(fixture, id), value, { adapter: null, root: fixture.doc.querySelector('form'), ...extra });
}

/** Only the plan's events, and none trusted but the browser's own input and change after an untrusted click. */
function expectOnlyAllowedUntrustedEvents(events: readonly LoggedEvent[]): void {
  expect(untrustedViolations(events)).toEqual([]);
  expect(events.filter((event) => event.type === 'click').every((event) => !event.trusted)).toBe(true);
  expect(events.every((event) => (ALLOWED_EVENTS as readonly string[]).includes(event.type))).toBe(true);
}

describe('the text filler', () => {
  afterEach(() => removeFixtures(document));

  it('sets the value through the prototype setter and sends input, change, focusout and blur, all untrusted', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><form><label for="n">Name</label><input id="n"></form></body>');
    const log = logEvents(fixture.doc);
    expect(fillIn(fixture, 'n', { kind: 'text', text: 'Alex Rivera' }))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect((fixture.doc.getElementById('n') as HTMLInputElement).value).toBe('Alex Rivera');
    expect(log.on('n').map((event) => event.type)).toEqual(['input', 'change', 'focusout', 'blur']);
    expectOnlyAllowedUntrustedEvents(log.events);
  });

  it('writes nothing when the value is already there, or is longer than maxlength (never cut)', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <label for="a">A</label><input id="a" value="same"><label for="b">B</label><input id="b" maxlength="5"></form></body>`);
    const log = logEvents(fixture.doc);
    expect(fillIn(fixture, 'a', { kind: 'text', text: 'same' })).toMatchObject({ wrote: false, reason: 'already-correct',
      verification: 'verified' });
    expect(fillIn(fixture, 'b', { kind: 'text', text: 'too long' })).toMatchObject({ wrote: false,
      reason: 'maxlength-exceeded', verification: 'not-checked' });
    expect((fixture.doc.getElementById('b') as HTMLInputElement).value).toBe('');
    expect(log.events).toEqual([]);
  });

  it('verifies a value the page reformats equivalently: digits for phones, case-folded for emails', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <label for="p">Phone</label><input id="p" type="tel"><label for="e">Email</label><input id="e" type="email">
      <script>
        document.getElementById('p').addEventListener('input', (e) => { e.target.value = '(512) 555-0147'; });
        document.getElementById('e').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
      </script></form></body>`);
    expect(fillIn(fixture, 'p', { kind: 'text', text: '512.555.0147' })).toMatchObject({ verification: 'verified' });
    expect(fillIn(fixture, 'e', { kind: 'text', text: 'alex.rivera.f7q2@example.com' }))
      .toMatchObject({ verification: 'verified' });
  });

  it('reports a widget that ignored our events as needs-your-click, and a cleared value as rejected', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <label for="r">Reverts</label><input id="r" value="old"><label for="c">Clears</label><input id="c" value="old">
      <script>
        document.getElementById('r').addEventListener('input', (e) => { e.target.value = 'old'; });
        document.getElementById('c').addEventListener('change', (e) => { e.target.value = ''; });
      </script></form></body>`);
    expect(fillIn(fixture, 'r', { kind: 'text', text: 'new' })).toEqual({ wrote: false, verification: 'not-checked',
      reason: 'needs-your-click', needsUserAction: true });
    expect(fillIn(fixture, 'c', { kind: 'text', text: 'new' })).toMatchObject({ wrote: true, verification: 'mismatch',
      reason: 'value-rejected-by-site' });
  });
});

describe('the select fillers', () => {
  afterEach(() => removeFixtures(document));

  const SELECT = `<!doctype html><body><form><label for="s">Degree</label><select id="s">
    <option value="">Select...</option><option value="x">Bachelor's</option><option value="x">Master's</option>
    <option value="y" disabled>Doctorate</option></select>
    <label for="m">Skills</label><select id="m" multiple><option>Go</option><option selected>Rust</option>
    <option>Java</option></select></form></body>`;

  it('selects by place among the visible options, exact even when values repeat', async () => {
    const fixture = await loadFixture(document, SELECT);
    const log = logEvents(fixture.doc);
    expect(fillIn(fixture, 's', { kind: 'option', index: 2, cleanLabel: "Master's" })).toMatchObject({ reason: 'ok',
      verification: 'verified' });
    const select = fixture.doc.getElementById('s') as HTMLSelectElement;
    expect(select.selectedOptions[0]!.textContent).toBe("Master's");
    expect(log.on('s').map((event) => event.type)).toEqual(['input', 'change']);
    expectOnlyAllowedUntrustedEvents(log.events);
    expect(fillIn(fixture, 's', { kind: 'option', index: 2, cleanLabel: "Master's" })).toMatchObject({ wrote: false,
      reason: 'already-correct' });
  });

  it('refuses an option whose label changed or that is disabled', async () => {
    const fixture = await loadFixture(document, SELECT);
    expect(fillIn(fixture, 's', { kind: 'option', index: 1, cleanLabel: 'Associate' })).toMatchObject({ wrote: false,
      reason: 'options-changed' });
    expect(fillIn(fixture, 's', { kind: 'option', index: 3, cleanLabel: 'Doctorate' })).toMatchObject({ wrote: false,
      reason: 'options-changed' });
    expect((fixture.doc.getElementById('s') as HTMLSelectElement).selectedIndex).toBe(0);
  });

  it('adds the missing options of a multiple select, never deselects, with one input and one change', async () => {
    const fixture = await loadFixture(document, SELECT);
    const log = logEvents(fixture.doc);
    expect(fillIn(fixture, 'm', { kind: 'options', indices: [0, 1], cleanLabels: ['Go', 'Rust'] }))
      .toMatchObject({ reason: 'ok', wrote: true });
    const select = fixture.doc.getElementById('m') as HTMLSelectElement;
    expect(Array.from(select.selectedOptions).map((option) => option.text)).toEqual(['Go', 'Rust']);
    expect(log.on('m').map((event) => event.type)).toEqual(['input', 'change']);
    expect(fillIn(fixture, 'm', { kind: 'options', indices: [1], cleanLabels: ['Rust'] }))
      .toMatchObject({ reason: 'already-correct' });
  });

  it('refuses a whole multiple-select write when one planned option now reads otherwise, selecting nothing', async () => {
    const fixture = await loadFixture(document, SELECT);
    const log = logEvents(fixture.doc);
    // Index 0 is still Go, but index 2 is Java, not the planned TypeScript.
    expect(fillIn(fixture, 'm', { kind: 'options', indices: [0, 2], cleanLabels: ['Go', 'TypeScript'] }))
      .toEqual({ wrote: false, verification: 'not-checked', reason: 'options-changed', needsUserAction: false });
    const select = fixture.doc.getElementById('m') as HTMLSelectElement;
    expect(Array.from(select.selectedOptions).map((option) => option.text)).toEqual(['Rust']);
    expect(log.events).toEqual([]);
    // Labels without one per index are a planner bug.
    expect(fillIn(fixture, 'm', { kind: 'options', indices: [0, 2], cleanLabels: ['Go'] }))
      .toMatchObject({ wrote: false, reason: 'internal-error' });
  });
});

describe('the radio and checkbox fillers', () => {
  afterEach(() => removeFixtures(document));

  const CHOICES = `<!doctype html><body><form>
    <fieldset><legend>Relocate?</legend><label><input type="radio" name="r" id="r-yes"> Yes</label>
      <label><input type="radio" name="r" id="r-no"> No</label></fieldset>
    <label><input type="checkbox" id="agree"> I agree to the privacy policy</label>
    <fieldset><legend>Tools</legend><label><input type="checkbox" name="tools" id="go" checked> Go</label>
      <label><input type="checkbox" name="tools" id="rust"> Rust</label>
      <label><input type="checkbox" name="tools" id="java"> Java</label></fieldset></form></body>`;

  it('clicks the planned radio once, untrusted, and leaves a checked one alone', async () => {
    const fixture = await loadFixture(document, CHOICES);
    const log = logEvents(fixture.doc);
    expect(fillIn(fixture, 'r', { kind: 'option', index: 1, cleanLabel: 'No' })).toMatchObject({ reason: 'ok' });
    expect((fixture.doc.getElementById('r-no') as HTMLInputElement).checked).toBe(true);
    // Our click is untrusted; Chromium fires the input and change of the click's activation itself, as trusted.
    expect(log.on('r-no').map((event) => [event.type, event.trusted])).toEqual([['click', false], ['input', true],
      ['change', true]]);
    expectOnlyAllowedUntrustedEvents(log.events);
    expect(fillIn(fixture, 'r', { kind: 'option', index: 1, cleanLabel: 'No' })).toMatchObject({ wrote: false,
      reason: 'already-correct' });
    expect(log.on('r-no')).toHaveLength(3);
  });

  it('ticks a lone checkbox and never unticks one', async () => {
    const fixture = await loadFixture(document, CHOICES);
    expect(fillIn(fixture, 'agree', { kind: 'check' })).toMatchObject({ reason: 'ok', wrote: true });
    expect(fillIn(fixture, 'agree', { kind: 'check' })).toMatchObject({ reason: 'already-correct', wrote: false });
    expect((fixture.doc.getElementById('agree') as HTMLInputElement).checked).toBe(true);
  });

  it('clicks only the planned boxes that are not ticked yet', async () => {
    const fixture = await loadFixture(document, CHOICES);
    const log = logEvents(fixture.doc);
    expect(fillIn(fixture, 'tools', { kind: 'options', indices: [0, 2], cleanLabels: ['Go', 'Java'] }))
      .toMatchObject({ reason: 'ok', wrote: true });
    expect(log.on('go')).toEqual([]);
    expect(log.on('rust')).toEqual([]);
    expect(log.on('java').map((event) => event.type)).toEqual(['click', 'input', 'change']);
    expect((fixture.doc.getElementById('go') as HTMLInputElement).checked).toBe(true);
  });

  it('refuses a whole checkbox-group write when one planned box now shows another label, ticking nothing', async () => {
    const fixture = await loadFixture(document, CHOICES);
    const target = targetOf(fixture, 'tools');
    const log = logEvents(fixture.doc);
    // The page re-labels the boxes after our scan (React reusing its inputs for a re-ordered list): the box at index 2
    // now reads Go.
    const labels = Array.from(fixture.doc.querySelectorAll('fieldset')[1]!.querySelectorAll('label'));
    const texts = labels.map((label) => label.lastChild!.textContent);
    labels.forEach((label, at) => { label.lastChild!.textContent = texts[texts.length - 1 - at]!; });
    expect(fill(target, { kind: 'options', indices: [1, 2], cleanLabels: ['Rust', 'Java'] },
      { adapter: null, root: fixture.doc.querySelector('form') }))
      .toEqual({ wrote: false, verification: 'not-checked', reason: 'options-changed', needsUserAction: false });
    expect(['go', 'rust', 'java'].map((id) => (fixture.doc.getElementById(id) as HTMLInputElement).checked))
      .toEqual([true, false, false]);
    expect(log.events).toEqual([]);
  });

  it('flags a box the page refuses to tick as needs-your-click, and does not retry', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <label><input type="checkbox" id="stubborn"> I agree</label>
      <script>document.getElementById('stubborn').addEventListener('click', (e) => e.preventDefault());</script>
      </form></body>`);
    const log = logEvents(fixture.doc);
    expect(fillIn(fixture, 'stubborn', { kind: 'check' })).toMatchObject({ reason: 'needs-your-click',
      needsUserAction: true, wrote: false });
    expect(log.on('stubborn').filter((event) => event.type === 'click')).toHaveLength(1);
  });

  it('refuses to click a control inside a submit button', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <button><label><input type="checkbox" id="trapped"> Inside a button</label></button></form></body>`);
    const log = logEvents(fixture.doc);
    expect(fillIn(fixture, 'trapped', { kind: 'check' })).toMatchObject({ reason: 'needs-your-click', wrote: false });
    expect(log.events).toEqual([]);
  });
});

describe('the file filler', () => {
  afterEach(() => removeFixtures(document));

  const pdf = (view: Window & typeof globalThis) => new view.File(['%PDF-1.7 golden'], 'Alex Rivera Resume.pdf',
    { type: 'application/pdf' });
  const docx = (view: Window & typeof globalThis) => new view.File(['PK golden'], 'Alex Rivera Resume.docx',
    { type: DOCX_MIME });

  const FILES = `<!doctype html><body><form>
    <label for="any">Resume</label><input type="file" id="any">
    <label for="pdf-only">Resume (PDF)</label><input type="file" id="pdf-only" accept=".pdf,application/pdf">
    <label for="images">Photo</label><input type="file" id="images" accept="image/*">
    </form></body>`;

  it('puts the resume in through a DataTransfer, then sends input and change', async () => {
    const fixture = await loadFixture(document, FILES);
    const log = logEvents(fixture.doc);
    const file = pdf(fixture.view);
    expect(fillIn(fixture, 'any', { kind: 'file', ref: 'resume' }, { file })).toMatchObject({ reason: 'ok', wrote: true });
    const held = (fixture.doc.getElementById('any') as HTMLInputElement).files![0]!;
    expect([held.name, held.size, held.type]).toEqual([file.name, file.size, file.type]);
    expect(log.on('any').map((event) => event.type)).toEqual(['input', 'change']);
    expectOnlyAllowedUntrustedEvents(log.events);
    expect(fillIn(fixture, 'any', { kind: 'file', ref: 'resume' }, { file })).toMatchObject({ reason: 'already-correct' });
  });

  it('checks the accept list: a DOCX never goes into a PDF-only input, a PDF never into an image input', async () => {
    const fixture = await loadFixture(document, FILES);
    const log = logEvents(fixture.doc);
    expect(fillIn(fixture, 'pdf-only', { kind: 'file', ref: 'resume' }, { file: docx(fixture.view) }))
      .toMatchObject({ reason: 'pdf-only-input', wrote: false });
    expect(fillIn(fixture, 'images', { kind: 'file', ref: 'resume' }, { file: pdf(fixture.view) }))
      .toMatchObject({ reason: 'resume-format-unsupported', wrote: false });
    expect(fillIn(fixture, 'pdf-only', { kind: 'file', ref: 'resume' })).toMatchObject({ reason: 'resume-unavailable' });
    expect(log.events).toEqual([]);
    expect(fillIn(fixture, 'any', { kind: 'file', ref: 'resume' }, { file: docx(fixture.view) }))
      .toMatchObject({ reason: 'ok' });
  });
});

describe('the date filler', () => {
  afterEach(() => removeFixtures(document));

  it('writes ISO text into date and month inputs, and never invents a day', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <label for="d">Start date</label><input type="date" id="d">
      <label for="m">Graduation</label><input type="month" id="m">
      <label for="t">Interview slot</label><input type="datetime-local" id="t"></form></body>`);
    const log = logEvents(fixture.doc);
    expect(fillIn(fixture, 'd', { kind: 'date', iso: '2021-06-01' })).toMatchObject({ reason: 'ok' });
    expect((fixture.doc.getElementById('d') as HTMLInputElement).value).toBe('2021-06-01');
    expect(fillIn(fixture, 'm', { kind: 'date', iso: '2019-05-20' })).toMatchObject({ reason: 'ok' });
    expect((fixture.doc.getElementById('m') as HTMLInputElement).value).toBe('2019-05');
    expect(log.on('d').map((event) => event.type)).toEqual(['input', 'change']);
    expect(fillIn(fixture, 'd', { kind: 'date', iso: '2019-05' })).toMatchObject({ reason: 'format-unsupported' });
    expect(fillIn(fixture, 't', { kind: 'date', iso: '2019-05-20' })).toMatchObject({ reason: 'format-unsupported' });
  });
});

describe('sameText', () => {
  it.each([
    ['(512) 555-0147', '512.555.0147', 'digits', true],
    ['(512) 555-0147', '+1 512 555 0147', 'digits', false],
    ['', '', 'digits', false],
    ['ALEX@EXAMPLE.COM ', 'alex@example.com', 'casefold', true],
    ['120,000', '120000', 'numeric', true],
    ['$120,000.50', '120000.5', 'numeric', true],
    ['120,001', '120000', 'numeric', false],
    ['Alex   Rivera ', 'Alex Rivera', 'text', true],
    ['alex rivera', 'Alex Rivera', 'text', false],
    ['Alex Rivera ', 'Alex Rivera', 'exact', false],
  ] as const)('%j against %j under %s is %s', (actual, expected, rule, same) => {
    expect(sameText(actual, expected, rule)).toBe(same);
  });
});

describe('untrustedViolations', () => {
  it("allows only the browser's own input and change right after an untrusted click on the same control", () => {
    const event = (type: string, trusted: boolean, target = 'box') => ({ type, trusted, target });
    expect(untrustedViolations([event('click', false), event('input', true), event('change', true)])).toEqual([]);
    expect(untrustedViolations([event('input', true)])).toEqual([event('input', true)]);
    expect(untrustedViolations([event('click', true), event('change', true)])).toHaveLength(2);
    expect(untrustedViolations([event('click', false, 'a'), event('change', true, 'b')])).toHaveLength(1);
    expect(untrustedViolations([event('click', false), event('focusout', true)])).toHaveLength(1);
  });
});

describe('fill', () => {
  afterEach(() => removeFixtures(document));

  it('refuses a mismatched value, a disabled control and a camouflaged one', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body style="background:#fff"><form>
      <label for="t">Name</label><input id="t">
      <label for="off">Off</label><input id="off" disabled>
      <label for="ghost">Ghost</label><input id="ghost" style="border:0;background:transparent;outline:none"></form></body>`);
    expect(fillIn(fixture, 't', { kind: 'check' })).toMatchObject({ reason: 'internal-error', wrote: false });
    expect(fillIn(fixture, 't', { kind: 'query', queries: ['Austin'] })).toMatchObject({ reason: 'internal-error' });
    expect(fillIn(fixture, 'off', { kind: 'text', text: 'x' })).toMatchObject({ reason: 'disabled-or-readonly' });
    expect(fillIn(fixture, 'ghost', { kind: 'text', text: 'x' })).toMatchObject({ reason: 'not-user-visible' });
  });

  it('verifies after the settle in a fresh scan: gone, rejected, or held', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><form><label for="t">City</label><input id="t"></form></body>');
    const root = fixture.doc.querySelector('form')!;
    const first = scan(root, null, OPTIONS);
    const key = first.fields[0]!.key;
    const value = { kind: 'text', text: 'Austin' } as const;
    fill(first.target(key)!, value, { adapter: null, root });
    expect(verifyAfterSettle(first.rescan(), key, value)).toEqual({ verification: 'verified', reason: 'ok' });
    fixture.doc.getElementById('t')!.setAttribute('aria-invalid', 'true');
    expect(verifyAfterSettle(first.rescan(), key, value)).toEqual({ verification: 'mismatch',
      reason: 'value-rejected-by-site' });
    fixture.doc.getElementById('t')!.remove();
    expect(verifyAfterSettle(first.rescan(), key, value)).toEqual({ verification: 'not-checked',
      reason: 'element-not-found' });
  });
});

describe('a list the page re-orders between the plan and the write', () => {
  afterEach(() => removeFixtures(document));

  const SKILLS = ['Go', 'Java', 'Python', 'Rust', 'TypeScript'];
  const PAGE = `<!doctype html><body><form>
    <fieldset id="skills"><legend>Which of these skills do you use?</legend>
    ${SKILLS.map((skill) => `<label><input type="checkbox" name="skills" value="${skill}"> ${skill}</label>`).join('\n')}
    </fieldset>
    <label for="multi">Strongest skills</label>
    <select id="multi" multiple>${SKILLS.map((skill) => `<option>${skill}</option>`).join('')}</select>
    </form></body>`;
  const PLANNED = ['Python', 'TypeScript'];

  /** The plan, made from the scan before the page changes: the profile's Python and TypeScript. */
  function planOver(fixture: Fixture, kind: 'checkbox-group' | 'multiselect') {
    const root = fixture.doc.querySelector('form')!;
    const planned = scan(root, null, OPTIONS);
    const field = planned.fields.find((candidate) => candidate.kind === kind)!;
    const options = field.options === 'lazy' ? [] : field.options;
    const indices = PLANNED.map((label) => options.find((option) => option.label === label)!.index);
    const write: PlannedWrite = { key: field.key, value: { kind: 'options', indices, cleanLabels: [...PLANNED] },
      origin: { provenance: 'profile', path: 'skills' as ProfilePath },
      match: { stage: 'exact', optionIndex: null, rule: null, confidence: 1, flags: [], suggestions: [], reason: 'ok' } };
    return { root, planned, field, write };
  }

  /** What the content script does right before the write: the DOM guard's fresh scan, then the frame's core Guard. */
  function beforeWrite(plan: ReturnType<typeof planOver>) {
    const verdict = domGuardBeforeWrite(plan.planned, { key: plan.field.key, baseKey: plan.field.baseKey,
      label: plan.field.label, kind: plan.field.kind });
    if (!verdict.ok) throw new Error(`the DOM guard refused: ${verdict.reason}`);
    return { target: verdict.target, guard: guardWriteInFrame(plan.write, toFieldSpec(verdict.target.field), []) };
  }

  it('ticks nothing in a reversed checkbox group: same key, but the Guard and the filler say options-changed', async () => {
    const fixture = await loadFixture(document, PAGE);
    const plan = planOver(fixture, 'checkbox-group');
    const fieldset = fixture.doc.getElementById('skills')!;
    for (const label of Array.from(fieldset.querySelectorAll('label')).reverse()) fieldset.append(label);
    const log = logEvents(fixture.doc);
    const { target, guard } = beforeWrite(plan);
    // The option-set hash is over the sorted labels: the reversed list keeps the key, so only the labels tell.
    expect(target.field.key).toBe(plan.field.key);
    expect(guard).toEqual({ ok: false, reason: 'options-changed' });
    // The filler refuses on its own as well, whoever calls it.
    expect(fill(target, plan.write.value, { adapter: null, root: plan.root }))
      .toEqual({ wrote: false, verification: 'not-checked', reason: 'options-changed', needsUserAction: false });
    expect(Array.from(fixture.doc.querySelectorAll<HTMLInputElement>('input[type=checkbox]')).filter((box) => box.checked))
      .toEqual([]);
    expect(log.events).toEqual([]);
  });

  it('selects nothing in a reversed multiple select, for the same reasons', async () => {
    const fixture = await loadFixture(document, PAGE);
    const plan = planOver(fixture, 'multiselect');
    const select = fixture.doc.getElementById('multi') as HTMLSelectElement;
    for (const option of Array.from(select.options).reverse()) select.append(option);
    const log = logEvents(fixture.doc);
    const { target, guard } = beforeWrite(plan);
    expect(target.field.key).toBe(plan.field.key);
    expect(guard).toEqual({ ok: false, reason: 'options-changed' });
    expect(fill(target, plan.write.value, { adapter: null, root: plan.root }))
      .toEqual({ wrote: false, verification: 'not-checked', reason: 'options-changed', needsUserAction: false });
    expect(select.selectedOptions).toHaveLength(0);
    expect(log.events).toEqual([]);
  });

  it('writes the planned options when the list is unchanged, and verifies them by label as well as by place', async () => {
    const fixture = await loadFixture(document, PAGE);
    for (const kind of ['checkbox-group', 'multiselect'] as const) {
      const plan = planOver(fixture, kind);
      const { target, guard } = beforeWrite(plan);
      expect(guard, kind).toEqual({ ok: true });
      expect(fill(target, plan.write.value, { adapter: null, root: plan.root }), kind)
        .toMatchObject({ wrote: true, verification: 'verified', reason: 'ok' });
      expect(verifyAfterSettle(plan.planned.rescan(), plan.field.key, plan.write.value), kind)
        .toEqual({ verification: 'verified', reason: 'ok' });
    }
    // The page then re-renders the group in reverse, keeping each input's checked state by place (React reusing its
    // inputs): places 2 and 4 are still ticked, but now read Python and Go. By place alone that would verify.
    const plan = planOver(fixture, 'checkbox-group');
    const labels = Array.from(fixture.doc.getElementById('skills')!.querySelectorAll('label'));
    labels.forEach((label, at) => { label.lastChild!.textContent = ` ${SKILLS[SKILLS.length - 1 - at]!}`; });
    const fresh = plan.planned.rescan();
    expect(fresh.target(plan.field.key)?.members.map((box) => box.checked)).toEqual([false, false, true, false, true]);
    expect(verifyAfterSettle(fresh, plan.field.key, { kind: 'options', indices: [2, 4], cleanLabels: PLANNED }))
      .toEqual({ verification: 'mismatch', reason: 'verify-mismatch' });
  });
});
