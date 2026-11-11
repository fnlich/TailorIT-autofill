/*
 * jr6 ENGINE E2 (FIXPLAN §6.2 item 10, ADP-6): a success sign that only an open modal's focus trap hides counts. ADP
 * draws "Thank You! We have received your application." after a Submit, then opens its BrightJump promo pane
 * (sdf-focus-pane[data-sdf-modal]), whose focus trap sets aria-hidden="true" on the page around it and keeps each
 * element's value from before in data-old-aria-hidden (the jr6 ADP audit's ADP-6, snapshot6 adp1 and adp2: the cases
 * jr6-confirmation and jr6-confirmation-2). A rule naming that modal (SuccessRule.underModal) reads its sign, its
 * companion and its exclude as shown while a person sees the modal open and the trap alone hides them
 * (adapters/success.ts shownUnderRule, dom/visibility.ts visibleBesideFocusTrap), in successSignsOf and in
 * content/submitted.ts' shownSignsOf, successShown and newSuccessSign. Negatives: the modal shut, an aria-hidden the
 * page set itself, one the element held before the trap, any other kind of hiding, other words, no companion, a rule
 * naming no modal. The page here is synthetic, built from the audit's rule (its selectors and words are ADP's,
 * Jobright's ats-submission-rules adp-workforcenow); ADP's own config declares the rule on its branch, so the
 * submitted.ts tests set it on ATS_CONFIGS.adp for their run and put it back.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import { ATS_CONFIGS } from '../adapters/configured/registry';
import { successSignsOf, type SuccessRule } from '../adapters/success';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { newSuccessSign, shownSignsOf, successShown } from './submitted';

/** The rule as the ADP audit gives it (ADP-6's fix), with its modal. */
const RULE: SuccessRule = {
  css: '#vdlContainerFluid.success-card .success-message-container p.message',
  text: /^(?:Thank You! )?We have received your application\.?$/i,
  companion: { css: '.success-message-container span.message-header', text: /^Thank You!?$/i },
  underModal: 'sdf-focus-pane[data-sdf-modal]',
  from: 'jr6 ADP-6, synthetic',
};

/** The rule as it read before E2: no modal named. */
const { underModal: _none, ...PLAIN } = RULE;

/** ADP's page after its Submit, its promo pane open over it: the trap's aria-hidden on the page's own root, the value
 *  from before beside it. */
const CONFIRMATION = `<!doctype html><html><head><style>
  body { font: 14px sans-serif; margin: 16px; }
  sdf-focus-pane { display: block; position: fixed; right: 0; top: 0; width: 360px; height: 400px; background: #fff;
    border: 1px solid #888; }
</style></head><body>
  <div id="page" data-old-aria-hidden="null" aria-hidden="true">
    <div id="vdlContainerFluid" class="success-card">
      <div class="success-message-container" id="container">
        <span class="message-header" id="header">Thank You!</span>
        <p class="message" id="message">We have received your application.</p>
      </div>
    </div>
  </div>
  <sdf-focus-pane id="promo" data-sdf-modal="" heading="Promo">An offer</sdf-focus-pane>
</body></html>`;

afterEach(() => removeFixtures(document));

async function confirmation(change?: (doc: Document) => void): Promise<Document> {
  const { doc } = await loadFixture(document, CONFIRMATION, { width: 1280, height: 900 });
  change?.(doc);
  return doc;
}

const signIds = (doc: Document, rule: SuccessRule = RULE) => successSignsOf(doc, [rule]).map((sign) => sign.id);

describe('jr6 E2 item 10 (ADP-6): a success sign hidden only by an open modal’s focus trap', () => {
  it('control: a rule naming no modal reads no sign under the trap', async () => {
    expect(signIds(await confirmation(), PLAIN)).toEqual([]);
  });

  it('counts the sign, beside its companion, while the modal is open and only its trap hides them', async () => {
    expect(signIds(await confirmation())).toEqual(['message']);
    // With no trap at all (the promo shut and the page's aria-hidden put back), it reads as any shown sign does.
    expect(signIds(await confirmation((doc) => {
      doc.getElementById('promo')!.remove();
      doc.getElementById('page')!.removeAttribute('aria-hidden');
    }), PLAIN)).toEqual(['message']);
  });

  it('reads nothing once the modal is shut, though the page still says aria-hidden', async () => {
    expect(signIds(await confirmation((doc) => {
      doc.getElementById('promo')!.style.display = 'none';
    }))).toEqual([]);
    expect(signIds(await confirmation((doc) => doc.getElementById('promo')!.remove()))).toEqual([]);
  });

  it('never lifts an aria-hidden the page set itself, or one the element held before the trap', async () => {
    expect(signIds(await confirmation((doc) => doc.getElementById('page')!.removeAttribute('data-old-aria-hidden'))))
      .toEqual([]);
    expect(signIds(await confirmation((doc) => doc.getElementById('page')!.setAttribute('data-old-aria-hidden', 'true'))))
      .toEqual([]);
    // A second aria-hidden, the page's own, inside the trapped part.
    expect(signIds(await confirmation((doc) => doc.getElementById('container')!.setAttribute('aria-hidden', 'true'))))
      .toEqual([]);
  });

  it('still hides what any other rule hides: display, hidden, inert, visibility', async () => {
    for (const hide of [
      (doc: Document) => { doc.getElementById('message')!.style.display = 'none'; },
      (doc: Document) => { doc.getElementById('vdlContainerFluid')!.hidden = true; },
      (doc: Document) => { doc.getElementById('page')!.setAttribute('inert', ''); },
      (doc: Document) => { doc.getElementById('container')!.style.visibility = 'hidden'; },
    ]) {
      expect(signIds(await confirmation(hide))).toEqual([]);
      removeFixtures(document);
    }
  });

  it('still needs the rule’s words and its companion, the companion read through the trap too', async () => {
    expect(signIds(await confirmation((doc) => {
      doc.getElementById('message')!.textContent = 'We have saved your draft.';
    }))).toEqual([]);
    removeFixtures(document);
    expect(signIds(await confirmation((doc) => doc.getElementById('header')!.remove()))).toEqual([]);
    removeFixtures(document);
    expect(signIds(await confirmation((doc) => { doc.getElementById('header')!.style.display = 'none'; }))).toEqual([]);
  });

  it('reads an exclude the trap hides as shown: the rule then reads no sign', async () => {
    expect(signIds(await confirmation((doc) => {
      const error = doc.createElement('div');
      error.className = 'submit-error';
      error.textContent = 'Something went wrong';
      doc.getElementById('page')!.append(error);
    }), { ...RULE, exclude: '.submit-error' })).toEqual([]);
  });
});

describe('jr6 E2 item 10 (ADP-6): content/submitted.ts reads the sign under the modal', () => {
  const before = ATS_CONFIGS.adp;
  const adapter: Adapter = { ...genericAdapter, id: 'generic', postingText: () => null };

  beforeEach(() => {
    ATS_CONFIGS.adp = { ...before!, success: RULE };
  });
  afterEach(() => {
    ATS_CONFIGS.adp = before;
  });

  /** The form page at the press: the form shown, no confirmation, no promo. */
  async function pressed() {
    const doc = await confirmation((page) => {
      page.getElementById('promo')!.remove();
      page.getElementById('page')!.removeAttribute('aria-hidden');
      page.getElementById('page')!.removeAttribute('data-old-aria-hidden');
      page.getElementById('vdlContainerFluid')!.hidden = true;
      const form = page.createElement('form');
      form.id = 'app';
      const input = page.createElement('input');
      input.style.cssText = 'display: block; width: 300px';
      form.append(input);
      page.body.prepend(form);
    });
    const root = doc.getElementById('app')!;
    return { doc, root, signs: shownSignsOf(doc, 'adp') };
  }

  /** What ADP does after the Submit: the form gone, the confirmation drawn, the promo opened with its trap. */
  function submitted(doc: Document): void {
    doc.getElementById('app')!.remove();
    doc.getElementById('vdlContainerFluid')!.hidden = false;
    const page = doc.getElementById('page')!;
    page.setAttribute('data-old-aria-hidden', 'null');
    page.setAttribute('aria-hidden', 'true');
    const promo = doc.createElement('sdf-focus-pane');
    promo.id = 'promo';
    promo.setAttribute('data-sdf-modal', '');
    promo.textContent = 'An offer';
    doc.body.append(promo);
  }

  it('records the Submit: the sign is new since the press, shown under the promo, where the form was', async () => {
    const { doc, root, signs } = await pressed();
    expect(signs.size).toBe(0);
    expect(successShown(doc, 'adp')).toBe(false);
    submitted(doc);
    expect(successShown(doc, 'adp')).toBe(true);
    expect(newSuccessSign(doc, 'adp', { before: signs, root, adapter })?.id).toBe('message');
    expect([...shownSignsOf(doc, 'adp')].map((sign) => sign.id)).toEqual(['message']);
  });

  it('control: with the rule naming no modal, the Submit is never recorded while the promo shows', async () => {
    ATS_CONFIGS.adp = { ...before!, success: PLAIN };
    const { doc, root, signs } = await pressed();
    submitted(doc);
    expect(successShown(doc, 'adp')).toBe(false);
    expect(newSuccessSign(doc, 'adp', { before: signs, root, adapter })).toBeNull();
  });

  it('records nothing once the promo is shut and the page still says aria-hidden, nor a sign the page hid itself',
    async () => {
      const shut = await pressed();
      submitted(shut.doc);
      shut.doc.getElementById('promo')!.style.display = 'none';
      expect(successShown(shut.doc, 'adp')).toBe(false);
      expect(newSuccessSign(shut.doc, 'adp', { before: shut.signs, root: shut.root, adapter })).toBeNull();
      removeFixtures(document);
      const own = await pressed();
      submitted(own.doc);
      own.doc.getElementById('page')!.removeAttribute('data-old-aria-hidden');
      expect(successShown(own.doc, 'adp')).toBe(false);
      expect(newSuccessSign(own.doc, 'adp', { before: own.signs, root: own.root, adapter })).toBeNull();
    });
});
