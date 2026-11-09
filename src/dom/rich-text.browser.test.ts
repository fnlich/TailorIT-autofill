/*
 * v5 Phase 2 (P2-fill): rich-text boxes (contenteditable editing hosts, the HTML standard's) are scanned as text fields
 * and written with the browser's own insert (fillers/text.ts fillEditable), on fixtures/synthetic/rich-text: a plain
 * box, a model-keeping editor that cancels every beforeinput and draws itself from its own model (as ProseMirror,
 * Lexical, Slate and Draft do), a one-line plaintext-only box, a box that ignores every write, one inside an open shadow
 * root; and what is no field: a hidden box (a honeypot, only counted), contenteditable="false", an editable element
 * inside another box's editing, and the extension's own UI.
 */
import { afterEach, describe, expect, it } from 'vitest';
import pageHtml from '../../fixtures/synthetic/rich-text/index.html?raw';
import { loadFixture, logEvents, removeFixtures, type Fixture } from './fixture.testkit';
import { fill, verifyAfterSettle } from './fillers';
import { domGuardBeforeWrite } from './guard';
import { isEditingHost } from './kinds';
import { scan } from './scan';
import type { FieldTarget, ScanResult } from './types';
import { editableText, textOfControl } from './values';

const OPTIONS = { platform: 'lever' as const };

function rootOf(fixture: Fixture): Element {
  return fixture.doc.getElementById('application')!;
}

function scanned(fixture: Fixture): ScanResult {
  return scan(rootOf(fixture), null, OPTIONS);
}

/** The live target of the field labelled `label`. */
function targetOf(fixture: Fixture, label: string): FieldTarget {
  const result = scanned(fixture);
  const field = result.fields.find((candidate) => candidate.label === label);
  if (field === undefined) throw new Error(`no field ${label}`);
  return result.target(field.key)!;
}

function write(fixture: Fixture, label: string, text: string) {
  return fill(targetOf(fixture, label), { kind: 'text', text }, { adapter: null, root: rootOf(fixture) });
}

describe('rich-text boxes: the scan', () => {
  afterEach(() => removeFixtures(document));

  it('reads each visible editing host as a text field with its label, kind and current text', async () => {
    const fixture = await loadFixture(document, pageHtml);
    const result = scanned(fixture);
    const byLabel = new Map(result.fields.map((field) => [field.label, field] as const));
    expect([...byLabel.keys()]).toEqual(['Full name', 'Cover letter', 'Why do you want to join us?', 'First name',
      'Anything else?', 'Additional information']);
    expect(byLabel.get('Cover letter')).toMatchObject({ kind: 'textarea', labelVisible: true, visibility: 'visible',
      current: { kind: 'text', text: 'Old text' }, camouflaged: false });
    expect(byLabel.get('Why do you want to join us?')).toMatchObject({ kind: 'textarea', required: true,
      current: { kind: 'empty' } });
    expect(byLabel.get('First name')).toMatchObject({ kind: 'text', current: { kind: 'empty' } });
    expect(byLabel.get('Additional information')).toMatchObject({ kind: 'textarea', labelVisible: true });
  });

  it('never takes a hidden box, contenteditable="false" or an editable element inside a box for a field', async () => {
    const fixture = await loadFixture(document, pageHtml);
    const result = scanned(fixture);
    expect(result.fields.some((field) => field.label === 'Website' || field.label === 'Posting summary')).toBe(false);
    // The hidden box is a honeypot: only counted.
    expect(result.counters.hiddenControlsIgnored).toBeGreaterThanOrEqual(1);
    const inner = fixture.doc.getElementById('inner')!;
    expect(isEditingHost(inner)).toBe(false);
    expect(isEditingHost(fixture.doc.getElementById('off')!)).toBe(false);
    expect(isEditingHost(fixture.doc.getElementById('letter')!)).toBe(true);
    expect(isEditingHost(fixture.doc.getElementById('name')!)).toBe(false);
  });

  it('counts a hidden box among the hidden controls ignored, and only it (undo proof for the honeypot rule)', async () => {
    const fixture = await loadFixture(document, pageHtml);
    const before = scanned(fixture).counters.hiddenControlsIgnored;
    fixture.doc.getElementById('trap-wrap')!.remove();
    expect(scanned(fixture).counters.hiddenControlsIgnored).toBe(before - 1);
  });
});

describe('rich-text boxes: the write', () => {
  afterEach(() => removeFixtures(document));

  it('replaces a plain box\'s text with the browser\'s insert, line by line, and reads it back', async () => {
    const fixture = await loadFixture(document, pageHtml);
    const log = logEvents(fixture.doc);
    const outcome = write(fixture, 'Cover letter', 'Dear team,\n\nI build platforms.');
    expect(outcome).toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    const box = fixture.doc.getElementById('letter')!;
    expect(editableText(box).replace(/\n+/g, '\n')).toBe('Dear team,\nI build platforms.');
    expect(box.textContent).not.toContain('Old text');
    // The browser's own editing: its trusted beforeinput and input, insertText and insertParagraph.
    const inputs = log.on('letter').filter((event) => event.type === 'input');
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((event) => event.trusted)).toBe(true);
    // The box was left (blur) and no selection is left behind.
    expect(fixture.doc.activeElement).not.toBe(box);
    expect(fixture.view.getSelection()?.rangeCount ?? 0).toBe(0);
  });

  it('writes a model-keeping editor through its own beforeinput handling: its model holds the text', async () => {
    const fixture = await loadFixture(document, pageHtml);
    const outcome = write(fixture, 'Why do you want to join us?', 'Your mission.\nYour team.');
    expect(outcome).toMatchObject({ wrote: true, verification: 'verified' });
    const model = (fixture.view as unknown as { __whyModel: string[] }).__whyModel;
    expect(model).toEqual(['Your mission.', 'Your team.']);
    const inputs = (fixture.view as unknown as { __whyInputs: Record<string, number> }).__whyInputs;
    expect(inputs).toMatchObject({ insertText: 2, insertParagraph: 1 });
  });

  it('writes a one-line plaintext-only box, and a box inside an open shadow root', async () => {
    const fixture = await loadFixture(document, pageHtml);
    expect(write(fixture, 'First name', 'Alex')).toMatchObject({ wrote: true, verification: 'verified' });
    expect(textOfControl(fixture.doc.getElementById('preferred')!)).toBe('Alex');
    expect(write(fixture, 'Additional information', 'Open to relocation.')).toMatchObject({ wrote: true,
      verification: 'verified' });
    const shadowed = fixture.doc.getElementById('host')!.shadowRoot!.getElementById('shadowed')!;
    expect(editableText(shadowed)).toBe('Open to relocation.');
  });

  it('reads a box whose editor takes each insert and draws nothing as written, not verified; writes nothing already there', async () => {
    const fixture = await loadFixture(document, pageHtml);
    expect(write(fixture, 'Anything else?', 'Thanks')).toMatchObject({ verification: 'mismatch',
      reason: 'verify-mismatch' });
    expect(editableText(fixture.doc.getElementById('ignores')!)).toBe('');
    expect(write(fixture, 'Cover letter', 'Old text')).toMatchObject({ wrote: false, reason: 'already-correct' });
  });

  it('reads the written box back after a settle through the scan, and the DOM guard re-finds it', async () => {
    const fixture = await loadFixture(document, pageHtml);
    write(fixture, 'Cover letter', 'Hello');
    const fresh = scanned(fixture);
    const field = fresh.fields.find((candidate) => candidate.label === 'Cover letter')!;
    expect(field.current).toEqual({ kind: 'text', text: 'Hello' });
    expect(verifyAfterSettle(fresh, field.key, { kind: 'text', text: 'Hello' })).toEqual({ verification: 'verified',
      reason: 'ok' });
    const verdict = domGuardBeforeWrite(fresh, { key: field.key, baseKey: field.baseKey, label: field.label,
      kind: field.kind });
    expect(verdict.ok).toBe(true);
  });

  it('never touches another box: the selection is the written box\'s own content alone', async () => {
    const fixture = await loadFixture(document, pageHtml);
    const name = fixture.doc.getElementById('name') as HTMLInputElement;
    name.value = 'Kept';
    write(fixture, 'First name', 'Alex');
    expect(name.value).toBe('Kept');
    expect(editableText(fixture.doc.getElementById('letter')!)).toBe('Old text');
    expect(editableText(fixture.doc.getElementById('trap')!)).toBe('');
  });
});
