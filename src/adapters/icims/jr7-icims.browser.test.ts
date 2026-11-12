/*
 * The iCIMS adapter on the owner's snapshot7 of 2026-11-11 (F:\Develop\Refer\snapshot7\iCIMS1, icims2, icims3:
 * arc-onesolutions, whose IForms are framed from oneblood.icims.com; the same job's gate reached from its Jibe page; and
 * careers-quartzbenefits, whose last form is followed by an Assessments step), converted as fixtures/icims/jr7-*.html
 * with jr7-tooling-done's converter, the jr7 build's ICIMS-7 package (FIX7PLAN §6.7), P1: each hook the package adds,
 * on the snapshots and on DOM variants of them.
 * - ICIMS7-01 (adapter half): a portal frame that frames an IForm declares the forms frame's origin (chainChildOrigins),
 *   origins alone, on all eight IForm portal frames of fixtures/icims; arc-onesolutions' (oneblood.icims.com) is one no
 *   host-name rule derives (adapters/chain.ts chainChildOrigin null), CHAIN-7's worker keys the leaf by it.
 * - ICIMS7-04 (2): the Assessments step is the person's (handOver 'assessment'); its "Continue" is never pressed.
 * - ICIMS7-V3 (adapter half): "Desired Salary"'s currency, amount and time frame read as their part (labelSuffix,
 *   labelFirst), as RULES-7 reads them (FIX7PLAN §3.3).
 * - identityHosts: login.icims.com, iCIMS's own sign-in.
 * Nothing here prints or reads a snapshot's value: ids, classes, page words of the site and counts only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { chainChildOrigin, chainPageOf } from '../chain';
import { genericAdapter } from '../generic';
import { adaptersFor, applicationOf } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { ICIMS_SNAPSHOTS, icimsAdapter } from './index';
import { parseIcimsUrl } from './url';

const PAGES = import.meta.glob('../../../fixtures/icims/jr7-*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
/** The IForm portal frames and leaves of the earlier snapshots (2026-11-06 and snapshot6), for the declared origin. */
const OLD = import.meta.glob(['../../../fixtures/icims/edgewater-self-id-veteran.frame-*.html',
  '../../../fixtures/icims/nyu-self-id-disability.frame-*.html', '../../../fixtures/icims/jr6-nyu-iform-offer.frame-*.html',
  '../../../fixtures/icims/jr6-nyu-iform-signature.frame-*.html', '../../../fixtures/icims/jr6-sentinel-iform-selfid.frame-*.html'],
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
/** Every committed iCIMS page and frame, read lazily (parsed, never laid out) where a hook must answer nothing. */
const ALL = import.meta.glob('../../../fixtures/icims/*.html', { query: '?raw', import: 'default' }) as
  Record<string, () => Promise<string>>;
const ROUTES = import.meta.glob('../../../fixtures/icims/*.routes.json', { import: 'default', eager: true }) as
  Record<string, Record<string, string>>;

/** The snapshot7 cases (ICIMS_SNAPSHOTS' jr7 part, FIX7PLAN §11): 12 of iCIMS1, icims2's gate, 8 of icims3. */
const JR7_CASES = ['jr7-icims1-posting', 'jr7-icims1-login', 'jr7-icims1-profile', 'jr7-icims1-profile-1',
  'jr7-icims1-profile-2', 'jr7-icims1-profile-3', 'jr7-icims1-profile-4', 'jr7-icims1-profile-5', 'jr7-icims1-eeo',
  'jr7-icims1-iform-1', 'jr7-icims1-iform-2', 'jr7-icims1-confirmation', 'jr7-icims2-login', 'jr7-icims3-posting',
  'jr7-icims3-login', 'jr7-icims3-profile', 'jr7-icims3-questions', 'jr7-icims3-eeo', 'jr7-icims3-iform',
  'jr7-icims3-assessment', 'jr7-icims3-confirmation'] as const;

/** Each IForm portal frame of fixtures/icims (the verifier's eight) and the case whose .frame-2 is its leaf. */
const PORTALS = ['edgewater-self-id-veteran', 'nyu-self-id-disability', 'jr6-nyu-iform-offer', 'jr6-nyu-iform-signature',
  'jr6-sentinel-iform-selfid', 'jr7-icims1-iform-1', 'jr7-icims1-iform-2', 'jr7-icims3-iform'] as const;

const byFile = <T>(table: Record<string, T>, file: string): T | undefined =>
  Object.entries(table).find(([path]) => path.endsWith(`/${file}`))?.[1];

/** A page or frame of a case: its markup and its address (its route map's). */
function fileOf(name: string): { html: string; address: string } {
  const base = name.replace(/\.frame-\d+$/, '');
  const routes = byFile(ROUTES, `${base}.routes.json`) ?? {};
  const address = Object.entries(routes).find(([, path]) => path === `fixtures/icims/${name}.html`)?.[0] ?? '';
  return { html: byFile(PAGES, `${name}.html`) ?? byFile(OLD, `${name}.html`) ?? '', address };
}

/** Loads a page at its own address (a srcdoc page's base is about:srcdoc: its links resolve there). */
async function load(name: string) {
  const { html, address } = fileOf(name);
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  return fixture;
}

/** Every jr7 page and frame the content script runs in (the third-party stand-ins aside). */
const JR7_FILES = Object.keys(PAGES).map((path) => path.split('/').pop()!.replace(/\.html$/, ''))
  .filter((name) => !name.endsWith('.third-party-frame')).sort();

/** Every committed iCIMS page or frame, parsed (no layout). */
async function everyIcimsPage(): Promise<Array<{ name: string; doc: Document }>> {
  const pages: Array<{ name: string; doc: Document }> = [];
  for (const [path, read] of Object.entries(ALL).sort(([a], [b]) => a.localeCompare(b))) {
    const name = path.split('/').pop()!.replace(/\.html$/, '');
    if (name.endsWith('.third-party-frame')) continue;
    pages.push({ name, doc: new DOMParser().parseFromString(await read(), 'text/html') });
  }
  return pages;
}

/** An element of `doc` with these attributes (a variant's own markup, built as nodes). */
function el(doc: Document, tag: string, attributes: Record<string, string>): HTMLElement {
  const made = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) made.setAttribute(name, value);
  return made;
}

afterEach(() => removeFixtures(document));

// ---------------------------------------------------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------------------------------------------------

describe('the snapshot7 cases', () => {
  it('are the adapter’s jr7 snapshots, each page and frame served at its captured address', () => {
    expect([...ICIMS_SNAPSHOTS].filter((path) => path.includes('/jr7-')).sort())
      .toEqual(JR7_CASES.map((name) => `fixtures/icims/${name}.html`).sort());
    expect(JR7_FILES.length).toBe(45);
    for (const name of JR7_FILES) expect(fileOf(name).html.length > 0 && fileOf(name).address !== '', name).toBe(true);
  });

  it('picks the iCIMS adapter first on every address; the IForm leaves are chain frames of their forms host', () => {
    for (const name of JR7_FILES) {
      const url = new URL(fileOf(name).address);
      expect(adaptersFor(url).map((adapter) => adapter.id), name).toEqual(['icims', 'generic']);
      const leaf = /iform(?:-\d)?\.frame-2$/.test(name);
      const family = name.startsWith('jr7-icims1') ? 'icims:oneblood' : 'icims:quartzbenefits';
      expect(chainPageOf(url), name).toEqual(leaf ? { platform: 'icims', role: 'frame', family } : null);
    }
    // The reason ICIMS7-01 needs a declared origin: arc-onesolutions' name gives no forms host, quartz's does.
    expect(chainChildOrigin(new URL(fileOf('jr7-icims1-iform-1.frame-1').address))).toBeNull();
    expect(chainChildOrigin(new URL(fileOf('jr7-icims3-iform.frame-1').address))).toBe('https://quartzbenefits.icims.com');
  });

  it('reads each page of an application under its posting’s one key, the Assessments step included (ICIMS7-04 (1))',
    () => {
      for (const prefix of ['jr7-icims1', 'jr7-icims2', 'jr7-icims3']) {
        const names = JR7_FILES.filter((name) => name.startsWith(prefix) && !/\.frame-2$/.test(name));
        const read = names.map((name) => ({ name, ref: applicationOf(new URL(fileOf(name).address)) }));
        expect(read.every(({ ref }) => ref !== null), prefix).toBe(true);
        expect(new Set(read.map(({ ref }) => ref!.applicationKey)).size, prefix).toBe(1);
        for (const { name, ref } of read) {
          const page = /-posting(?:\.|$)/.test(name) ? 'posting' : /-confirmation(?:\.|$)/.test(name) ? 'confirmation'
            : 'application';
          expect(ref!.page, name).toBe(page);
        }
      }
      for (const name of ['jr7-icims3-assessment', 'jr7-icims3-assessment.frame-1']) {
        expect(parseIcimsUrl(new URL(fileOf(name).address))?.page, name).toBe('application');
      }
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// ICIMS7-01 (adapter half): the forms frame's origin, declared by the portal frame
// ---------------------------------------------------------------------------------------------------------------------

describe('chainChildOrigins (ICIMS7-01)', () => {
  it.each(PORTALS)('%s: the portal frame declares its leaf’s origin, alone', async (name) => {
    const fixture = await load(`${name}.frame-1`);
    const leaf = new URL(fileOf(`${name}.frame-2`).address);
    expect(icimsAdapter.chainChildOrigins!(fixture.doc)).toEqual([leaf.origin]);
    // The leaf names the origin the portal declares, and a portal no step form of its own.
    expect(icimsAdapter.detect(fixture.doc), name).toBeNull();
    expect(chainPageOf(leaf)?.role, name).toBe('frame');
  });

  it('declares oneblood.icims.com on arc-onesolutions’ two IForm steps and quartzbenefits on careers-quartzbenefits’',
    async () => {
      for (const [name, origin] of [['jr7-icims1-iform-1', 'https://oneblood.icims.com'],
        ['jr7-icims1-iform-2', 'https://oneblood.icims.com'], ['jr7-icims3-iform', 'https://quartzbenefits.icims.com']]) {
        const fixture = await load(`${name}.frame-1`);
        const origins = icimsAdapter.chainChildOrigins!(fixture.doc);
        expect(origins, name).toEqual([origin]);
        // An origin alone: no path, no query (the frame's src holds the person's user, item, token and csrf).
        for (const each of origins) expect(new URL(each).origin, name).toBe(each);
        removeFixtures(document);
      }
    });

  it('declares nothing on any other committed iCIMS page or frame (wrappers, steps, leaves, postings, the gate)',
    async () => {
      const declaring: string[] = [];
      const pages = await everyIcimsPage();
      expect(pages.length).toBeGreaterThan(90);
      for (const { name, doc } of pages) if (icimsAdapter.chainChildOrigins!(doc).length > 0) declaring.push(name);
      expect(declaring.sort()).toEqual(PORTALS.map((name) => `${name}.frame-1`).sort());
    });

  it('takes only a company portal’s /forms over https: never www, api, login, internal-, http, a port, credentials or '
    + 'another path', async () => {
    const fixture = await load('jr7-icims1-iform-1.frame-1');
    const frame = fixture.doc.querySelector('.iCIMS_mainFormFrame iframe#icims_formFrame')!;
    const src = frame.getAttribute('src')!;
    const query = new URL(src).search;
    const answer = (address: string) => {
      frame.setAttribute('src', address);
      return icimsAdapter.chainChildOrigins!(fixture.doc);
    };
    expect(answer(src)).toEqual(['https://oneblood.icims.com']);
    for (const address of [`https://www.icims.com/forms${query}`, `https://api.icims.com/forms${query}`,
      `https://login.icims.com/forms${query}`, `https://internal-oneblood.icims.com/forms${query}`,
      `http://oneblood.icims.com/forms${query}`, `https://oneblood.icims.com:8443/forms${query}`,
      `https://u:p@oneblood.icims.com/forms${query}`, `https://oneblood.icims.com/form${query}`,
      `https://oneblood.icims.com/forms/x${query}`, `https://oneblood.icims.com.evil.example/forms${query}`,
      `https://oneblood.example/forms${query}`, 'about:blank', 'javascript:void(0)']) {
      expect(answer(address), address).toEqual([]);
    }
    frame.removeAttribute('src');
    expect(icimsAdapter.chainChildOrigins!(fixture.doc)).toEqual([]);
  });

  it('names an origin once, every forms frame’s own, and none on a page with a step form of its own', async () => {
    const fixture = await load('jr7-icims1-iform-1.frame-1');
    const frame = fixture.doc.querySelector('.iCIMS_mainFormFrame iframe#icims_formFrame')!;
    const box = frame.closest('.iCIMS_mainFormFrame')!;
    box.append(frame.cloneNode());
    expect(icimsAdapter.chainChildOrigins!(fixture.doc)).toEqual(['https://oneblood.icims.com']);
    const other = frame.cloneNode() as Element;
    other.setAttribute('src', 'https://quartzbenefits.icims.com/forms?module=Forms');
    box.append(other);
    expect(icimsAdapter.chainChildOrigins!(fixture.doc))
      .toEqual(['https://oneblood.icims.com', 'https://quartzbenefits.icims.com']);
    // A frame outside the forms box, or one of another id, is none of an IForm's.
    other.remove();
    const loose = frame.cloneNode() as Element;
    loose.setAttribute('src', 'https://quartzbenefits.icims.com/forms?module=Forms');
    fixture.doc.body.append(loose);
    expect(icimsAdapter.chainChildOrigins!(fixture.doc)).toEqual(['https://oneblood.icims.com']);
    removeFixtures(document);
    // A leaf (its own IForm, a step form) declares nothing, even holding such a frame.
    const leaf = await load('jr7-icims1-iform-1.frame-2');
    const holder = el(leaf.doc, 'div', { class: 'iCIMS_mainFormFrame' });
    holder.append(el(leaf.doc, 'iframe', { id: 'icims_formFrame', src: 'https://oneblood.icims.com/forms?module=Forms' }));
    leaf.doc.body.append(holder);
    expect(icimsAdapter.detect(leaf.doc)).not.toBeNull();
    expect(icimsAdapter.chainChildOrigins!(leaf.doc)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// ICIMS7-04 (2): the Assessments step, the person's
// ---------------------------------------------------------------------------------------------------------------------

describe('the Assessments step (ICIMS7-04 (2))', () => {
  it('is the person’s by design in its frame: no root, no entry, no step reading, and its Continue never pressed',
    async () => {
      const fixture = await load('jr7-icims3-assessment.frame-1');
      const { doc } = fixture;
      expect(icimsAdapter.handOver!(doc)).toBe('assessment');
      expect(icimsAdapter.detect(doc)).toBeNull();
      expect(genericAdapter.detect(doc)).toBeNull();
      expect(icimsAdapter.entryControl!(doc)).toBeNull();
      expect(icimsAdapter.authState!(doc)).toBeNull();
      expect(icimsAdapter.chainStepFacts!(doc)).toBeNull();
      const recovery = doc.querySelector('a#assessmentLink0.iCIMS_Assessment_Recovery')!;
      expect(recovery).not.toBeNull();
      expect(icimsAdapter.neverPress!(doc.documentElement)).toContain(recovery);
      removeFixtures(document);
      // Its wrapper (the top, around the frame that shows the step) is no hand-over of its own.
      const top = await load('jr7-icims3-assessment');
      expect(icimsAdapter.handOver!(top.doc)).toBeNull();
      expect(icimsAdapter.detect(top.doc)).toBeNull();
      expect(genericAdapter.detect(top.doc)).toBeNull();
      expect(icimsAdapter.applicationFrame!(top.doc)).toBe(top.doc.querySelector('iframe#icims_content_iframe'));
    });

  it('is read from the bar’s current step or from the recovery link a person sees, either alone', async () => {
    const fixture = await load('jr7-icims3-assessment.frame-1');
    const { doc } = fixture;
    const link = doc.querySelector<HTMLElement>('a#assessmentLink0')!;
    const bar = doc.querySelector('.iCIMS_Steps')!;
    // The bar alone.
    link.style.display = 'none';
    expect(icimsAdapter.handOver!(doc)).toBe('assessment');
    // The link alone.
    link.style.display = '';
    const parent = bar.parentNode!;
    const next = bar.nextSibling;
    bar.remove();
    expect(icimsAdapter.handOver!(doc)).toBe('assessment');
    // Neither: a hidden link and no bar.
    link.style.display = 'none';
    expect(icimsAdapter.handOver!(doc)).toBeNull();
    // A bar whose current step is another one.
    link.style.display = 'none';
    parent.insertBefore(bar, next);
    doc.getElementById('Step_assessmentsStep')!.classList.remove('iCIMS_Steps_Current');
    doc.getElementById('Step_perPortalSubmittalFormsStep')!.classList.add('iCIMS_Steps_Current');
    expect(icimsAdapter.handOver!(doc)).toBeNull();
  });

  it('is no hand-over on a page with a step form of its own, nor on any other committed iCIMS page or frame',
    async () => {
      const fixture = await load('jr7-icims3-assessment.frame-1');
      const { doc } = fixture;
      const form = el(doc, 'form', { id: 'questions', name: 'questions' });
      form.append(el(doc, 'input', { type: 'text', name: 'q1' }),
        el(doc, 'input', { type: 'submit', id: 'quesp_form_submit_i', value: 'Submit' }));
      doc.body.append(form);
      expect(icimsAdapter.detect(fixture.doc)).not.toBeNull();
      expect(icimsAdapter.handOver!(fixture.doc)).toBeNull();
      const handing: string[] = [];
      const linked: string[] = [];
      for (const page of await everyIcimsPage()) {
        if (icimsAdapter.handOver!(page.doc) !== null) handing.push(page.name);
        if (page.doc.querySelector('a.iCIMS_Assessment_Recovery, a[id^="assessmentLink"]') !== null) linked.push(page.name);
      }
      // Parsed with no layout, the bar alone decides (no link is seen): the assessment's frame, and no other page.
      expect(handing).toEqual(['jr7-icims3-assessment.frame-1']);
      expect(linked).toEqual(['jr7-icims3-assessment.frame-1']);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// ICIMS7-V3 (adapter half): "Desired Salary"'s three parts
// ---------------------------------------------------------------------------------------------------------------------

describe('Desired Salary’s parts (ICIMS7-V3, FIX7PLAN §3.3)', () => {
  const SALARY = ['CandProfileFields.Salary_Currency', 'CandProfileFields.Salary', 'CandProfileFields.Salary_Timeframe'];

  it.each(['jr7-icims1-profile.frame-1', 'jr7-icims1-profile-1.frame-1', 'jr7-icims1-profile-3.frame-1'])(
    '%s: the currency, the amount and the time frame each read as their part, by the row’s label', async (name) => {
      const fixture = await load(name);
      const root = icimsAdapter.detect(fixture.doc)!.formRoot;
      const scanned = scan(root, icimsAdapter, { platform: 'icims' });
      const salary = scanned.fields.filter((field) => SALARY.includes(scanned.target(field.key)?.control.id ?? ''));
      expect(salary.map((field) => [scanned.target(field.key)!.control.id, field.label, field.labelSource,
        field.labelVisible])).toEqual([
        ['CandProfileFields.Salary_Currency', 'Desired Salary currency', 'adapter', true],
        ['CandProfileFields.Salary', 'Desired Salary amount', 'adapter', true],
        ['CandProfileFields.Salary_Timeframe', 'Desired Salary time frame', 'adapter', true]]);
      // No other field of the page reads a part's words.
      expect(scanned.fields.filter((field) => / (?:currency|amount|time frame)$/.test(field.label)).length).toBe(3);
      for (const id of SALARY) {
        const control = fixture.doc.getElementById(id)!;
        expect(icimsAdapter.labelFor!(control), id).toBe(fixture.doc.getElementById('label_CandProfileFields.Salary'));
        expect(icimsAdapter.labelFirst!(control), id).toBe(true);
      }
    });

  it('reads no part outside a salary box, nor a control of another id or kind inside one', async () => {
    const fixture = await load('jr7-icims1-profile.frame-1');
    const { doc } = fixture;
    for (const control of Array.from(doc.querySelectorAll('select, input, textarea'))) {
      if (SALARY.includes(control.id)) continue;
      const suffix = icimsAdapter.labelSuffix!(control);
      expect(suffix === null || ['month', 'day', 'year'].includes(suffix), control.id).toBe(true);
    }
    const box = doc.getElementById('CandProfileFields.Salary_SPAN')!;
    box.append(el(doc, 'input', { type: 'checkbox', id: 'CandProfileFields.Salary_x' }),
      el(doc, 'select', { id: 'CandProfileFields.Salary_Other' }));
    expect(icimsAdapter.labelSuffix!(doc.getElementById('CandProfileFields.Salary_x')!)).toBeNull();
    expect(icimsAdapter.labelSuffix!(doc.getElementById('CandProfileFields.Salary_Other')!)).toBeNull();
    // The amount as another kind of box is none.
    const amount = doc.getElementById('CandProfileFields.Salary') as HTMLInputElement;
    amount.type = 'hidden';
    expect(icimsAdapter.labelSuffix!(amount)).toBeNull();
    // A box whose id names no field (no _SPAN) reads nothing.
    amount.type = 'text';
    box.id = 'salary';
    expect(icimsAdapter.labelSuffix!(amount)).toBeNull();
    expect(icimsAdapter.labelFirst!(amount)).toBe(false);
  });

  it('leaves careers-quartzbenefits’ one Desired Salary box (a question, no salary field) as its own words', async () => {
    const fixture = await load('jr7-icims3-questions.frame-1');
    const root = icimsAdapter.detect(fixture.doc)!.formRoot;
    const scanned = scan(root, icimsAdapter, { platform: 'icims' });
    expect(fixture.doc.querySelector('.iCIMS_Forms_SalaryField')).toBeNull();
    expect(scanned.fields.filter((field) => / (?:currency|amount|time frame)$/.test(field.label))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// identityHosts: iCIMS's own sign-in
// ---------------------------------------------------------------------------------------------------------------------

describe('identityHosts', () => {
  it('names login.icims.com, whole, and no portal', () => {
    const hosts = icimsAdapter.identityHosts!;
    const named = (host: string) => hosts.some((pattern) => pattern.test(host));
    expect(named('login.icims.com')).toBe(true);
    for (const host of ['arc-onesolutions.icims.com', 'careers-quartzbenefits.icims.com', 'oneblood.icims.com',
      'login.icims.com.evil.example', 'xlogin.icims.com', 'www.icims.com', 'icims.com']) {
      expect(named(host), host).toBe(false);
    }
    // Every page of the snapshots is on a portal's or its forms host's, none on the sign-in's.
    for (const name of JR7_FILES) expect(named(new URL(fileOf(name).address).hostname), name).toBe(false);
  });
});
