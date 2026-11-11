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
 * Every value is synthetic (no owner data), but the Oracle fixture's, which is the converted, redacted capture.
 */
import { afterEach, describe, expect, it } from 'vitest';
import hjfApplySectionHtml from '../../fixtures/oracle/hjf-apply-section.html?raw';
import { genericAdapter } from '../adapters/generic';
import { oracleAdapter } from '../adapters/oracle';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import type { Adapter } from '../adapters/types';
import { accountFormOf, accountLeft, accountRowsIn, accountSectionOf } from './account-section';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { detectPause } from './pause-detect';
import { scan } from './scan';

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
