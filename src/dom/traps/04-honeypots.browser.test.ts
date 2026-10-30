import { afterEach, describe, expect, it } from 'vitest';
import html from '../../../fixtures/traps/04-honeypots.html?raw';
import { fill } from '../fillers';
import { logEvents, removeFixtures, untrustedViolations, watchHoneypots } from '../fixture.testkit';
import { domGuardBeforeWrite } from '../guard';
import { labelTable, loadTrap } from './trap.testkit';

const HONEYPOTS = ['website', 'hp-email', 'alt-phone', 'hp-check', 'hp-radio', 'fax', 'hp-blend'];

describe('trap 04: honeypots', () => {
  afterEach(() => removeFixtures(document));

  it('makes no field of (a) to (f), counts them, and reports (g) with no visible label', async () => {
    const trap = await loadTrap(document, html);
    expect(trap.result.fields.map((field) => field.idAttr)).toEqual(['email', 'hp-blend']);
    expect(trap.result.counters.hiddenControlsIgnored).toBe(6);
    const blend = trap.result.fields.find((field) => field.idAttr === 'hp-blend')!;
    expect(blend).toMatchObject({ label: '', labelSource: 'none', labelVisible: false, camouflaged: true,
      autocomplete: ['email'] });
    expect(trap.field('Email')).toMatchObject({ labelSource: 'for', labelVisible: true, camouflaged: false });
    expect(labelTable(trap, ['Email'])).toEqual([['Email', 'text', 'contact.email', 'label-rule']]);
  });

  it("refuses (g) at the DOM guard, and fills the real Email without touching any honeypot", async () => {
    const trap = await loadTrap(document, html);
    const blend = trap.result.fields.find((field) => field.idAttr === 'hp-blend')!;
    expect(domGuardBeforeWrite(trap.result, blend)).toEqual({ ok: false, reason: 'no-visible-label' });
    const log = logEvents(trap.doc);
    const watch = watchHoneypots(trap.doc);
    const verdict = domGuardBeforeWrite(trap.result, trap.field('Email'));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(fill(verdict.target, { kind: 'text', text: 'alex.rivera.f7q2@example.com' }, { adapter: null, root: trap.root }))
      .toMatchObject({ verification: 'verified', reason: 'ok' });
    for (const id of HONEYPOTS) expect([id, log.on(id)]).toEqual([id, []]);
    expect(watch.changes()).toBe(0);
    for (const id of ['website', 'hp-email', 'alt-phone', 'fax', 'hp-blend']) {
      expect((trap.doc.getElementById(id) as HTMLInputElement).value).toBe('');
    }
    expect((trap.doc.getElementById('hp-check') as HTMLInputElement).checked).toBe(false);
    expect((trap.doc.getElementById('hp-radio') as HTMLInputElement).checked).toBe(false);
    expect(untrustedViolations(log.events)).toEqual([]);
  });
});
