/*
 * Ashby's application form, drawn with React as the live capture of 2026-11-01 recorded it (docs/FIXTURES.md, "The
 * Ashby capture"; its report's field table and event logs): the same classes, entries and widgets, and the same
 * answers to the same events.
 * - The page's panel is drawn into the right pane `drawAfterMs` after mounting (the live page draws it 4.8 to 6.8 s
 *   after it loads), in one render with its handlers: the Application tab's div#form[role=tabpanel] with the form, or
 *   (MountOptions.view 'overview') the Overview tab's div#overview[role=tabpanel] with the posting's description and
 *   its "Apply for this Job" link, as the read-only probe of 2026-11-02 showed it. show() switches the panel, as
 *   Ashby's router does when a tab changes the address. Every entry is [data-field-path][data-field-entry-id], its
 *   question a label.ashby-application-form-question-title whose for= reaches only the text, email, tel, file and
 *   textarea inputs, required shown by its _required_ class (drawn ::after "*" by index.html).
 * - Text, email, tel and textarea: React holds each value; a change is saved (MountOptions.server, ApiSetFormValue)
 *   500 ms after its last input, and again when the box is left.
 * - The resume: a file input 1 px wide, clipped, beside its "Upload File" button. A file put in shows at once as the
 *   question's file item (its name and a Delete file button, "Replace" on the upload button) and is uploaded (the
 *   server's upload: ApiCreateFileUploadHandle in e2e); a failed upload adds Ashby's error toast "Error<name> failed to
 *   upload" to the toasts at the end of <body>, the file item left as it is, as the live probe of 2026-11-02 saw it
 *   (MountOptions.uploadFails, or the server's answer).
 * - The SMS consent beside the phone: two visible radios in wrapping labels; a click saves the consent at once
 *   (ApiSubmitCandidateTextingConsent).
 * - Yes/No: two typeless buttons with aria-pressed and data-option beside a display:none checkbox; click() answers it
 *   (mouse and pointer events alone do nothing: React's onClick), clicking the pressed one again clears the answer.
 * - A radio group (a ValueSelect of 7 options or fewer) and a checkbox group (a MultiValueSelect): a fieldset with no
 *   legend, each input at opacity 0 inside a visible span that carries data-checked once chosen, tied to its option's
 *   label[for]; click() on the input or the label chooses, a second click on a chosen radio clears it, and setting
 *   .checked changes the input alone (React never hears of it).
 * - A ValueSelect of 9 options or more: an input[role=combobox] beside a toggle button; a click() on the toggle opens
 *   its whole list (no request), typing filters it; the list is drawn in a floating-ui portal at the end of <body>
 *   (div[data-floating-ui-portal] > div[role=listbox]), named by the input's aria-controls while open, its first
 *   option aria-selected="true" before anything is chosen (a highlight); click() on an option chooses it and closes the
 *   list (mousedown alone chooses nothing); Escape closes it, focusout and blur do not (focusout puts back the chosen
 *   text); while it is open every element of the page outside the input's box and the portal is marked aria-hidden
 *   (data-aria-hidden), as floating-ui's markOthers does.
 * - Location: the same combobox, a remote search: typing opens it, shows "No results" while it asks the geocoder
 *   (debounced 300 ms), then lists the places whose name holds the typed text (as Ashby's ApiAutocompleteGeoLocation
 *   answers "Austin, Texas"; "Austin, TX" lists nothing); a click() on the toggle opens an empty "No results" list. A
 *   chosen place shows its whole name.
 * - The date: a text box ("Pick date...") whose focus or click opens a calendar (logged: never opened by the
 *   extension); MM/DD/YYYY is saved as that day, ISO text a day early (as Ashby saves it in America/Los_Angeles).
 * - Education: one block (School, a remote search whose results show the name, the country and the domain, and whose
 *   box then holds the name alone; Degree; Field of Study; Start and End Date month and year lists, each with its
 *   placeholder "Month..." or "Year..." of an empty value, a month choosing the year too when none is chosen yet, and
 *   the start's years ending at the end year once one is chosen (both as on the live form, 2026-11-01);
 *   "Still Student?"), its Delete and "+ Add Education", which adds a block on every click.
 * - A question of one box (the data consent), and the EEO survey: gender and veteran status radios, in their own form.
 * - The buttons the extension must never press record every press: "Autofill from resume"'s Upload file (and a file
 *   put into its input), Upload File, Delete, the tabs, Submit Application.
 * - jr8 (the owner's snapshot10, Ashby's Honeydew form, 2026-11-13), each only when asked: Yes/No answers drawn pressed
 *   when the form is drawn (MountOptions.answered, as Ashby draws an application's answers saved before), and a required
 *   ValueSelect "What is your primary state of residence?" of the options given (MountOptions.residence: Honeydew's are
 *   the states' two-letter codes), drawn as the capture draws it (its entry a div with no class around the question's
 *   fieldset), which may draw only its first results (MountOptions.residenceDraws).
 * The page script never dispatches an event, focuses, clicks or submits: every event on a control is the extension's.
 * What React holds, and what the page saw and saved, is written to the log object the caller gives (window.__ashby).
 */
import { createElement as h, Fragment, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { PLACES, SCHOOLS, type School } from './data';

export { PLACES, SCHOOLS, type School } from './data';

/** What the page logs. */
export interface AshbyLog {
  /** React's value of each question, by path. */
  values: Record<string, unknown>;
  /** Every save the page made: its operation and path (the value saved is in `values`). */
  saves: Array<{ op: string; path: string }>;
  /** The never-pressed buttons a press reached, by their words. */
  pressed: string[];
  /** Every geocoder and school request: the typed text. */
  places: string[];
  schools: string[];
  /** Every text typed into a combobox, by path. */
  typed: Record<string, string[]>;
  /** How often each list opened, by path. */
  opened: Record<string, number>;
  /** How often the date's calendar opened (a focus or a click on its box). */
  calendars: number;
  /** When the form was drawn (performance.now()), or null before. */
  drawnAt: number | null;
  /** Every upload the page made: the file's name and whether it worked. */
  uploads: Array<{ name: string; ok: boolean }>;
}

/** The page's server: its saves and its searches. In memory by default; the e2e page's goes to its routes. */
export interface AshbyServer {
  save(op: string, path: string, value: unknown): void;
  /** Every place the geocoder knows; the page lists those whose name holds the typed text. */
  places(text: string): Promise<string[]>;
  /** Every school; the page lists those whose name holds the typed text. */
  schools(text: string): Promise<School[]>;
  /** Uploads a file put into an upload question: whether it worked. */
  upload(name: string): Promise<boolean>;
}

export interface MountOptions {
  log?: AshbyLog;
  /** How long after mounting the form is drawn: 0 at once. */
  drawAfterMs?: number;
  server?: AshbyServer;
  /** How long the in-memory server takes to answer a search. */
  searchMs?: number;
  /** The in-memory server's uploads fail. */
  uploadFails?: boolean;
  /** Which tab's panel is drawn: the application form (by default) or the posting's overview. */
  view?: AshbyView;
  /** The overview's description, as paragraphs. */
  description?: readonly string[];
  /** jr8 (the owner's snapshot10, Honeydew's form, 2026-11-13): the Yes/No answers the form shows pressed when it is
   *  drawn, as Ashby draws an application's answers saved before (its autosave) or the person's own choice. */
  answered?: Partial<Record<'authorized' | 'sponsorship', boolean>>;
  /** jr8: a required ValueSelect "What is your primary state of residence?" after the sponsorship, of these options
   *  (Honeydew's lists the two-letter codes), drawn as the capture draws it: its entry a div with no class, the
   *  question's fieldset in it. */
  residence?: readonly string[];
  /** jr8: the most results the state's list draws at once, the first ones (a list longer than it draws, read whole
   *  only by typing): whether Ashby's own ValueSelect caps its results is not known (snapshot10 shows it closed), so
   *  this stands for any list the run cannot read whole. Every result by default. */
  residenceDraws?: number;
}

/** The two tabs' panels. */
export type AshbyView = 'application' | 'overview';

/** A new log. */
export function newLog(): AshbyLog {
  return { values: {}, saves: [], pressed: [], places: [], schools: [], typed: {}, opened: {}, calendars: 0, drawnAt: null,
    uploads: [] };
}

/** The form's render ids (the live page draws a new one on every load): the application's and the survey's. */
export const RENDER_ID = '11111111-2222-4333-8444-555555555555';
export const SURVEY_RENDER_ID = '11111111-2222-4333-8444-666666666666';

/** The questions' paths. */
export const PATHS = {
  authorized: '6f1b584f-0001-4000-8000-000000000001', sponsorship: '6f1b584f-0002-4000-8000-000000000002',
  heard: '6f1b584f-0003-4000-8000-000000000003', skills: '6f1b584f-0004-4000-8000-000000000004',
  degree: '6f1b584f-0005-4000-8000-000000000005', phone: '6f1b584f-0006-4000-8000-000000000006',
  linkedin: '6f1b584f-0007-4000-8000-000000000007', start: '6f1b584f-0008-4000-8000-000000000008',
  why: '6f1b584f-0009-4000-8000-000000000009', consent: '_systemfield_data_consent_ack',
  residence: '6f1b584f-0010-4000-8000-000000000010',
} as const;

/** jr8: the two-letter codes of the US states and DC, as snapshot10's state of residence lists them. */
export const STATE_CODES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
  'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'] as const;

const HEARD = ['LinkedIn', 'Referral', 'Company website', 'Job board', 'Other'];
const SKILLS = ['TypeScript', 'Ruby', 'PostgreSQL', 'Kubernetes', 'Scala', 'Go'];
const DEGREES = ['High School', "Associate's Degree", "Bachelor's Degree", "Master's Degree", 'Doctorate (Ph.D.)',
  'Master of Business Administration (M.B.A.)', 'Juris Doctor (J.D.)', 'Doctor of Medicine (M.D.)', 'Some college', 'Other'];
const GENDERS = ['Male', 'Female', 'Decline to self-identify'];
const VETERAN = ['I identify as one or more of the classifications of protected veteran',
  'I am not a protected veteran', 'I decline to self-identify for protected veteran status'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];
const YEARS = Array.from({ length: 40 }, (_, at) => String(2027 - at));
const SEARCH_DEBOUNCE_MS = 300;
const SAVE_DEBOUNCE_MS = 500;

/** The in-memory server (MountOptions.server's default): saves kept in the log, searches answered after `searchMs`. */
export function memoryServer(searchMs = 400, uploadFails = false): AshbyServer {
  const later = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), searchMs));
  return { save: () => undefined, places: () => later([...PLACES]), schools: () => later([...SCHOOLS]),
    upload: () => later(!uploadFails) };
}

/** The page's own context: its log and server, and its error toasts. */
interface Page {
  log: AshbyLog;
  server: AshbyServer;
  doc: Document;
  /** Adds an error toast (the page's Toasts component listens). */
  toast(text: string): void;
}

/** Ashby's toasts at the end of <body> (the live probe: div._toasts_1bmj4_58 > div._toast_1bmj4_28._negative_f7cvd_96
 *  "Error" and the message). */
function Toasts(props: { page: Page; listen(add: (text: string) => void): void }): ReactElement | null {
  const [toasts, setToasts] = useState<readonly string[]>([]);
  useEffect(() => props.listen((text) => setToasts((now) => [...now, text])), [props]);
  if (props.page.doc.body === null) return null;
  return createPortal(h('div', { className: '_toasts_1bmj4_58' }, ...toasts.map((text, at) => h('div', { key: at,
    className: '_toast_1bmj4_28 _negative_f7cvd_96 _highlighted_f7cvd_138', role: 'status' },
  h('strong', null, 'Error'), h('span', null, text)))), props.page.doc.body);
}

/** Saves one value, recorded in the log. */
function save(page: Page, op: string, path: string, value: unknown): void {
  page.log.values[path] = value;
  page.log.saves.push({ op, path });
  page.server.save(op, path, value);
}

/** Marks every element of the page outside `keep` (and their ancestors) aria-hidden, as floating-ui's markOthers does
 *  while a list is open; answers how to take the marks off. */
function markOthers(doc: Document, keep: readonly Element[]): () => void {
  const path = new Set<Element>();
  for (const el of keep) for (let at: Element | null = el; at !== null; at = at.parentElement) path.add(at);
  const marked: Element[] = [];
  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (keep.includes(child)) continue;
      if (path.has(child)) {
        walk(child);
        continue;
      }
      if (['SCRIPT', 'STYLE', 'LINK'].includes(child.tagName) || child.getAttribute('aria-hidden') === 'true') continue;
      child.setAttribute('data-aria-hidden', 'true');
      child.setAttribute('aria-hidden', 'true');
      marked.push(child);
    }
  };
  if (doc.body !== null) walk(doc.body);
  return () => {
    for (const el of marked) {
      el.removeAttribute('aria-hidden');
      el.removeAttribute('data-aria-hidden');
    }
  };
}

const titleClass = (required: boolean) => `_heading_f7cvd_52 ${required ? '_required_f7cvd_91 ' : ''}_label_1e3gg_42 ashby-application-form-question-title`;

/** A question's entry: its title, its help text and its control. */
function Entry(props: { path: string; title: string; required?: boolean; description?: string; field?: boolean;
  survey?: boolean; children?: ReactNode }): ReactElement {
  const id = `${props.survey === true ? SURVEY_RENDER_ID : RENDER_ID}_${props.path}`;
  return h('div', { className: props.field === false ? undefined : '_fieldEntry_1e3gg_28 ashby-application-form-field-entry',
    'data-field-path': props.path, 'data-field-entry-id': id },
  h('label', { className: titleClass(props.required === true), htmlFor: props.path }, props.title),
  props.description === undefined ? null : h('div', { className: '_description_1e3gg_48 ashby-application-form-question-description' },
    h('p', null, props.description)),
  props.children);
}

/** A text, email, tel or url box, or a textarea, whose value React holds and saves. */
function TextQuestion(props: { page: Page; path: string; title: string; type?: string; required?: boolean;
  multiline?: boolean; placeholder?: string }): ReactElement {
  const [value, setValue] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changed = (next: string) => {
    setValue(next);
    props.page.log.values[props.path] = next;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(props.page, 'ApiSetFormValue', props.path, next), SAVE_DEBOUNCE_MS);
  };
  const common = { id: props.path, name: props.path, required: props.required === true, value,
    placeholder: props.placeholder ?? 'Type here...',
    onChange: (event: { target: { value: string } }) => changed(event.target.value),
    onBlur: () => save(props.page, 'ApiSetFormValue', props.path, value) };
  const control = props.multiline === true
    ? h('textarea', { ...common, className: '_input_1e3gg_32 ashby-application-form-input-textarea' })
    : h('input', { ...common, type: props.type ?? 'text', className: '_input_80epu_28 _input_1e3gg_32 ashby-application-form-input-text' });
  return h(Entry, { path: props.path, title: props.title, required: props.required }, h('div', null, control));
}

/** The resume, its file input behind its "Upload File" button, its file item once a file is in (see the header). */
function ResumeQuestion(props: { page: Page }): ReactElement {
  const path = '_systemfield_resume';
  const { page } = props;
  const [name, setName] = useState<string | null>(null);
  const put = (file: File | undefined) => {
    if (file === undefined) return;
    setName(file.name);
    void page.server.upload(file.name).then((ok) => {
      page.log.uploads.push({ name: file.name, ok });
      if (ok) save(page, 'ApiSetFormValueToFile', path, file.name);
      else page.toast(`${file.name} failed to upload`);
    });
  };
  return h(Entry, { path, title: 'Resume', required: true },
    h('div', { role: 'presentation', className: '_container_10xk4_70 ashby-application-form-input-file' },
      h('input', { type: 'file', tabIndex: -1, id: path, required: true, className: 'ashby-visually-hidden-file',
        accept: 'application/pdf,.pdf,application/msword,.doc,.docx',
        onChange: (event: { target: HTMLInputElement }) => put(event.target.files?.[0]) }),
      name === null ? null : h('div', { className: '_file_10xk4_76 ashby-application-form-input-file-item' },
        h('p', { className: '_name_10xk4_41 ashby-application-form-input-file-item-name' }, h('span', null, name)),
        h('button', { title: 'Delete file', className: '_removeButton_10xk4_83 ashby-application-form-input-file-item-delete',
          onClick: () => page.log.pressed.push('Delete file') }, '\u2715')),
      h('div', { className: '_instructions_10xk4_33 ashby-application-form-input-file-dropzone' },
        h('button', { className: '_button_zyh3g_28 ashby-application-form-input-file-dropzone-upload',
          onClick: () => page.log.pressed.push('Upload File') },
        name === null ? h('span', null, h('span', null, 'Upload File')) : h('span', null, 'Replace')),
        h('p', { className: 'ashby-application-form-input-file-dropzone-instructions' }, 'or drag and drop here'))));
}

/** The phone, with the SMS consent beside it. */
function PhoneQuestion(props: { page: Page }): ReactElement {
  const [consent, setConsent] = useState<string | null>(null);
  const radio = (value: string, words: string) => h('label', { className: '_label_1rwuy_6' },
    h('input', { className: '_radio_1rwuy_12', type: 'radio', name: 'communicationConsent', value,
      checked: consent === value, onChange: () => {
        setConsent(value);
        save(props.page, 'ApiSubmitCandidateTextingConsent', 'communicationConsent', value);
      } }),
    h('div', { className: '_consentRadioLabel_q1pga_38' }, h('p', null, words)));
  const [value, setValue] = useState('');
  return h(Entry, { path: PATHS.phone, title: 'Phone Number', required: true },
    h('input', { id: PATHS.phone, name: PATHS.phone, type: 'tel', required: true, value, placeholder: '1-415-555-1234...',
      className: '_input_80epu_28 _input_1e3gg_32 ashby-application-form-input-text',
      onChange: (event: { target: { value: string } }) => setValue(event.target.value),
      onBlur: () => save(props.page, 'ApiSetFormValue', PATHS.phone, value) }),
    h('div', { className: '_phoneNumberConsentLegalText_q1pga_1 ashby-application-form-texting-consent-description' },
      h('div', { className: '_consentBody_q1pga_8' }, h('p', null, 'Check Yes or No to indicate your agreement to receive '
        + 'text message updates from TailorIT Fixture regarding your job application. Message and data rates may apply.')),
      h('div', { className: '_container_1rwuy_1 _consentRadioGroup_q1pga_13' },
        radio('given', 'Yes - I consent to receiving text messages'),
        radio('notGiven', 'No - I do not consent to receiving text messages'))));
}

/** A Yes/No question (`initial`: the answer it shows when drawn, MountOptions.answered). */
function YesNoQuestion(props: { page: Page; path: string; title: string; description?: string; initial?: boolean }):
  ReactElement {
  const [value, setValue] = useState<boolean | null>(props.initial ?? null);
  const press = (answer: boolean) => {
    const next = value === answer ? null : answer;
    setValue(next);
    save(props.page, 'ApiSetFormValue', props.path, next);
  };
  const button = (answer: boolean) => h('button', {
    className: `_container_pjyt6_1 _option_1svni_32 ${value === answer ? '_active_1svni_45 ' : ''}ashby-application-form-input-yesno-option`,
    'aria-pressed': value === answer ? 'true' : 'false', 'data-option': answer ? 'yes' : 'no', onClick: () => press(answer),
  }, answer ? 'Yes' : 'No');
  return h(Entry, { path: props.path, title: props.title, required: true, description: props.description },
    h('div', { className: '_container_1svni_28 ashby-application-form-input-yesno' }, button(true), button(false),
      h('input', { type: 'checkbox', className: '_input_1svni_78', tabIndex: -1, name: props.path, checked: value === true,
        readOnly: true })));
}

/** A radio group (a ValueSelect of 7 options or fewer). */
function RadioQuestion(props: { page: Page; path: string; title: string; options: readonly string[]; required?: boolean;
  survey?: boolean }): ReactElement {
  const [value, setValue] = useState<string | null>(null);
  const name = `${props.survey === true ? SURVEY_RENDER_ID : RENDER_ID}_${props.path}`;
  const choose = (option: string) => {
    setValue(option);
    save(props.page, 'ApiSetFormValue', props.path, option);
  };
  return h('div', { 'data-field-path': props.path, 'data-field-entry-id': name },
    h('fieldset', { className: '_container_1258i_28 _fieldEntry_1e3gg_28 ashby-application-form-input-radio-group' },
      h('label', { className: titleClass(props.required === true), htmlFor: props.path }, props.title),
      ...props.options.map((option, at) => {
        const chosen = value === option;
        const id = `${name}-labeled-radio-${at}`;
        return h('div', { key: option, className: `_option_1258i_34 ${chosen ? 'true' : 'false'} ashby-application-form-input-radio-group-option`,
          ...(chosen ? { 'data-checked': '' } : {}) },
        h('span', { className: `_container_132c8_28${chosen ? ' _checked_132c8_90' : ''}`, 'data-disabled': 'false',
          ...(chosen ? { 'data-checked': '' } : {}) },
        h('span', { className: '_circle_132c8_77' }),
        h('input', { type: 'radio', id, name, checked: chosen, className: 'ashby-application-form-input-radio-group-option-radio',
          onChange: () => choose(option),
          // Ashby clears an answer clicked again.
          onClick: () => {
            if (value === option) {
              setValue(null);
              save(props.page, 'ApiSetFormValue', props.path, null);
            }
          } })),
        h('label', { htmlFor: id, className: '_label_1258i_42 ashby-application-form-input-radio-group-option-label' }, option));
      })));
}

/** A checkbox group (a MultiValueSelect), or a question of one box. */
function CheckboxQuestion(props: { page: Page; path: string; title: string; options: readonly string[]; required?: boolean;
  description?: string; survey?: boolean }): ReactElement {
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const entryId = `${props.survey === true ? SURVEY_RENDER_ID : RENDER_ID}_${props.path}`;
  const toggle = (option: string) => {
    const next = chosen.includes(option) ? chosen.filter((each) => each !== option) : [...chosen, option];
    setChosen(next);
    save(props.page, 'ApiSetFormValue', props.path, next);
  };
  return h('div', { 'data-field-path': props.path, 'data-field-entry-id': entryId },
    h('fieldset', { className: '_container_1258i_28 _fieldEntry_1e3gg_28 ashby-application-form-input-checkbox-group' },
      h('label', { className: titleClass(props.required === true), htmlFor: props.path }, props.title),
      props.description === undefined ? null : h('div', { className: 'ashby-application-form-question-description' },
        h('p', null, props.description)),
      ...props.options.map((option, at) => {
        const on = chosen.includes(option);
        const id = `${entryId}-labeled-checkbox-${at}`;
        return h('div', { key: option, className: '_option_1258i_34 ashby-application-form-input-checkbox-group-option',
          ...(on ? { 'data-checked': '' } : {}) },
        h('span', { className: `ashby-application-form-input-checkbox-group-option-checkbox _container_1danv_28${on ? ' _checked_1danv_87' : ''}`,
          'data-disabled': 'false', ...(on ? { 'data-checked': '' } : {}) },
        h('input', { type: 'checkbox', id, name: option, checked: on, onChange: () => toggle(option) })),
        h('label', { htmlFor: id, className: '_label_1258i_42 ashby-application-form-input-checkbox-group-option-label' }, option));
      })));
}

/** One option of a combobox's list. */
interface ListItem {
  label: string;
  /** What the box shows once it is chosen (School: the name alone). */
  shown: string;
  /** How the option is drawn (School: its name, its country and its domain). */
  parts?: readonly string[];
}

let nextListId = 0;

/** A combobox: a ValueSelect (its own list, filtered as typed) or a remote search (Location, School). */
function Combobox(props: { page: Page; path: string; placeholder?: string; items?: readonly ListItem[];
  search?: (text: string) => Promise<ListItem[]>; draws?: number }): ReactElement {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<ListItem | null>(null);
  const [results, setResults] = useState<ListItem[] | null>(props.items === undefined ? [] : null);
  const [listId] = useState(() => `:r${(nextListId += 1).toString(36)}:`);
  const box = useRef<HTMLDivElement | null>(null);
  const portal = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asked = useRef(0);
  const page = props.page;
  const shownItems = props.items !== undefined
    ? props.items.filter((item) => text === '' || text === chosen?.shown || item.label.toLowerCase().includes(text.toLowerCase()))
      .slice(0, props.draws)
    : results ?? [];
  useEffect(() => {
    if (!open || box.current === null || portal.current === null) return undefined;
    return markOthers(page.doc, [box.current, portal.current]);
  }, [open, page.doc]);
  const openList = () => {
    page.log.opened[props.path] = (page.log.opened[props.path] ?? 0) + 1;
    setOpen(true);
  };
  const choose = (item: ListItem) => {
    setChosen(item);
    setText(item.shown);
    setOpen(false);
    save(page, 'ApiSetFormValue', props.path, item.shown);
  };
  const typed = (next: string) => {
    setText(next);
    (page.log.typed[props.path] ??= []).push(next);
    if (!open) openList();
    if (props.search === undefined) return;
    setResults(null);
    if (timer.current !== null) clearTimeout(timer.current);
    const ask = (asked.current += 1);
    timer.current = setTimeout(() => {
      void props.search!(next).then((found) => {
        if (asked.current === ask) setResults(found);
      });
    }, SEARCH_DEBOUNCE_MS);
  };
  const rect = box.current?.getBoundingClientRect();
  const view = page.doc.defaultView;
  const list = !open || page.doc.body === null ? null : createPortal(h('div', { 'data-floating-ui-portal': '', ref: portal },
    h('div', { tabIndex: 0, id: listId, role: 'listbox', 'aria-orientation': 'vertical', className: '_floatingContainer_d7ago_103',
      style: { position: 'absolute', left: `${(rect?.left ?? 0) + (view?.scrollX ?? 0)}px`,
        top: `${(rect?.bottom ?? 0) + (view?.scrollY ?? 0)}px`, width: `${rect?.width ?? 600}px`, maxHeight: '240px',
        overflowY: 'auto', background: '#fff', border: '1px solid #999', zIndex: 10 } },
    h('div', { className: '_resultContainer_d7ago_116 ashby-application-form-input-autocomplete-popup' },
      shownItems.length === 0 ? h('div', { className: '_noResults_d7ago_120' }, 'No results')
        : shownItems.map((item, at) => h('div', { key: item.label, role: 'option', id: `${listId}-${at}`,
          'aria-selected': at === 0 ? 'true' : 'false',
          className: `_result_d7ago_107${at === 0 ? ' _active_d7ago_88' : ''} ashby-application-form-input-autocomplete-popup-result`,
          onClick: () => choose(item) },
        // A school is drawn as Ashby draws it: its name and country side by side, its domain below, no space between.
        item.parts === undefined ? item.label : h('div', { className: '_stack_b7xpf_1 _vertical_b7xpf_4' },
          h('div', { className: '_stack_b7xpf_1 _horizontal_b7xpf_7' },
            h('span', { className: '_canonicalSchoolResultName_1e3gg_205' }, item.parts[0]),
            h('span', { className: '_canonicalSchoolResultCountry_1e3gg_209' }, item.parts[1])),
          h('span', { className: '_canonicalSchoolResultDomain_1e3gg_218' }, item.parts[2])))))),
    h('button', { type: 'button', tabIndex: -1, className: 'ashby-floating-dismiss', onClick: () => setOpen(false) }, 'Dismiss')),
  page.doc.body);
  return h(Fragment, null,
    h('div', { className: '_inputContainer_d7ago_28', ref: box },
      h('input', { className: '_input_d7ago_28 ashby-application-form-input-autocomplete', placeholder: props.placeholder ?? 'Start typing...',
        'aria-autocomplete': 'list', 'aria-expanded': open ? 'true' : 'false', 'aria-haspopup': 'listbox', role: 'combobox',
        ...(open ? { 'aria-controls': listId } : {}), value: text,
        onChange: (event: { target: { value: string } }) => typed(event.target.value),
        onKeyDown: (event: { key: string }) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'ArrowDown' && !open) openList();
        },
        // Ashby's blur closes nothing: it puts back the chosen text.
        onBlur: () => setText(chosen?.shown ?? '') }),
      h('button', { className: '_container_pjyt6_1 _toggleButton_d7ago_32', 'aria-label': '',
        onClick: () => (open ? setOpen(false) : openList()) }, h('span', { className: 'ashby-chevron' }, '▾'))),
    list);
}

/** A question drawn as a combobox. */
function ComboboxQuestion(props: { page: Page; path: string; title: string; required?: boolean; items?: readonly ListItem[];
  search?: (text: string) => Promise<ListItem[]> }): ReactElement {
  return h(Entry, { path: props.path, title: props.title, required: props.required },
    h(Combobox, { page: props.page, path: props.path, items: props.items, search: props.search }));
}

/** jr8: the state of residence, a ValueSelect as snapshot10 draws it: <div data-field-path=... data-field-entry-id=...>
 *  <fieldset class="_container_wz442_28 _fieldEntry_1e3gg_28"><label class="... ashby-application-form-question-title"
 *  for=...>What is your primary state of residence?</label><div class="_inputContainer_d7ago_28"><input ... role=
 *  "combobox" ...><button class="_container_pjyt6_1 _toggleButton_d7ago_32">. */
function ResidenceQuestion(props: { page: Page; options: readonly string[]; draws?: number }): ReactElement {
  const path = PATHS.residence;
  return h('div', { 'data-field-path': path, 'data-field-entry-id': `${RENDER_ID}_${path}` },
    h('fieldset', { className: '_container_wz442_28 _fieldEntry_1e3gg_28' },
      h('label', { className: titleClass(true), htmlFor: path }, 'What is your primary state of residence?'),
      h(Combobox, { page: props.page, path, items: props.options.map((label) => ({ label, shown: label })),
        draws: props.draws })));
}

/** The date question: a text box whose focus or click opens a calendar. */
function DateQuestion(props: { page: Page; path: string; title: string }): ReactElement {
  const [text, setText] = useState('');
  const [calendar, setCalendar] = useState(false);
  const opened = () => {
    props.page.log.calendars += 1;
    setCalendar(true);
  };
  const parsed = (value: string): string | null => {
    const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (us !== null) return `${us[3]}-${us[1]}-${us[2]}`;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (iso === null) return null;
    // Read as a time at UTC midnight, then saved as the day in America/Los_Angeles: a day early.
    const day = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]) - 1));
    return day.toISOString().slice(0, 10);
  };
  return h(Entry, { path: props.path, title: props.title, required: true },
    h('div', { className: 'react-datepicker-wrapper' }, h('div', { className: 'react-datepicker__input-container' },
      h('input', { type: 'text', placeholder: 'Pick date...', required: true, value: text,
        className: '_input_gc9ve_28 _greedy_gc9ve_61 ashby-application-form-input-date', onFocus: opened, onClick: opened,
        onChange: (event: { target: { value: string } }) => {
          setText(event.target.value);
          const day = parsed(event.target.value);
          if (day !== null) save(props.page, 'ApiSetFormValue', props.path, day);
        } }))),
    calendar ? h('div', { className: 'react-datepicker-popper' }, h('div', { className: 'react-datepicker' }, 'Calendar')) : null);
}

/** One Education block. */
function EducationBlock(props: { page: Page; index: number; schoolSearch: (text: string) => Promise<ListItem[]> }):
  ReactElement {
  const base = '_systemfield_education_history';
  const at = props.index;
  const [start, setStart] = useState<{ m: string; y: string }>({ m: '', y: '' });
  const [end, setEnd] = useState<{ m: string; y: string }>({ m: '', y: '' });
  const [current, setCurrent] = useState(false);
  const key = (part: string) => `${base}[${at}].${part}`;
  const dates = (which: 'startDate' | 'endDate', value: { m: string; y: string },
    set: (next: { m: string; y: string }) => void, years: readonly string[]) => h('div', { className: '_stack_b7xpf_1 _vertical_b7xpf_4' },
    h('label', { className: '_heading_f7cvd_52 _educationLabel_1e3gg_162 ashby-application-form-question-title',
      htmlFor: `${base}-${which}` }, which === 'startDate' ? 'Start Date' : 'End Date'),
    h('div', { className: '_stack_b7xpf_1 _horizontal_b7xpf_7', id: `${base}-${which}` },
      h('div', { className: '_container_14jlb_78 ashby-application-form-input-dropdown' },
        h('select', { className: '_select_14jlb_39 ashby-application-form-input-dropdown-select', value: value.m,
          onChange: (event: { target: { value: string } }) => {
            // Choosing a month sets the year to this year when none is chosen yet.
            const next = { m: event.target.value, y: value.y === '' ? String(new Date().getFullYear()) : value.y };
            set(next);
            save(props.page, 'ApiSetFormValue', key(which), next);
          } }, h('option', { value: '', disabled: true }, 'Month...'),
        MONTHS.map((month, index) => h('option', { key: month, value: String(index + 1) }, month)))),
      h('div', { className: '_container_14jlb_78 ashby-application-form-input-dropdown' },
        h('select', { className: '_select_14jlb_39 ashby-application-form-input-dropdown-select', value: value.y,
          onChange: (event: { target: { value: string } }) => {
            const next = { ...value, y: event.target.value };
            set(next);
            save(props.page, 'ApiSetFormValue', key(which), next);
          } }, h('option', { value: '', disabled: true }, 'Year...'),
        years.map((year) => h('option', { key: year, value: year }, year))))));
  const text = (part: 'degree' | 'major', label: string, placeholder: string) => {
    const id = at === 0 ? `${base}-${part}` : `${base}-${at}-${part}`;
    return h(EducationText, { page: props.page, id, label, placeholder, saveKey: key(part) });
  };
  return h('div', { className: '_repeatableEducationEntry_1e3gg_176 ashby-application-form-input-education-entry' },
    h('div', { className: 'ashby-application-form-input-education-entry-header' },
      h('span', { className: '_repeatableEducationLabel_1e3gg_186' }, 'Education'),
      h('button', { className: '_repeatableEducationButton_1e3gg_192 ashby-application-form-input-education-entry-delete',
        onClick: () => props.page.log.pressed.push('Delete') }, h('span', null, 'Delete'))),
    h('div', { className: '_stack_b7xpf_1 _vertical_b7xpf_4' },
      h('div', { className: '_stack_b7xpf_1 _vertical_b7xpf_4' },
        h('label', { className: '_heading_f7cvd_52 _educationLabel_1e3gg_162 ashby-application-form-question-title',
          htmlFor: `${base}-school` }, 'School'),
        h(Combobox, { page: props.page, path: key('school'), placeholder: 'Search schools...', search: props.schoolSearch })),
      h('div', { className: '_stack_b7xpf_1 _horizontal_b7xpf_7' }, text('degree', 'Degree', 'e.g. Bachelor of Science'),
        text('major', 'Field of Study', 'e.g. Economics')),
      h('div', { className: '_stack_b7xpf_1 _horizontal_b7xpf_7' }, dates('startDate', start, setStart,
        // The start's years end at the end year once one is chosen, as on the live form.
        end.y === '' ? YEARS : YEARS.filter((year) => year <= end.y)),
        dates('endDate', end, setEnd, YEARS)),
      h('label', { className: '_heading_f7cvd_52 _educationLabel_1e3gg_162 ashby-application-form-question-title',
        htmlFor: at === 0 ? `${base}-isCurrent` : `${base}-${at}-isCurrent` },
      h('span', { className: '_container_1danv_28', 'data-disabled': 'false' },
        h('input', { type: 'checkbox', id: at === 0 ? `${base}-isCurrent` : `${base}-${at}-isCurrent`, checked: current,
          onChange: () => {
            setCurrent(!current);
            save(props.page, 'ApiSetFormValue', key('isCurrent'), !current);
          } })), 'Still Student?')));
}

/** An Education block's text box. */
function EducationText(props: { page: Page; id: string; label: string; placeholder: string; saveKey: string }):
  ReactElement {
  const [value, setValue] = useState('');
  return h('div', { className: '_stack_b7xpf_1 _vertical_b7xpf_4 _educationFlexField_1e3gg_171' },
    h('label', { className: '_heading_f7cvd_52 _educationLabel_1e3gg_162 ashby-application-form-question-title', htmlFor: props.id },
      props.label),
    h('input', { id: props.id, placeholder: props.placeholder, type: 'text', className: '_input_80epu_28 ashby-application-form-input-text',
      value, onChange: (event: { target: { value: string } }) => {
        setValue(event.target.value);
        save(props.page, 'ApiSetFormValue', props.saveKey, event.target.value);
      } }));
}

/** The Education History question: its blocks and its add button. */
function EducationQuestion(props: { page: Page; schoolSearch: (text: string) => Promise<ListItem[]> }): ReactElement {
  const [blocks, setBlocks] = useState(1);
  return h(Entry, { path: '_systemfield_education_history', title: 'Education History' },
    h('div', null, ...Array.from({ length: blocks }, (_, index) => h(EducationBlock, { key: index, page: props.page, index,
      schoolSearch: props.schoolSearch })),
    h('button', { className: '_repeatableEducationButton_1e3gg_192 ashby-application-form-input-education-add',
      onClick: () => setBlocks(blocks + 1) }, '+ Add Education')));
}

/** The whole application form. */
function Form(props: { page: Page; answered?: MountOptions['answered']; residence?: readonly string[];
  residenceDraws?: number }): ReactElement {
  const { page } = props;
  const placeSearch = async (text: string): Promise<ListItem[]> => {
    page.log.places.push(text);
    const all = await page.server.places(text);
    return all.filter((place) => place.toLowerCase().includes(text.toLowerCase())).map((place) => ({ label: place, shown: place }));
  };
  const schoolSearch = async (text: string): Promise<ListItem[]> => {
    page.log.schools.push(text);
    const all = await page.server.schools(text);
    return all.filter((school) => school.name.toLowerCase().includes(text.toLowerCase()))
      .map((school) => ({ label: `${school.name} ${school.country} ${school.domain}`, shown: school.name,
        parts: [school.name, school.country, school.domain] }));
  };
  const section = (heading: string | null, ...children: ReactNode[]) => h('div', {
    className: '_section_5yu8i_86 ashby-application-form-section-container' },
  heading === null ? null : h('div', { className: '_sectionHeader_5yu8i_93 ashby-application-form-section-header' },
    h('h2', { className: '_title_5yu8i_99 ashby-application-form-section-header-title' }, heading)),
  ...children);
  return h(Fragment, null,
    h('div', { className: '_autofillPane_5yu8i_448 ashby-application-form-autofill-uploader' },
      h('div', { role: 'presentation', className: '_root_xd2v0_1 ashby-application-form-autofill-input-root' },
        h('input', { type: 'file', tabIndex: -1, className: 'ashby-visually-hidden-file',
          onChange: () => page.log.pressed.push('Autofill from resume') }),
        h('h3', { className: '_title_xd2v0_64 ashby-application-form-autofill-input-title' }, 'Autofill from resume'),
        h('p', null, 'Upload your resume here to autofill key application fields.'),
        h('button', { className: '_button_zyh3g_28', onClick: () => page.log.pressed.push('Upload file') }, 'Upload file'))),
    h('div', { className: '_jobPostingForm_5yu8i_402 ashby-application-form-container' },
      section(null,
        h(TextQuestion, { page, path: '_systemfield_name', title: 'Name', required: true }),
        h(TextQuestion, { page, path: '_systemfield_email', title: 'Email', type: 'email', required: true,
          placeholder: 'hello@example.com...' }),
        h(ResumeQuestion, { page }),
        h(PhoneQuestion, { page }),
        h(TextQuestion, { page, path: PATHS.linkedin, title: 'LinkedIn' }),
        h(ComboboxQuestion, { page, path: '_systemfield_location', title: 'Where are you currently located?', required: true,
          search: placeSearch }),
        h(DateQuestion, { page, path: PATHS.start, title: 'When can you start a new role?' }),
        h(YesNoQuestion, { page, path: PATHS.authorized, title: 'Are you legally authorized to work in the United States?',
          initial: props.answered?.authorized }),
        h(YesNoQuestion, { page, path: PATHS.sponsorship, title: 'Will you now or in the future require sponsorship for '
          + 'employment visa status?', description: 'We may provide immigration and sponsorship support to new employees.',
        initial: props.answered?.sponsorship }),
        props.residence === undefined ? null : h(ResidenceQuestion, { page, options: props.residence,
          draws: props.residenceDraws })),
      section('Background',
        h(RadioQuestion, { page, path: PATHS.heard, title: 'How did you hear about us?', options: HEARD, required: true }),
        h(CheckboxQuestion, { page, path: PATHS.skills, title: 'Which of these skills have you used?', options: SKILLS }),
        h(ComboboxQuestion, { page, path: PATHS.degree, title: 'What is the highest level of education you have completed?',
          required: true, items: DEGREES.map((label) => ({ label, shown: label })) }),
        h(EducationQuestion, { page, schoolSearch }),
        h(TextQuestion, { page, path: PATHS.why, title: 'Why do you want to join TailorIT Fixture?', multiline: true }))),
    h('div', { className: 'ashby-survey-form-container' },
      h('div', { className: '_jobPostingForm_5yu8i_402 ashby-application-form-container' },
        h('div', { className: '_section_5yu8i_86 ashby-application-form-section-container' },
          h('div', { className: '_sectionHeader_5yu8i_93 ashby-application-form-section-header' },
            h('div', { className: '_sectionDescription_5yu8i_105 ashby-application-form-section-header-description' },
              h('p', null, h('strong', null, 'U.S. EQUAL EMPLOYMENT OPPORTUNITY INFORMATION'),
                ' (Completion is voluntary and will not subject you to adverse treatment)'),
              h('p', null, 'We invite all applicants to voluntarily self-identify.'))),
          h(RadioQuestion, { page, path: '_systemfield_eeoc_gender', title: 'Gender', options: GENDERS, survey: true }),
          h(RadioQuestion, { page, path: '_systemfield_eeoc_veteran_status', title: 'Veteran Status', options: VETERAN,
            survey: true }),
          h(CheckboxQuestion, { page, path: PATHS.consent, title: 'Data consent', required: true, survey: true,
            description: 'Do you agree to allow TailorIT Fixture to keep your application data for future roles?',
            options: ['I agree'] })))),
    h('button', { className: '_button_zyh3g_28 _primary_zyh3g_57 ashby-application-form-submit-button',
      onClick: () => page.log.pressed.push('Submit Application') }, 'Submit Application'));
}

/** The Overview tab's panel: the posting's description and its "Apply for this Job" link. */
function Overview(props: { description: readonly string[] }): ReactElement {
  return h('div', { tabIndex: 0, role: 'tabpanel', 'aria-labelledby': 'job-overview', id: 'overview',
    className: '_descriptionContainer_5yu8i_172 ashby-job-posting-description-container' },
  h('div', { className: '_descriptionText_oj0x8_198 ashby-job-posting-description' },
    ...props.description.map((text, at) => h('p', { key: at }, text))),
  h('a', { className: '_container_j2da7_1', href: './application' },
    h('button', { className: '_button_zyh3g_28 _primary_zyh3g_97' }, 'Apply for this Job')));
}

/** The posting's description by default: a few paragraphs about the role. */
export const DESCRIPTION = ['About the team', 'TailorIT Fixture builds the tools job seekers use to apply with care. '
  + 'You will design, build and run the services our product rests on, review designs with the team and help on call.',
'You will work across the stack, from React on the web to TypeScript services and PostgreSQL, and share what you learn.'];

/** Draws the page's panel into `container` (the right pane) `drawAfterMs` after mounting; answers how to switch it (a
 *  tab's route change) and how to take it away. */
export function mountAshbyForm(container: HTMLElement, options: MountOptions = {}):
  { unmount(): void; show(view: AshbyView): void } {
  const doc = container.ownerDocument;
  let add: (text: string) => void = () => undefined;
  const page: Page = { log: options.log ?? newLog(),
    server: options.server ?? memoryServer(options.searchMs, options.uploadFails === true), doc,
    toast: (text) => add(text) };
  const root = createRoot(container);
  let view: AshbyView = options.view ?? 'application';
  let drawn = false;
  const render = () => {
    root.render(h(Fragment, null,
      view === 'application'
        ? h('div', { tabIndex: 0, role: 'tabpanel', 'aria-labelledby': 'job-application-form', id: 'form' }, h(Form, { page,
          answered: options.answered, residence: options.residence, residenceDraws: options.residenceDraws }))
        : h(Overview, { description: options.description ?? DESCRIPTION }),
      h(Toasts, { page, listen: (next) => {
        add = next;
      } })));
  };
  const draw = () => {
    drawn = true;
    page.log.drawnAt = performance.now();
    render();
  };
  const timer = (options.drawAfterMs ?? 0) > 0 ? setTimeout(draw, options.drawAfterMs) : null;
  if (timer === null) draw();
  return {
    unmount() {
      if (timer !== null) clearTimeout(timer);
      root.unmount();
    },
    show(next) {
      view = next;
      if (drawn) render();
    },
  };
}

/** The tabs beside the form: each press is recorded, and no press navigates. */
export function watchTabs(doc: Document, log: AshbyLog): void {
  for (const tab of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[role="tab"]'))) {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      log.pressed.push((tab.textContent ?? '').trim());
    });
  }
}
