import { afterEach, describe, expect, it } from 'vitest';
import { loadFixture, removeFixtures, type Fixture } from './fixture.testkit';
import { domGuardBeforeWrite } from './guard';
import { registerOwnUiHost } from './own-ui';
import { scan } from './scan';
import type { ScannedField, ScanResult } from './types';

const OPTIONS = { platform: 'lever' as const };
const PAGE = `<!doctype html><body style="background:#fff"><form>
  <label for="email">Email</label><input id="email">
  <label for="degree">Degree</label><select id="degree"><option>BS</option><option>MS</option></select>
  <input id="bare" style="border:1px solid #888">
  <input id="ghost" aria-label="Ghost" style="border:0;background:transparent;outline:none">
  <label for="ghost2">Phone</label><input id="ghost2" style="border:0;background:transparent;outline:none">
</form></body>`;

async function setup(): Promise<{ fixture: Fixture; first: ScanResult; field: (id: string) => ScannedField }> {
  const fixture = await loadFixture(document, PAGE);
  const first = scan(fixture.doc.querySelector('form')!, null, OPTIONS);
  return { fixture, first, field: (id) => first.fields.find((candidate) => candidate.idAttr === id)! };
}

describe('domGuardBeforeWrite', () => {
  afterEach(() => removeFixtures(document));

  it('re-finds the field by key in a fresh scan, even when the page replaced its node', async () => {
    const { fixture, first, field } = await setup();
    const replacement = fixture.doc.createElement('input');
    replacement.id = 'email';
    fixture.doc.getElementById('email')!.replaceWith(replacement);
    const verdict = domGuardBeforeWrite(first, field('email'));
    expect(verdict.ok && verdict.target.control).toBe(replacement);
  });

  it('refuses a field that is gone, hidden, relabelled, disabled or whose options changed', async () => {
    const { fixture, first, field } = await setup();
    const email = field('email');
    fixture.doc.getElementById('email')!.style.display = 'none';
    expect(domGuardBeforeWrite(first, email)).toEqual({ ok: false, reason: 'not-user-visible' });
    fixture.doc.getElementById('email')!.style.display = '';
    const label = fixture.doc.querySelector('label[for="email"]')!;
    // Same key (the slug ignores case), different words on screen: not the field that was planned.
    label.textContent = 'EMAIL';
    expect(domGuardBeforeWrite(first, email)).toEqual({ ok: false, reason: 'element-not-found' });
    label.textContent = "Referrer's email";
    expect(domGuardBeforeWrite(first, email)).toEqual({ ok: false, reason: 'element-not-found' });
    // A required mark is not a new question.
    label.textContent = 'Email *';
    expect(domGuardBeforeWrite(first, email).ok).toBe(true);
    label.textContent = 'Email';
    (fixture.doc.getElementById('email') as HTMLInputElement).disabled = true;
    expect(domGuardBeforeWrite(first, email)).toEqual({ ok: false, reason: 'disabled-or-readonly' });
    fixture.doc.getElementById('email')!.remove();
    expect(domGuardBeforeWrite(first, email)).toEqual({ ok: false, reason: 'element-not-found' });
    const degree = field('degree');
    fixture.doc.querySelector('#degree option')!.textContent = 'PhD';
    expect(domGuardBeforeWrite(first, degree)).toEqual({ ok: false, reason: 'options-changed' });
  });

  it('never writes a field without a visible label, or one drawn camouflaged', async () => {
    const { first, field } = await setup();
    expect(domGuardBeforeWrite(first, field('bare'))).toEqual({ ok: false, reason: 'no-visible-label' });
    expect(domGuardBeforeWrite(first, field('ghost'))).toEqual({ ok: false, reason: 'no-visible-label' });
    expect(domGuardBeforeWrite(first, field('ghost2'))).toEqual({ ok: false, reason: 'not-user-visible' });
  });

  it('writes nothing on a step that shows a password or one-time-code field', async () => {
    const { fixture, first, field } = await setup();
    const code = fixture.doc.createElement('input');
    code.setAttribute('autocomplete', 'one-time-code');
    fixture.doc.querySelector('form')!.append(code);
    expect(domGuardBeforeWrite(first, field('email'))).toEqual({ ok: false, reason: 'auth-required' });
  });

  it("never finds a field inside the extension's own UI", async () => {
    const { fixture, first, field } = await setup();
    const email = field('email');
    registerOwnUiHost(fixture.doc.querySelector('form')!);
    expect(domGuardBeforeWrite(first, email)).toEqual({ ok: false, reason: 'not-user-visible' });
  });
});
