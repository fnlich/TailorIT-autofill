/*
 * jr6 ENGINE E2 (FIXPLAN §6.2 items 6, 7, 8 and 11): how the page is read, on synthetic pages shaped as the jr6 audits
 * describe each platform's markup (SP\jr6\audit\icims.md, oracle.md, adp.md), each hook declared by a test adapter as
 * its platform package declares it (FIXPLAN §6.5, §6.6, §6.11):
 * - item 6 (ICIMS-04): an account part declared as rows (Adapter.accountRows: careers-sentinel's Login, Password and
 *   Re-enter rows beside the profile's name and email) is the form's account part: no pause, the other questions read,
 *   its boxes counted by accountLeft; rows holding anything else of the application, or missing a box, are none;
 * - item 7 (O4): a borderless control inside the bordered box it shares with another control (Oracle's phone number
 *   beside its country code) is drawn by the box its adapter declares (Adapter.controlBox), and only by a box that holds
 *   it, encloses it, shows and draws something; on the owner's Oracle section page too (fixtures/oracle/
 *   hjf-apply-section.html, whose expectation lists the number box as camouflaged without the hook);
 * - item 8 (ICIMS-14): a radio whose option words no label element holds (iCIMS's self-identification IForms: each
 *   radio in its wrapper, its bare words after it) is read with the words its adapter reads (Adapter.optionTextFor),
 *   only while a person sees them beside it; a label element still wins; the radio filler chooses by those words; on
 *   the owner's IForm page too (fixtures/icims/edgewater-self-id-veteran.frame-2.html);
 * - item 11 (ADP-5): a label[for] or aria-labelledby label that ends with a copy of the control's own validation message
 *   (ADP's "City is required" beside validationmessage=" is required"), or of its widget host's, is read without it;
 *   any other label stands;
 * - the ICIMS package's edit 1 (ICIMS-01's reading): an open dropdown's results, drawn in a container positioned
 *   absolutely inside a static cell that hides its overflow (iCIMS's div.iCIMS_InfoData, 40 px tall), read clear,
 *   as a person sees them below the cell: the cell is not the container's containing block, so its overflow never
 *   cuts them (dom/camouflage.ts heldUnder); a cell that is the containing block, or one above it, still cuts them;
 * Every value is synthetic (no owner data), but the Oracle fixture's, which is the converted, redacted capture.
 */
import { afterEach, describe, expect, it } from 'vitest';
import edgewaterVeteranHtml from '../../fixtures/icims/edgewater-self-id-veteran.frame-2.html?raw';
import hjfApplySectionHtml from '../../fixtures/oracle/hjf-apply-section.html?raw';
import { genericAdapter } from '../adapters/generic';
import { icimsAdapter } from '../adapters/icims';
import { oracleAdapter } from '../adapters/oracle';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import type { Adapter } from '../adapters/types';
import { accountFormOf, accountLeft, accountRowsIn, accountSectionOf } from './account-section';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { fill } from './fillers';
import { isCamouflaged } from './camouflage';
import { labelOfControl } from './labels';
import { detectPause } from './pause-detect';
import { scan } from './scan';
import { newScanCache } from './scan-cache';
import { visibleText } from './visible-text';
import { isUserVisible } from './visibility';

afterEach(() => removeFixtures(document));

// ── item 6 (ICIMS-04): the account part as rows ─────────────────────────────────────────────────────────────────────

/** careers-sentinel's Basic Information as the ICIMS audit describes it (jr6-sentinel-basic-info.frame-1): one pane,
 *  "Create your profile", whose table holds the name and email rows beside the Login, Password and Re-enter rows, all
 *  sent by "Submit Profile". */
const BASIC_INFO = `<!doctype html><html><head><style>input { display: block; width: 300px; }</style></head><body>
  <form id="f" method="post">
    <div class="pane" id="pane" role="group" aria-labelledby="pane-title"><h2 id="pane-title">Create your profile</h2>
      <div class="table">
        <div class="row" id="r-first"><label for="first">First Name</label><input id="first" required></div>
        <div class="row" id="r-last"><label for="last">Last Name</label><input id="last" required></div>
        <div class="row" id="r-email"><label for="email">Email</label><input id="email" type="email" required></div>
        <div class="row" id="r-login"><label for="login">Login</label><input id="login" aria-required="true"></div>
        <div class="row" id="r-pw"><label for="pw">Password</label><input id="pw" type="password" aria-required="true">
          <input type="hidden" name="pw-rules" value="8"></div>
        <div class="row" id="r-pw2"><label for="pw2">Password (Re-enter)</label>
          <input id="pw2" type="password" aria-required="true"></div>
      </div>
    </div>
    <input type="submit" id="next" value="Submit Profile">
  </form></body></html>`;

const ROWS = ['r-login', 'r-pw', 'r-pw2'];

/** The adapter ICIMS declares on that page: the three rows (accountRows), left out of the fields (excluded), and the
 *  create-login as its create-account form, its press the person's. `rows` overrides the declared row ids. */
function sentinel(rows: readonly string[] = ROWS): Adapter {
  const byId = (root: Element, id: string) => root.ownerDocument.getElementById(id)!;
  return { ...genericAdapter, id: 'generic',
    detect: (doc) => ({ formRoot: doc.getElementById('f')! }),
    accountRows: (root) => rows.map((id) => byId(root, id)),
    excluded: (root) => rows.map((id) => byId(root, id)),
    signInForm: (doc, wall) => (wall !== 'create-account' ? null : {
      email: doc.getElementById('login') as HTMLInputElement, password: doc.getElementById('pw') as HTMLInputElement,
      confirm: doc.getElementById('pw2') as HTMLInputElement, terms: [], button: doc.getElementById('next')!,
      form: doc.getElementById('f') as HTMLFormElement, declared: true, personPresses: true }) };
}

async function basicInfo(declared: Adapter, change?: (doc: Document) => void) {
  const fixture = await loadFixture(document, BASIC_INFO);
  change?.(fixture.doc);
  const doc = fixture.doc;
  const root = doc.getElementById('f')!;
  return { doc, root,
    rows: accountRowsIn(declared, doc, root).map((row) => row.id),
    section: accountSectionOf(declared, doc, root),
    form: accountFormOf(declared, doc, root),
    left: accountLeft(declared, doc, root),
    pause: detectPause(doc, root, declared)?.kind ?? null,
    labels: () => scan(root, declared, { platform: 'icims' }).fields.map((field) => field.label) };
}

describe('jr6 E2 item 6 (ICIMS-04): an account part declared as rows', () => {
  it('control: the same page with no rows declared pauses as an account’s creation', async () => {
    const page = await basicInfo({ ...sentinel(), accountRows: undefined, excluded: undefined });
    expect([page.rows, page.section, page.form, page.left]).toEqual([[], null, null, 0]);
    expect(page.pause).toBe('create-account');
  });

  it('reads the rows as the form’s account part: no pause, the profile’s questions fill, the rows’ boxes counted',
    async () => {
      const page = await basicInfo(sentinel());
      expect(page.rows).toEqual(ROWS);
      // No single element holds them: accountSectionOf answers none, accountFormOf and accountLeft read the rows.
      expect(page.section).toBeNull();
      expect(page.form?.password).toBe(page.doc.getElementById('pw'));
      expect(page.left).toBe(3);
      expect(page.pause).toBeNull();
      // The name and email are the step's fields; the rows' boxes are none (the adapter's excluded).
      expect(page.labels()).toEqual(['First Name', 'Last Name', 'Email']);
      // Once the person (or Sign-in Auto) filled the rows, nothing holds Next.
      for (const id of ['login', 'pw', 'pw2']) (page.doc.getElementById(id) as HTMLInputElement).value = 'x';
      expect(accountLeft(sentinel(), page.doc, page.root)).toBe(0);
    });

  it('is no account part where a row holds another question of the application', async () => {
    const page = await basicInfo(sentinel(), (doc) => doc.getElementById('r-login')!
      .append(doc.getElementById('email')!));
    expect([page.rows, page.form, page.left]).toEqual([[], null, 0]);
    expect(page.pause).toBe('create-account');
  });

  it('is no account part where a box of its create-account form sits in no declared row', async () => {
    const page = await basicInfo(sentinel(['r-login', 'r-pw']));
    expect([page.rows, page.form, page.left]).toEqual([[], null, 0]);
    expect(page.pause).toBe('create-account');
  });

  it('is no account part where a row is the form root, holds another row, or holds none of its boxes', async () => {
    for (const rows of [['f', 'r-pw', 'r-pw2'], ['pane', 'r-pw', 'r-pw2'], [...ROWS, 'r-first'], [...ROWS, 'pane-title'],
      [...ROWS, 'r-pw']]) {
      const page = await basicInfo(sentinel(rows));
      expect([page.rows, page.form, page.left], rows.join(' ')).toEqual([[], null, 0]);
      removeFixtures(document);
    }
    // A row inside another declared row, each holding only the boxes: still no account part.
    const nested = await basicInfo(sentinel(['r-login', 'pw-pair', 'r-pw']), (doc) => {
      const pair = doc.createElement('div');
      pair.id = 'pw-pair';
      pair.append(doc.getElementById('r-pw')!, doc.getElementById('r-pw2')!);
      doc.querySelector('.table')!.append(pair);
    });
    expect([nested.rows, nested.form, nested.left, nested.pause]).toEqual([[], null, 0, 'create-account']);
  });

  it('keeps a list of one as the section it was', async () => {
    const page = await basicInfo({ ...sentinel(), accountRows: undefined, excluded: undefined,
      accountSection: (root) => root.ownerDocument.getElementById('login-group') },
    (doc) => {
      const group = doc.createElement('div');
      group.id = 'login-group';
      group.append(...ROWS.map((id) => doc.getElementById(id)!));
      doc.getElementById('pane')!.append(group);
    });
    expect(page.section).toBe(page.doc.getElementById('login-group'));
    expect([page.rows, page.left, page.pause]).toEqual([['login-group'], 3, null]);
  });
});

// ── item 7 (O4): the box an adapter declares draws a borderless control ─────────────────────────────────────────────

/** Oracle's phone row as the audit measured it (O4): a bordered white group, 680 by 41 px, holding the country code's
 *  picker and the number box, each with no border, background or outline of its own. */
const PHONE_ROW = `<!doctype html><html><head><style>
  body { background: #fff; font: 14px sans-serif; margin: 16px; }
  .phone-row { display: flex; width: 680px; height: 41px; border: 1px solid #8a8a8a; border-radius: 4px; background: #fff; }
  .phone-row input { border: none; background: transparent; outline: none; height: 39px; padding: 0 8px; }
  .code { width: 120px; } .number { flex: 1; }
  label { display: block; margin: 8px 0 4px; }
</style></head><body>
  <form id="f">
    <label for="code">Country code</label><label for="phone">Phone Number</label>
    <div class="phone-row" id="phone-row" role="group"><input id="code" class="code"><input id="phone" class="number" type="tel"></div>
    <div id="beside" style="border: 1px solid #8a8a8a; width: 680px; height: 41px"></div>
  </form></body></html>`;

/** The hook as ORACLE declares it (oracle.md O4): the number box's group. `pick` overrides the element answered. */
const phoneBox = (pick: (phone: Element) => Element | null = (phone) => phone.closest('.phone-row[role="group"]')):
  Adapter => ({ ...genericAdapter, id: 'generic', controlBox: (control) => (control.id === 'phone' ? pick(control) : null) });

async function phoneCamouflaged(declared: Adapter | null, change?: (doc: Document) => void): Promise<boolean | undefined> {
  const fixture = await loadFixture(document, PHONE_ROW, { width: 1280, height: 900 });
  change?.(fixture.doc);
  const result = scan(fixture.doc.getElementById('f')!, declared, { platform: 'oracle' });
  const camouflaged = result.fields.find((field) => field.label === 'Phone Number')?.camouflaged;
  removeFixtures(document);
  return camouflaged;
}

describe('jr6 E2 item 7 (O4): a borderless control drawn by its declared box', () => {
  it('control: with no box declared, the shared group draws no box for it (the wrapper rule refuses a shared one)',
    async () => {
      expect(await phoneCamouflaged(null)).toBe(true);
      expect(await phoneCamouflaged({ ...genericAdapter, id: 'generic' })).toBe(true);
    });

  it('is drawn by the group its adapter declares, which a person sees with a border', async () => {
    expect(await phoneCamouflaged(phoneBox())).toBe(false);
    // A background that shows draws it too.
    expect(await phoneCamouflaged(phoneBox(), (doc) => {
      doc.getElementById('phone-row')!.style.cssText = 'display: flex; width: 680px; height: 41px; border: none; background: #d8d8d8';
    })).toBe(false);
  });

  it('is not drawn by a box that draws nothing, holds it not, does not enclose it, is hidden, or by a failing hook',
    async () => {
      // No border, no background a person sees against the page.
      expect(await phoneCamouflaged(phoneBox(), (doc) => {
        doc.getElementById('phone-row')!.style.cssText = 'display: flex; width: 680px; height: 41px; border: none; background: transparent';
      })).toBe(true);
      // A bordered box beside it, not around it.
      expect(await phoneCamouflaged(phoneBox((phone) => phone.ownerDocument.getElementById('beside')))).toBe(true);
      // A bordered box drawn over the row, enclosing it on screen, that does not hold it.
      expect(await phoneCamouflaged(phoneBox((phone) => phone.ownerDocument.getElementById('beside')), (doc) => {
        const row = doc.getElementById('phone-row')!.getBoundingClientRect();
        doc.getElementById('beside')!.style.cssText = `position: absolute; left: ${row.left - 4}px; top: ${row.top - 4}px;`
          + ` width: ${row.width + 8}px; height: ${row.height + 8}px; border: 1px solid #8a8a8a; pointer-events: none`;
      })).toBe(true);
      // Around it, but too short to enclose it (the box overflows).
      expect(await phoneCamouflaged(phoneBox(), (doc) => {
        doc.getElementById('phone-row')!.style.height = '10px';
      })).toBe(true);
      // Hidden itself (its box drawn by nobody a person sees).
      expect(await phoneCamouflaged(phoneBox(), (doc) => {
        doc.getElementById('phone-row')!.style.visibility = 'hidden';
        for (const input of Array.from(doc.querySelectorAll<HTMLElement>('.phone-row input'))) input.style.visibility = 'visible';
      })).toBe(true);
      // The control itself.
      expect(await phoneCamouflaged(phoneBox((phone) => phone))).toBe(true);
      expect(await phoneCamouflaged(phoneBox(() => {
        throw new Error('hook');
      }))).toBe(true);
    });

  it('reads the Oracle section page’s phone number as drawn once the hook is declared', async () => {
    const numberBox = async (declared: Adapter) => {
      const fixture = await loadFixture(document, hjfApplySectionHtml, SNAPSHOT_VIEWPORT);
      const root = declared.detect(fixture.doc)!.formRoot;
      const result = scan(root, declared, { platform: 'oracle' });
      const phone = fixture.doc.querySelector('input.phone-row__input')!;
      const field = result.fields.find((each) => result.target(each.key)?.control === phone);
      removeFixtures(document);
      return field?.camouflaged;
    };
    expect(await numberBox(oracleAdapter)).toBe(true);
    expect(await numberBox({ ...oracleAdapter, controlBox: (control) => (control.matches('input.phone-row__input')
      ? control.closest('.input-row-composite__inputs.phone-row[role="group"]') : null) })).toBe(false);
  });
});

// ── item 8 (ICIMS-14): an option's words that no label element holds ───────────────────────────────────────────────

/** An iCIMS self-identification IForm as the audit describes it (ICIMS-14): a title, an instruction, and three radios,
 *  each in its wrapper span and followed by its bare words up to a line break. */
const SELF_ID = `<!doctype html><html><head><style>body { font: 14px sans-serif; margin: 16px; }</style></head><body>
  <form id="f" name="icims_form" class="iCIMS_FormMainStyle">
    <div id="title">Voluntary Self-Identification of Protected Veteran Status</div>
    <p>Please check one of the boxes below:</p>
    <span id="group">
      <span class="iCIMS_Forms_RadioGroup"><input type="radio" id="v1" name="vet" value="Protected"></span> I IDENTIFY AS
        ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERAN LISTED ABOVE<br><br>
      <span class="iCIMS_Forms_RadioGroup"><input type="radio" id="v2" name="vet" value="NotProtected"></span> I AM NOT A
        PROTECTED VETERAN<br><br>
      <span class="iCIMS_Forms_RadioGroup"><input type="radio" id="v3" name="vet" value="Decline"></span> I DON'T WISH TO
        ANSWER<br>
    </span>
  </form></body></html>`;

/** The text the page draws after a radio's wrapper (or the radio), up to the next line break or control: the words the
 *  ICIMS package's optionTextFor reads (FIXPLAN §6.5, ICIMS-14), as a test adapter writes it. */
function wordsAfter(input: HTMLInputElement): string | null {
  const wrapper = input.parentElement?.matches('.iCIMS_Forms_RadioGroup') === true ? input.parentElement : input;
  let words = '';
  for (let node = wrapper.nextSibling; node !== null; node = node.nextSibling) {
    if (node.nodeType === 1 && ((node as Element).localName === 'br' || (node as Element).querySelector('input') !== null
      || (node as Element).localName === 'input')) break;
    words += ` ${node.textContent ?? ''}`;
  }
  const text = words.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

/** The group and its title, as ICIMS declares them (groupOf, labelFor), and `words` as its optionTextFor (null: none). */
const selfId = (words: ((input: HTMLInputElement) => string | null) | null = wordsAfter): Adapter => ({
  ...genericAdapter, id: 'generic',
  detect: (doc) => ({ formRoot: doc.getElementById('f')! }),
  groupOf: (control) => (control.getAttribute('name') === 'vet' ? control.ownerDocument.getElementById('group') : null),
  labelFor: (el) => (el.id === 'group' ? el.ownerDocument.getElementById('title') : null),
  ...(words === null ? {} : { optionTextFor: words }),
});

async function veteran(declared: Adapter, change?: (doc: Document) => void) {
  const fixture = await loadFixture(document, SELF_ID, { width: 1280, height: 900 });
  change?.(fixture.doc);
  const root = fixture.doc.getElementById('f')!;
  const result = scan(root, declared, { platform: 'icims' });
  const field = result.fields.find((each) => each.kind === 'radio');
  const options = field === undefined || field.options === 'lazy' ? [] : field.options.map((option) => option.label);
  return { doc: fixture.doc, result, field, options };
}

describe('jr6 E2 item 8 (ICIMS-14): a radio named by the words its adapter reads after it', () => {
  it('control: with no optionTextFor, the radios show no option a person can read', async () => {
    const { options } = await veteran(selfId(null));
    expect(options).toEqual([]);
  });

  it('reads each option by the words a person sees after it, and the radio filler chooses by them', async () => {
    const { doc, result, field, options } = await veteran(selfId());
    expect(options).toEqual(['I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERAN LISTED ABOVE',
      'I AM NOT A PROTECTED VETERAN', "I DON'T WISH TO ANSWER"]);
    expect(field?.label).toBe('Voluntary Self-Identification of Protected Veteran Status');
    const target = result.target(field!.key)!;
    const outcome = fill(target, { kind: 'option', index: 1, cleanLabel: 'I AM NOT A PROTECTED VETERAN' },
      { adapter: selfId(), root: doc.getElementById('f') });
    expect(outcome).toMatchObject({ wrote: true, verification: 'verified' });
    expect((doc.getElementById('v2') as HTMLInputElement).checked).toBe(true);
  });

  it('never takes words a person cannot see beside the radio, nor a failing hook’s', async () => {
    // Words the page does not draw beside it.
    expect((await veteran(selfId((input) => (input.id === 'v2' ? 'I AM A PROTECTED VETERAN' : wordsAfter(input)))))
      .options).toEqual(['I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERAN LISTED ABOVE',
      "I DON'T WISH TO ANSWER"]);
    removeFixtures(document);
    // Words the page draws hidden.
    const hidden = await veteran(selfId(), (doc) => {
      const v2 = doc.getElementById('v2')!.parentElement!;
      const words = doc.createElement('span');
      words.style.display = 'none';
      words.append(v2.nextSibling!);
      v2.after(words);
    });
    expect(hidden.options).not.toContain('I AM NOT A PROTECTED VETERAN');
    expect(hidden.options).toHaveLength(2);
    removeFixtures(document);
    expect((await veteran(selfId(() => {
      throw new Error('hook');
    }))).options).toEqual([]);
  });

  it('lets a label element win over the adapter’s words', async () => {
    const { options } = await veteran(selfId(), (doc) => {
      const label = doc.createElement('label');
      label.htmlFor = 'v3';
      label.textContent = 'Decline to self-identify';
      doc.getElementById('v3')!.parentElement!.after(label);
    });
    expect(options[2]).toBe('Decline to self-identify');
  });

  it('reads the owner’s veteran IForm’s three options by the words drawn after them', async () => {
    const fixture = await loadFixture(document, edgewaterVeteranHtml, SNAPSHOT_VIEWPORT);
    const doc = fixture.doc;
    const IFORM = 'form[name="icims_form"].iCIMS_FormMainStyle';
    const radios = Array.from(doc.querySelectorAll<HTMLInputElement>(`${IFORM} input[type="radio"][name="icims_f_Veteran"]`));
    expect(radios).toHaveLength(3);
    const declared: Adapter = { ...icimsAdapter,
      groupOf: (control) => {
        if (!radios.includes(control as HTMLInputElement)) return null;
        let at = control.parentElement;
        while (at !== null && !radios.every((radio) => at!.contains(radio))) at = at.parentElement;
        return at;
      },
      optionTextFor: (input) => (radios.includes(input) ? wordsAfter(input) : null) };
    const without = scan(icimsAdapter.detect(doc)!.formRoot, { ...declared, optionTextFor: undefined },
      { platform: 'icims' });
    const result = scan(icimsAdapter.detect(doc)!.formRoot, declared, { platform: 'icims' });
    const veteranOptions = (scanned: typeof result) => {
      const field = scanned.fields.find((each) => each.kind === 'radio' && scanned.target(each.key)?.members
        ?.some((member) => radios.includes(member as HTMLInputElement)));
      return field === undefined || field.options === 'lazy' ? [] : field.options.map((option) => option.label);
    };
    expect(veteranOptions(without)).toEqual([]);
    const read = veteranOptions(result);
    expect(read).toHaveLength(3);
    const shown = visibleText(doc.body, { singleLine: true }).replace(/\s+/g, ' ');
    for (const words of read) expect(shown).toContain(words);
  });
});

// ── item 11 (ADP-5): a validation message the page writes into a label ──────────────────────────────────────────────

/** ADP's Personal Information after a refused Next, as the audit describes it (jr6-personal-us-errors): each label's
 *  text rewritten to "<label> is required" (class mdf-label-error) before its required star, its input carrying
 *  validationmessage=" is required"; State a widget host (wfn-dropdown-list) labelled through aria-labelledby, carrying
 *  validation-message=" is required". */
const ADP_ERRORS = `<!doctype html><html><head><style>body { font: 14px sans-serif; margin: 16px; }
  input { display: block; width: 300px; } x-select { display: inline-block; width: 300px; height: 30px; }</style>
  </head><body>
  <form id="f">
    <div><label for="line1" class=" mdf-label-error">Address Line 1 is required<span class="mdf-required-indicator">*</span></label>
      <input id="line1" validationmessage=" is required" aria-required="true"></div>
    <div><label for="city" class=" mdf-label-error">City is required<span class="mdf-required-indicator">*</span></label>
      <input id="city" validationmessage=" is required" aria-required="true"></div>
    <div><label for="phone">Mobile Number is invalid</label><input id="phone" type="tel" validationmessage=" is invalid"></div>
    <div><label id="state-label" class=" mdf-label-error">State / Territory is required<span>*</span></label>
      <x-select id="state" role="combobox" aria-expanded="false" aria-labelledby="state-label" validation-message=" is required"></x-select></div>
    <div><label for="license">A driving license is required</label><input id="license"></div>
    <div><label for="training">Training is required</label><input id="training" validationmessage=""></div>
    <div><label for="only">is required</label><input id="only" validationmessage=" is required"></div>
    <div><label for="other">Degree is invalid</label><input id="other" validationmessage=" is required"></div>
    <div id="host-row"></div>
  </form></body></html>`;

describe('jr6 E2 item 11 (ADP-5): a label read without its control’s validation message', () => {
  const labelsOf = async (change?: (doc: Document) => void) => {
    const fixture = await loadFixture(document, ADP_ERRORS, { width: 1280, height: 900 });
    change?.(fixture.doc);
    const ctx = { cache: newScanCache(), adapter: null };
    const read = (el: Element) => labelOfControl(el, ctx);
    return { doc: fixture.doc, read, byId: (id: string) => read(fixture.doc.getElementById(id)!) };
  };

  it('reads "City is required" as City, required, beside validationmessage=" is required"', async () => {
    const { byId } = await labelsOf();
    expect(byId('city')).toMatchObject({ text: 'City', source: 'for', required: true, visible: true });
    expect(byId('line1')).toMatchObject({ text: 'Address Line 1', required: true });
    expect(byId('phone').text).toBe('Mobile Number');
  });

  it('reads a widget host’s aria-labelledby label without its validation-message', async () => {
    const { byId } = await labelsOf();
    expect(byId('state')).toMatchObject({ text: 'State / Territory', source: 'aria-labelledby', required: true });
  });

  it('reads a control inside a widget host’s shadow tree without the host’s message', async () => {
    const { doc, read } = await labelsOf((page) => {
      const host = page.createElement('x-field');
      host.setAttribute('validationmessage', ' is invalid');
      const shadow = host.attachShadow({ mode: 'open' });
      const label = page.createElement('label');
      label.htmlFor = 'inner';
      label.textContent = 'Home Phone Number is invalid';
      const input = page.createElement('input');
      input.id = 'inner';
      input.type = 'tel';
      shadow.append(label, input);
      page.getElementById('host-row')!.append(host);
    });
    const inner = doc.querySelector('x-field')!.shadowRoot!.getElementById('inner')!;
    expect(read(inner).text).toBe('Home Phone Number');
  });

  it('leaves every other label as it reads: no message, an empty one, another one, or nothing left', async () => {
    const { byId } = await labelsOf();
    expect(byId('license').text).toBe('A driving license is required');
    expect(byId('training').text).toBe('Training is required');
    expect(byId('only').text).toBe('is required');
    expect(byId('other').text).toBe('Degree is invalid');
  });

  it('gives the scan the label without the message', async () => {
    const fixture = await loadFixture(document, ADP_ERRORS, { width: 1280, height: 900 });
    const labels = scan(fixture.doc.getElementById('f')!, null, { platform: 'adp' }).fields.map((field) => field.label);
    expect(labels).toContain('City');
    expect(labels).toContain('Address Line 1');
    expect(labels).not.toContain('City is required');
  });
});

// ── the ICIMS package's edit 1 (ICIMS-01's reading): an overflow cuts only what its containing block holds ──────────

/** iCIMS's AddressStreet1 dropdown opened, as the ICIMS handoff measured it (jr6-ars-profile-address): the row
 *  positioned, its static cell 40 px tall hiding its overflow, the results' container positioned absolutely below the
 *  anchor, white with a grey border, its results in dark words. */
const DROPDOWN = `<!doctype html><html><head><style>
  body { font: 14px sans-serif; margin: 16px; background: #fff; color: #222; }
  .row { position: relative; width: 600px; }
  .cell { height: 40px; overflow: hidden; }
  .container { position: absolute; top: 40px; left: 0; width: 400px; background: #fff; border: 1px solid #999; }
  ul { margin: 0; padding: 4px; list-style: none; } li { padding: 4px; }
</style></head><body>
  <div class="row" id="row"><div class="cell" id="cell">
    <a id="anchor" role="combobox" aria-expanded="true" href="#">Address</a>
    <div class="container" id="container"><input class="dropdown-search" aria-label="Type to Search">
      <ul role="listbox" id="results"><li role="option" id="manual">Enter manually</li>
        <li role="option" id="other">123 Example Street</li></ul></div>
  </div></div>
</body></html>`;

describe('jr6 E2 (ICIMS-01 reading): an overflow cuts only what its containing block holds', () => {
  async function results(change?: (doc: Document) => void) {
    const fixture = await loadFixture(document, DROPDOWN, { width: 1280, height: 900 });
    change?.(fixture.doc);
    const li = fixture.doc.getElementById('manual')!;
    const verdict = isCamouflaged(li);
    const shown = isUserVisible(li);
    const words = visibleText(fixture.doc.getElementById('results')!, { singleLine: true });
    removeFixtures(document);
    return { verdict, shown, words };
  }

  it('reads the results drawn below a static overflow-hidden cell clear, as a person sees them', async () => {
    expect(await results()).toEqual({ verdict: 'clear', shown: true, words: 'Enter manually 123 Example Street' });
    // The cell's own background is not under them: a dark cell, a container with no background of its own.
    expect((await results((doc) => {
      doc.getElementById('cell')!.style.backgroundColor = '#333';
      doc.getElementById('container')!.style.background = 'none';
    })).verdict).toBe('clear');
    // A fixed container escapes every overflow below the viewport.
    expect((await results((doc) => {
      doc.getElementById('container')!.style.position = 'fixed';
      doc.getElementById('container')!.style.top = '80px';
    })).verdict).toBe('clear');
  });

  it('still cuts them where the cell is their containing block, or a block above it hides its overflow', async () => {
    // The cell positioned: it is the container's containing block, and its overflow hides the results.
    const cell = await results((doc) => { doc.getElementById('cell')!.style.position = 'relative'; });
    expect(cell.shown).toBe(false);
    expect(cell.verdict).not.toBe('clear');
    expect(cell.words).toBe('');
    // The row (the containing block) hides its overflow and is as short as the cell.
    const row = await results((doc) => { doc.getElementById('row')!.style.cssText = 'overflow: hidden; height: 40px'; });
    expect(row.verdict).not.toBe('clear');
    expect(row.words).toBe('');
    // In flow (static), the cell cuts it.
    const flow = await results((doc) => { doc.getElementById('container')!.style.position = 'static'; });
    expect(flow.verdict).not.toBe('clear');
  });

  it('still judges the words’ colours: white results on the white container are camouflaged', async () => {
    expect((await results((doc) => { doc.getElementById('results')!.style.color = '#fff'; })).verdict)
      .toBe('camouflaged');
  });
});
