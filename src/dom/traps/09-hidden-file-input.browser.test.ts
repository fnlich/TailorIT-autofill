import { afterEach, describe, expect, it } from 'vitest';
import html from '../../../fixtures/traps/09-hidden-file-input.html?raw';
import { genericAdapter } from '../../adapters/generic';
import type { Adapter } from '../../adapters/types';
import { DOCX_MIME, fill } from '../fillers';
import { logEvents, removeFixtures, untrustedViolations, watchHoneypots } from '../fixture.testkit';
import { labelTable, loadTrap } from './trap.testkit';

/** The test-only adapter of the plan: it declares (d)'s visible Attach button as the upload widget of its hidden input,
 *  and (d)'s "Resume" caption as that input's label. */
const TEST_ADAPTER: Adapter = {
  ...genericAdapter,
  uploadWidgets: (root) => [{ control: root.querySelector('#attach-d')!, input: root.querySelector<HTMLInputElement>('#file-d')! }],
  labelFor: (control) => (control.id === 'file-d' ? control.ownerDocument.getElementById('label-d') : null),
};

/** A stand-in for the golden resume, a PDF. */
function goldenResume(view: Window & typeof globalThis): File {
  return new view.File(['%PDF-1.7\n% Alex Rivera golden resume\n'], 'Alex Rivera - Resume.pdf', { type: 'application/pdf' });
}

async function sha256(view: Window & typeof globalThis, blob: Blob): Promise<string> {
  const digest = await view.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('trap 09: hidden file inputs', () => {
  afterEach(() => removeFixtures(document));

  it('makes a field of (a) through its label, flags (b), and ignores (c) entirely', async () => {
    const trap = await loadTrap(document, html);
    expect(trap.field('Attach resume')).toMatchObject({ kind: 'file', visibility: 'hidden-file-with-visible-control',
      proxy: 'label', constraints: { accept: ['.pdf'] } });
    expect(trap.result.fields.map((field) => field.idAttr)).toEqual(['first', 'email', 'resume']);
    expect(trap.result.unrecognisedUploads.map((row) => row.label)).toEqual(['Attach', 'Attach']);
    expect(trap.result.counters.hiddenControlsIgnored).toBe(3);
  });

  it("makes a field of (d) through the test adapter's upload widget", async () => {
    const trap = await loadTrap(document, html, TEST_ADAPTER);
    expect(trap.field('Resume')).toMatchObject({ kind: 'file', visibility: 'hidden-file-with-visible-control',
      proxy: 'adapter', labelSource: 'adapter' });
    expect(trap.result.unrecognisedUploads.map((row) => row.label)).toEqual(['Attach']);
    expect(labelTable(trap, ['Attach resume', 'Resume'])).toEqual([
      ['Attach resume', 'file', 'file.resume', 'label-rule'],
      ['Resume', 'file', 'file.resume', 'label-rule'],
    ]);
  });

  it('puts the resume into (a) and (d): name, type, size and bytes, and the page sees one change', async () => {
    const trap = await loadTrap(document, html, TEST_ADAPTER);
    const log = logEvents(trap.doc);
    const watch = watchHoneypots(trap.doc);
    const file = goldenResume(trap.view);
    for (const label of ['Attach resume', 'Resume']) {
      const target = trap.result.rescan().target(trap.field(label).key)!;
      expect([label, fill(target, { kind: 'file', ref: 'resume' }, { adapter: TEST_ADAPTER, root: trap.root, file })])
        .toEqual([label, { wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false }]);
      const held = (target.control as HTMLInputElement).files![0]!;
      expect([held.name, held.type, held.size]).toEqual([file.name, file.type, file.size]);
      expect(await sha256(trap.view, held)).toBe(await sha256(trap.view, file));
    }
    expect((trap.view as unknown as { __resumeChanges: number }).__resumeChanges).toBe(1);
    expect(trap.doc.getElementById('resume-name')!.textContent).toBe(file.name);
    expect(log.on('file-b')).toEqual([]);
    expect(log.on('file-c')).toEqual([]);
    expect(watch.changes()).toBe(0);
    expect(untrustedViolations(log.events)).toEqual([]);
  });

  it('refuses a DOCX for the PDF-only input (a), with no event', async () => {
    const trap = await loadTrap(document, html);
    const log = logEvents(trap.doc);
    const docx = new trap.view.File(['PK'], 'Alex Rivera - Resume.docx', { type: DOCX_MIME });
    const target = trap.result.target(trap.field('Attach resume').key)!;
    expect(fill(target, { kind: 'file', ref: 'resume' }, { adapter: null, root: trap.root, file: docx }))
      .toMatchObject({ wrote: false, reason: 'pdf-only-input' });
    expect(log.events).toEqual([]);
  });
});
