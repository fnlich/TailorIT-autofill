/*
 * Core pass Z2 of 2026-11-06: the scanner reads across open shadow roots by the composed tree (./composed): a field in a
 * shadow root falls under the heading before its host (the section finder used compareDocumentPosition across two
 * trees, whose answer follows no rule: SmartRecruiters' screening questions fell now under "Preliminary questions", now
 * under none), and a 'radio' an adapter declares keeps members that sit in shadow roots inside its element (ADP's
 * referral radios: Node.contains stopped at the shadow root, so they were dropped).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter } from '../adapters/types';
import { composedOrder, holdsComposed } from './composed';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { scan } from './scan';

const OPTIONS = { platform: 'lever' as const };

afterEach(() => removeFixtures(document));

/** `count` hosts, each holding one labelled text box in its open shadow root. */
const shadowFields = (count: number) => Array.from({ length: count }, (_, at) => `<div class="host"><template
  shadowrootmode="open"><label for="q${at}">Question ${at}</label><input id="q${at}"
  style="border:1px solid #333"></template></div>`).join('');

describe('the composed tree', () => {
  it('orders a host, its shadow tree, then its own children, and holds across shadow roots', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><h2 id="before">Before</h2>
      <div id="host"><template shadowrootmode="open"><span id="inner">In</span></template><span id="light">Light</span></div>
      <h2 id="after">After</h2></body>`);
    const doc = fixture.doc;
    const host = doc.getElementById('host')!;
    const inner = host.shadowRoot!.getElementById('inner')!;
    const order = [doc.getElementById('after')!, doc.getElementById('light')!, inner, host, doc.getElementById('before')!]
      .sort(composedOrder).map((el) => el.id);
    expect(order).toEqual(['before', 'host', 'inner', 'light', 'after']);
    expect(holdsComposed(host, inner)).toBe(true);
    expect(host.contains(inner)).toBe(false);
    expect(holdsComposed(doc.getElementById('before')!, inner)).toBe(false);
  });

  it('puts every field in a shadow root under the heading before its host, never the one after', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>${shadowFields(24)}
      <h2>Afterwards</h2><label for="last">Last</label><input id="last" style="border:1px solid #333"></form></body>`);
    // The heading before the hosts is made after their shadow trees, as a page's script draws a heading late: across two
    // trees, Chromium's compareDocumentPosition answers by the nodes themselves, not by where they stand, and here it
    // put the heading after the fields (the scanner read them under no section until core pass Z2).
    const heading = fixture.doc.createElement('h2');
    heading.textContent = 'Contact details';
    const form = fixture.doc.querySelector('form')!;
    form.prepend(heading);
    const result = scan(form, null, OPTIONS);
    expect(result.fields).toHaveLength(25);
    expect(result.fields.slice(0, 24).map((field) => field.section.id)).toEqual(Array(24).fill('contact-details'));
    expect(result.fields[24]!.section.id).toBe('afterwards');
  });

  it("keeps a declared radio's members that sit in shadow roots inside its element, and reads its choice from them",
    async () => {
      // ADP's referral question's shape (fixtures/adp/questions.html): wfn-radio-button hosts, each holding its
      // role=radio in its shadow root, its words slotted in.
      const option = (value: string) => `<x-option value="${value}"><template shadowrootmode="open"><span role="radio"
        aria-checked="false" tabindex="0" style="border:1px solid #333"><slot></slot></span></template>${value}</x-option>`;
      const fixture = await loadFixture(document, `<!doctype html><body><form><span id="q">Were you referred?</span>
        <div id="options">${option('Yes')}${option('No')}</div></form></body>`);
      const doc = fixture.doc;
      const group = doc.getElementById('options')!;
      const radios = Array.from(group.children).map((host) => host.shadowRoot!.querySelector<HTMLElement>('[role="radio"]')!);
      const adapter = {
        id: 'generic', matchesUrl: () => true, detect: () => null,
        widgetRoots: () => [group],
        widgetFor: (el: Element) => (el === group ? { kind: 'radio' as const, opener: group, members: radios } : null),
        labelFor: (el: Element) => (el === group ? doc.getElementById('q') : null),
      } as unknown as Adapter;
      const result = scan(doc.querySelector('form')!, adapter, OPTIONS);
      const field = result.fields.find((each) => each.label === 'Were you referred?')!;
      expect(result.target(field.key)?.widget?.members).toEqual(radios);
      expect(Array.isArray(field.options) && field.options.map((each) => each.label)).toEqual(['Yes', 'No']);
      expect(field.current).toEqual({ kind: 'empty' });
      radios[1]!.setAttribute('aria-checked', 'true');
      const again = result.rescan().fields.find((each) => each.label === 'Were you referred?')!;
      expect(again.current).toEqual({ kind: 'selected', labels: ['No'] });
    });
});
