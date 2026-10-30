import { afterEach, describe, expect, it } from 'vitest';
import html from '../../../fixtures/traps/11-forged-wxt-events.html?raw';
import { fill } from '../fillers';
import { removeFixtures } from '../fixture.testkit';
import { labelTable, loadTrap } from './trap.testkit';

describe('trap 11: forged WXT events', () => {
  afterEach(() => removeFixtures(document));

  it('fires the forgeries mid-fill, and the fill and the next scans carry on regardless', async () => {
    const trap = await loadTrap(document, html);
    const seen: string[] = [];
    trap.doc.addEventListener('flmloalhjldmcihejnmkndbcnhaacmng:content:wxt:content-script-started', (event) => {
      seen.push((event as CustomEvent<{ contentScriptName: string; messageId: string }>).detail.messageId);
    });
    const values: Array<[string, string]> = [['First name', 'Alex'], ['Last name', 'Rivera'],
      ['Email', 'alex.rivera.f7q2@example.com']];
    for (const [label, text] of values) {
      const result = trap.result.rescan();
      const target = result.target(trap.field(label).key)!;
      expect([label, fill(target, { kind: 'text', text }, { adapter: null, root: trap.root }).verification])
        .toEqual([label, 'verified']);
    }
    expect((trap.view as unknown as { __forgedEvents: number }).__forgedEvents).toBe(3);
    expect(seen).toEqual(['forged-by-the-page']);
    expect(trap.result.rescan().fields).toHaveLength(3);
  });

  it('scans the form with exact labels that the label rules classify', async () => {
    const trap = await loadTrap(document, html);
    expect(labelTable(trap, ['First name', 'Last name', 'Email'])).toEqual([
      ['First name', 'text', 'identity.firstName', 'label-rule'],
      ['Last name', 'text', 'identity.lastName', 'label-rule'],
      ['Email', 'text', 'contact.email', 'label-rule'],
    ]);
  });
});
