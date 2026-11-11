/*
 * jr6 ENGINE E2 (FIXPLAN §6.2 items 6, 7, 8 and 11): how the page is read, on synthetic pages shaped as the jr6 audits
 * describe each platform's markup (SP\jr6\audit\icims.md, oracle.md, adp.md), each hook declared by a test adapter as
 * its platform package declares it (FIXPLAN §6.5, §6.6, §6.11):
 * - item 6 (ICIMS-04): an account part declared as rows (Adapter.accountRows: careers-sentinel's Login, Password and
 *   Re-enter rows beside the profile's name and email) is the form's account part: no pause, the other questions read,
 *   its boxes counted by accountLeft; rows holding anything else of the application, or missing a box, are none;
 * Every value is synthetic (no owner data).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../adapters/generic';
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
