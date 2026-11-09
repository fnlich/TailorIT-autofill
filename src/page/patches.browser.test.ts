/*
 * v5 p2-fill (PLAN decision 14): the page patches (page/patches.ts), in a fixture frame they are installed in as the
 * worker's injection installs them, driven through the isolated world's client (dom/fillers/dialogs.ts, dom/fillers/picker.ts) and, as a
 * page would, by raw calls:
 * - dialogs.hold / dialogs.release (page/dialogs.ts): the page's alert and confirm held only while a hold stands and
 *   only for dialogs no action of the person's brought (a hold through a wait ends at the person's own pointer or key),
 *   counted, never read; put back as they were (the page's own property, or none); nothing patched before a hold; a
 *   second install in the same document adds nothing;
 * - picker.arm / picker.disarm (page/picker.ts): a page's click() on a file input of its own during the arm opens no
 *   picker and the input is handed to the isolated world, which puts the file in; a click() made after a promise
 *   (react-dropzone's fallback) too; a showOpenFilePicker() is answered with the file alone; a click() on any other
 *   input, and every call once disarmed, goes through; the arm ends at its first use and puts back what it shadowed;
 *   v5 p2-fill review (security 7c): only a file input inside the pressed control's scope (its parent, or what its
 *   adapter declares), or one made at the press, is taken: another upload's input is the page's, and the person's own
 *   pointer during the wait disarms at once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { askPatches } from '../dom/patches';
import { holdDialogs, withDialogsHeld, withDialogsHeldWhile } from '../dom/fillers/dialogs';
import { fillThroughPicker } from '../dom/fillers/picker';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { PICKED } from '../dom/patch-protocol';
import { installPatches } from './patches';
import { genericAdapter } from '../adapters/generic';

const removals: Array<() => void> = [];
afterEach(() => {
  for (const remove of removals.splice(0)) remove();
  removeFixtures(document);
});

async function page(html: string): Promise<Fixture> {
  const fixture = await loadFixture(document, html);
  removals.push(installPatches(fixture.doc));
  return fixture;
}

/** A page whose own alert and confirm are spies (never the browser's, which would stop the test). */
function withOwnDialogs(fixture: Fixture) {
  const alert = vi.fn();
  const confirm = vi.fn(() => true);
  Object.assign(fixture.view, { alert, confirm });
  return { alert, confirm };
}

describe('the page\'s dialogs held through a write', () => {
  it('holds the page\'s alert and confirm only while a hold stands, counts them and puts the page\'s own back', async () => {
    const fixture = await page('<!doctype html><body><input id="a"></body>');
    const own = withOwnDialogs(fixture);
    const held = holdDialogs(fixture.doc);
    expect(fixture.view.alert).not.toBe(own.alert);
    fixture.view.alert('Uploaded!');
    expect(fixture.view.confirm('Replace your file?')).toBe(false);
    expect(own.alert).not.toHaveBeenCalled();
    expect(own.confirm).not.toHaveBeenCalled();
    expect(held.release()).toEqual({ alerts: 1, confirms: 1 });
    expect(held.release()).toBeNull();
    expect(fixture.view.alert).toBe(own.alert);
    expect(fixture.view.confirm).toBe(own.confirm);
    fixture.view.alert('After');
    expect(own.alert).toHaveBeenCalledTimes(1);
  });

  it('ends a hold made through a wait at the person\'s own pointer: the dialog their click brings shows', async () => {
    const fixture = await page('<!doctype html><body><button id="b" style="width:120px;height:40px">Mine</button></body>');
    const own = withOwnDialogs(fixture);
    fixture.doc.getElementById('b')!.addEventListener('click', () => fixture.view.alert('Yours'));
    const heard = vi.fn();
    await withDialogsHeldWhile(fixture.doc, async () => {
      fixture.view.alert('Ours');
      const box = fixture.doc.getElementById('b')!.getBoundingClientRect();
      await userEvent.click(fixture.frame, { position: { x: box.left + box.width / 2, y: box.top + box.height / 2 } });
    }, heard);
    expect(own.alert.mock.calls).toEqual([['Yours']]);
    expect(heard).toHaveBeenCalledWith({ alerts: 1, confirms: 0 });
    expect(fixture.view.alert).toBe(own.alert);
  });

  // v5 p2-fill review (security 4): through a wait only the alert is held.
  it('never answers a confirm the page asks during a wait: the person gets it; its alert is held, counted', async () => {
    const fixture = await page('<!doctype html><body><input id="a"></body>');
    const own = withOwnDialogs(fixture);
    const heard = vi.fn();
    let answered: boolean | null = null;
    await withDialogsHeldWhile(fixture.doc, () => new Promise<void>((done) => {
      fixture.view.setTimeout(() => {
        answered = fixture.view.confirm('Stay signed in?');
        fixture.view.alert('Saved');
        done();
      }, 50);
    }), heard);
    expect(own.confirm.mock.calls).toEqual([['Stay signed in?']]);
    expect(answered).toBe(true);
    expect(own.alert).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledWith({ alerts: 1, confirms: 0 });
    // A write's own synchronous events still hold both, the confirm answered Cancel.
    expect(withDialogsHeld(fixture.doc, () => fixture.view.confirm('Replace?'), heard)).toBe(false);
    expect(own.confirm).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenLastCalledWith({ alerts: 0, confirms: 1 });
    expect(fixture.view.confirm).toBe(own.confirm);
  });

  it('adds nothing on a second install in the same document', async () => {
    const fixture = await page('<!doctype html><body></body>');
    const listeners = vi.spyOn(fixture.doc, 'addEventListener');
    removals.push(installPatches(fixture.doc));
    expect(listeners).not.toHaveBeenCalled();
    withOwnDialogs(fixture);
    const held = holdDialogs(fixture.doc);
    expect(held.release()).toEqual({ alerts: 0, confirms: 0 });
  });

  it('patches nothing before a hold, and puts back alert and confirm as the window had them', async () => {
    const fixture = await page('<!doctype html><body></body>');
    const alert = Object.getOwnPropertyDescriptor(fixture.view, 'alert');
    const confirm = Object.getOwnPropertyDescriptor(fixture.view, 'confirm');
    const held = holdDialogs(fixture.doc);
    expect(fixture.view.alert).not.toBe(alert?.value);
    held.release();
    expect(Object.getOwnPropertyDescriptor(fixture.view, 'alert')).toEqual(alert);
    expect(Object.getOwnPropertyDescriptor(fixture.view, 'confirm')).toEqual(confirm);
  });

  it('keeps a replacement the page made during the hold', async () => {
    const fixture = await page('<!doctype html><body></body>');
    withOwnDialogs(fixture);
    const held = holdDialogs(fixture.doc);
    const theirs = vi.fn();
    fixture.view.alert = theirs;
    held.release();
    expect(fixture.view.alert).toBe(theirs);
  });

  it('holds nothing where no patches answer (a frame no run began in)', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body></body>');
    const own = withOwnDialogs(fixture);
    const heard = vi.fn();
    withDialogsHeld(fixture.doc, () => fixture.view.alert('Shown'), heard);
    expect(own.alert).toHaveBeenCalledTimes(1);
    expect(heard).not.toHaveBeenCalled();
  });

  it('holds a dialog a write\'s own change event brings, and says how many (withDialogsHeld)', async () => {
    const fixture = await page('<!doctype html><body><input id="a"></body>');
    const own = withOwnDialogs(fixture);
    const input = fixture.doc.getElementById('a') as HTMLInputElement;
    input.addEventListener('change', () => fixture.view.alert('Saved'));
    const heard = vi.fn();
    withDialogsHeld(fixture.doc, () => input.dispatchEvent(new fixture.view.Event('change')), heard);
    expect(own.alert).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledWith({ alerts: 1, confirms: 0 });
  });
});

/** A page whose "Attach" button makes a file input and clicks it, as Dropzone and many uploaders do; its change handler
 *  records the file's name. `later`: the click comes after a promise (react-dropzone's fallback). */
const UPLOADER = `<!doctype html><body><form id="f"><span id="l">Resume</span>
  <button type="button" id="attach" aria-labelledby="l">Attach</button><p id="name"></p>
  <input id="other" type="file"></form>
  <script>
    window.__mode = 'now';
    document.getElementById('attach').addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.docx';
      input.addEventListener('change', function () { document.getElementById('name').textContent = input.files[0].name; });
      window.__made = input;
      if (window.__mode === 'later') Promise.resolve().then(function () { input.click(); });
      else if (window.__mode === 'picker') {
        window.showOpenFilePicker().then(function (handles) { return handles[0].getFile(); })
          .then(function (file) { document.getElementById('name').textContent = 'fs:' + file.name; },
            function (error) { document.getElementById('name').textContent = 'refused:' + error.name; });
      } else input.click();
    });
  </script></body>`;

const RESUME = () => new File([new Uint8Array([37, 80, 68, 70, 45, 49])], 'Alex Rivera Resume.pdf',
  { type: 'application/pdf' });

/** v5 p2-fill review (security 7c): two uploads on one page, each its input beside its button; the résumé's button
 *  clicks the input `window.__which` names, at once, or (`window.__later`) when the test calls window.__pending. */
const TWO_UPLOADS = `<!doctype html><body><form id="f">
  <div id="a"><span id="l">Resume</span> <button type="button" id="attach" aria-labelledby="l">Attach</button>
    <input id="mine" type="file" hidden><p id="mine-name"></p></div>
  <div id="b"><span>Cover letter</span> <button type="button" id="letter" style="width:120px;height:40px">Attach letter</button>
    <input id="other" type="file" hidden><p id="other-name"></p></div></form>
  <script>
    window.__which = 'mine';
    window.__later = false;
    for (const id of ['mine', 'other']) {
      document.getElementById(id).addEventListener('change', function () {
        document.getElementById(id + '-name').textContent = this.files[0].name;
      });
    }
    document.getElementById('attach').addEventListener('click', function () {
      var input = document.getElementById(window.__which);
      if (window.__later) window.__pending = function () { input.click(); };
      else input.click();
    });
  </script></body>`;

describe('the picker takes only an input of the pressed control\'s own (v5 p2-fill review, security 7c)', () => {
  it('gives the résumé to the input beside its button', async () => {
    const fixture = await page(TWO_UPLOADS);
    const result = await fillThroughPicker(fixture.doc.getElementById('attach')!, RESUME(),
      { adapter: null, root: fixture.doc.getElementById('f') });
    expect(result).toMatchObject({ picked: 'input', outcome: { wrote: true, verification: 'verified' } });
    expect(result.input?.id).toBe('mine');
    expect(fixture.doc.getElementById('mine-name')!.textContent).toBe('Alex Rivera Resume.pdf');
  });

  it('never takes another upload\'s input the page clicks during the press: it is the page\'s', async () => {
    const fixture = await page(TWO_UPLOADS);
    (fixture.view as unknown as { __which: string }).__which = 'other';
    const opened = vi.fn();
    fixture.doc.addEventListener(PICKED, opened, true);
    const result = await fillThroughPicker(fixture.doc.getElementById('attach')!, RESUME(),
      { adapter: null, root: fixture.doc.getElementById('f'), waitMs: 300 });
    expect(result).toMatchObject({ picked: null, outcome: { wrote: false, reason: 'needs-your-click' } });
    expect(opened).not.toHaveBeenCalled();
    expect((fixture.doc.getElementById('other') as HTMLInputElement).files?.length ?? 0).toBe(0);
    expect(fixture.doc.getElementById('other-name')!.textContent).toBe('');
  });

  it('takes it where the adapter declares the scope wider (Adapter.uploadPickerScope)', async () => {
    const fixture = await page(TWO_UPLOADS);
    (fixture.view as unknown as { __which: string }).__which = 'other';
    const form = fixture.doc.getElementById('f')!;
    const result = await fillThroughPicker(fixture.doc.getElementById('attach')!, RESUME(),
      { adapter: { ...genericAdapter, uploadPickerScope: () => form }, root: form, waitMs: 300 });
    expect(result).toMatchObject({ picked: 'input', outcome: { wrote: true } });
    expect(result.input?.id).toBe('other');
  });

  it('is disarmed by the person\'s own pointer during the wait: their press is theirs', async () => {
    const fixture = await page(TWO_UPLOADS);
    const own = fixture.view as unknown as { __later: boolean; __pending?: () => void };
    own.__later = true;
    const opened = vi.fn();
    fixture.doc.addEventListener(PICKED, opened, true);
    const pressing = fillThroughPicker(fixture.doc.getElementById('attach')!, RESUME(),
      { adapter: null, root: fixture.doc.getElementById('f'), waitMs: 1_500 });
    const box = fixture.doc.getElementById('letter')!.getBoundingClientRect();
    await userEvent.click(fixture.frame, { position: { x: box.left + box.width / 2, y: box.top + box.height / 2 } });
    // The page's own click on the résumé's input comes after the person's press: it is no longer ours to take.
    own.__pending?.();
    const result = await pressing;
    expect(result).toMatchObject({ picked: null, outcome: { wrote: false, reason: 'needs-your-click' } });
    expect(opened).not.toHaveBeenCalled();
    expect((fixture.doc.getElementById('mine') as HTMLInputElement).files?.length ?? 0).toBe(0);
  });
});

describe('the page\'s own file picker, armed for one press', () => {
  it('hands the input the page clicked to the isolated world, which puts the résumé in: the page reads it', async () => {
    const fixture = await page(UPLOADER);
    const button = fixture.doc.getElementById('attach')!;
    const result = await fillThroughPicker(button, RESUME(), { adapter: null, root: fixture.doc.getElementById('f') });
    expect(result.picked).toBe('input');
    expect(result.outcome).toMatchObject({ wrote: true, verification: 'verified' });
    expect(fixture.doc.getElementById('name')!.textContent).toBe('Alex Rivera Resume.pdf');
    // Disarmed: the page's own click is back.
    expect(Object.getOwnPropertyDescriptor(fixture.view.HTMLInputElement.prototype, 'click')).toBeUndefined();
  });

  it('takes a click the page makes after a promise (react-dropzone\'s fallback)', async () => {
    const fixture = await page(UPLOADER);
    (fixture.view as unknown as { __mode: string }).__mode = 'later';
    const result = await fillThroughPicker(fixture.doc.getElementById('attach')!, RESUME(),
      { adapter: null, root: fixture.doc.getElementById('f') });
    expect(result).toMatchObject({ picked: 'input', outcome: { wrote: true, verification: 'verified' } });
    expect(fixture.doc.getElementById('name')!.textContent).toBe('Alex Rivera Resume.pdf');
  });

  it('answers the page\'s showOpenFilePicker with the résumé alone: written, never read back', async () => {
    const fixture = await page(UPLOADER);
    (fixture.view as unknown as { __mode: string }).__mode = 'picker';
    const result = await fillThroughPicker(fixture.doc.getElementById('attach')!, RESUME(),
      { adapter: null, root: fixture.doc.getElementById('f') });
    expect(result).toMatchObject({ picked: 'file-system', input: null,
      outcome: { wrote: true, verification: 'mismatch', reason: 'upload-not-confirmed' } });
    await vi.waitFor(() => expect(fixture.doc.getElementById('name')!.textContent).toBe('fs:Alex Rivera Resume.pdf'));
  });

  it('presses nothing and gives nothing where no patches answer the arm (undo proof for the arm)', async () => {
    const fixture = await loadFixture(document, UPLOADER);
    const clicks = vi.fn();
    fixture.doc.getElementById('attach')!.addEventListener('click', clicks);
    const result = await fillThroughPicker(fixture.doc.getElementById('attach')!, RESUME(),
      { adapter: null, root: fixture.doc.getElementById('f'), waitMs: 200 });
    expect(result).toMatchObject({ picked: null, outcome: { wrote: false, reason: 'needs-your-click' } });
    expect(clicks).not.toHaveBeenCalled();
  });

  it('says needs-your-click when the press opens no picker within its wait', async () => {
    const fixture = await page('<!doctype html><body><form id="f"><button type="button" id="b">Attach</button></form></body>');
    const result = await fillThroughPicker(fixture.doc.getElementById('b')!, RESUME(),
      { adapter: null, root: fixture.doc.getElementById('f'), waitMs: 200 });
    expect(result).toMatchObject({ picked: null, outcome: { wrote: false, reason: 'needs-your-click' } });
    expect(Object.getOwnPropertyDescriptor(fixture.view.HTMLInputElement.prototype, 'click')).toBeUndefined();
  });

  it('leaves every other click alone: a checkbox\'s, and any input\'s once disarmed', async () => {
    const fixture = await page('<!doctype html><body><input type="checkbox" id="c"><button id="b">x</button></body>');
    const box = fixture.doc.getElementById('c') as HTMLInputElement;
    expect(askPatches(fixture.doc.getElementById('b')!, 'picker.arm')?.ok).toBe(true);
    box.click();
    expect(box.checked).toBe(true);
    askPatches(fixture.doc.getElementById('b')!, 'picker.disarm');
    const other = fixture.doc.createElement('input');
    other.type = 'file';
    const opened = vi.fn();
    fixture.doc.addEventListener(PICKED, opened, true);
    other.click();
    expect(opened).not.toHaveBeenCalled();
  });

  it('never presses a control the never-submit door refuses (a submit button)', async () => {
    const fixture = await page(`<!doctype html><body><form id="f" onsubmit="event.preventDefault(); window.__sent = 1">
      <button type="submit" id="s">Submit application</button></form></body>`);
    const result = await fillThroughPicker(fixture.doc.getElementById('s')!, RESUME(),
      { adapter: null, root: fixture.doc.getElementById('f'), waitMs: 100 });
    expect(result.outcome).toMatchObject({ wrote: false, reason: 'needs-your-click' });
    expect((fixture.view as unknown as { __sent?: number }).__sent).toBeUndefined();
  });
});
