/*
 * The configured-adapter layer (DESIGN-NEW-ATS §3, Phase 0) on its own synthetic page, fixtures/synthetic/configured-ats
 * (the framework's own markup, never a snapshot's): one AtsConfig that declares every rule kind, turned into an Adapter
 * by configuredAdapter, each hook held to what the page shows as the test shows and hides its parts:
 * - root (and its `holds`), page states (a consent gate whose entry the agent's door presses, a residence choice filled
 *   like a step, an account form for Sign-in Auto, an emailed code), the posting and its entry;
 * - questions (a title in the container, a title before it, help, a checkbox question with no fieldset through groupOf),
 *   required marks a person sees and required classes, sections, a declared dropdown, drawn radios (checkedOf), a
 *   clipped checkbox and its proxy, an upload and its signs, a repeatable block, all through the scanner itself;
 * - steps (signature, Next, Back, Submit, finality), never-pressed controls, errors, the busy sign and the success sign
 *   (content/submitted.ts through ATS_CONFIGS);
 * - configProblems on a sound and an unsound config, and on every registered one.
 * Each rule's test fails without the rule: the group test holds the same page read with no group rule, and the success
 * test the same page with no config registered.
 */
import { afterEach, describe, expect, it } from 'vitest';
import pageHtml from '../../../fixtures/synthetic/configured-ats/index.html?raw';
import { pressEntry } from '../../content/press';
import { newSuccessSign, shownSignsOf, signsOf } from '../../content/submitted';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan } from '../../dom/scan';
import { signInFormOf } from '../../dom/sign-in-form';
import type { ScanResult, ScannedField } from '../../dom/types';
import type { ApplicationUrl } from '../application-key';
import { configProblems, configuredAdapter, configuredHooks, configuredSuccessSigns } from './index';
import { ATS_CONFIGS } from './registry';
import type { AtsConfig, ConfiguredHooks } from './types';

/** Where every synthetic rule comes from. */
const FROM = 'fixtures/synthetic/configured-ats';
/** The synthetic page's addresses: the reserved fixture company on a configured platform's host. */
const POSTING = 'https://jobs.jobvite.com/tailorit-fixture/job/oFixture1';
const APPLICATION = `${POSTING}/apply`;

/** The synthetic platform's address reading: the posting, its application form, and nothing else. */
function parse(url: URL): ApplicationUrl | null {
  const match = /^\/tailorit-fixture\/job\/(oFixture\d)(\/apply)?\/?$/.exec(url.pathname);
  if (url.hostname !== 'jobs.jobvite.com' || match === null) return null;
  return { platform: 'jobvite', board: 'tailorit-fixture', jobId: match[1]!, page: match[2] === undefined ? 'posting'
    : 'application', applicationUrl: `https://jobs.jobvite.com/tailorit-fixture/job/${match[1]!}/apply` };
}

/** Every rule kind, on the synthetic page. The platform is any configured one: the layer reads none of it. */
const SYNTHETIC: AtsConfig = {
  platform: 'jobvite',
  snapshots: ['synthetic/configured-ats'],
  parse,
  states: [
    { name: 'consent', when: '#cf-consent .cf-consent-choice', auth: 'entry-choice', entry: '.cf-accept', from: FROM },
    { name: 'residence', when: '#cf-consent .cf-consent-form', root: '#cf-consent .cf-consent-form', from: FROM },
    { name: 'account', when: '#cf-account-form', auth: 'create-account', from: FROM, signIn: { form: '#cf-account-form',
      email: '#cf-acct-email', password: '#cf-acct-pass', confirm: '#cf-acct-confirm', terms: '.cf-acct-terms',
      button: '#cf-create' } },
    { name: 'code', when: '#cf-code', auth: 'email-code', from: FROM },
  ],
  root: { css: 'main#cf-app', holds: '.cf-steps', from: FROM },
  questions: [
    { container: '.cf-q--group', title: '.cf-q-title', group: true, from: FROM },
    { container: '.cf-q', title: '.cf-q-title', help: '.cf-help', from: FROM },
    { container: '.cf-q-plain', titleBefore: 'h4.cf-before', from: FROM },
  ],
  required: [{ mark: '.cf-star', from: FROM }, { is: '.cf-q--required', from: FROM }],
  sections: [{ container: '.cf-section', heading: '.cf-section-title', from: FROM }],
  widgets: [{ match: '.cf-select', root: true, kind: 'combobox', opener: '.cf-select-toggle',
    expanded: '.cf-select-toggle', parts: 'select', keys: ['Escape'], readOnlyBox: true, from: FROM }],
  checked: [{ input: '.cf-radio input', holder: 'label.cf-radio', chosen: '.cf-radio--on', from: FROM }],
  proxies: [{ input: '#cf-terms', proxy: '.cf-box-face', scope: '.cf-box', from: FROM }],
  uploads: [{ input: 'input.cf-file', control: '.cf-upload-button', area: '.cf-upload', done: '.cf-upload-done',
    pending: '.cf-upload-busy', failed: '.cf-upload-error', from: FROM }],
  repeatables: [{ kind: 'experience', section: '.cf-experience', block: '.cf-block', add: '.cf-add', save: '.cf-block-save',
    currentlyHere: '.cf-current', from: FROM }],
  steps: { heading: '.cf-step-title', progress: '.cf-progress', anchors: [{ css: '.cf-step', attr: 'data-step' }],
    urlPart: 'hash', next: '.cf-next', back: '.cf-back', from: FROM },
  submit: { css: '.cf-submit', from: FROM },
  neverPress: [{ css: '.cf-later', from: FROM }, { css: '.cf-linkedin', from: FROM }, { css: '.cf-parse', from: FROM },
    { css: '.cf-cookies', from: FROM }, { css: '.cf-decline', from: FROM }],
  excluded: [{ css: '.cf-parser', from: FROM }],
  errors: { css: '.cf-error', from: FROM },
  busy: [{ css: '.cf-saving', from: FROM }],
  success: { css: '.cf-thanks', from: FROM },
  posting: { text: '#cf-posting .cf-description', entry: '#cf-posting .cf-apply', from: FROM },
  quirks: { formLateMs: 1_000 },
};

const adapter = configuredAdapter(SYNTHETIC);

afterEach(() => {
  removeFixtures(document);
  delete ATS_CONFIGS.jobvite;
});

async function open(): Promise<Fixture> {
  return loadFixture(document, pageHtml, { width: 1280, height: 2400 });
}

/** Shows `selector`'s elements (hidden: false) or hides them. */
function show(fixture: Fixture, selector: string, on = true): void {
  for (const el of Array.from(fixture.doc.querySelectorAll(selector))) el.toggleAttribute('hidden', !on);
}

const q = <T extends Element = HTMLElement>(fixture: Fixture, selector: string) => fixture.doc.querySelector<T>(selector)!;

/** The scan's field labelled `label`. */
function field(result: ScanResult, label: string): ScannedField {
  const found = result.fields.find((each) => each.label === label);
  if (found === undefined) throw new Error(`no field "${label}" in ${JSON.stringify(result.fields.map((each) => each.label))}`);
  return found;
}

describe('configProblems', () => {
  it('finds none in the synthetic config, and in every registered one', () => {
    expect(configProblems(SYNTHETIC)).toEqual([]);
    for (const [platform, config] of Object.entries(ATS_CONFIGS)) expect(configProblems(config!), platform).toEqual([]);
  });

  it('names a rule with no snapshot, an entry-choice state with a root, and an entry or signIn its auth does not allow', () => {
    const unsound: AtsConfig = { ...SYNTHETIC, snapshots: [], root: { css: 'main', from: '' },
      required: [{ from: 'x-0' }], questions: [{ container: '.q', from: 'x-0' }],
      states: [{ name: 'a', when: '.a', auth: 'entry-choice', root: '.a form', from: 'x-0' },
        { name: 'a', when: '.b', entry: '.b button', from: 'x-0' },
        { name: 'c', when: '.c', auth: 'email-code', signIn: { form: 'form', button: 'button' }, from: ' ' }] };
    expect(configProblems(unsound)).toEqual([
      'root: no snapshot named (from)', 'snapshots: none named', 'states[2]: no snapshot named (from)',
      'required (x-0): neither mark nor is', 'questions (x-0): no title, titleBefore, help or group',
      'states.a: an entry-choice state takes no root (the entry presses only where no form shows)',
      'states: a named twice', 'states.a: an entry only on an entry-choice state',
      'states.c: a signIn only on a sign-in, create-account or email-gate state']);
  });
});

describe('the configured adapter: identity, root and page states', () => {
  it('reads its addresses through the config, on its own host', () => {
    expect(adapter.id).toBe('jobvite');
    expect(adapter.matchesUrl(new URL(APPLICATION))).toBe(true);
    expect(adapter.matchesUrl(new URL('https://www.jobvite.com/x'))).toBe(false);
    expect(adapter.canonicalApplicationUrl(new URL(`${APPLICATION}?x=1`))).toBe(APPLICATION);
    expect(adapter.canonicalApplicationUrl(new URL(POSTING))).toBeNull();
    // configuredHooks are the same hooks without the identity, for a full adapter to spread.
    expect(Object.keys(configuredHooks(SYNTHETIC)).sort()).toEqual(Object.keys(adapter)
      .filter((key) => !['id', 'matchesUrl', 'canonicalApplicationUrl'].includes(key)).sort());
  });

  it('finds the application root only while it shows and holds what the config says', async () => {
    const fixture = await open();
    expect(adapter.detect(fixture.doc)?.formRoot).toBe(q(fixture, 'main#cf-app'));
    expect(adapter.authState?.(fixture.doc)).toBeNull();
    expect(configuredAdapter({ ...SYNTHETIC, root: { css: 'main#cf-app', holds: '.cf-nothing', from: FROM } })
      .detect(fixture.doc)).toBeNull();
    show(fixture, 'main#cf-app', false);
    expect(adapter.detect(fixture.doc)).toBeNull();
  });

  it('reads the posting: its text, and its Apply as the entry no run presses', async () => {
    const fixture = await open();
    show(fixture, 'main#cf-app', false);
    show(fixture, '#cf-posting');
    expect(adapter.postingText?.(fixture.doc)).toBe(q(fixture, '#cf-posting .cf-description'));
    expect(adapter.entryControl?.(fixture.doc)).toBe(q(fixture, '.cf-apply'));
    expect(adapter.entryNeverPressed).toBe(true);
    expect(adapter.neverPress?.(fixture.doc.documentElement)).toContain(q(fixture, '.cf-apply'));
    // No entry while a form shows.
    show(fixture, 'main#cf-app');
    expect(adapter.entryControl?.(fixture.doc)).toBeNull();
  });

  it('fills a state with a root like a step, and presses nothing there', async () => {
    const fixture = await open();
    show(fixture, 'main#cf-app', false);
    show(fixture, '#cf-consent');
    expect(adapter.detect(fixture.doc)?.formRoot).toBe(q(fixture, '.cf-consent-form'));
    expect(adapter.authState?.(fixture.doc)).toBeNull();
    expect(adapter.isFinalStep?.(fixture.doc)).toBe('unknown');
    expect(adapter.nextButton?.(q(fixture, '.cf-consent-form'))).toBeNull();
    expect(adapter.stepSignature?.(fixture.doc)).toEqual({ anchors: ['state:residence'] });
    expect(scan(q(fixture, '.cf-consent-form'), adapter, { platform: 'jobvite' }).fields.map((each) => each.label))
      .toEqual(['Location of residence']);
  });

  it("gives an entry-choice state's entry to the agent's door alone, in either Consents mode, never its decline", async () => {
    const fixture = await open();
    show(fixture, 'main#cf-app', false);
    show(fixture, '#cf-consent');
    show(fixture, '.cf-consent-choice');
    expect(adapter.detect(fixture.doc)).toBeNull();
    expect(adapter.authState?.(fixture.doc)).toBe('entry-choice');
    expect(detectPause(fixture.doc, null, adapter)).toEqual({ kind: 'entry-choice', evidence: 'adapter' });
    expect(adapter.entryControl?.(fixture.doc)).toBe(q(fixture, '.cf-accept'));
    const never = adapter.neverPress?.(fixture.doc.documentElement) ?? [];
    expect(never).toContain(q(fixture, '.cf-accept'));
    expect(never).toContain(q(fixture, '.cf-decline'));
    const pressed: string[] = [];
    fixture.doc.addEventListener('click', (event) => pressed.push((event.target as Element).className), true);
    expect(await pressEntry(fixture.doc, [adapter], new AbortController().signal, 1_000, 100))
      .toEqual({ outcome: 'pressed' });
    expect(pressed).toEqual(['cf-accept']);
  });

  it("declares an account state's form to Sign-in Auto, and nothing for another wall or state", async () => {
    const fixture = await open();
    show(fixture, 'main#cf-app', false);
    show(fixture, '#cf-account');
    expect(adapter.detect(fixture.doc)).toBeNull();
    expect(adapter.authState?.(fixture.doc)).toBe('create-account');
    expect(detectPause(fixture.doc, null, adapter)).toEqual({ kind: 'create-account', evidence: 'adapter' });
    const form = signInFormOf(adapter, fixture.doc, 'create-account');
    expect(form).toEqual({ email: q(fixture, '#cf-acct-email'), password: q(fixture, '#cf-acct-pass'),
      confirm: q(fixture, '#cf-acct-confirm'), terms: [q(fixture, '.cf-acct-terms')], button: q(fixture, '#cf-create'),
      form: q(fixture, '#cf-account-form'), declared: true });
    expect(signInFormOf(adapter, fixture.doc, 'sign-in')).toBeNull();
    // The account's button is never one the run's fill could press as Next or Submit.
    expect(adapter.nextButton?.(fixture.doc.body)).toBeNull();
    expect(adapter.isFinalStep?.(fixture.doc)).toBe('unknown');
    show(fixture, '#cf-account', false);
    show(fixture, 'main#cf-app');
    expect(signInFormOf(adapter, fixture.doc, 'create-account')).toBeNull();
  });

  it('pauses on an emailed code, the person\'s', async () => {
    const fixture = await open();
    show(fixture, 'main#cf-app', false);
    show(fixture, '#cf-code');
    expect(adapter.authState?.(fixture.doc)).toBe('email-code');
    expect(detectPause(fixture.doc, null, adapter)).toEqual({ kind: 'email-code', evidence: 'adapter' });
    expect(adapter.detect(fixture.doc)).toBeNull();
  });
});

describe('the configured adapter: questions, through the scanner', () => {
  it('labels, requires, describes and sections each question as the config says', async () => {
    const fixture = await open();
    const root = adapter.detect(fixture.doc)!.formRoot;
    const result = scan(root, adapter, { platform: 'jobvite' });
    const first = field(result, 'First name');
    expect([first.kind, first.labelSource, first.required, first.section]).toEqual(['text', 'adapter', true,
      { id: 'personal-information' }]);
    const last = field(result, 'Last name');
    expect([last.required, last.description]).toEqual([true, 'As written on your passport.']);
    // A star a person cannot see marks nothing.
    expect(field(result, 'Middle name').required).toBe(false);
    expect(field(result, 'Preferred contact time').labelSource).toBe('adapter');
    expect(field(result, 'Email').required).toBe(false);
    // The resume parser's part holds no field.
    expect(result.fields.some((each) => each.nameAttr === 'parsed')).toBe(false);
  });

  it('makes a checkbox question with no fieldset one group through groupOf, and two lone boxes without it', async () => {
    const fixture = await open();
    const root = adapter.detect(fixture.doc)!.formRoot;
    const group = field(scan(root, adapter, { platform: 'jobvite' }), 'Are you authorized to work here?');
    expect([group.kind, group.required, Array.isArray(group.options) ? group.options.map((option) => option.label) : null])
      .toEqual(['checkbox-group', true, ['Yes', 'No']]);
    expect(adapter.groupOf?.(q(fixture, 'input[name="authorized_yes"]'))).toBe(q(fixture, '.cf-q--group'));
    // The same page with the question's group rule undone: the question is lost, each box its own "Yes" and "No".
    const ungrouped = configuredAdapter({ ...SYNTHETIC, questions: SYNTHETIC.questions!.map((rule) => {
      const { group: _group, ...rest } = rule;
      return rest;
    }) });
    const boxes = scan(root, ungrouped, { platform: 'jobvite' }).fields.filter((each) => each.nameAttr.startsWith('authorized'));
    expect(boxes.map((each) => [each.kind, each.label])).toEqual([['checkbox', 'Yes'], ['checkbox', 'No']]);
  });

  it('reads drawn radios as the page shows them chosen, and a clipped box through its proxy', async () => {
    const fixture = await open();
    const root = adapter.detect(fixture.doc)!.formRoot;
    const result = scan(root, adapter, { platform: 'jobvite' });
    const sponsor = field(result, 'Will you need sponsorship?');
    expect([sponsor.kind, sponsor.visibility]).toEqual(['radio', 'hidden-native-with-visible-label']);
    expect(Array.isArray(sponsor.options) && sponsor.options.map((option) => [option.label, option.selected]))
      .toEqual([['Yes', false], ['No', true]]);
    expect(adapter.checkedOf?.(q<HTMLInputElement>(fixture, 'input[name="sponsor"][value="no"]'))).toBe(true);
    expect(adapter.checkedOf?.(q<HTMLInputElement>(fixture, 'input[name="first"]'))).toBeNull();
    const terms = field(result, 'I agree to the terms of this application');
    expect([terms.kind, terms.visibility, terms.proxy]).toEqual(['checkbox', 'hidden-native-with-visible-label', 'adapter']);
    expect(adapter.proxyFor?.(q<HTMLInputElement>(fixture, '#cf-terms'))).toBe(q(fixture, '.cf-box-face'));
  });

  it('declares the drawn dropdown as its widget, its native select its own part', async () => {
    const fixture = await open();
    const root = adapter.detect(fixture.doc)!.formRoot;
    expect(adapter.widgetRoots?.(root)).toEqual([q(fixture, '.cf-select')]);
    const decl = adapter.widgetFor?.(q(fixture, '.cf-select'));
    expect(decl).toMatchObject({ kind: 'combobox', opener: q(fixture, '.cf-select-toggle'),
      expanded: q(fixture, '.cf-select-toggle'), parts: [q(fixture, '.cf-select-native')], keys: ['Escape'], readOnlyBox: true,
      snapshot: FROM });
    expect(adapter.widgetFor?.(q(fixture, 'input[name="first"]'))).toBeNull();
    const country = field(scan(root, adapter, { platform: 'jobvite' }), 'Country');
    expect(country.kind).toBe('combobox');
  });

  it("pairs the upload with its control, and reads the page's signs of the file", async () => {
    const fixture = await open();
    const root = adapter.detect(fixture.doc)!.formRoot;
    const input = q<HTMLInputElement>(fixture, 'input.cf-file');
    expect(adapter.uploadWidgets?.(root)).toEqual([{ control: q(fixture, '.cf-upload-button'), input }]);
    expect(field(scan(root, adapter, { platform: 'jobvite' }), 'Resume')).toMatchObject({ kind: 'file', proxy: 'adapter' });
    expect(adapter.uploadState?.(input, 'resume.pdf')).toBe('pending');
    show(fixture, '.cf-upload-busy');
    expect(adapter.uploadState?.(input, 'resume.pdf')).toBe('pending');
    show(fixture, '.cf-upload-busy', false);
    show(fixture, '.cf-upload-done');
    expect(adapter.uploadState?.(input, 'resume.pdf')).toBe('confirmed');
    show(fixture, '.cf-upload-error');
    expect(adapter.uploadState?.(input, 'resume.pdf')).toBe('failed');
    expect(adapter.uploadState?.(q<HTMLInputElement>(fixture, 'input[name="first"]'), 'x')).toBeNull();
  });

  it('reads the repeatable block, its Add, its Save and its "currently here" box, and keys its fields by block', async () => {
    const fixture = await open();
    const root = adapter.detect(fixture.doc)!.formRoot;
    const [experience] = adapter.repeatables?.(root) ?? [];
    expect(experience?.kind).toBe('experience');
    expect(experience?.blocks()).toEqual([q(fixture, '.cf-block')]);
    expect(experience?.addButton()).toBe(q(fixture, '.cf-add'));
    expect(experience?.save?.(q(fixture, '.cf-block'))).toBe(q(fixture, '.cf-block-save'));
    expect(experience?.currentlyHere?.(q(fixture, '.cf-block'))).toBe(q(fixture, '.cf-current'));
    expect(field(scan(root, adapter, { platform: 'jobvite' }), 'Job title').section).toEqual({ id: 'experience', block: 0 });
  });
});

describe('the configured adapter: steps, buttons, errors, busy and success', () => {
  it('reads the step, its Next and Submit, and which step is final', async () => {
    const fixture = await open();
    const root = adapter.detect(fixture.doc)!.formRoot;
    expect(adapter.stepSignature?.(fixture.doc)).toEqual({ heading: 'Your details', progress: 'Step 1 of 2',
      anchors: ['details'], urlPart: '' });
    expect(adapter.nextButton?.(root)).toBe(q(fixture, '.cf-next'));
    expect(adapter.submitButton?.(root)).toBe(q(fixture, '.cf-submit'));
    expect(adapter.isFinalStep?.(fixture.doc)).toBe('not-final');
    show(fixture, '.cf-submit');
    expect(adapter.isFinalStep?.(fixture.doc)).toBe('unknown');
    show(fixture, '.cf-next', false);
    show(fixture, '.cf-step[data-step="details"]', false);
    show(fixture, '.cf-step[data-step="review"]');
    q(fixture, '.cf-progress').textContent = 'Step 2 of 2';
    expect(adapter.isFinalStep?.(fixture.doc)).toBe('final');
    expect(adapter.stepSignature?.(fixture.doc)).toEqual({ heading: 'Review', progress: 'Step 2 of 2', anchors: ['review'],
      urlPart: '' });
    expect(adapter.nextButton?.(root)).toBeNull();
  });

  it('is final on a one-page form when Submit shows, and declares no step machine there', async () => {
    const fixture = await open();
    const { steps: _steps, states: _states, ...rest } = SYNTHETIC;
    const onePage = configuredAdapter(rest);
    expect(onePage.stepSignature).toBeUndefined();
    expect(onePage.nextButton).toBeUndefined();
    expect(onePage.isFinalStep?.(fixture.doc)).toBe('unknown');
    show(fixture, '.cf-submit');
    expect(onePage.isFinalStep?.(fixture.doc)).toBe('final');
  });

  it('names every never-pressed control document-wide, Back included, and the parts that hold no question', async () => {
    const fixture = await open();
    const root = adapter.detect(fixture.doc)!.formRoot;
    const never = adapter.neverPress?.(root) ?? [];
    for (const selector of ['.cf-later', '.cf-linkedin', '.cf-parse', '.cf-cookies', '.cf-decline', '.cf-back', '.cf-apply',
      '.cf-accept']) {
      expect(never, selector).toContain(q(fixture, selector));
    }
    expect(never).not.toContain(q(fixture, '.cf-next'));
    expect(never).not.toContain(q(fixture, '#cf-create'));
    expect(adapter.excluded?.(root)).toEqual([q(fixture, '.cf-parser')]);
  });

  it("reads the page's errors beside aria-invalid, and its busy sign", async () => {
    const fixture = await open();
    const root = adapter.detect(fixture.doc)!.formRoot;
    expect(adapter.errors?.(root).map((each) => each.el)).toEqual([q(fixture, 'main input[name="email"]'), q(fixture, '.cf-error')]);
    expect(adapter.isBusy?.(fixture.doc)).toBe(false);
    show(fixture, '.cf-saving');
    expect(adapter.isBusy?.(fixture.doc)).toBe(true);
  });

  it('gives content/submitted.ts its success sign through ATS_CONFIGS, under its own rules', async () => {
    const fixture = await open();
    const root = adapter.detect(fixture.doc)!.formRoot;
    // Hidden at load: no sign shows yet (the behaviour review, M1: signs a person cannot see are never armed).
    expect(configuredSuccessSigns(fixture.doc, SYNTHETIC)).toEqual([]);
    // Unregistered, the platform reads no sign: the rule is the config's.
    show(fixture, '.cf-thanks');
    expect(signsOf(fixture.doc, 'jobvite')).toEqual([]);
    ATS_CONFIGS.jobvite = SYNTHETIC;
    expect(signsOf(fixture.doc, 'jobvite')).toEqual([q(fixture, '.cf-thanks')]);
    show(fixture, '.cf-thanks', false);
    // Armed as the runtime arms a press (the behaviour review of 2026-11-06, M1): the signs shown at the press.
    const before = shownSignsOf(fixture.doc, 'jobvite');
    expect(before.size).toBe(0);
    // Shown while the form still shows: not this Submit's.
    show(fixture, '.cf-thanks');
    expect(newSuccessSign(fixture.doc, 'jobvite', { before, root, adapter })).toBeNull();
    show(fixture, 'main#cf-app', false);
    expect(newSuccessSign(fixture.doc, 'jobvite', { before, root, adapter })).toBe(q(fixture, '.cf-thanks'));
  });

  it('lets `code` win over every rule-built hook', async () => {
    const fixture = await open();
    const coded = configuredAdapter({ ...SYNTHETIC, code: { isFinalStep: () => 'final', labelFor: () => null } });
    expect(coded.isFinalStep?.(fixture.doc)).toBe('final');
    expect(coded.labelFor?.(q(fixture, 'input[name="first"]'))).toBeNull();
    expect(adapter.labelFor?.(q(fixture, 'input[name="first"]'))).toBe(q(fixture, '.cf-q .cf-q-title'));
  });

  // jr7 ENGINE-7 E0 (FIX7PLAN §3.1): the shared contract's new hooks have no rule; a configured platform declares them
  // in `code`, which passes each through as written, on the whole adapter and on the hooks a full adapter spreads.
  it('passes the jr7 hooks declared in `code` through as written, and declares none of them without it', async () => {
    const fixture = await open();
    const press = q(fixture, 'input[name="first"]');
    const code = {
      chainChildOrigins: () => ['https://acme.icims.com'],
      confirmationAfter: (armed: URL, here: URL) => armed.origin === here.origin,
      successSigns: () => [press],
      requiredBlocksLeft: () => [press],
      uploadPrompt: () => ({ press, kind: 'dismiss' as const }),
      editorOpener: () => [press],
      notCodeBox: () => true,
      identityHosts: [/^login\.example$/],
      handOver: () => 'assessment' as const,
      tailoritAddress: () => 'https://acme.icims.com/jobs/1/job',
    } satisfies Partial<ConfiguredHooks>;
    for (const built of [configuredAdapter({ ...SYNTHETIC, code }), configuredHooks({ ...SYNTHETIC, code })]) {
      for (const [name, hook] of Object.entries(code)) expect(built[name as keyof typeof code], name).toBe(hook);
    }
    for (const name of Object.keys(code)) expect(name in adapter, name).toBe(false);
  });
});
