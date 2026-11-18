/*
 * The side panel's "Your autofill information" editor (v3 Phase 3b, Profile.tsx), over the scripted worker: it reads
 * the profile with panel/profile and shows it; an edit saves with panel/saveProfile from the revision it read, the
 * sensitive part only when it was shared; the contract's save checks stop a save and say why, next to the field and
 * above Save; a connection without profile:write sees it read-only; a conflict offers Load the latest, which keeps the
 * person's edits on the latest; the note's flagged lines are named; Back closes it. The review of v3 Phase 3b: an email
 * that is the account's sign-in address stays '' ("follow the account"); countries are chosen from the ISO list; dates
 * are month pickers; an expected pay of 0 is said in a person's words.
 */
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_AUTOFILL_PROFILE, EMPTY_AUTOFILL_SENSITIVE, type AutofillProfile, type AutofillSensitive,
} from '../../contract/tailorit';
import type { ProfileView } from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { adoptPageStyles } from '../page/styles';
import { button, click, createFakeWorker, mount, settle, typeInto, unmountAll, type FakeWorker } from '../ui.testkit';
import { ProfileEditor } from './Profile';

const WORDS = COPY.profile;
const TAILORIT = 'http://localhost:3190/settings/autofill';

const PROFILE: AutofillProfile = {
  ...EMPTY_AUTOFILL_PROFILE,
  name: { ...EMPTY_AUTOFILL_PROFILE.name, first: 'Morgan', last: 'Lee' },
  contact: { ...EMPTY_AUTOFILL_PROFILE.contact, email: 'morgan@example.test',
    address: { ...EMPTY_AUTOFILL_PROFILE.contact.address, city: 'Austin', country: 'US' } },
  experience: [{ id: 'job1', company: 'Northwind', title: 'Engineer', location: { city: '', region: '', country: null },
    startDate: '2021-09', endDate: null, current: true, description: '' }],
  skills: ['TypeScript', 'PostgreSQL'],
  anythingElse: 'I prefer remote roles.\nI hold a work visa.\nI like small teams.\nMy salary is 150k.',
};

const SENSITIVE: AutofillSensitive = {
  ...EMPTY_AUTOFILL_SENSITIVE,
  workAuthorization: [{ country: 'US', authorized: { state: 'value', value: true },
    sponsorshipNow: { state: 'value', value: false }, sponsorshipFuture: { state: 'declined' },
    status: { state: 'value', value: 'citizen' } }],
};

function view(overrides: Partial<ProfileView> = {}): ProfileView {
  return { revision: 7, profile: PROFILE, flaggedLines: [], canWrite: true,
    sensitive: { state: 'shared', value: SENSITIVE }, ...overrides };
}

/** A worker that answers panel/profile with `answer`, and panel/saveProfile with `saved` (saved, revision 8, by
 *  default). */
function worker(answer: ProfileView | null = view(), saved: Record<string, unknown> = { outcome: 'saved', revision: 8,
  flaggedLines: [] }): FakeWorker {
  const fake = createFakeWorker();
  fake.on('panel/profile', () => (answer === null ? { ok: false, error: 'unavailable' } : { ok: true, data: answer }));
  fake.on('panel/saveProfile', () => ({ ok: true, data: saved }));
  return fake;
}

async function open(fake: FakeWorker, onClose: () => void = () => undefined): Promise<HTMLElement> {
  adoptPageStyles(document);
  const root = await mount(<ProfileEditor platform={fake.platform} onClose={onClose} tailoritUrl={TAILORIT} />);
  await settle();
  return root;
}

/** The control a visible or hidden label names, exactly (the first, where several share it). */
function control<T extends HTMLElement = HTMLInputElement>(root: ParentNode, label: string): T {
  const named = [...root.querySelectorAll('label')]
    .find((each) => each.textContent?.trim() === label && each.htmlFor !== '');
  const found = named === undefined ? null : document.getElementById(named.htmlFor);
  if (found === null) throw new Error(`no control labelled ${label}`);
  return found as T;
}

/** Chooses an option of a list as the person would. */
async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const saves = (fake: FakeWorker) => fake.sentOfType('panel/saveProfile');

afterEach(() => unmountAll());

describe('Your autofill information (v3 Phase 3b)', () => {
  it('reads the profile once and shows it, section by section', async () => {
    const fake = worker();
    const root = await open(fake);
    expect(fake.sentOfType('panel/profile')).toHaveLength(1);
    expect(root.querySelector('h2')?.textContent).toBe(WORDS.heading);
    expect(control(root, WORDS.fields.first).value).toBe('Morgan');
    // The account's own sign-in address (auth/status names it): shown empty, and named under the box.
    const email = control(root, WORDS.fields.email);
    expect(email.value).toBe('');
    expect(document.getElementById(email.getAttribute('aria-describedby')!)?.textContent)
      .toBe(WORDS.emailHelp('morgan@example.test'));
    expect(control<HTMLSelectElement>(root, WORDS.fields.country).value).toBe('US');
    expect(control(root, WORDS.fields.company).value).toBe('Northwind');
    expect(control(root, WORDS.fields.skills).value).toBe('TypeScript, PostgreSQL');
    expect(control<HTMLTextAreaElement>(root, WORDS.fields.anythingElse).value).toBe(PROFILE.anythingElse);
    expect([...root.querySelectorAll('[data-profile-section] h3')].map((heading) => heading.textContent)).toEqual([
      WORDS.sections.personal, WORDS.sections.links, WORDS.sections.education, WORDS.sections.experience,
      WORDS.sections.skills, WORDS.sections.certifications, WORDS.sections.preferences, COPY.documents.title,
      WORDS.sections.anythingElse, WORDS.sections.sensitive]);
    // The shared sensitive part: a yes, a no and a decline, as each answer's three states.
    expect(control<HTMLSelectElement>(root, WORDS.fields.authorized).value).toBe('yes');
    expect(control<HTMLSelectElement>(root, WORDS.fields.sponsorshipNow).value).toBe('no');
    expect(control<HTMLSelectElement>(root, WORDS.fields.sponsorshipFuture).value).toBe('declined');
    expect(control<HTMLSelectElement>(root, WORDS.fields.workStatus).value).toBe('v:citizen');
    // No value is put in an attribute: only inputs' own values hold it.
    const attributes = [...root.querySelectorAll('*')].flatMap((el) => [...el.attributes]
      .filter((attribute) => attribute.name !== 'value').map((attribute) => attribute.value));
    for (const text of ['Morgan', 'Northwind', 'Austin', 'morgan@example.test', '2021-09']) {
      expect(attributes.some((value) => value.includes(text))).toBe(false);
    }
    expect(root.querySelector<HTMLAnchorElement>('a[data-tailorit-link="autofill"]')?.href).toBe(TAILORIT);
  });

  it('saves an edit with the revision it read, the profile and the shared sensitive part, then Saved', async () => {
    const fake = worker();
    const root = await open(fake);
    const save = () => button(root, WORDS.save)!;
    expect(save().disabled).toBe(true);
    await typeInto(control(root, WORDS.fields.first), 'Morgana');
    // A comma typed stays as typed; the skills go as a list.
    await typeInto(control(root, WORDS.fields.skills), 'TypeScript, Go, ');
    expect(control(root, WORDS.fields.skills).value).toBe('TypeScript, Go, ');
    await choose(control<HTMLSelectElement>(root, WORDS.fields.sponsorshipFuture), 'yes');
    expect(save().disabled).toBe(false);
    await click(save());
    expect(saves(fake)).toHaveLength(1);
    const body = saves(fake)[0]!;
    expect(body.revision).toBe(7);
    const profile = body.profile as AutofillProfile;
    expect(profile.name.first).toBe('Morgana');
    expect(profile.skills).toEqual(['TypeScript', 'Go']);
    expect(profile.experience[0]!.company).toBe('Northwind');
    expect((body.sensitive as AutofillSensitive).workAuthorization[0]!.sponsorshipFuture).toEqual({ state: 'value',
      value: true });
    expect(root.querySelector('[data-profile-outcome="saved"]')?.textContent).toBe(WORDS.saved);
    expect(save().disabled).toBe(true);
    // The next save names the revision TailorIT answered.
    await typeInto(control(root, WORDS.fields.last), 'Leigh');
    await click(save());
    expect(saves(fake)[1]!.revision).toBe(8);
  });

  // s2 profile (snapshot round 2, 2026-11-07): TailorIT's new profile values, edited here too (decision 16).
  it('edits the values snapshot round 2 added: a handle saved as its link, the phone type, places, a certification and the new sensitive answers', async () => {
    const fake = worker();
    const root = await open(fake);
    await typeInto(control(root, WORDS.fields.x), '@morgan_lee');
    await typeInto(control(root, WORDS.fields.telegram), 't.me/morgan_lee');
    await choose(control<HTMLSelectElement>(root, WORDS.fields.phoneType), 'work');
    await choose(control<HTMLSelectElement>(root, WORDS.fields.referralSourceCategory), 'event');
    // Two places, one left empty: the empty one is not sent.
    await click(button(root, WORDS.add.place)!);
    await click(button(root, WORDS.add.place)!);
    await typeInto(control(root, `${WORDS.fields.place} 1`), 'Denver, CO');
    await click(button(root, WORDS.add.certification)!);
    await typeInto(control(root, WORDS.fields.name), 'Certified Kubernetes Administrator');
    await typeInto(control(root, WORDS.fields.year), '2024');
    // The sensitive part: a clearance, a citizenship, a relative nowhere, transgender declined.
    await choose(control<HTMLSelectElement>(root, WORDS.fields.clearance), 'value');
    await choose(control<HTMLSelectElement>(root, WORDS.fields.clearanceLevel), 'ts-sci');
    await choose(control<HTMLSelectElement>(root, WORDS.fields.clearanceActive), 'yes');
    await choose(control<HTMLSelectElement>(root, WORDS.fields.citizenships), 'value');
    await choose(control<HTMLSelectElement>(root, WORDS.citizenship(1)), 'CA');
    await choose(control<HTMLSelectElement>(root, WORDS.fields.relativesAt), 'value');
    await choose(control<HTMLSelectElement>(root, WORDS.fields.transgender), 'declined');
    await choose(control<HTMLSelectElement>(root, WORDS.fields.restrictiveAgreement), 'no');
    // The Asian subgroups show beside Asian alone.
    const box = (words: string) => [...root.querySelectorAll<HTMLLabelElement>('label.tia-profile__check')]
      .find((label) => label.textContent === words)?.querySelector('input') ?? null;
    await choose(control<HTMLSelectElement>(root, WORDS.fields.races), 'value');
    expect(box(WORDS.asianSubgroups['east-asian'])).toBeNull();
    await click(box(WORDS.races.asian)!);
    await click(box(WORDS.asianSubgroups['east-asian'])!);
    await click(button(root, WORDS.save)!);
    expect(root.querySelector('[data-profile-problems]')).toBeNull();
    expect(saves(fake)).toHaveLength(1);
    const body = saves(fake)[0]!;
    const profile = body.profile as AutofillProfile;
    expect(profile.links).toMatchObject({ x: 'https://x.com/morgan_lee', telegram: 'https://t.me/morgan_lee' });
    expect(profile.contact.phone.type).toBe('work');
    expect(profile.preferences).toMatchObject({ referralSourceCategory: 'event', relocationPlaces: ['Denver, CO'] });
    expect(profile.certifications).toEqual([{ name: 'Certified Kubernetes Administrator', issuer: '', year: 2024 }]);
    const sensitive = body.sensitive as AutofillSensitive;
    expect(sensitive.legal).toMatchObject({
      clearance: { state: 'value', value: { level: 'ts-sci', active: true, polygraph: null } },
      citizenships: { state: 'value', value: ['CA'] },
      relativesAt: { state: 'value', value: [] },
      restrictiveAgreement: { state: 'value', value: false },
    });
    expect(sensitive.eeo).toMatchObject({ transgender: { state: 'declined' }, races: { state: 'value', value: ['asian'] },
      raceSubgroups: ['east-asian'] });
    // Asian unticked: its subgroups go with it.
    await click(box(WORDS.races.asian)!);
    expect(box(WORDS.asianSubgroups['east-asian'])).toBeNull();
  });

  it('never sends the sensitive part it could not read, and says so', async () => {
    const fake = worker(view({ sensitive: { state: 'not-shared' } }));
    const root = await open(fake);
    expect(root.querySelector('[data-profile-sensitive="not-shared"]')?.textContent).toBe(WORDS.sensitiveNotShared);
    expect(root.querySelector('[data-profile-section="sensitive"] select')).toBeNull();
    await typeInto(control(root, WORDS.fields.first), 'Sam');
    await click(button(root, WORDS.save));
    expect(saves(fake)).toHaveLength(1);
    expect('sensitive' in saves(fake)[0]!).toBe(false);
  });

  it('checks a save as TailorIT does: nothing sent, each problem said by its field and above Save', async () => {
    const fake = worker();
    const root = await open(fake);
    await typeInto(control(root, WORDS.fields.last), '');
    await typeInto(control(root, WORDS.fields.email), 'not an email');
    await click(button(root, WORDS.save));
    expect(saves(fake)).toHaveLength(0);
    const problems = root.querySelector('[data-profile-problems]');
    expect(problems?.getAttribute('role')).toBe('alert');
    expect(problems?.textContent).toContain(`${WORDS.fields.last}: Required`);
    expect(problems?.textContent).toContain(WORDS.fields.email);
    const last = control(root, WORDS.fields.last);
    expect(last.getAttribute('aria-invalid')).toBe('true');
    const said = document.getElementById(last.getAttribute('aria-describedby')!);
    expect(said?.textContent).toBe('Required');
    // Fixed, the problems go as the person types, and the save goes out.
    await typeInto(last, 'Leigh');
    await typeInto(control(root, WORDS.fields.email), 'morgan.leigh@example.test');
    expect(root.querySelector('[data-profile-problems]')).toBeNull();
    await click(button(root, WORDS.save));
    expect(saves(fake)).toHaveLength(1);
  });

  it('adds and removes entries, each with its own id', async () => {
    const fake = worker();
    const root = await open(fake);
    await click(root.querySelector('[data-profile-add="education"]'));
    await typeInto(control(root, WORDS.fields.school), 'University of Texas at Austin');
    await click(root.querySelector('[data-profile-add="experience"]'));
    expect(root.querySelectorAll('[data-profile-section="experience"] fieldset')).toHaveLength(2);
    await click(root.querySelector(`button[aria-label="${WORDS.remove(WORDS.entry.experience(2))}"]`));
    await typeInto(control(root, WORDS.fields.first), 'Morgan A');
    await click(button(root, WORDS.save));
    const profile = saves(fake)[0]!.profile as AutofillProfile;
    expect(profile.education).toHaveLength(1);
    expect(profile.education[0]!.institution.canonicalName).toBe('University of Texas at Austin');
    expect(profile.education[0]!.id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
    expect(profile.experience.map((entry) => entry.id)).toEqual(['job1']);
  });

  it('is read-only for a connection that may not change it, and says how to edit it', async () => {
    const fake = worker(view({ canWrite: false }));
    const root = await open(fake);
    expect(root.querySelector('[data-profile-read-only]')?.textContent).toBe(WORDS.readOnly);
    // Every control sits in a disabled fieldset: none can be used or focused.
    expect(control(root, WORDS.fields.first).matches(':disabled')).toBe(true);
    expect(control<HTMLSelectElement>(root, WORDS.fields.authorized).matches(':disabled')).toBe(true);
    expect(root.querySelector('[data-profile-add="education"]')?.matches(':disabled')).toBe(true);
    expect(button(root, WORDS.back)?.matches(':disabled')).toBe(false);
    expect(button(root, WORDS.save)).toBeNull();
    expect(root.querySelector('a[data-tailorit-link="autofill"]')?.textContent).toBe(WORDS.openInTailorit);
  });

  it('offers Load the latest after a conflict, and keeps the person’s edits on the latest', async () => {
    const fake = worker(view(), { outcome: 'conflict' });
    const root = await open(fake);
    await typeInto(control(root, WORDS.fields.first), 'Morgana');
    await choose(control<HTMLSelectElement>(root, WORDS.fields.sponsorshipFuture), 'yes');
    await click(button(root, WORDS.save));
    const prompt = root.querySelector('[data-profile-outcome="conflict"]');
    expect(prompt?.textContent).toContain(WORDS.conflict);
    expect(control(root, WORDS.fields.first).value).toBe('Morgana');
    expect(fake.sentOfType('panel/profile')).toHaveLength(1);
    // Elsewhere, the last name and the city changed (revision 9); the person changed the first name and an answer.
    const latest = { ...PROFILE, name: { ...PROFILE.name, last: 'Leigh' },
      contact: { ...PROFILE.contact, address: { ...PROFILE.contact.address, city: 'Dallas' } } };
    fake.on('panel/profile', () => ({ ok: true, data: view({ revision: 9, profile: latest }) }));
    fake.on('panel/saveProfile', () => ({ ok: true, data: { outcome: 'saved', revision: 10, flaggedLines: [] } }));
    await click(button(root, WORDS.loadLatest));
    expect(fake.sentOfType('panel/profile')).toHaveLength(2);
    // Theirs and the latest, together: nothing of either lost.
    expect(control(root, WORDS.fields.first).value).toBe('Morgana');
    expect(control(root, WORDS.fields.last).value).toBe('Leigh');
    expect(control(root, WORDS.fields.city).value).toBe('Dallas');
    expect(control<HTMLSelectElement>(root, WORDS.fields.sponsorshipFuture).value).toBe('yes');
    expect(root.querySelector('[data-profile-merged]')?.textContent).toContain(WORDS.merged);
    expect(root.querySelector('[data-profile-merged-both]')).toBeNull();
    expect(root.querySelector('[data-profile-outcome]')).toBeNull();
    // The save goes from the latest revision, with both.
    await click(button(root, WORDS.save));
    const body = saves(fake).at(-1)!;
    expect(body.revision).toBe(9);
    expect((body.profile as AutofillProfile).name).toMatchObject({ first: 'Morgana', last: 'Leigh' });
    expect((body.sensitive as AutofillSensitive).workAuthorization[0]!.sponsorshipFuture).toEqual({ state: 'value',
      value: true });
  });

  it('names a field changed both here and elsewhere, keeping the person’s version for them to check', async () => {
    const fake = worker(view(), { outcome: 'conflict' });
    const root = await open(fake);
    await typeInto(control(root, WORDS.fields.first), 'Morgana');
    await click(button(root, WORDS.save));
    fake.on('panel/profile', () => ({ ok: true, data: view({ revision: 9,
      profile: { ...PROFILE, name: { ...PROFILE.name, first: 'Mo' } } }) }));
    await click(button(root, WORDS.loadLatest));
    expect(control(root, WORDS.fields.first).value).toBe('Morgana');
    expect(root.querySelector('[data-profile-merged-both]')?.textContent)
      .toBe(WORDS.mergedBoth(WORDS.fields.first));
  });

  it('keeps an email that follows the account as \'\', and saves a typed one as typed', async () => {
    const fake = worker();
    const root = await open(fake);
    await typeInto(control(root, WORDS.fields.first), 'Morgana');
    await click(button(root, WORDS.save));
    expect((saves(fake)[0]!.profile as AutofillProfile).contact.email).toBe('');
    await typeInto(control(root, WORDS.fields.email), 'morgan.lee@work.example');
    await click(button(root, WORDS.save));
    expect((saves(fake)[1]!.profile as AutofillProfile).contact.email).toBe('morgan.lee@work.example');
    // Another address than the account's is shown, and saved, as it is.
    const own = worker(view({ profile: { ...PROFILE, contact: { ...PROFILE.contact, email: 'me@elsewhere.example' } } }));
    const ownRoot = await open(own);
    expect(control(ownRoot, WORDS.fields.email).value).toBe('me@elsewhere.example');
    await typeInto(control(ownRoot, WORDS.fields.first), 'Mo');
    await click(button(ownRoot, WORDS.save));
    expect((saves(own)[0]!.profile as AutofillProfile).contact.email).toBe('me@elsewhere.example');
  });

  it('chooses countries from the ISO list, and dates from month pickers', async () => {
    const fake = worker();
    const root = await open(fake);
    const country = control<HTMLSelectElement>(root, WORDS.fields.country);
    expect(country.tagName).toBe('SELECT');
    expect([...country.options].some((option) => option.value === 'GB')).toBe(true);
    expect([...country.options].every((option) => option.value === '' || /^[A-Z]{2}$/.test(option.value))).toBe(true);
    await choose(country, 'GB');
    const start = control(root, WORDS.fields.startDate);
    expect(start.type).toBe('month');
    expect(start.value).toBe('2021-09');
    await typeInto(start, '2020-03');
    await click(button(root, WORDS.save));
    const profile = saves(fake)[0]!.profile as AutofillProfile;
    expect(profile.contact.address.country).toBe('GB');
    expect(profile.experience[0]!.startDate).toBe('2020-03');
    // A year alone is kept, and said under the picker.
    const yearly = worker(view({ profile: { ...PROFILE, experience: [{ ...PROFILE.experience[0]!, startDate: '2019' }] } }));
    const yearRoot = await open(yearly);
    expect(yearRoot.textContent).toContain(WORDS.yearOnly('2019'));
    await typeInto(control(yearRoot, WORDS.fields.first), 'Mo');
    await click(button(yearRoot, WORDS.save));
    expect((saves(yearly)[0]!.profile as AutofillProfile).experience[0]!.startDate).toBe('2019');
  });

  it('says an expected pay of 0 in a person’s words', async () => {
    const fake = worker();
    const root = await open(fake);
    await choose(control<HTMLSelectElement>(root, WORDS.fields.expectedSalary), 'value');
    expect(control(root, WORDS.fields.salaryMin).value).toBe('');
    await click(button(root, WORDS.save));
    expect(saves(fake)).toHaveLength(0);
    expect(root.querySelector('[data-profile-problems]')?.textContent).toContain(WORDS.salaryAboveZero.min);
    await typeInto(control(root, WORDS.fields.salaryMin), '120000');
    await click(button(root, WORDS.save));
    expect(saves(fake)).toHaveLength(1);
  });

  it('says why another refusal kept the save', async () => {
    const fake = worker(view(), { outcome: 'not-allowed' });
    const root = await open(fake);
    await typeInto(control(root, WORDS.fields.first), 'Morgana');
    await click(button(root, WORDS.save));
    expect(root.querySelector('[data-profile-outcome="not-allowed"]')?.textContent).toBe(WORDS.outcomes['not-allowed']);
  });

  it("names the note's lines TailorIT keeps from the AI", async () => {
    const root = await open(worker(view({ flaggedLines: [1, 3] })));
    const flagged = root.querySelector('[data-profile-flagged]');
    expect(flagged?.textContent).toBe(WORDS.flagged([1, 3]));
    expect(flagged?.textContent).toContain('Lines 2 and 4');
    expect((await open(worker())).querySelector('[data-profile-flagged]')).toBeNull();
  });

  it('says why it could not read the profile, and Try again reads it again', async () => {
    const fake = worker(null);
    const root = await open(fake);
    expect(root.querySelector('.tia-feedback')?.textContent).toBe(WORDS.loadFailed.unavailable);
    fake.on('panel/profile', () => ({ ok: true, data: view() }));
    await click(button(root, WORDS.retry));
    expect(fake.sentOfType('panel/profile')).toHaveLength(2);
    expect(control(root, WORDS.fields.first).value).toBe('Morgan');
  });

  it('Back closes it', async () => {
    const onClose = vi.fn();
    const root = await open(worker(), onClose);
    await click(button(root, WORDS.back));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // v3.2 EXT (E5, the owner: "all description should be ?tooltip"): a list's explanation is the "?" beside its legend,
  // still describing the group, which the legend's words alone name; Load the latest's is a "?" beside the conflict.
  it('puts a list’s explanation in a "?" beside its legend, and Load the latest’s in a "?" (v3.2 EXT)', async () => {
    const fake = worker(view(), { outcome: 'conflict' });
    const root = await open(fake);
    const group = [...root.querySelectorAll<HTMLFieldSetElement>('fieldset')]
      .find((each) => each.querySelector(':scope > legend span')?.textContent === WORDS.fields.relocationPlaces)!;
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe(WORDS.fields.relocationPlaces);
    const tip = group.querySelector(':scope > legend [role="tooltip"]')!;
    expect(tip.textContent).toBe(WORDS.relocationHelp);
    expect(group.getAttribute('aria-describedby')?.split(' ')).toContain(tip.id);
    expect(group.querySelector(':scope > legend .tia-helptip__button')?.getAttribute('aria-label'))
      .toBe(COPY.help.about(WORDS.fields.relocationPlaces));
    expect(root.querySelectorAll('.tia-help:not([role="status"])')).toHaveLength(0);
    await typeInto(control(root, WORDS.fields.first), 'Morgana');
    await click(button(root, WORDS.save));
    const prompt = root.querySelector('[data-profile-outcome="conflict"]')!;
    expect(prompt.querySelector('[role="tooltip"]')?.textContent).toBe(WORDS.conflictHelp);
    // Named after the line, so Load The Latest stays the one button of that name.
    expect(prompt.querySelector('.tia-helptip__button')?.getAttribute('aria-label')).toBe(COPY.help.about(WORDS.conflict));
    expect([...prompt.querySelectorAll('button')].filter((each) => (each.getAttribute('aria-label') ?? each.textContent)
      ?.includes(WORDS.loadLatest))).toHaveLength(1);
    expect(prompt.querySelector('.tia-help')).toBeNull();
  });
});
