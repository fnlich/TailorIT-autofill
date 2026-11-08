/*
 * "Your autofill information" in the side panel (v3 Phase 3b; Jobright's Autofill Information, in TailorIT's look):
 * the person views and edits the autofill profile TailorIT keeps, without leaving the application. The side panel
 * shows it in place of its main content; Back returns there.
 *
 * - Reading: panel/profile, answered by the worker from TailorIT (GET /profile, and the sensitive part only where the
 *   connection may read it). A refusal says why, with Try again.
 * - Sections, top to bottom: Personal (name, email, phone, address), Links, Education and Work experience (entries
 *   added and removed), Skills (one line, separated by commas), Preferences, "Anything else we should know?" (the note
 *   TailorIT's AI reads; the lines TailorIT keeps from it, `flaggedLines`, are named under it), and, only where the
 *   connection may read it, Work authorization and self-identification, each answer one of Not provided, Prefer not to
 *   say, or the answer itself (the contract's `sensitive()`).
 * - Saving: checked first with the contract's own save schemas (AutofillProfileSaveSchema,
 *   AutofillSensitiveSaveSchema), each problem said next to its field and listed above Save (an expected pay of 0 in
 *   words a person reads, not the schema's); nothing is sent until they pass. panel/saveProfile carries the revision the
 *   editor loaded, the profile, and the sensitive part only where it was read. Saved: the new revision and flagged lines
 *   are kept. A conflict (it changed elsewhere since) offers Load the latest, which reads it again and keeps the
 *   person's edits on it (the review of v3 Phase 3b): each value, list or sensitive answer they changed since they
 *   loaded it is put on the latest; one changed elsewhere too keeps theirs, and the editor names it before they save.
 *   Edits to the sensitive part the connection may no longer read cannot be kept, and the editor says so. Every other
 *   refusal is said.
 * - The email: TailorIT keeps '' for "the account's sign-in address", and GET answers it with that address filled in.
 *   The editor shows such an email empty, says which address it stands for (the account's, from auth/status), and saves
 *   '' again, so it keeps following the account; a typed address is saved as typed.
 * - Countries are chosen from the ISO 3166-1 list (CLDR English names, the bundled vocabulary's), and an entry's dates
 *   from month pickers (YYYY-MM; a year alone, as TailorIT may hold one, is kept until the person picks a month).
 * - A connection without profile:write (one made before API version 3) shows everything read-only and says to
 *   connect again. "Open in TailorIT" (TailorIT's Settings › Autofill) is always at the foot.
 * - Snapshot round 2 (2026-11-07, TailorIT's contract of the same day, the owner: "you can add them on autofill profile
 *   data"): the phone's type, X and Telegram (a handle typed is saved as its link), the kind of "How did you hear"
 *   answer, the places the person would relocate to or work from, Certifications; and in the sensitive part the Asian
 *   subgroups (beside Asian), race and sexual orientation in the person's words, active duty, transgender, and the
 *   screening answers (a non-compete, U.S. military or government service, relatives at a company, essential
 *   functions, a security clearance, citizenships). An empty place, company or certification is left out of a save.
 *
 * The person's own data, shown to them alone: held in this component's state while it is open, never stored, logged
 * or put in an attribute. It talks to the worker through messaging only.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  ASIAN_SUBGROUPS, AutofillProfileSaveSchema, AutofillSensitiveSaveSchema, AUTOFILL_ANYTHING_ELSE_MAX, CLEARANCE_LEVELS,
  DEGREE_LEVELS, EXPECTED_SALARY_PERIODS, GENDER_IDENTITIES, PHONE_DEVICE_TYPES, POLYGRAPH_KINDS, RACE_CATEGORIES,
  REFERRAL_CATEGORIES, SEXUAL_ORIENTATIONS, WORK_ARRANGEMENTS, WORK_STATUSES, type AutofillCertification,
  type AutofillEducation, type AutofillExperience, type AutofillProfile, type AutofillSensitive, type SensitiveAnswer,
} from '../../contract/tailorit';
import type { ErrorCode } from '../../messaging/envelope';
import type { PanelSaveProfileAnswer, ProfileView } from '../../messaging/schemas';
import type { PagePlatform } from '../../platform/types';
import countriesJson from '../../core/vocab/data/countries.json?raw';
import { COPY } from '../../shared/copy';
import { Icon } from '../brand/Icon';
import { HelpTip } from '../page/HelpTip';
import { request } from '../page/request';
import { InSidePanel, useOnPage } from './on-page';

const WORDS = COPY.profile;
const FIELDS = WORDS.fields;

/** The lists' choices, as their selects and boxes draw them. */
const DEGREE_CHOICES = DEGREE_LEVELS.map((level) => [level, WORDS.degreeLevels[level]] as const);
const RELOCATE_CHOICES = [['', WORDS.choices.unset], ['yes', WORDS.choices.yes], ['no', WORDS.choices.no]] as const;
const ARRANGEMENT_CHOICES = WORK_ARRANGEMENTS.map((arrangement) =>
  [arrangement, WORDS.arrangements[arrangement]] as const);
// s2 profile (snapshot round 2): the new lists' choices, "Not set" first where none may be chosen.
const PHONE_TYPE_CHOICES = [['', WORDS.choices.unset],
  ...PHONE_DEVICE_TYPES.map((type) => [type, WORDS.phoneTypes[type]] as const)] as const;
const REFERRAL_CATEGORY_CHOICES = [['', WORDS.choices.unset],
  ...REFERRAL_CATEGORIES.map((category) => [category, WORDS.referralCategories[category]] as const)] as const;

/** What an empty date or choice is stored as: none. */
const noneIfEmpty = (value: string) => (value === '' ? null : value);

let countryChoices: ReadonlyArray<readonly [string, string]> | null = null;
/** The ISO 3166-1 countries by alpha-2 code, each with its CLDR English name, sorted by name (read once). */
function countries(): ReadonlyArray<readonly [string, string]> {
  if (countryChoices === null) {
    const raw = JSON.parse(countriesJson) as { countries: Array<{ a2: string; s: Array<[string, ...unknown[]]> }> };
    countryChoices = raw.countries.map((entry) => [entry.a2, entry.s[0]?.[0] ?? entry.a2] as const)
      .sort((a, b) => a[1].localeCompare(b[1], 'en'));
  }
  return countryChoices;
}

export interface ProfileEditorProps {
  platform: PagePlatform;
  /** Back: the side panel shows its main content again. */
  onClose(): void;
  /** TailorIT's Settings › Autofill, for "Open in TailorIT". */
  tailoritUrl: string;
  /** v4 ui: TailorIT kept a save (the side panel checks again whether the profile is complete). */
  onSaved?(): void;
}

/** A path into the profile or the sensitive part, as zod's issues name it. */
type Path = ReadonlyArray<string | number>;

/** What the editor holds once read: the worker's view, and the person's edits (the skills as typed). */
interface Draft {
  profile: AutofillProfile;
  sensitive: AutofillSensitive | null;
  skills: string;
}

/** `original`: the draft as read (or as last saved), for Load the latest's merge; `accountEmail`: the account's sign-in
 *  address an empty email stands for (null: not known). */
type Loaded = { view: ProfileView; draft: Draft; base: string; original: Draft; accountEmail: string | null };
type State = { kind: 'loading' } | { kind: 'failed'; error: ErrorCode } | ({ kind: 'ready' } & Loaded);

/** What the last save said: saving, saved, or a refusal. */
type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'merging' }
  | { kind: 'refused'; outcome: Exclude<PanelSaveProfileAnswer['outcome'], 'saved'> };

/** What Load the latest kept: the fields changed elsewhere too (the person's version kept), and whether the person's
 *  edits to the sensitive part could not be kept. */
type Merged = { both: string[]; sensitiveDropped: boolean };

/** The skills as one line. */
const skillsText = (skills: readonly string[]) => skills.join(', ');

/** The skills a line names: split at commas, trimmed, empty ones dropped. */
const skillsOf = (text: string) => text.split(',').map((skill) => skill.trim()).filter((skill) => skill !== '');

/**
 * s2 profile: a social profile as its link: a handle ("@elena_r" or "elena_r") becomes the site's address for it, and
 * an address typed without its scheme ("x.com/elena_r") gets https://; anything else is left as typed, for the save's
 * check to name (TailorIT's Settings page does the same).
 */
function socialLink(text: string, site: { host: string; hosts: RegExp; handle: RegExp }): string {
  const typed = text.trim();
  const handle = /^@?([A-Za-z0-9_]+)$/.exec(typed)?.[1];
  if (handle !== undefined && site.handle.test(handle)) return `https://${site.host}/${handle}`;
  if (site.hosts.test(typed)) return `https://${typed}`;
  return text;
}

const X_SITE = { host: 'x.com', hosts: /^(?:www\.)?(?:x|twitter)\.com\/\S+$/i, handle: /^[A-Za-z0-9_]{1,15}$/ };
const TELEGRAM_SITE = { host: 't.me', hosts: /^(?:t\.me|telegram\.me)\/\S+$/i, handle: /^[A-Za-z0-9_]{5,32}$/ };

/** s2 profile: a certification never filled in (no name, issuer or year). */
const blankCertification = (entry: AutofillCertification) => entry.name.trim() === '' && entry.issuer.trim() === ''
  && entry.year === null;

/** The profile to save: the skills from their line; s2 profile: X and Telegram as links, the empty places and
 *  certifications left out. */
const profileOf = (draft: Draft): AutofillProfile => {
  const { links, preferences, certifications } = draft.profile;
  return { ...draft.profile, skills: skillsOf(draft.skills),
    links: { ...links, x: socialLink(links.x, X_SITE), telegram: socialLink(links.telegram, TELEGRAM_SITE) },
    preferences: { ...preferences, relocationPlaces: preferences.relocationPlaces.map((place) => place.trim())
      .filter((place) => place !== '') },
    certifications: certifications.filter((entry) => !blankCertification(entry)) };
};

/** s2 profile: the sensitive part to save: the empty companies left out, the Asian subgroups only beside Asian. */
const sensitiveOf = (draft: Draft): AutofillSensitive | null => {
  const sensitive = draft.sensitive;
  if (sensitive === null) return null;
  const { races, raceSubgroups } = sensitive.eeo;
  const relatives = sensitive.legal.relativesAt;
  return { ...sensitive,
    eeo: { ...sensitive.eeo,
      raceSubgroups: races.state === 'value' && races.value.includes('asian') ? raceSubgroups : [] },
    legal: { ...sensitive.legal, relativesAt: relatives.state !== 'value' ? relatives
      : { state: 'value', value: relatives.value.map((company) => company.trim()).filter((company) => company !== '') } } };
};

/** What a save would send, to tell whether anything changed. */
const fingerprint = (draft: Draft) => JSON.stringify([profileOf(draft), sensitiveOf(draft)]);

/** `target` with the value at `path` replaced; every object and array on the way copied, nothing else touched. */
function setIn<T>(target: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path;
  const node = target as unknown as Record<string | number, unknown>;
  const copy = (Array.isArray(target) ? [...target] : { ...node }) as Record<string | number, unknown>;
  copy[head!] = setIn(node[head!], rest, value);
  return copy as T;
}

/** The value at `path`, or undefined. */
function getIn(target: unknown, path: Path): unknown {
  let node = target;
  for (const key of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}

/** The places an edit replaces whole, under `value`: each plain value, each list, each sensitive answer (an object with
 *  a `state`), by path. */
function unitsOf(value: unknown, path: Path = []): Path[] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && !('state' in value)) {
    return Object.entries(value).flatMap(([key, item]) => unitsOf(item, [...path, key]));
  }
  return [path];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The person's edits since `original` put on `latest` (Load the latest): each unit they changed takes their value; one
 *  changed elsewhere too keeps theirs and is named. */
function mergeDraft(original: Draft, mine: Draft, latest: Draft): { draft: Draft } & Merged {
  const both: string[] = [];
  const carry = <T,>(was: T, now: T, onto: T, label: (path: Path) => string): T => {
    let merged = onto;
    for (const path of unitsOf(now)) {
      const before = getIn(was, path);
      const after = getIn(now, path);
      if (same(before, after)) continue;
      const theirs = getIn(onto, path);
      if (!same(before, theirs) && !same(theirs, after)) both.push(label(path));
      merged = setIn(merged, path, after);
    }
    return merged;
  };
  const profile = carry(original.profile, mine.profile, latest.profile, labelOf);
  let skills = latest.skills;
  if (mine.skills !== original.skills) {
    if (latest.skills !== original.skills && latest.skills !== mine.skills) both.push(FIELDS.skills);
    skills = mine.skills;
  }
  let sensitive = latest.sensitive;
  let sensitiveDropped = false;
  if (original.sensitive !== null && mine.sensitive !== null && !same(original.sensitive, mine.sensitive)) {
    if (latest.sensitive === null) sensitiveDropped = true;
    else sensitive = carry(original.sensitive, mine.sensitive, latest.sensitive, labelOf);
  }
  return { draft: { profile, skills, sensitive }, both: [...new Set(both)], sensitiveDropped };
}

/** An entry id TailorIT takes (letters, digits, hyphens and underscores, at most 40): 32 hex digits. */
const newId = () => globalThis.crypto.randomUUID().replace(/-/g, '');

const nowhere = () => ({ city: '', region: '', country: null });

const newEducation = (): AutofillEducation => ({
  id: newId(), institution: { canonicalName: '', aliases: [] }, degree: { level: 'bachelor', type: '', field: '' },
  minor: '', startDate: null, endDate: null, current: false, gpa: null, location: nowhere(),
});

const newExperience = (): AutofillExperience => ({
  id: newId(), company: '', title: '', location: nowhere(), startDate: null, endDate: null, current: false,
  description: '',
});

const newAuthorization = (): AutofillSensitive['workAuthorization'][number] => ({
  country: '', authorized: { state: 'not_provided' }, sponsorshipNow: { state: 'not_provided' },
  sponsorshipFuture: { state: 'not_provided' }, status: { state: 'not_provided' },
});

/** The words of a path, for the list of problems above Save ("Education 1 · End"). */
function labelOf(path: Path): string {
  const [root, second, third, fourth] = path;
  const field = (key: string | number | undefined): string => (typeof key === 'string' && key in FIELDS
    ? FIELDS[key as keyof typeof FIELDS] : String(key ?? ''));
  if (root === 'name' || root === 'links') return field(second);
  if (root === 'contact') {
    if (second === 'email') return FIELDS.email;
    if (second === 'phone') return third === 'number' ? FIELDS.phone : third === 'country' ? FIELDS.phoneCountry
      : third === 'type' ? FIELDS.phoneType : FIELDS.phoneExtension;
    return field(third);
  }
  if (root === 'education' && typeof second === 'number') {
    const degree = fourth === 'level' ? FIELDS.degreeLevel
      : fourth === 'field' ? FIELDS.fieldOfStudy : FIELDS.degreeType;
    const which = third === 'institution' ? FIELDS.school : third === 'degree' ? degree : field(third);
    return `${WORDS.entry.education(second + 1)} · ${which}`;
  }
  if (root === 'experience' && typeof second === 'number') {
    return `${WORDS.entry.experience(second + 1)} · ${field(third)}`;
  }
  if (root === 'skills') return FIELDS.skills;
  if (root === 'certifications' && typeof second === 'number') {
    return `${WORDS.entry.certification(second + 1)} · ${field(third)}`;
  }
  if (root === 'preferences') return field(second);
  if (root === 'anythingElse') return FIELDS.anythingElse;
  if (root === 'workAuthorization' && typeof second === 'number') {
    const which = third === 'status' ? FIELDS.workStatus : field(third);
    return `${WORDS.entry.workAuthorization(second + 1)} · ${which}`;
  }
  if (root === 'eeo' || root === 'legal') return field(second);
  if (root === 'compensation') return FIELDS.expectedSalary;
  return path.join('.');
}

/** The problems a save would meet, by path ('sensitive.' before the sensitive part's), checked as TailorIT checks. */
function problemsOf(draft: Draft): Map<string, { label: string; message: string }> {
  const found = new Map<string, { label: string; message: string }>();
  const parsed = AutofillProfileSaveSchema.safeParse(profileOf(draft));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path as Path;
      const key = path.join('.');
      if (!found.has(key)) found.set(key, { label: labelOf(path), message: issue.message });
    }
  }
  const sensitive = sensitiveOf(draft);
  if (sensitive !== null) {
    const checked = AutofillSensitiveSaveSchema.safeParse(sensitive);
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        const path = issue.path as Path;
        const key = `sensitive.${path.join('.')}`;
        if (!found.has(key)) found.set(key, { label: labelOf(path), message: salaryMessage(path, issue.code) ?? issue.message });
      }
    }
  }
  return found;
}

/** An expected pay of 0 or less, said in a person's words rather than the schema's. */
function salaryMessage(path: Path, code: string): string | undefined {
  if (code !== 'too_small' || path[0] !== 'compensation' || path[2] !== 'value') return undefined;
  if (path[3] === 'min') return WORDS.salaryAboveZero.min;
  if (path[3] === 'max') return WORDS.salaryAboveZero.max;
  return undefined;
}

/** panel/profile, as the editor's state: the profile and the person's draft of it (none yet), or why it could not be
 *  read. v5 p1-shell (the review's S7): in the sidebar on the page (`onPage`), never the sensitive part. */
async function readProfile(platform: PagePlatform, onPage: boolean): Promise<State> {
  const [answer, status] = await Promise.all([request(platform, { v: 1, type: 'panel/profile',
    ...(onPage ? { sensitive: false as const } : {}) }),
    request(platform, { v: 1, type: 'auth/status' })]);
  if (!answer.ok) return { kind: 'failed', error: answer.error };
  const view = answer.data;
  const accountEmail = status.ok ? status.data.account?.email ?? null : null;
  // GET answers '' ("the account's sign-in address") with that address: shown empty again, and saved as '' (header).
  const email = view.profile.contact.email;
  const follows = accountEmail !== null && accountEmail !== ''
    && email.trim().toLowerCase() === accountEmail.trim().toLowerCase();
  const profile = follows ? setIn(view.profile, ['contact', 'email'], '') : view.profile;
  const draft: Draft = { profile, skills: skillsText(profile.skills),
    sensitive: view.sensitive.state === 'shared' ? view.sensitive.value : null };
  return { kind: 'ready', view, draft, base: fingerprint(draft), original: draft, accountEmail };
}

/** The sentence a refused read shows. */
function loadFailedOf(error: ErrorCode): string {
  if (error === 'not_connected') return WORDS.loadFailed.notConnected;
  if (error === 'rate_limited') return WORDS.loadFailed.rateLimited;
  return WORDS.loadFailed.unavailable;
}

export function ProfileEditor({ platform, onClose, tailoritUrl, onSaved }: ProfileEditorProps) {
  const headingId = useId();
  /** v5 p1-shell (the review's S7): drawn in the sidebar on the page: the sensitive part stays in Chrome's side panel. */
  const onPage = useOnPage();
  const inPage = onPage !== null;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  /** Whether a Save was tried: from then on the problems are shown, and kept up to date as the person fixes them. */
  const [checking, setChecking] = useState(false);

  /** What the last Load the latest kept (shown until the next save). */
  const [merged, setMerged] = useState<Merged | null>(null);
  /** Whether the editor is still open: an answer that lands after Back changes nothing. */
  const open = useRef(true);
  useEffect(() => () => {
    open.current = false;
  }, []);

  /** Bumped by Try again: each bump reads the profile again. */
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let live = true;
    void readProfile(platform, inPage).then((read) => {
      if (live) setState(read);
    });
    return () => {
      live = false;
    };
  }, [platform, reads, inPage]);

  /** Reads the profile again, dropping the edits and what the last save said (Try again, after a failed read). */
  const load = useCallback(() => {
    setState({ kind: 'loading' });
    setSave({ kind: 'idle' });
    setChecking(false);
    setMerged(null);
    setReads((count) => count + 1);
  }, []);

  /** Load the latest, after a conflict: reads the profile again and keeps the person's edits on it (header). A read
   *  that fails keeps everything as it is and says so. */
  const loadLatest = async () => {
    if (state.kind !== 'ready') return;
    const { original, draft: mine } = state;
    setSave({ kind: 'merging' });
    const read = await readProfile(platform, inPage);
    if (!open.current) return;
    if (read.kind === 'loading') return;
    if (read.kind === 'failed') {
      setSave({ kind: 'refused', outcome: read.error === 'not_connected' ? 'not-connected'
        : read.error === 'rate_limited' ? 'rate-limited' : 'unavailable' });
      return;
    }
    const kept = mergeDraft(original, mine, read.draft);
    setState({ ...read, draft: kept.draft });
    setMerged({ both: kept.both, sensitiveDropped: kept.sensitiveDropped });
    setSave({ kind: 'idle' });
  };

  const header = (
    <header className="tia-profile__head">
      <button type="button" className="tia-button tia-button--quiet tia-profile__back" onClick={onClose}>
        <Icon name="chevron-right" size={16} className="tia-icon tia-profile__back-icon" />
        {WORDS.back}
      </button>
      <h2 className="tia-profile__title" id={headingId}>{WORDS.heading}</h2>
      {/* v4 ui: the explanation is the "?" beside the heading. */}
      <HelpTip text={WORDS.intro} topic={WORDS.heading} />
    </header>
  );
  const foot = (
    <p className="tia-profile__foot">
      <a href={tailoritUrl} target="_blank" rel="noreferrer" data-tailorit-link="autofill">{WORDS.openInTailorit}</a>
    </p>
  );

  if (state.kind !== 'ready') {
    return (
      <section className="tia-profile" aria-labelledby={headingId} data-profile={state.kind}>
        {header}
        {state.kind === 'loading' ? (
          <p className="tia-help" role="status">{WORDS.loading}</p>
        ) : (
          <div className="tia-profile__failed">
            <p className="tia-feedback" role="status">{loadFailedOf(state.error)}</p>
            <button type="button" className="tia-button" onClick={load}>{WORDS.retry}</button>
          </div>
        )}
        {foot}
      </section>
    );
  }

  const { view, draft } = state;
  const canWrite = view.canWrite;
  const dirty = fingerprint(draft) !== state.base;
  const problems = checking ? problemsOf(draft) : new Map<string, { label: string; message: string }>();

  /** One edit: the profile (or, with `sensitive`, the sensitive part) at `path` takes `value`. */
  const edit = (path: Path, value: unknown, sensitive = false) => {
    setState((now) => {
      if (now.kind !== 'ready') return now;
      const next: Draft = sensitive
        ? { ...now.draft, sensitive: now.draft.sensitive === null ? null : setIn(now.draft.sensitive, path, value) }
        : { ...now.draft, profile: setIn(now.draft.profile, path, value) };
      return { ...now, draft: next };
    });
    if (save.kind === 'saved') setSave({ kind: 'idle' });
  };
  const editSkills = (text: string) => {
    setState((now) => (now.kind === 'ready' ? { ...now, draft: { ...now.draft, skills: text } } : now));
    if (save.kind === 'saved') setSave({ kind: 'idle' });
  };
  const problem = (key: string) => problems.get(key)?.message;
  /** A control's change and problem at `path`; `as` shapes what is stored (an empty date as none). */
  const bind = <V,>(path: Path, as: (value: V) => unknown = (value) => value) => ({
    onChange: (value: V) => edit(path, as(value)),
    error: problem(path.join('.')),
  });

  const submit = async () => {
    const found = problemsOf(draft);
    setChecking(true);
    if (found.size > 0) return;
    setSave({ kind: 'saving' });
    const sent = draft;
    const sentSensitive = sensitiveOf(sent);
    const answer = await request(platform, { v: 1, type: 'panel/saveProfile', revision: view.revision,
      profile: profileOf(sent), ...(sentSensitive === null ? {} : { sensitive: sentSensitive }) });
    if (!answer.ok) {
      setSave({ kind: 'refused', outcome: answer.error === 'not_connected' ? 'not-connected'
        : answer.error === 'rate_limited' ? 'rate-limited' : 'unavailable' });
      return;
    }
    const outcome = answer.data;
    if (outcome.outcome !== 'saved') {
      setSave({ kind: 'refused', outcome: outcome.outcome });
      return;
    }
    const saved = (now: ProfileView) => ({ ...now, revision: outcome.revision, flaggedLines: outcome.flaggedLines });
    setState((now) => (now.kind !== 'ready' ? now : { ...now, view: saved(now.view), base: fingerprint(sent),
      original: sent }));
    setChecking(false);
    setMerged(null);
    setSave({ kind: 'saved' });
    onSaved?.();
  };

  const p = draft.profile;
  const { phone, address } = p.contact;
  const { preferences } = p;
  const sensitive = draft.sensitive;
  return (
    <section className="tia-profile" aria-labelledby={headingId} data-profile="ready">
      {header}
      {!canWrite && <p className="tia-strip" data-tone="neutral" data-profile-read-only="">{WORDS.readOnly}</p>}
      <form className="tia-profile__form" noValidate onSubmit={(event) => {
        event.preventDefault();
        if (canWrite && dirty && save.kind !== 'saving') void submit();
      }}>
        <fieldset className="tia-profile__all" disabled={!canWrite}>
          <Section name={WORDS.sections.personal} id="personal">
            <div className="tia-profile__grid">
              <Text label={FIELDS.first} value={p.name.first} {...bind<string>(['name', 'first'])}
                autoComplete="given-name" />
              <Text label={FIELDS.last} value={p.name.last} {...bind<string>(['name', 'last'])}
                autoComplete="family-name" />
              <Text label={FIELDS.middle} value={p.name.middle} {...bind<string>(['name', 'middle'])} />
              <Text label={FIELDS.preferred} value={p.name.preferred} {...bind<string>(['name', 'preferred'])} />
              <Text label={FIELDS.suffix} value={p.name.suffix} {...bind<string>(['name', 'suffix'])} />
            </div>
            <Text label={FIELDS.email} type="email" value={p.contact.email} {...bind<string>(['contact', 'email'])}
              autoComplete="email" help={state.accountEmail === null ? undefined : WORDS.emailHelp(state.accountEmail)} />
            <div className="tia-profile__grid">
              <Text label={FIELDS.phone} type="tel" value={phone.number}
                {...bind<string>(['contact', 'phone', 'number'])} />
              <Text label={FIELDS.phoneExtension} value={phone.extension}
                {...bind<string>(['contact', 'phone', 'extension'])} />
              <Country label={FIELDS.phoneCountry} value={phone.country}
                {...bind<string | null>(['contact', 'phone', 'country'])} />
              <Select label={FIELDS.phoneType} value={phone.type ?? ''} choices={PHONE_TYPE_CHOICES}
                {...bind<string>(['contact', 'phone', 'type'], noneIfEmpty)} />
            </div>
            <Text label={FIELDS.line1} value={address.line1} {...bind<string>(['contact', 'address', 'line1'])} />
            <Text label={FIELDS.line2} value={address.line2} {...bind<string>(['contact', 'address', 'line2'])} />
            <div className="tia-profile__grid">
              <Text label={FIELDS.city} value={address.city} {...bind<string>(['contact', 'address', 'city'])} />
              <Text label={FIELDS.region} value={address.region} {...bind<string>(['contact', 'address', 'region'])} />
              <Text label={FIELDS.postalCode} value={address.postalCode}
                {...bind<string>(['contact', 'address', 'postalCode'])} />
              <Country label={FIELDS.country} value={address.country}
                {...bind<string | null>(['contact', 'address', 'country'])} />
            </div>
          </Section>

          <Section name={WORDS.sections.links} id="links">
            {(['linkedin', 'github', 'portfolio', 'website', 'x', 'telegram'] as const).map((link) => (
              <Text key={link} label={FIELDS[link]} type="url" value={p.links[link]}
                {...(link === 'x' || link === 'telegram' ? { help: WORDS.socialHelp } : {})}
                {...bind<string>(['links', link])} />
            ))}
          </Section>

          <Section name={WORDS.sections.education} id="education">
            {p.education.map((entry, at) => (
              <Entry key={entry.id} name={WORDS.entry.education(at + 1)}
                onRemove={() => edit(['education'], p.education.filter((_, index) => index !== at))}>
                <Text label={FIELDS.school} value={entry.institution.canonicalName}
                  {...bind<string>(['education', at, 'institution', 'canonicalName'])} />
                <div className="tia-profile__grid">
                  <Select label={FIELDS.degreeLevel} value={entry.degree.level} choices={DEGREE_CHOICES}
                    {...bind<string>(['education', at, 'degree', 'level'])} />
                  <Text label={FIELDS.degreeType} value={entry.degree.type}
                    {...bind<string>(['education', at, 'degree', 'type'])} />
                </div>
                <Text label={FIELDS.fieldOfStudy} value={entry.degree.field}
                  {...bind<string>(['education', at, 'degree', 'field'])} />
                <Dates path={['education', at]} entry={entry} edit={edit} problem={problem}
                  nowLabel={FIELDS.studyingNow} />
              </Entry>
            ))}
            <button type="button" className="tia-button" data-profile-add="education"
              onClick={() => edit(['education'], [...p.education, newEducation()])}>{WORDS.add.education}</button>
          </Section>

          <Section name={WORDS.sections.experience} id="experience">
            {p.experience.map((entry, at) => (
              <Entry key={entry.id} name={WORDS.entry.experience(at + 1)}
                onRemove={() => edit(['experience'], p.experience.filter((_, index) => index !== at))}>
                <div className="tia-profile__grid">
                  <Text label={FIELDS.company} value={entry.company} {...bind<string>(['experience', at, 'company'])} />
                  <Text label={FIELDS.title} value={entry.title} {...bind<string>(['experience', at, 'title'])} />
                </div>
                <Dates path={['experience', at]} entry={entry} edit={edit} problem={problem}
                  nowLabel={FIELDS.workingNow} />
                <Text label={FIELDS.description} multiline value={entry.description}
                  {...bind<string>(['experience', at, 'description'])} />
              </Entry>
            ))}
            <button type="button" className="tia-button" data-profile-add="experience"
              onClick={() => edit(['experience'], [...p.experience, newExperience()])}>{WORDS.add.experience}</button>
          </Section>

          <Section name={WORDS.sections.skills} id="skills">
            <Text label={FIELDS.skills} value={draft.skills} onChange={editSkills} help={WORDS.skillsHelp}
              placeholder={WORDS.placeholders.skills} error={firstUnder(problems, 'skills')} />
          </Section>

          <Section name={WORDS.sections.certifications} id="certifications">
            {p.certifications.map((entry, at) => (
              <Entry key={at} name={WORDS.entry.certification(at + 1)}
                onRemove={() => edit(['certifications'], p.certifications.filter((_, index) => index !== at))}>
                <Text label={FIELDS.name} value={entry.name} {...bind<string>(['certifications', at, 'name'])} />
                <div className="tia-profile__grid">
                  <Text label={FIELDS.issuer} value={entry.issuer} {...bind<string>(['certifications', at, 'issuer'])} />
                  <Whole label={FIELDS.year} value={entry.year} min={1950} max={2100}
                    {...bind<number | null>(['certifications', at, 'year'])} />
                </div>
              </Entry>
            ))}
            <button type="button" className="tia-button" data-profile-add="certification"
              disabled={p.certifications.length >= 20}
              onClick={() => edit(['certifications'], [...p.certifications, { name: '', issuer: '', year: null }])}>
              {WORDS.add.certification}
            </button>
          </Section>

          <Section name={WORDS.sections.preferences} id="preferences">
            <div className="tia-profile__grid">
              <Text label={FIELDS.earliestStartDate} type="date" value={preferences.earliestStartDate ?? ''}
                {...bind<string>(['preferences', 'earliestStartDate'], noneIfEmpty)} />
              <Whole label={FIELDS.noticePeriodWeeks} value={preferences.noticePeriodWeeks} min={0} max={52}
                {...bind<number | null>(['preferences', 'noticePeriodWeeks'])} />
              <Select label={FIELDS.willingToRelocate} value={preferences.willingToRelocate ?? ''}
                choices={RELOCATE_CHOICES} {...bind<string>(['preferences', 'willingToRelocate'], noneIfEmpty)} />
              <Whole label={FIELDS.travelPercent} value={preferences.travelPercent} min={0} max={100}
                {...bind<number | null>(['preferences', 'travelPercent'])} />
            </div>
            <Checks legend={FIELDS.workArrangements} chosen={preferences.workArrangements} choices={ARRANGEMENT_CHOICES}
              {...bind<string[]>(['preferences', 'workArrangements'],
                (v) => WORK_ARRANGEMENTS.filter((each) => v.includes(each)))} />
            <Text label={FIELDS.referralSource} value={preferences.referralSource}
              {...bind<string>(['preferences', 'referralSource'])} />
            <Select label={FIELDS.referralSourceCategory} value={preferences.referralSourceCategory ?? ''}
              choices={REFERRAL_CATEGORY_CHOICES}
              {...bind<string>(['preferences', 'referralSourceCategory'], noneIfEmpty)} />
            <TextList legend={FIELDS.relocationPlaces} itemLabel={FIELDS.place} add={WORDS.add.place} max={10}
              help={WORDS.relocationHelp} items={preferences.relocationPlaces}
              onChange={(items) => edit(['preferences', 'relocationPlaces'], items)}
              error={firstUnder(problems, 'preferences.relocationPlaces')} />
          </Section>

          <Section name={WORDS.sections.anythingElse} id="anything-else">
            <Text label={FIELDS.anythingElse} hideLabel multiline rows={5} maxLength={AUTOFILL_ANYTHING_ELSE_MAX}
              value={p.anythingElse} onChange={(v) => edit(['anythingElse'], v)} help={WORDS.anythingElseHelp}
              error={problem('anythingElse')} />
            {view.flaggedLines.length > 0 && (
              <p className="tia-profile__flagged" role="status" data-profile-flagged="">
                <Icon name="alert" size={16} className="tia-icon" />
                {WORDS.flagged(view.flaggedLines)}
              </p>
            )}
          </Section>

          <Section name={WORDS.sections.sensitive} id="sensitive"
            {...(sensitive === null ? {} : { help: WORDS.sensitiveHelp })}>
            {onPage !== null && <InSidePanel text={COPY.onPage.sensitive} onPage={onPage} />}
            {onPage === null && view.sensitive.state === 'not-shared' && (
              <p className="tia-help" data-profile-sensitive="not-shared">{WORDS.sensitiveNotShared}</p>
            )}
            {view.sensitive.state === 'unavailable' && (
              <p className="tia-help" data-profile-sensitive="unavailable">{WORDS.sensitiveUnavailable}</p>
            )}
            {sensitive !== null && (
              <SensitiveFields value={sensitive} edit={(path, value) => edit(path, value, true)}
                problem={(key) => problem(`sensitive.${key}`)} />
            )}
          </Section>
        </fieldset>

        {problems.size > 0 && (
          <div className="tia-profile__problems" role="alert" data-profile-problems="">
            <p className="tia-profile__problems-title">{WORDS.fixFirst(problems.size)}</p>
            <ul>
              {[...problems].map(([key, found]) => <li key={key}>{`${found.label}: ${found.message}`}</li>)}
            </ul>
          </div>
        )}
        {merged !== null && (
          <div className="tia-profile__merged" role="status" data-profile-merged="">
            <p>{WORDS.merged}</p>
            {merged.both.length > 0 && <p data-profile-merged-both="">{WORDS.mergedBoth(merged.both.join(', '))}</p>}
            {merged.sensitiveDropped && <p data-profile-merged-dropped="">{WORDS.sensitiveDropped}</p>}
          </div>
        )}
        {(save.kind === 'refused' && save.outcome === 'conflict') || save.kind === 'merging' ? (
          <div className="tia-profile__conflict" role="status" data-profile-outcome="conflict">
            <p className="tia-profile__conflict-title">{WORDS.conflict}</p>
            <p className="tia-help">{WORDS.conflictHelp}</p>
            <button type="button" className="tia-button" disabled={save.kind === 'merging'}
              aria-busy={save.kind === 'merging' ? 'true' : undefined} onClick={() => void loadLatest()}>
              {save.kind === 'merging' ? WORDS.loadingLatest : WORDS.loadLatest}
            </button>
          </div>
        ) : save.kind === 'refused' ? (
          <p className="tia-feedback" role="status" data-profile-outcome={save.outcome}>
            {WORDS.outcomes[save.outcome]}
          </p>
        ) : save.kind === 'saved' ? (
          <p className="tia-feedback" role="status" data-profile-outcome="saved">{WORDS.saved}</p>
        ) : null}
        {canWrite && (
          <div className="tia-profile__actions">
            <button type="submit" className="tia-button tia-button--primary" disabled={!dirty || save.kind === 'saving'}
              aria-busy={save.kind === 'saving' ? 'true' : undefined} data-profile-save="">
              {save.kind === 'saving' && <Icon name="spinner" size={14} className="tia-icon tia-spin" />}
              {save.kind === 'saving' ? WORDS.saving : WORDS.save}
            </button>
          </div>
        )}
      </form>
      {foot}
    </section>
  );
}

/** The first problem at or under `prefix` (the skills' list names each skill's place). */
function firstUnder(problems: ReadonlyMap<string, { message: string }>, prefix: string): string | undefined {
  for (const [key, found] of problems) if (key === prefix || key.startsWith(`${prefix}.`)) return found.message;
  return undefined;
}

/** One section: its heading (v4 ui: with a "?" holding its explanation, where it has one), then its fields. */
function Section({ name, id, help, children }: { name: string; id: string; help?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className="tia-profile__section" aria-labelledby={headingId} data-profile-section={id}>
      <div className="tia-profile__headrow">
        <h3 className="tia-profile__heading" id={headingId}>{name}</h3>
        {help !== undefined && <HelpTip text={help} topic={name} />}
      </div>
      {children}
    </section>
  );
}

/** One entry of a list (an education, a job, a country), with Remove. */
function Entry({ name, onRemove, children }: { name: string; onRemove(): void; children: ReactNode }) {
  return (
    <fieldset className="tia-profile__entry">
      <legend className="tia-profile__legend">
        <span>{name}</span>
        <button type="button" className="tia-button tia-button--quiet" aria-label={WORDS.remove(name)}
          onClick={onRemove}>{WORDS.removeShort}</button>
      </legend>
      {children}
    </fieldset>
  );
}

/** What every field takes: its label, and the problem a save would meet there. */
interface FieldProps {
  label: string;
  error?: string | undefined;
}

/** The ids a field's control is named and described by. */
type Ids = { id: string; describedBy: string | undefined; invalid: 'true' | undefined };

/** A field's label, control, help and problem, tied together for assistive technology. */
function Labelled({ label, hideLabel = false, help, error, children }: FieldProps & { hideLabel?: boolean;
  help?: string | undefined; children: (ids: Ids) => ReactNode }) {
  const id = useId();
  const helpId = useId();
  const errorId = useId();
  const described = [help === undefined ? null : helpId, error === undefined ? null : errorId].filter(Boolean);
  return (
    <div className="tia-profile__field" data-invalid={error === undefined ? undefined : ''}>
      <span className="tia-profile__labelrow">
        <label className={hideLabel ? 'tia-visually-hidden' : 'tia-profile__label'} htmlFor={id}>{label}</label>
        {/* v4 ui: a field's explanation is the "?" beside its label, and still describes its control. */}
        {help !== undefined && <HelpTip text={help} topic={label} id={helpId} />}
      </span>
      {children({ id, describedBy: described.length === 0 ? undefined : described.join(' '),
        invalid: error === undefined ? undefined : 'true' })}
      {error !== undefined && <p className="tia-profile__error" id={errorId}>{error}</p>}
    </div>
  );
}

/** A text box (or, `multiline`, a text area). */
function Text({ value, onChange, type = 'text', multiline = false, rows = 3, maxLength, placeholder, autoComplete,
  ...field }: FieldProps & { value: string; onChange(value: string): void; help?: string;
  type?: 'text' | 'email' | 'tel' | 'url' | 'date' | 'month'; multiline?: boolean; rows?: number; maxLength?: number;
  placeholder?: string; hideLabel?: boolean; autoComplete?: string }) {
  return (
    <Labelled {...field}>
      {({ id, describedBy, invalid }) => (multiline ? (
        <textarea id={id} className="tia-profile__input tia-profile__input--area" rows={rows} value={value}
          maxLength={maxLength} aria-describedby={describedBy} aria-invalid={invalid}
          onChange={(event) => onChange(event.currentTarget.value)} />
      ) : (
        <input id={id} className="tia-profile__input" type={type} value={value} maxLength={maxLength}
          placeholder={placeholder} autoComplete={autoComplete ?? 'off'} aria-describedby={describedBy}
          aria-invalid={invalid} onChange={(event) => onChange(event.currentTarget.value)} />
      ))}
    </Labelled>
  );
}

/** A country, chosen from the ISO 3166-1 list by its two-letter code; Not set is none. A code TailorIT holds that the
 *  list does not name stays a choice, so it is never changed unasked. */
function Country({ value, onChange, ...field }: FieldProps & { value: string | null;
  onChange(value: string | null): void }) {
  const listed = countries();
  const extra = value !== null && value !== '' && !listed.some(([code]) => code === value);
  return (
    <Labelled {...field}>
      {({ id, describedBy, invalid }) => (
        <select id={id} className="tia-profile__input" value={value ?? ''} aria-describedby={describedBy}
          aria-invalid={invalid} onChange={(event) => onChange(noneIfEmpty(event.currentTarget.value))}>
          <option value="">{WORDS.choices.unset}</option>
          {extra && <option value={value}>{value}</option>}
          {listed.map(([code, name]) => <option key={code} value={code}>{`${name} (${code})`}</option>)}
        </select>
      )}
    </Labelled>
  );
}

/** A whole number; empty is none. */
function Whole({ value, onChange, min, max, ...field }: FieldProps & { value: number | null;
  onChange(value: number | null): void; min: number; max: number; help?: string }) {
  return (
    <Labelled {...field}>
      {({ id, describedBy, invalid }) => (
        <input id={id} className="tia-profile__input tia-profile__input--short" type="number" inputMode="numeric"
          min={min} max={max} step={1} value={value === null || !Number.isFinite(value) ? '' : String(value)}
          aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => {
            const typed = event.currentTarget.value.trim();
            onChange(typed === '' ? null : Number(typed));
          }} />
      )}
    </Labelled>
  );
}

/** A list to choose one of. */
function Select({ value, choices, onChange, ...field }: FieldProps & { value: string;
  choices: ReadonlyArray<readonly [string, string]>; onChange(value: string): void }) {
  return (
    <Labelled {...field}>
      {({ id, describedBy, invalid }) => (
        <select id={id} className="tia-profile__input" value={value} aria-describedby={describedBy}
          aria-invalid={invalid} onChange={(event) => onChange(event.currentTarget.value)}>
          {choices.map(([choice, words]) => <option key={choice} value={choice}>{words}</option>)}
        </select>
      )}
    </Labelled>
  );
}

/** Boxes to tick any of, under one legend. */
function Checks<T extends string>({ legend, chosen, choices, onChange, error }: { legend: string;
  chosen: readonly T[]; choices: ReadonlyArray<readonly [T, string]>; onChange(value: T[]): void;
  error?: string | undefined }) {
  const errorId = useId();
  const toggle = (choice: T, on: boolean) =>
    onChange(on ? [...chosen, choice] : chosen.filter((each) => each !== choice));
  return (
    <fieldset className="tia-profile__checks" aria-describedby={error === undefined ? undefined : errorId}>
      <legend className="tia-profile__label">{legend}</legend>
      {choices.map(([choice, words]) => (
        <label key={choice} className="tia-profile__check">
          <input type="checkbox" checked={chosen.includes(choice)}
            onChange={(event) => toggle(choice, event.currentTarget.checked)} />
          <span>{words}</span>
        </label>
      ))}
      {error !== undefined && <p className="tia-profile__error" id={errorId}>{error}</p>}
    </fieldset>
  );
}

/** s2 profile: a short list of texts (places, companies), each its own box with Remove, then Add; at most `max`. */
function TextList({ legend, itemLabel, add, items, onChange, max, help, error }: { legend: string; itemLabel: string;
  add: string; items: readonly string[]; onChange(items: string[]): void; max: number; help?: string;
  error?: string | undefined }) {
  const helpId = useId();
  const errorId = useId();
  const described = [help === undefined ? null : helpId, error === undefined ? null : errorId].filter(Boolean);
  return (
    <fieldset className="tia-profile__checks" aria-describedby={described.length === 0 ? undefined : described.join(' ')}>
      <legend className="tia-profile__label">{legend}</legend>
      {help !== undefined && <p className="tia-help" id={helpId}>{help}</p>}
      {items.map((item, at) => (
        <div key={at} className="tia-profile__grid">
          <Text label={`${itemLabel} ${at + 1}`} value={item}
            onChange={(value) => onChange(items.map((each, index) => (index === at ? value : each)))} />
          <button type="button" className="tia-button tia-button--quiet" aria-label={WORDS.remove(`${itemLabel} ${at + 1}`)}
            onClick={() => onChange(items.filter((_, index) => index !== at))}>{WORDS.removeShort}</button>
        </div>
      ))}
      <button type="button" className="tia-button" disabled={items.length >= max}
        onClick={() => onChange([...items, ''])}>{add}</button>
      {error !== undefined && <p className="tia-profile__error" id={errorId}>{error}</p>}
    </fieldset>
  );
}

/** An entry's dates (YYYY-MM, empty is none) and its "now" box. */
function Dates({ path, entry, edit, problem, nowLabel }: { path: Path;
  entry: { startDate: string | null; endDate: string | null; current: boolean };
  edit(path: Path, value: unknown): void; problem(key: string): string | undefined; nowLabel: string }) {
  const key = path.join('.');
  const month = (value: string) => (value.trim() === '' ? null : value.trim());
  /** A year alone (TailorIT keeps "YYYY" too), which a month picker cannot show: said under it, kept until changed. */
  const yearOnly = (value: string | null) => (value !== null && /^\d{4}$/.test(value) ? WORDS.yearOnly(value) : undefined);
  return (
    <>
      <div className="tia-profile__grid">
        <Text label={FIELDS.startDate} type="month" value={entry.startDate ?? ''} help={yearOnly(entry.startDate)}
          onChange={(v) => edit([...path, 'startDate'], month(v))} error={problem(`${key}.startDate`)} />
        <Text label={FIELDS.endDate} type="month" value={entry.endDate ?? ''} help={yearOnly(entry.endDate)}
          onChange={(v) => edit([...path, 'endDate'], month(v))} error={problem(`${key}.endDate`)} />
      </div>
      <label className="tia-profile__check">
        <input type="checkbox" checked={entry.current}
          onChange={(event) => edit([...path, 'current'], event.currentTarget.checked)} />
        <span>{nowLabel}</span>
      </label>
    </>
  );
}

// ── The sensitive part ────────────────────────────────────────────────────────────────────────────────────────────

/** The two answers every sensitive question takes before its own: not provided, and prefer not to say. */
type Unanswered = Exclude<SensitiveAnswer<unknown>['state'], 'value'>;
const UNANSWERED = [['not_provided', WORDS.choices.notProvided], ['declined', WORDS.choices.declined]] as const;
const unanswered = (choice: string): choice is Unanswered => choice === 'not_provided' || choice === 'declined';

/** A sensitive yes or no: Not provided, Prefer not to say, Yes or No. */
function SensitiveBoolean({ value, onChange, ...field }: FieldProps & { value: SensitiveAnswer<boolean>;
  onChange(value: SensitiveAnswer<boolean>): void }) {
  const shown = value.state === 'value' ? (value.value ? 'yes' : 'no') : value.state;
  return (
    <Select {...field} value={shown}
      choices={[...UNANSWERED, ['yes', WORDS.choices.yes], ['no', WORDS.choices.no]]}
      onChange={(choice) => onChange(unanswered(choice) ? { state: choice }
        : { state: 'value', value: choice === 'yes' })} />
  );
}

/** A sensitive choice of a closed list: Not provided, Prefer not to say, or one of `choices`. */
function SensitiveChoice<T extends string>({ value, choices, onChange, ...field }: FieldProps & {
  value: SensitiveAnswer<T>; choices: ReadonlyArray<readonly [T, string]>;
  onChange(value: SensitiveAnswer<T>): void }) {
  const shown = value.state === 'value' ? `v:${value.value}` : value.state;
  return (
    <Select {...field} value={shown}
      choices={[...UNANSWERED, ...choices.map(([choice, words]) => [`v:${choice}`, words] as const)]}
      onChange={(choice) => onChange(unanswered(choice) ? { state: choice }
        : { state: 'value', value: choice.slice(2) as T })} />
  );
}

/** Whether a sensitive answer is given, declined or not provided, for an answer with more than one control. */
function SensitiveState({ state, onChange, ...field }: FieldProps & { state: SensitiveAnswer<unknown>['state'];
  onChange(state: SensitiveAnswer<unknown>['state']): void }) {
  return (
    <Select {...field} value={state} choices={[...UNANSWERED, ['value', WORDS.choices.answer]]}
      onChange={(choice) => onChange(unanswered(choice) ? choice : 'value')} />
  );
}

/** The lists' choices in the sensitive part. */
const STATUS_CHOICES = WORK_STATUSES.map((status) => [status, WORDS.workStatuses[status]] as const);
const GENDER_CHOICES = GENDER_IDENTITIES.map((identity) => [identity, WORDS.genders[identity]] as const);
const RACE_CHOICES = RACE_CATEGORIES.map((race) => [race, WORDS.races[race]] as const);
const PERIOD_CHOICES = EXPECTED_SALARY_PERIODS.map((period) => [period, WORDS.periods[period]] as const);
const VETERAN_CHOICES = [...UNANSWERED, ['none', WORDS.veteran.none], ['veteran', WORDS.veteran.veteran],
  ['protected', WORDS.veteran.protected]] as const;
/** An expected pay first answered: its minimum still to type. */
const NEW_SALARY = { min: 0, max: null, currency: 'USD', period: 'year' } as const;
// s2 profile (snapshot round 2): the new sensitive answers' choices, and what each starts from once answered.
const SUBGROUP_CHOICES = ASIAN_SUBGROUPS.map((subgroup) => [subgroup, WORDS.asianSubgroups[subgroup]] as const);
const ORIENTATION_CHOICES = SEXUAL_ORIENTATIONS.map((value) => [value, WORDS.orientations[value]] as const);
const CLEARANCE_CHOICES = CLEARANCE_LEVELS.map((level) => [level, WORDS.clearanceLevels[level]] as const);
const POLYGRAPH_CHOICES = [['', WORDS.choices.unset],
  ...POLYGRAPH_KINDS.map((kind) => [kind, WORDS.polygraphs[kind]] as const)] as const;
const ACTIVE_CHOICES = [['', WORDS.choices.unset], ['yes', WORDS.clearanceActive.yes],
  ['no', WORDS.clearanceActive.no]] as const;
const NEW_ORIENTATION = { values: [], selfDescribed: '' };
const NEW_SERVICE = { military: false, militaryEndYear: null, government: false, governmentEndYear: null };
const NEW_CLEARANCE = { level: 'none', active: null, polygraph: null } as const;

/** The sensitive part's fields: work authorization per country, self-identification, age and record, pay. */
function SensitiveFields({ value, edit, problem }: { value: AutofillSensitive; edit(path: Path, value: unknown): void;
  problem(key: string): string | undefined }) {
  const { eeo, legal, compensation } = value;
  const { gender, races, pronouns, veteran } = eeo;
  // s2 profile (snapshot round 2).
  const { sexualOrientation, raceSubgroups } = eeo;
  const { governmentService, relativesAt, clearance, citizenships } = legal;
  const year = (part: string): Path => ['legal', 'governmentService', 'value', part];
  const salary = compensation.expectedSalary;
  const veteranShown = veteran.state !== 'value' ? veteran.state
    : veteran.value.isProtectedVeteran ? 'protected' : veteran.value.isVeteran ? 'veteran' : 'none';
  /** A control's change and problem at `path`. */
  const bind = <V,>(path: Path) => ({ onChange: (next: V) => edit(path, next), error: problem(path.join('.')) });
  /** An answer with more than one control: its state, keeping what was answered (or `fresh`) once answered again. */
  const stateOf = <V,>(path: Path, held: SensitiveAnswer<V>, fresh: V) =>
    (state: SensitiveAnswer<unknown>['state']) =>
      edit(path, state === 'value' ? { state, value: held.state === 'value' ? held.value : fresh } : { state });
  const salaryAt = (part: string): Path => ['compensation', 'expectedSalary', 'value', part];
  return (
    <>
      {value.workAuthorization.map((row, at) => (
        <Entry key={at} name={WORDS.entry.workAuthorization(at + 1)}
          onRemove={() => edit(['workAuthorization'], value.workAuthorization.filter((_, index) => index !== at))}>
          <Country label={FIELDS.country} value={row.country === '' ? null : row.country}
            onChange={(v) => edit(['workAuthorization', at, 'country'], v ?? '')}
            error={problem(`workAuthorization.${at}.country`)} />
          <SensitiveBoolean label={FIELDS.authorized} value={row.authorized}
            {...bind<SensitiveAnswer<boolean>>(['workAuthorization', at, 'authorized'])} />
          <SensitiveBoolean label={FIELDS.sponsorshipNow} value={row.sponsorshipNow}
            {...bind<SensitiveAnswer<boolean>>(['workAuthorization', at, 'sponsorshipNow'])} />
          <SensitiveBoolean label={FIELDS.sponsorshipFuture} value={row.sponsorshipFuture}
            {...bind<SensitiveAnswer<boolean>>(['workAuthorization', at, 'sponsorshipFuture'])} />
          <SensitiveChoice label={FIELDS.workStatus} value={row.status} choices={STATUS_CHOICES}
            {...bind<SensitiveAnswer<string>>(['workAuthorization', at, 'status'])} />
        </Entry>
      ))}
      <button type="button" className="tia-button" data-profile-add="work-authorization"
        onClick={() => edit(['workAuthorization'], [...value.workAuthorization, newAuthorization()])}>
        {WORDS.add.workAuthorization}
      </button>

      <SensitiveChoice label={FIELDS.gender} choices={GENDER_CHOICES}
        value={gender.state === 'value' ? { state: 'value', value: gender.value.identity } : gender}
        onChange={(v) => edit(['eeo', 'gender'], v.state !== 'value' ? v : { state: 'value', value: {
          identity: v.value, selfDescribed: gender.state === 'value' ? gender.value.selfDescribed : '' } })} />
      {gender.state === 'value' && gender.value.identity === 'self-describe' && (
        <Text label={FIELDS.selfDescribed} value={gender.value.selfDescribed}
          {...bind<string>(['eeo', 'gender', 'value', 'selfDescribed'])} />
      )}
      <SensitiveBoolean label={FIELDS.hispanicOrLatino} value={eeo.hispanicOrLatino}
        {...bind<SensitiveAnswer<boolean>>(['eeo', 'hispanicOrLatino'])} />
      <SensitiveState label={FIELDS.races} state={races.state} onChange={stateOf(['eeo', 'races'], races, [])} />
      {races.state === 'value' && (
        <Checks legend={FIELDS.races} chosen={races.value} choices={RACE_CHOICES} error={problem('eeo.races.value')}
          onChange={(v) => edit(['eeo', 'races', 'value'], RACE_CATEGORIES.filter((each) => v.includes(each)))} />
      )}
      {races.state === 'value' && races.value.includes('asian') && (
        <Checks legend={FIELDS.raceSubgroups} chosen={raceSubgroups} choices={SUBGROUP_CHOICES}
          error={problem('eeo.raceSubgroups')}
          onChange={(v) => edit(['eeo', 'raceSubgroups'], ASIAN_SUBGROUPS.filter((each) => v.includes(each)))} />
      )}
      <Text label={FIELDS.raceSelfDescribed} value={eeo.raceSelfDescribed} help={WORDS.raceSelfDescribedHelp}
        {...bind<string>(['eeo', 'raceSelfDescribed'])} />
      <Select label={FIELDS.veteran} value={veteranShown} choices={VETERAN_CHOICES}
        onChange={(choice) => edit(['eeo', 'veteran'], unanswered(choice) ? { state: choice }
          : { state: 'value', value: { isVeteran: choice !== 'none', isProtectedVeteran: choice === 'protected',
            isActiveDuty: veteran.state === 'value' && veteran.value.isActiveDuty } })} />
      {veteran.state === 'value' && (
        <label className="tia-profile__check">
          <input type="checkbox" checked={veteran.value.isActiveDuty}
            onChange={(event) => edit(['eeo', 'veteran', 'value', 'isActiveDuty'], event.currentTarget.checked)} />
          <span>{FIELDS.activeDuty}</span>
        </label>
      )}
      <SensitiveBoolean label={FIELDS.disability} value={eeo.disability}
        {...bind<SensitiveAnswer<boolean>>(['eeo', 'disability'])} />
      <SensitiveState label={FIELDS.sexualOrientation} state={sexualOrientation.state}
        onChange={stateOf(['eeo', 'sexualOrientation'], sexualOrientation, NEW_ORIENTATION)} />
      {sexualOrientation.state === 'value' && (
        <>
          <Checks legend={FIELDS.sexualOrientation} chosen={sexualOrientation.value.values} choices={ORIENTATION_CHOICES}
            error={problem('eeo.sexualOrientation.value.values')}
            onChange={(v) => edit(['eeo', 'sexualOrientation', 'value', 'values'],
              SEXUAL_ORIENTATIONS.filter((each) => v.includes(each)))} />
          {sexualOrientation.value.values.includes('self-describe') && (
            <Text label={FIELDS.selfDescribed} value={sexualOrientation.value.selfDescribed}
              {...bind<string>(['eeo', 'sexualOrientation', 'value', 'selfDescribed'])} />
          )}
        </>
      )}
      <SensitiveBoolean label={FIELDS.transgender} value={eeo.transgender}
        {...bind<SensitiveAnswer<boolean>>(['eeo', 'transgender'])} />
      <SensitiveState label={FIELDS.pronouns} state={pronouns.state}
        onChange={stateOf(['eeo', 'pronouns'], pronouns, '')} />
      {pronouns.state === 'value' && (
        <Text label={FIELDS.pronouns} value={pronouns.value} {...bind<string>(['eeo', 'pronouns', 'value'])} />
      )}
      <SensitiveBoolean label={FIELDS.atLeast18} value={legal.atLeast18}
        {...bind<SensitiveAnswer<boolean>>(['legal', 'atLeast18'])} />
      <SensitiveBoolean label={FIELDS.criminalRecord} value={legal.criminalRecord}
        {...bind<SensitiveAnswer<boolean>>(['legal', 'criminalRecord'])} />
      <SensitiveBoolean label={FIELDS.restrictiveAgreement} value={legal.restrictiveAgreement}
        {...bind<SensitiveAnswer<boolean>>(['legal', 'restrictiveAgreement'])} />
      <SensitiveBoolean label={FIELDS.essentialFunctions} value={legal.essentialFunctions}
        {...bind<SensitiveAnswer<boolean>>(['legal', 'essentialFunctions'])} />
      <SensitiveState label={FIELDS.governmentService} state={governmentService.state}
        onChange={stateOf(['legal', 'governmentService'], governmentService, NEW_SERVICE)} />
      {governmentService.state === 'value' && (['military', 'government'] as const).map((served) => {
        const end = served === 'military' ? 'militaryEndYear' : 'governmentEndYear';
        return (
          <div key={served}>
            <label className="tia-profile__check">
              <input type="checkbox" checked={governmentService.value[served]}
                onChange={(event) => edit(['legal', 'governmentService', 'value'], { ...governmentService.value,
                  [served]: event.currentTarget.checked, ...(event.currentTarget.checked ? {} : { [end]: null }) })} />
              <span>{FIELDS[served]}</span>
            </label>
            {governmentService.value[served] && (
              <Whole label={FIELDS[end]} value={governmentService.value[end]} min={1940} max={2100}
                help={WORDS.serviceYearHelp} onChange={(v) => edit(year(end), v)} error={problem(year(end).join('.'))} />
            )}
          </div>
        );
      })}
      <SensitiveState label={FIELDS.relativesAt} state={relativesAt.state}
        onChange={stateOf(['legal', 'relativesAt'], relativesAt, [])} />
      {relativesAt.state === 'value' && (
        <TextList legend={FIELDS.relativesAt} itemLabel={FIELDS.relative} add={WORDS.add.relative} max={20}
          help={WORDS.relativesHelp} items={relativesAt.value}
          onChange={(items) => edit(['legal', 'relativesAt', 'value'], items)}
          error={problem('legal.relativesAt.value')} />
      )}
      <SensitiveState label={FIELDS.clearance} state={clearance.state}
        onChange={stateOf(['legal', 'clearance'], clearance, NEW_CLEARANCE)} />
      {clearance.state === 'value' && (
        <div className="tia-profile__grid">
          <Select label={FIELDS.clearanceLevel} value={clearance.value.level} choices={CLEARANCE_CHOICES}
            {...bind<string>(['legal', 'clearance', 'value', 'level'])} />
          {clearance.value.level !== 'none' && (
            <>
              <Select label={FIELDS.clearanceActive} choices={ACTIVE_CHOICES}
                value={clearance.value.active === null ? '' : clearance.value.active ? 'yes' : 'no'}
                onChange={(v) => edit(['legal', 'clearance', 'value', 'active'], v === '' ? null : v === 'yes')} />
              <Select label={FIELDS.polygraph} value={clearance.value.polygraph ?? ''} choices={POLYGRAPH_CHOICES}
                onChange={(v) => edit(['legal', 'clearance', 'value', 'polygraph'], noneIfEmpty(v))} />
            </>
          )}
        </div>
      )}
      <SensitiveState label={FIELDS.citizenships} state={citizenships.state}
        onChange={stateOf(['legal', 'citizenships'], citizenships, ['US'])} />
      {citizenships.state === 'value' && (
        <>
          {citizenships.value.map((code, at) => (
            <div key={at} className="tia-profile__grid">
              <Country label={WORDS.citizenship(at + 1)} value={code}
                onChange={(v) => edit(['legal', 'citizenships', 'value', at], v ?? '')}
                error={problem(`legal.citizenships.value.${at}`)} />
              {citizenships.value.length > 1 && (
                <button type="button" className="tia-button tia-button--quiet"
                  aria-label={WORDS.remove(WORDS.citizenship(at + 1))}
                  onClick={() => edit(['legal', 'citizenships', 'value'],
                    citizenships.value.filter((_, index) => index !== at))}>{WORDS.removeShort}</button>
              )}
            </div>
          ))}
          {problem('legal.citizenships.value') !== undefined && (
            <p className="tia-profile__error">{problem('legal.citizenships.value')}</p>
          )}
          <button type="button" className="tia-button" data-profile-add="citizenship"
            disabled={citizenships.value.length >= 3}
            onClick={() => edit(['legal', 'citizenships', 'value'], [...citizenships.value, ''])}>
            {WORDS.add.citizenship}
          </button>
        </>
      )}
      <SensitiveState label={FIELDS.expectedSalary} state={salary.state}
        onChange={stateOf(['compensation', 'expectedSalary'], salary, NEW_SALARY)} />
      {salary.state === 'value' && (
        <div className="tia-profile__grid">
          <Whole label={FIELDS.salaryMin} value={salary.value.min > 0 ? salary.value.min : null} min={1}
            max={Number.MAX_SAFE_INTEGER} onChange={(v) => edit(salaryAt('min'), v ?? 0)}
            error={problem(salaryAt('min').join('.'))} />
          <Whole label={FIELDS.salaryMax} value={salary.value.max} min={1} max={Number.MAX_SAFE_INTEGER}
            {...bind<number | null>(salaryAt('max'))} />
          <Text label={FIELDS.currency} value={salary.value.currency} placeholder={WORDS.placeholders.currency}
            maxLength={3} onChange={(v) => edit(salaryAt('currency'), v.toUpperCase().trim())}
            error={problem(salaryAt('currency').join('.'))} />
          <Select label={FIELDS.period} value={salary.value.period} choices={PERIOD_CHOICES}
            {...bind<string>(salaryAt('period'))} />
        </div>
      )}
    </>
  );
}
