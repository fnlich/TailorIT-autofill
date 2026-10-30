import { afterEach, describe, expect, it } from 'vitest';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { rawScan } from './raw-scan';
import { scan } from './scan';
import { monotonicNow } from './time';

/** A large application: 120 labelled text fields, a 250-country select, a 20-option radio group, a 12-box group. */
function largeForm(): string {
  const parts: string[] = ['<h2>Profile</h2>'];
  for (let i = 0; i < 120; i += 1) parts.push(`<div><label for="t${i}">Question ${i}</label><input id="t${i}"></div>`);
  parts.push('<label for="country">Country</label><select id="country">',
    ...Array.from({ length: 250 }, (_, i) => `<option value="c${i}">Country ${i}</option>`), '</select>');
  parts.push('<fieldset><legend>Pick one</legend>',
    ...Array.from({ length: 20 }, (_, i) => `<label><input type="radio" name="r" value="${i}"> Choice ${i}</label>`),
    '</fieldset>');
  parts.push('<fieldset><legend>Pick any</legend>',
    ...Array.from({ length: 12 }, (_, i) => `<label><input type="checkbox" name="c" value="${i}"> Box ${i}</label>`),
    '</fieldset>');
  return `<!doctype html><body><form>${parts.join('')}</form></body>`;
}

describe('scan performance', () => {
  afterEach(() => removeFixtures(document));

  // Generous budgets, so a slow CI machine passes; they catch a scan that turns quadratic.
  it('scans a large form, and rescans it to re-find a field, well within a second each', async () => {
    const fixture = await loadFixture(document, largeForm());
    const root = fixture.doc.querySelector('form')!;
    const started = monotonicNow();
    const first = scan(root, null, { platform: 'workday' });
    const scanned = monotonicNow() - started;
    expect(first.fields).toHaveLength(123);
    const key = first.fields[60]!.key;
    const restarted = monotonicNow();
    expect(first.rescan().target(key)).not.toBeNull();
    const rescanned = monotonicNow() - restarted;
    expect({ scanned: scanned < 1000, rescanned: rescanned < 1000 }).toEqual({ scanned: true, rescanned: true });
  });

  it('raw-scans the same page within its sliced budget', async () => {
    const fixture = await loadFixture(document, largeForm());
    const started = monotonicNow();
    const result = await rawScan(fixture.doc);
    expect(result.truncated).toBe(false);
    expect(monotonicNow() - started).toBeLessThan(2000);
  });
});
