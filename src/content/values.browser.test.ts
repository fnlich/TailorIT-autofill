/*
 * The read-back a write is hashed from and the scanner's own reading must give one canonical value (values.ts), or
 * every written field would count a flip at the next scan and be planned again for nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import type { WriteValue } from '../core/types/intent';
import { fill } from '../dom/fillers';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { cleanOptionLabel } from '../dom/option-hash';
import { scan } from '../dom/scan';
import type { ScannedField } from '../dom/types';
import { canonicalValue, readBack } from './values';

afterEach(() => removeFixtures(document));

const LONG = `Engineering ${'and operations '.repeat(30)}`;

const FORM = `<!doctype html><html><body style="margin:0;background:#fff;color:#222;font:16px system-ui">
  <form id="f"><label for="name">Full name</label><input id="name" style="border:1px solid #888">
  <label for="why">Why us?</label><textarea id="why" style="border:1px solid #888"></textarea>
  <label for="state">State</label><select id="state"><option value="">Select...</option><option>Texas</option>
    <option>Utah</option></select>
  <label for="team">Team</label><select id="team"><option value="">Select...</option><option>${LONG}</option></select>
  <label for="skills">Skills</label><select id="skills" multiple><option>Go</option><option>TypeScript</option>
    <option>Rust</option></select>
  <fieldset><legend>Are you authorized?</legend><label><input type="radio" name="auth" value="y"> Yes</label>
    <label><input type="radio" name="auth" value="n"> No</label></fieldset>
  <fieldset><legend>Languages</legend><label><input type="checkbox" name="lang" value="en"> English</label>
    <label><input type="checkbox" name="lang" value="es"> Spanish</label></fieldset>
  <label><input type="checkbox" id="terms"> I agree to the terms</label>
  <label for="start">Start date</label><input id="start" type="date" style="border:1px solid #888">
  </form></body></html>`;

/** A write for each field of the form, by its label. */
function valueFor(field: ScannedField): WriteValue {
  const option = (label: string) => {
    const options = field.options === 'lazy' ? [] : field.options;
    const found = options.find((candidate) => cleanOptionLabel(candidate.label).startsWith(label))!;
    return { index: found.index, cleanLabel: cleanOptionLabel(found.label) };
  };
  switch (field.label) {
    case 'Full name': return { kind: 'text', text: 'Alex Rivera' };
    case 'Why us?': return { kind: 'text', text: 'Line one.\nLine two.' };
    case 'State': return { kind: 'option', ...option('Utah') };
    case 'Team': return { kind: 'option', ...option('Engineering') };
    case 'Skills': {
      const [go, rust] = [option('Go'), option('Rust')];
      return { kind: 'options', indices: [rust.index, go.index], cleanLabels: [rust.cleanLabel, go.cleanLabel] };
    }
    case 'Are you authorized?': return { kind: 'option', ...option('Yes') };
    case 'Languages': {
      const [en, es] = [option('English'), option('Spanish')];
      return { kind: 'options', indices: [es.index, en.index], cleanLabels: [es.cleanLabel, en.cleanLabel] };
    }
    case 'Start date': return { kind: 'date', iso: '2026-11-02' };
    default: return { kind: 'check' };
  }
}

describe('the read-back of a write and the next scan', () => {
  it('read every native kind as one canonical value, before a write and after it', async () => {
    const fixture = await loadFixture(document, FORM);
    const root = fixture.doc.getElementById('f')!;
    const first = scan(root, genericAdapter, { platform: 'lever' });
    expect(first.fields.map((field) => field.kind).sort()).toEqual(['checkbox', 'checkbox-group', 'date', 'multiselect',
      'radio', 'select', 'select', 'text', 'textarea']);
    for (const field of first.fields) {
      const target = first.rescan().target(field.key)!;
      expect(canonicalValue(readBack(target)), `${field.label} before`).toBe(canonicalValue(target.field.current));
      const outcome = fill(target, valueFor(field), { adapter: genericAdapter, root });
      expect(outcome.wrote, field.label).toBe(true);
      const after = readBack(target);
      expect(after.kind, field.label).not.toBe('empty');
      expect(canonicalValue(after), `${field.label} after`)
        .toBe(canonicalValue(first.rescan().target(field.key)!.field.current));
    }
  });
});
