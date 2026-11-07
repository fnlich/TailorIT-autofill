/*
 * The configured-adapter layer's rules the behaviour review of 2026-11-06 found untested (FINDINGS.md minor 16, the
 * layer's F3, F4, F5, F7, F9 and F16), each pinned on a small synthetic page of the layer's own (the framework's
 * markup, never a snapshot's): a mutation of the rule makes its test fail.
 * - F3: a page state's Next counts only while a person can see it (finalityOf);
 * - F4: no finality where no application root shows;
 * - F5: an upload whose input sits outside its declared area reads failed;
 * - F7: a sign-in container belongs only to a state filled like a step (one with no auth);
 * - F9: Submit is the shown match, not the first in the document;
 * - F16: a repeatable's Add is the section's own, never a block's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { configuredAdapter } from './index';
import type { AtsConfig } from './types';

const FROM = 'synthetic/configured-survivors';

/** The layer's own page: an application with one step's controls, an upload in its area and a stray file input, a
 *  repeatable section, two Submits (the first hidden) and a gate whose Next is hidden. */
const PAGE = `<!doctype html><html><body>
  <main id="app"><div class="steps">
    <label for="name">Name</label><input id="name" name="name">
    <div class="up"><span class="up-title">Resume</span><input type="file" class="file"><button type="button"
      class="pick">Upload</button><span class="done" hidden>Uploaded</span></div>
    <input type="file" class="file stray">
    <div class="exp"><div class="block"><label for="org">Company</label><input id="org">
      <button type="button" class="add">Add</button></div>
      <button type="button" class="add" id="section-add">Add</button></div>
    <button type="button" class="submit" id="hidden-submit" hidden>Submit</button>
    <button type="button" class="submit" id="shown-submit">Submit</button>
  </div></main>
  <div id="gate" hidden><p>Before you apply</p><button type="button" class="go" hidden>Continue</button></div>
  <div id="acct" hidden><p>Create an account</p><label for="acct-email">Email</label><input id="acct-email" type="email">
    <button type="button" class="create">Create account</button></div>
</body></html>`;

const BASE: AtsConfig = {
  platform: 'jobvite',
  snapshots: [FROM],
  parse: () => null,
  root: { css: 'main#app', holds: '.steps', from: FROM },
  uploads: [{ input: 'input.file', control: 'button.pick', area: '.up', done: '.done', from: FROM }],
  repeatables: [{ kind: 'experience', section: '.exp', block: '.block', add: '.add', from: FROM }],
  submit: { css: 'button.submit', from: FROM },
};

afterEach(() => removeFixtures(document));

const open = (): Promise<Fixture> => loadFixture(document, PAGE, { width: 1280, height: 900 });
const q = <T extends Element = HTMLElement>(fixture: Fixture, selector: string) => fixture.doc.querySelector<T>(selector)!;

describe('the configured layer: the rules the review found untested', () => {
  it("F3: a page state with a Next is not final only while that Next shows; with it hidden, unknown", async () => {
    const fixture = await open();
    const adapter = configuredAdapter({ ...BASE, states: [{ name: 'gate', when: '#gate', next: '#gate .go', from: FROM }] });
    q(fixture, '#gate').hidden = false;
    // The state shows, its Next does not: nothing to press, so the step's end is unknown.
    expect(adapter.stepSignature?.(fixture.doc)).toEqual({ anchors: ['state:gate'] });
    expect(adapter.isFinalStep?.(fixture.doc)).toBe('unknown');
    q(fixture, '#gate .go').hidden = false;
    expect(adapter.isFinalStep?.(fixture.doc)).toBe('not-final');
  });

  it('F4: a page that shows no application root is of unknown finality, whatever Submit shows', async () => {
    const fixture = await open();
    const adapter = configuredAdapter(BASE);
    expect(adapter.isFinalStep?.(fixture.doc)).toBe('final');
    // The root no longer holds what makes it the application's (root.holds): no root, so nothing is final.
    q(fixture, '.steps').classList.remove('steps');
    expect(adapter.detect(fixture.doc)).toBeNull();
    expect(q(fixture, '#shown-submit').isConnected).toBe(true);
    expect(adapter.isFinalStep?.(fixture.doc)).toBe('unknown');
  });

  it('F5: an upload whose input sits outside its declared area reads failed; in it, pending until done shows', async () => {
    const fixture = await open();
    const adapter = configuredAdapter(BASE);
    const own = q<HTMLInputElement>(fixture, '.up input.file');
    expect(adapter.uploadState?.(own, 'resume.pdf')).toBe('pending');
    q(fixture, '.up .done').hidden = false;
    expect(adapter.uploadState?.(own, 'resume.pdf')).toBe('confirmed');
    expect(adapter.uploadState?.(q<HTMLInputElement>(fixture, 'input.stray'), 'resume.pdf')).toBe('failed');
  });

  it('F7: a sign-in container is read only on a state filled like a step, never on an auth state', async () => {
    const fixture = await open();
    q(fixture, '#acct').hidden = false;
    const container = { container: '#acct', email: '#acct-email', button: '#acct .create' };
    const step = configuredAdapter({ ...BASE, states: [{ name: 'acct', when: '#acct', root: '#acct',
      signInContainer: container, from: FROM }] });
    expect(step.signInContainer?.(fixture.doc)).toMatchObject({ container: q(fixture, '#acct'),
      button: q(fixture, '#acct .create'), email: q(fixture, '#acct-email') });
    // The same container declared on a create-account state (configProblems names it): its page is a pause, and the
    // container door reads nothing there.
    const wall = configuredAdapter({ ...BASE, states: [{ name: 'acct', when: '#acct', auth: 'create-account',
      signInContainer: container, from: FROM }] });
    expect(wall.authState?.(fixture.doc)).toBe('create-account');
    expect(wall.signInContainer?.(fixture.doc)).toBeNull();
  });

  it('F9: Submit is the match a person can see, not the first in the document', async () => {
    const fixture = await open();
    const adapter = configuredAdapter(BASE);
    const root = adapter.detect(fixture.doc)!.formRoot;
    expect(adapter.submitButton?.(root)).toBe(q(fixture, '#shown-submit'));
    // With none shown, the first match is still named, so the fill never presses it.
    q(fixture, '#shown-submit').hidden = true;
    expect(adapter.submitButton?.(root)).toBe(q(fixture, '#hidden-submit'));
  });

  it("F16: a repeatable section's Add is its own, outside every block, never a block's", async () => {
    const fixture = await open();
    const adapter = configuredAdapter(BASE);
    const [entry] = adapter.repeatables!(adapter.detect(fixture.doc)!.formRoot);
    expect(entry?.blocks()).toEqual([q(fixture, '.exp .block')]);
    expect(entry?.addButton()).toBe(q(fixture, '#section-add'));
  });
});
