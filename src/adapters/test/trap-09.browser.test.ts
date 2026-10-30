import { afterEach, describe, expect, it } from 'vitest';
import html from '../../../fixtures/traps/09-hidden-file-input.html?raw';
import { fill } from '../../dom/fillers';
import { loadFixture, logEvents, removeFixtures, untrustedViolations, watchHoneypots } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { e2eAdaptersFor, E2E_TEST_ADAPTER_MARKER, TRAP_09_URL } from './index';

/** A stand-in for the golden resume, a PDF. */
function goldenResume(view: Window & typeof globalThis): File {
  return new view.File(['%PDF-1.7\n% Alex Rivera golden resume\n'], 'Alex Rivera - Resume.pdf', { type: 'application/pdf' });
}

describe("the e2e-only test adapter on trap 09's page", () => {
  afterEach(() => removeFixtures(document));

  const adapter = e2eAdaptersFor(new URL(TRAP_09_URL))[0]!;

  it('is the generic adapter with a marker, for the trap page alone', () => {
    expect(adapter).toMatchObject({ id: 'generic', testOnly: E2E_TEST_ADAPTER_MARKER });
    expect(adapter.matchesUrl(new URL(`${TRAP_09_URL}?lever-source=x#top`))).toBe(true);
    expect(adapter.canonicalApplicationUrl(new URL(`${TRAP_09_URL}?x=1`))).toBe(TRAP_09_URL);
    for (const other of ['https://jobs.lever.co/tailorit-fixture/trap-01/apply', `${TRAP_09_URL}/`,
      'http://jobs.lever.co/tailorit-fixture/trap-09/apply', 'https://jobs.eu.lever.co/tailorit-fixture/trap-09/apply']) {
      expect(adapter.matchesUrl(new URL(other)), other).toBe(false);
      expect(e2eAdaptersFor(new URL(other)), other).toEqual([]);
    }
  });

  it("declares (d)'s Attach button the upload widget of its hidden input, labelled by its caption", async () => {
    const fixture = await loadFixture(document, html);
    const root = adapter.detect(fixture.doc)!.formRoot;
    expect(root.localName).toBe('form');
    expect(adapter.uploadWidgets!(root).map((widget) => [widget.control.id, widget.input.id])).toEqual([['attach-d', 'file-d']]);
    expect(adapter.labelFor!(fixture.doc.getElementById('file-d')!)).toBe(fixture.doc.getElementById('label-d'));
    expect(adapter.labelFor!(fixture.doc.getElementById('file-b')!)).toBeNull();
    const result = scan(root, adapter, { platform: 'lever' });
    expect(result.fields.map((field) => [field.idAttr, field.label, field.proxy])).toEqual([['first', 'First name', null],
      ['email', 'Email', null], ['resume', 'Attach resume', 'label'], ['file-d', 'Resume', 'adapter']]);
    expect(result.unrecognisedUploads.map((row) => row.label)).toEqual(['Attach']);
    const log = logEvents(fixture.doc);
    const watch = watchHoneypots(fixture.doc);
    const file = goldenResume(fixture.view);
    const target = result.target(result.fields[3]!.key)!;
    expect(fill(target, { kind: 'file', ref: 'resume' }, { adapter, root, file }))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect((fixture.doc.getElementById('file-d') as HTMLInputElement).files![0]!.name).toBe(file.name);
    expect(log.on('file-b')).toEqual([]);
    expect(log.on('file-c')).toEqual([]);
    expect(log.events.filter((event) => event.type === 'click')).toEqual([]);
    expect(untrustedViolations(log.events)).toEqual([]);
    expect(watch.changes()).toBe(0);
  });

  it('declares nothing on a page without case (d)', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><form><label for="a">Name</label><input id="a"></form></body>');
    expect(adapter.uploadWidgets!(fixture.doc.querySelector('form')!)).toEqual([]);
  });
});
