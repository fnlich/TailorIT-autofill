/*
 * Workable's application page, drawn with React as the live capture of 2026-11-02 recorded it (docs/FIXTURES.md, "The
 * Workable capture"; its report's field table and event logs): the same data-ui hooks, ids, title rows and widgets,
 * and the same answers to the same events.
 * - The page's view is drawn into the container `drawAfterMs` after mounting (the live page draws it 4.6 to 7.5 s
 *   after it loads), in one render with its handlers: the application form, or (MountOptions.view 'overview') the
 *   posting's description, requirements and benefits with "Apply for this job" (a[data-ui=apply-button][role=button]).
 * - Every field's title row: span[id=<id>_label] with the question, after a span holding a strong "*" when it is
 *   required, or before " (Optional)". Text, email and textarea are named by aria-labelledby; the number box and the
 *   date box only by the <label> that wraps the star, the title and the box.
 * - Text boxes: React holds each value (a plain .value= is put back); each change is kept in the page's draft (the
 *   live page's localStorage draft, here MountOptions' log). The Address is prefilled from "the visitor's IP"
 *   ("Seattle, United States of America"), beside its hidden city, postcode and country (1 px, aria-hidden).
 * - The number box (Desired salary): digits only, drawn with thousands separators ("85000" shows "85,000"); anything
 *   else is dropped.
 * - The date box (react-datepicker, MM/DD/YYYY, inputmode="tel"): a value written takes only after a keydown since the
 *   last write (any key; the live mask's rule), and the page then opens its calendar, as the live page does; Escape
 *   closes the calendar; Enter sets today (log.enters), never the typed date; a focus or a click opens the calendar
 *   (log.calendars).
 * - The phone (intl-tel-input): a country button (title and dial code shown) whose list (US, UK, Canada, Germany and
 *   Australia first, then the rest) opens on click(), closes on Escape (a keydown anywhere while it is open) and on a
 *   choice (click() on a country); the number drawn nationally for +1 countries ("5125550147" shows "512-555-0147").
 * - Dropdowns: select-only, input[role=combobox][readonly] in a label, opened by click() (or ArrowDown/Enter on the
 *   box) and never by focus or mousedown; the list is drawn in a non-modal dialog inside the field, position: fixed at
 *   the box's place on screen as it opens (so beyond the viewport for a box below the fold, as live), its first option
 *   marked data-active (the live page also moves focus to it; this page leaves focus alone, see the header's end);
 *   click() on an option chooses it and closes the list; Escape on the list or a mouseup on the page closes it;
 *   focusout, blur and a second click do not. The answer is the box's value (the label) and a hidden input's value
 *   (the option's id).
 * - Yes/No: a fieldset of two div[data-ui=option][role=radio] each with its own label and hidden radio (value true or
 *   false); click() on the radio or the label answers it (aria-checked at once, the input's own checked one render
 *   later); a click() on the option div itself does nothing.
 * - A single-choice question (radios) and a multi-choice one (checkboxes): label[data-checked] > div[role=radio |
 *   checkbox][aria-checked] > hidden input; click() on the input or the label chooses; .checked alone is put back.
 * - The GDPR consent: in a section with no heading, two nested labels around div[role=checkbox] and its hidden
 *   input[name=gdpr] (no required attribute); Submit refuses the application while it is unticked.
 * - Uploads: Resume and Photo, each a file input 1 px wide beside its "Choose file" label[role=button][for]. A file put
 *   in (log.files) is sent at once, as the live page sends it to its S3 bucket with a POST (MountOptions.upload; the e2e
 *   page POSTs to that bucket's address, which the e2e routes answer): a progress bar in the drop zone meanwhile, then
 *   the file's name with a "Remove file" button (kept: log.uploads), or, when the upload fails, an alert under the drop
 *   zone naming the file and, CRASH_AFTER_MS later, the page's error screen in place of everything ("Sorry, an unknown
 *   error occurred.", log.crashed), as the live page showed when its upload was aborted on 2026-11-02. No upload that
 *   worked was seen live: the name with its Remove file button is this page's guess at it.
 * - Education and Experience: "+ Add" opens one editor (Add disabled while it is open: School, Field of study and
 *   Degree, or Title, Company, Industry and Summary, then MM/YYYY Start and End dates, and "I currently work here" in
 *   Experience, which disables the End date); "Update" keeps the entry only once its first field holds something,
 *   folded into a summary with Edit and Delete (log.entries, in the order kept); "Cancel" drops it. As the owner's
 *   capture of 2026-11-13 (snapshot9) shows live Workable drawing them, the open editor is the list's first item and
 *   the saved entries follow it newest-added first (jr8: the page drew them oldest first, the editor last, before).
 * - The buttons the extension must never press record every press (log.pressed): "Import resume from", each section's
 *   Clear, "Choose file", an editor's Cancel, a saved entry's Edit and Delete, the cookie banner's buttons.
 * - jr8 (MountOptions.view 'jobs'): Workable's job site, jobs.workable.com/view/<id>/<slug>, as the owner's captures of
 *   2026-11-13 (snapshot12) draw it: the posting's "Apply now" (overview-apply-now; the sticky bar's sticky-apply-now
 *   not shown) opens the application in a dialog at the same address, its form drawn a moment later (JobsPage).
 * - Submit (button[data-ui=apply-button][type=submit], disabled until the first change): refuses an application with a
 *   required answer missing or the GDPR consent unticked (log.refused), else shows Workable's
 *   [data-ui=successful-submit] in the form's place (log.submitted, document.body.dataset.submitted).
 * The page script never dispatches an event, focuses, clicks or submits: every event on a control is the extension's.
 * The live page moves focus to a dropdown's list as it opens and to the box after a typed date; its Escape is read on
 * the list (and on the box) whatever holds focus, as the capture saw with the cookie banner focused.
 */
import { createElement as h, Fragment, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

/** What the page logs. */
export interface WorkableLog {
  /** React's value of each question, by its id. */
  values: Record<string, unknown>;
  /** The never-pressed buttons a press reached, by their words. */
  pressed: string[];
  /** How often each list opened, by its question's id. */
  opened: Record<string, number>;
  /** How often the date's calendar opened on a focus or a click (never the extension's), and after a typed date. */
  calendars: number;
  typedCalendars: number;
  /** Whether a calendar is open now. */
  calendarOpen: boolean;
  /** Enter keys on the date box (Enter sets today). */
  enters: number;
  /** Writes into the date box that came with no keydown before them (put back). */
  refusedWrites: number;
  /** The files put into each upload, by its data-ui, and how each one's upload ended. */
  files: Array<{ field: string; name: string }>;
  uploads: Array<{ field: string; name: string; ok: boolean }>;
  /** Whether a failed upload took the page down. */
  crashed: boolean;
  /** "+ Add" presses, and the entries each section kept (its editor's Update). */
  adds: number;
  entries: Record<string, Array<Record<string, unknown>>>;
  /** Submit's refusals (what was missing) and its submissions. */
  refused: string[][];
  submitted: number;
  /** When the view was drawn (performance.now()), or null before. */
  drawnAt: number | null;
  /** jr8: the job site's "Apply now" presses (overview-apply-now and sticky-apply-now together). */
  applyNow: number;
}

/** A log with nothing in it yet. */
export function newLog(): WorkableLog {
  return { values: {}, pressed: [], opened: {}, calendars: 0, typedCalendars: 0, calendarOpen: false, enters: 0,
    refusedWrites: 0, files: [], uploads: [], crashed: false, adds: 0, entries: {}, refused: [], submitted: 0,
    drawnAt: null, applyNow: 0 };
}

/** Sends a file put into an upload, as the live page sends it to its S3 bucket: whether it got there. */
export type Uploader = (field: 'resume' | 'avatar', file: File) => Promise<boolean>;
/** How long after a failed upload the page falls over, in ms. */
export const CRASH_AFTER_MS = 400;
/** The upload when the mounter names none (the DOM tests): there 60 ms later. */
const UPLOADED = (): Promise<boolean> => new Promise((done) => setTimeout(() => done(true), 60));

/** The questions' ids, as the page names them. */
export const IDS = {
  salary: 'CA_21784', start: 'CA_3905', authorized: 'CA_3907', sponsorship: 'CA_3908', degree: 'QA_11713819',
  skills: 'QA_12058638', heard: 'QA_11713820', years: 'QA_11713821', why: 'QA_12487830',
} as const;

/** The countries of the phone's list: the live list's first five, then a few of the rest, as it names them. */
export const COUNTRIES: ReadonlyArray<{ iso2: string; name: string; dial: string }> = [
  { iso2: 'us', name: 'United States', dial: '1' }, { iso2: 'gb', name: 'United Kingdom', dial: '44' },
  { iso2: 'ca', name: 'Canada', dial: '1' }, { iso2: 'de', name: 'Germany', dial: '49' },
  { iso2: 'au', name: 'Australia', dial: '61' }, { iso2: 'af', name: 'Afghanistan', dial: '93' },
  { iso2: 'br', name: 'Brazil', dial: '55' }, { iso2: 'fr', name: 'France', dial: '33' },
  { iso2: 'in', name: 'India', dial: '91' }, { iso2: 'mx', name: 'Mexico', dial: '52' },
];

/** The posting's own text on the overview. */
export const DESCRIPTION = ['We build the platform that powers hiring for thousands of teams.',
  'You will design and ship services used by millions of candidates, working closely with product and design.'];

/** The page's draft: what the live page writes to localStorage, here into the log. */
type Keep = (id: string, value: unknown) => void;

/** A title row (see the header). */
function titleRow(id: string, title: string, required: boolean): ReactElement {
  return h('span', { className: 'wk-title-row' },
    required ? h('span', { className: 'wk-star' }, h('strong', null, '*')) : null,
    h('span', null, h('span', { id: `${id}_label`, className: 'wk-title' }, h('strong', null, title)),
      required ? null : h('span', { className: 'wk-optional' }, ' (Optional)')));
}

/** A field's wrapper. */
const field = (...children: ReactNode[]) => h('div', { className: 'wk-field' }, ...children);

function TextField(props: { id: string; title: string; required: boolean; keep: Keep; type?: string; textarea?: boolean;
  initial?: string; helper?: string; /** An editor's box, which carries no data-ui (as live). */ editor?: boolean }):
  ReactElement {
  const [value, setValue] = useState(props.initial ?? '');
  const common = { id: props.id, name: props.id, ...(props.editor ? {} : { 'data-ui': props.id }),
    'aria-labelledby': `${props.id}_label`,
    'aria-required': String(props.required), required: props.required, value, dir: 'auto',
    ...(props.helper ? { 'aria-describedby': `${props.id}_helper` } : {}),
    onChange: (event: { target: { value: string } }) => {
      setValue(event.target.value);
      props.keep(props.id, event.target.value);
    } };
  return field(h('label', { className: 'wk-label' }, titleRow(props.id, props.title, props.required),
    h('div', { 'data-role': 'illustrated-input' }, props.textarea ? h('textarea', { ...common, rows: 5 })
      : h('input', { ...common, type: props.type ?? 'text' }))),
  props.helper ? h('div', { className: 'wk-helper' }, h('span', { id: `${props.id}_helper` }, props.helper)) : null);
}

/** The number box (see the header). */
function NumberField(props: { id: string; title: string; required: boolean; keep: Keep }): ReactElement {
  const [value, setValue] = useState('');
  return field(h('label', { className: 'wk-label' }, titleRow(props.id, props.title, props.required),
    h('div', { 'data-role': 'illustrated-input' }, h('input', { 'aria-required': String(props.required), 'data-ui': props.id,
      required: props.required, name: props.id, type: 'text', dir: 'auto', value,
      onChange: (event: { target: { value: string } }) => {
        const digits = event.target.value.replace(/,/g, '');
        if (digits !== '' && !/^\d+$/.test(digits)) return;
        const shown = digits === '' ? '' : Number(digits).toLocaleString('en-US');
        setValue(shown);
        props.keep(props.id, digits === '' ? '' : Number(digits));
      } }))));
}

/** The date box (see the header). */
function DateField(props: { id: string; title: string; required: boolean; keep: Keep; log: WorkableLog;
  /** MM/YYYY (the Education and Experience editors'), else MM/DD/YYYY. */
  month?: boolean; disabled?: boolean }): ReactElement {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const armed = useRef(false);
  const show = (now: boolean, typed = false) => {
    setOpen(now);
    props.log.calendarOpen = now;
    if (now && typed) props.log.typedCalendars += 1;
    else if (now) props.log.calendars += 1;
  };
  const today = () => {
    const at = new Date();
    return `${String(at.getMonth() + 1).padStart(2, '0')}/${String(at.getDate()).padStart(2, '0')}/${at.getFullYear()}`;
  };
  return field(h('label', { className: 'wk-label' }, titleRow(props.id, props.title, props.required),
    h('div', { className: 'react-datepicker-wrapper' }, h('div', { className: 'react-datepicker__input-container' },
      h('div', { 'data-role': 'illustrated-input' }, h('input', { type: 'text', 'aria-readonly': 'false',
        ...(props.month ? {} : { 'data-ui': props.id }), inputMode: 'tel', name: props.id, required: props.required,
        placeholder: props.month ? 'MM/YYYY' : 'MM/DD/YYYY', dir: 'auto', value, disabled: props.disabled === true,
        onFocus: () => show(true), onClick: () => show(true),
        onKeyDown: (event: { key: string }) => {
          armed.current = true;
          if (event.key === 'Escape') show(false);
          if (event.key === 'Enter') {
            props.log.enters += 1;
            setValue(today());
            props.keep(props.id, today());
            show(false);
          }
        },
        onChange: (event: { target: { value: string } }) => {
          // The live mask: a write with no keydown since the last one is put back.
          if (!armed.current) {
            props.log.refusedWrites += 1;
            return;
          }
          armed.current = false;
          const text = event.target.value;
          if (text !== '' && !(props.month ? /^\d{2}\/\d{4}$/ : /^\d{2}\/\d{2}\/\d{4}$/).test(text)) return;
          setValue(text);
          props.keep(props.id, text);
          if (text !== '') show(true, true);
        } })))),
    open ? h('div', { className: 'react-datepicker-popper', role: 'dialog' },
      h('button', { type: 'button', 'aria-label': 'Previous month' }, '‹'),
      h('button', { type: 'button', 'aria-label': 'Next month' }, '›'),
      h('div', { role: 'option', className: 'react-datepicker__day', 'aria-label': 'Choose a day' }, '15')) : null));
}

/** The phone and its country list (see the header). */
function PhoneField(props: { required: boolean; keep: Keep; log: WorkableLog }): ReactElement {
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState(COUNTRIES[0]!);
  const [number, setNumber] = useState('');
  useEffect(() => {
    if (!open) return undefined;
    const doc = document;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [open]);
  const national = (digits: string) => (country.dial === '1' && digits.length === 10
    ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : digits);
  return field(h('div', { className: 'wk-label' }, titleRow('phone', 'Phone', props.required),
    h('div', { 'data-ignore-focus': 'true', 'data-ui': 'phone' }, h('div', { 'data-role': 'illustrated-input' },
      h('div', { className: 'iti iti--input-container' },
        h('div', { className: 'iti__country-container' },
          h('button', { type: 'button', className: 'iti__selected-country', 'aria-expanded': String(open),
            'aria-label': `Change country for phone number, currently selected ${country.name} (+${country.dial})`,
            'aria-haspopup': 'dialog', 'aria-controls': 'iti-0__country-selector', title: country.name,
            onClick: () => {
              if (!open) props.log.opened.phone = (props.log.opened.phone ?? 0) + 1;
              setOpen(!open);
            } },
          h('div', { className: 'iti__selected-country-primary' }, h('div', { className: `iti__flag iti__${country.iso2}` }),
            h('div', { className: 'iti__arrow', 'aria-hidden': 'true' })),
          h('div', { className: 'iti__selected-dial-code' }, `+${country.dial}`)),
          h('div', { id: 'iti-0__country-selector', role: 'dialog', 'aria-modal': 'true',
            className: `iti__country-selector${open ? '' : ' iti__hide'}` },
          h('ul', { className: 'iti__country-list', id: 'iti-0__country-listbox', role: 'listbox',
            'aria-label': 'List of countries' }, ...COUNTRIES.map((each) => h('li', { key: each.iso2,
            id: `iti-0__item-${each.iso2}`, className: 'iti__country', tabIndex: -1, role: 'option',
            'data-dial-code': each.dial, 'data-iso2': each.iso2, 'aria-selected': String(each === country),
            onClick: () => {
              setCountry(each);
              setOpen(false);
              props.keep('phone_country', each.iso2);
            } }, h('div', { className: `iti__flag iti__${each.iso2}` }),
          h('span', { className: 'iti__country-name' }, `${each.name} `, h('span', { className: 'iti__dial-code' },
            `(+${each.dial})`))))))),
        h('input', { id: 'input_phone', type: 'tel', name: 'phone', 'aria-labelledby': 'phone_label', autoComplete: 'tel',
          inputMode: 'tel', required: props.required, value: number, dir: 'auto',
          onChange: (event: { target: { value: string } }) => {
            const digits = event.target.value.replace(/\D/g, '');
            setNumber(national(digits));
            props.keep('phone', digits);
          } }))))),
  h('div', { className: 'wk-helper' }, h('span', { id: 'phone_helper' },
    'The hiring team may use this number to contact you about this job.')));
}

/** A dropdown (see the header). */
function Dropdown(props: { id: string; title: string; required: boolean; options: readonly string[]; keep: Keep;
  log: WorkableLog }): ReactElement {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLInputElement | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  const ids = props.options.map((_, index) => String(6133432 + index));
  const show = () => {
    if (open) return;
    props.log.opened[props.id] = (props.log.opened[props.id] ?? 0) + 1;
    // As the live page does: the list is drawn position: fixed at the box's place on screen when it opens (beyond the
    // viewport for a box below the fold).
    const rect = box.current?.getBoundingClientRect();
    setPlace(rect === undefined ? null : { top: rect.bottom + 2, left: rect.left, width: rect.width });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return undefined;
    // The live page closes its list on a mouseup anywhere outside it. (It also moves focus to the list as it opens; its
    // Escape is read on the list whatever holds focus, as the capture saw with the cookie banner focused, so this page
    // leaves focus alone: every event on a control here is the extension's.)
    const doc = document;
    const onUp = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || wrapper.current === null || !wrapper.current.contains(event.target)) setOpen(false);
    };
    doc.addEventListener('mouseup', onUp);
    return () => doc.removeEventListener('mouseup', onUp);
  }, [open]);
  return field(h('div', { className: 'wk-label' }, titleRow(props.id, props.title, props.required),
    h('div', { 'data-ui': props.id, 'data-open': String(open), 'data-input-type': 'select', className: 'wk-select',
      ref: wrapper },
      h('label', null, h('div', { 'data-role': 'illustrated-input' }, h('div', null,
        h('input', { id: `input_${props.id}_input`, role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': String(open),
          'aria-owns': `input_${props.id}_listbox`, 'aria-controls': `input_${props.id}_listbox`, 'aria-autocomplete': 'none',
          autoComplete: 'off', 'aria-labelledby': `${props.id}_label`, placeholder: 'Select an option…', type: 'text',
          dir: 'auto', readOnly: true, value: chosen === null ? '' : props.options[chosen], ref: box,
          onClick: show,
          onKeyDown: (event: { key: string }) => {
            if (event.key === 'ArrowDown' || event.key === 'Enter') show();
          } })))),
      open ? h('dialog', { id: `input_${props.id}_dialog`, role: 'presentation', open: true, className: 'wk-dialog',
        style: place === null ? {} : { top: `${place.top}px`, left: `${place.left}px`, width: `${place.width}px` } },
        h('div', { 'data-role': 'dialog-container' }, h('ul', { role: 'listbox', tabIndex: -1, id: `input_${props.id}_listbox`,
          ref: list, 'aria-activedescendant': `opt_${props.id}_${ids[0]}`,
          onKeyDown: (event: { key: string }) => {
            if (event.key === 'Escape') setOpen(false);
          } }, ...props.options.map((label, at) => h('li', { key: label, value: ids[at], 'data-visible': 'true',
          id: `opt_${props.id}_${ids[at]}`, role: 'option', 'aria-selected': String(chosen === at),
          onClick: () => {
            setChosen(at);
            setOpen(false);
            props.keep(props.id, ids[at]);
          } }, h('div', { role: 'presentation', 'data-active': String(at === (chosen ?? 0)) },
          h('span', { 'data-role': 'option-label' }, label))))))) : null,
      h('input', { name: props.id, required: props.required, className: 'wk-hidden-value', tabIndex: -1,
        'aria-hidden': 'true', value: chosen === null ? '' : ids[chosen], readOnly: true }))));
}

/** A Yes/No question (see the header). */
function YesNo(props: { id: string; title: string; required: boolean; keep: Keep }): ReactElement {
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [shown, setShown] = useState<boolean | null>(null);
  // The input's own checked follows one render later, as on the live page.
  useEffect(() => {
    const timer = setTimeout(() => setShown(answer), 60);
    return () => clearTimeout(timer);
  }, [answer]);
  const group = `g${props.id}`;
  return field(h('div', { className: 'wk-label' }, titleRow(group, props.title, props.required),
    h('fieldset', { role: 'radiogroup', 'data-ui': props.id, 'aria-labelledby': `${group}_label`, className: 'wk-yesno' },
      ...[true, false].map((value) => h('div', { key: String(value), 'data-ui': 'option', role: 'radio',
        id: `wrapper_${props.id}_${String(value)}`, 'aria-checked': String(answer === value),
        'aria-labelledby': `${group}_label radio_label_${props.id}_${String(value)}`, tabIndex: 0,
        className: answer === value ? 'wk-option wk-on' : 'wk-option' },
      h('label', null, h('input', { 'aria-required': String(props.required), required: props.required,
        id: `${props.id}_${String(value)}`, tabIndex: -1, 'aria-hidden': 'true', type: 'radio', name: props.id,
        value: String(value), checked: shown === value,
        onChange: () => {
          setAnswer(value);
          props.keep(props.id, value);
        } }), h('div', null, h('span', { id: `radio_label_${props.id}_${String(value)}` }, value ? 'YES' : 'NO'))))))));
}

/** A single-choice question drawn as radios (see the header). */
function RadioQuestion(props: { id: string; title: string; required: boolean; options: readonly string[]; keep: Keep }):
  ReactElement {
  const [chosen, setChosen] = useState<number | null>(null);
  const group = `g${props.id}`;
  return field(h('div', { className: 'wk-label' }, titleRow(group, props.title, props.required),
    h('fieldset', { role: 'radiogroup', 'data-ui': props.id, 'aria-labelledby': `${group}_label` },
      ...props.options.map((label, at) => h('label', { key: label, role: 'presentation', 'data-checked': String(chosen === at),
        className: 'wk-choice' },
      h('div', { id: `wrapper_${props.id}_${at}`, role: 'radio', 'aria-checked': String(chosen === at), tabIndex: 0,
        className: 'wk-box wk-round' },
      h('input', { 'aria-required': String(props.required), required: props.required, id: `${props.id}_${at}`, tabIndex: -1,
        'aria-hidden': 'true', type: 'radio', name: props.id, value: String(7000 + at), checked: chosen === at,
        onChange: () => {
          setChosen(at);
          props.keep(props.id, label);
        } })), h('span', null, label))))));
}

/** A multi-choice question drawn as checkboxes (see the header). */
function CheckboxQuestion(props: { id: string; title: string; required: boolean; options: readonly string[]; keep: Keep }):
  ReactElement {
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const group = `g${props.id}`;
  return field(h('div', { className: 'wk-label' }, titleRow(group, props.title, props.required),
    h('div', { role: 'group', 'data-ui': props.id, 'aria-labelledby': `${group}_label`, id: `input_${group}` },
      ...props.options.map((label, at) => h('label', { key: label, 'aria-labelledby': `${group}_label`,
        'data-checked': String(ticked.has(at)), className: 'wk-choice' },
      h('div', { role: 'checkbox', 'aria-checked': String(ticked.has(at)), 'aria-required': String(props.required),
        tabIndex: 0, id: `${props.id}_box_${at}`, 'aria-labelledby': `${group}_label checkbox_label_${props.id}_${at}`,
        className: 'wk-box' },
      h('input', { 'aria-required': String(props.required), tabIndex: -1, 'aria-hidden': 'true', type: 'checkbox',
        required: props.required, name: String(6295301 + at), checked: ticked.has(at),
        onChange: () => {
          const next = new Set(ticked);
          if (next.has(at)) next.delete(at);
          else next.add(at);
          setTicked(next);
          props.keep(props.id, [...next].sort().map((index) => props.options[index]));
        } })), h('span', { id: `checkbox_label_${props.id}_${at}` }, label))))));
}

/** The GDPR consent (see the header). */
function Consent(props: { keep: Keep; onChange: (ticked: boolean) => void }): ReactElement {
  const [ticked, setTicked] = useState(false);
  return h('div', { 'data-ui': 'gdpr', className: 'wk-gdpr' }, h('div', { className: 'wk-field' },
    h('label', { className: 'wk-label' }, h('label', { 'data-ui': 'gdpr', 'data-checked': String(ticked),
      className: 'wk-choice' },
    h('div', { role: 'checkbox', 'aria-labelledby': 'checkbox_label_gdpr0001', 'aria-checked': String(ticked), tabIndex: 0,
      id: 'gdpr0001', className: 'wk-box' },
    h('input', { tabIndex: -1, 'aria-hidden': 'true', type: 'checkbox', name: 'gdpr', checked: ticked,
      onChange: () => {
        setTicked(!ticked);
        props.keep('gdpr', !ticked);
        props.onChange(!ticked);
      } })),
    h('span', null, h('span', { id: 'checkbox_label_gdpr0001' }, 'I have read, understand and accept the content of the ',
      h('a', { href: '#privacy-notice' }, 'Privacy Notice'), ' and consent to the processing of my data as part of this application.'))))));
}

/** An upload: its title, its "Choose file" and its 1 px file input, and the file's upload (see the header). */
function Upload(props: { ui: 'resume' | 'avatar'; id: string; title: string; required: boolean; accept: string;
  log: WorkableLog; keep: Keep; upload: Uploader; crash: () => void }): ReactElement {
  const [file, setFile] = useState<{ name: string; phase: 'uploading' | 'done' | 'failed' } | null>(null);
  const input = `input_files_input_${props.id}`;
  const shown = file === null ? null : file.phase === 'uploading'
    ? h('span', { role: 'progressbar', 'aria-label': 'Uploading', className: 'wk-progress' }, 'Uploading…')
    : file.phase === 'done' ? h('span', { className: 'wk-file-chip' }, h('span', { className: 'wk-file-name' }, file.name),
      h('button', { type: 'button', 'aria-label': 'Remove file', className: 'wk-remove',
        onClick: () => props.log.pressed.push('Remove file') }, '×'))
      : null;
  return field(h('div', { className: 'wk-label' }, titleRow(props.id, props.title, props.required),
    h('div', { 'data-role': 'dropzone', className: 'wk-dropzone' },
      h('label', { className: 'wk-icon', htmlFor: input }, h('span', { 'aria-hidden': 'true' }, '⬆')),
      h('div', null, shown,
        h('label', { tabIndex: 0, role: 'button', htmlFor: input, id: `description_input_${props.id}`,
          'aria-describedby': `${props.id}_label`, className: 'wk-choose',
          onClick: () => props.log.pressed.push('Choose file') }, 'Choose file'),
        ' ', h('span', null, 'or drag and drop here')),
      h('input', { 'data-ui': props.ui, tabIndex: -1, id: input, type: 'file',
        'aria-labelledby': `${props.id}_label description_input_${props.id}`, accept: props.accept,
        required: props.required, className: 'wk-file',
        onChange: (event: { target: HTMLInputElement }) => {
          const chosen = event.target.files?.[0];
          if (chosen === undefined) return;
          setFile({ name: chosen.name, phase: 'uploading' });
          props.log.files.push({ field: props.ui, name: chosen.name });
          // The live page sends the file to its S3 bucket at once (a POST): kept once it is there, else the field says
          // so and the page falls over.
          void props.upload(props.ui, chosen).catch(() => false).then((ok) => {
            props.log.uploads.push({ field: props.ui, name: chosen.name, ok });
            setFile({ name: chosen.name, phase: ok ? 'done' : 'failed' });
            if (ok) props.keep(props.ui, chosen.name);
            else setTimeout(props.crash, CRASH_AFTER_MS);
          });
        } })),
    file?.phase === 'failed' ? h('p', { role: 'alert', id: `${props.id}_error`, className: 'wk-error' },
      `${file.name} failed to upload. Please try again.`) : null));
}

/** What a saved entry's summary names, as the live summaries do (the capture's wk-education-saved and
 *  wk-experience-saved: School; Title and Company), above its Period. */
const SUMMARY_FIELDS: Record<'education' | 'experience', readonly string[]> = {
  education: ['school'], experience: ['title', 'company'],
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];

/** A saved entry's Period as the live summary writes it ("September 2018", "June 2021 - Present"), from its MM/YYYY
 *  dates. */
function periodOf(entry: Record<string, unknown>): string {
  const month = (value: unknown) => {
    const match = /^(\d{2})\/(\d{4})$/.exec(String(value ?? ''));
    return match === null ? '' : `${MONTHS[Number(match[1]) - 1] ?? ''} ${match[2]}`.trim();
  };
  const start = month(entry.start_date);
  const end = entry.current === true ? 'Present' : month(entry.end_date);
  return end === '' ? start : `${start} - ${end}`;
}

/** The fields of an Education or an Experience editor, as the live editors show them. */
const EDITOR_FIELDS: Record<'education' | 'experience', ReadonlyArray<{ id: string; title: string; required?: boolean;
  textarea?: boolean; month?: boolean }>> = {
  education: [{ id: 'school', title: 'School', required: true }, { id: 'field_of_study', title: 'Field of study' },
    { id: 'degree', title: 'Degree' }, { id: 'start_date', title: 'Start date', month: true },
    { id: 'end_date', title: 'End date', month: true }],
  experience: [{ id: 'title', title: 'Title', required: true }, { id: 'company', title: 'Company' },
    { id: 'industry', title: 'Industry' }, { id: 'summary', title: 'Summary', textarea: true },
    { id: 'start_date', title: 'Start date', month: true }, { id: 'end_date', title: 'End date', month: true }],
};

/** An Education or Experience section (see the header): "+ Add" opens one editor at a time (Add disabled meanwhile);
 *  its "Update" keeps the entry, folded into a summary, only when its required field holds something; "Cancel" drops
 *  it. Each kept entry is log.entries[kind], in the order their Update kept them. Drawn as the live page draws it (the
 *  owner's capture of 2026-11-13): the open editor at the top of the list, then the saved entries newest-added first. */
function Repeatable(props: { kind: 'education' | 'experience'; title: string; log: WorkableLog; keep: Keep;
  restored: ReadonlyArray<Record<string, unknown>> }): ReactElement {
  const [saved, setSaved] = useState<Array<Record<string, unknown>>>(() => [...props.restored]);
  const [editing, setEditing] = useState(false);
  const draft = useRef<Record<string, unknown>>({});
  const [current, setCurrent] = useState(false);
  const keep: Keep = (id, value) => {
    draft.current[id] = value;
  };
  const fields = EDITOR_FIELDS[props.kind];
  const required = fields.filter((each) => each.required === true).map((each) => each.id);
  const editor = () => h('li', { key: 'editor' }, h('div', { 'data-ui': 'editor' },
    ...fields.map((each) => (each.month
      ? h(DateField, { key: each.id, id: each.id, title: each.title, required: false, keep, log: props.log, month: true,
        disabled: each.id === 'end_date' && current })
      : h(TextField, { key: each.id, id: each.id, title: each.title, required: each.required === true, editor: true,
        textarea: each.textarea === true, keep }))),
    props.kind === 'experience' ? h('label', { 'data-checked': String(current), className: 'wk-choice' },
      h('div', { role: 'checkbox', 'aria-labelledby': 'checkbox_label_current', 'aria-checked': String(current),
        tabIndex: 0, id: 'current', className: 'wk-box' },
      h('input', { tabIndex: -1, 'aria-hidden': 'true', type: 'checkbox', name: 'current', checked: current,
        onChange: () => {
          setCurrent(!current);
          draft.current.current = !current;
        } })),
      h('span', { id: 'checkbox_label_current' }, 'I currently work here')) : null,
    h('div', null, h('button', { 'data-ui': 'save-section', type: 'button', onClick: () => {
      if (required.some((id) => (draft.current[id] ?? '') === '')) return;
      const entry = { ...draft.current };
      const all = [...saved, entry];
      setSaved(all);
      setEditing(false);
      props.log.entries[props.kind] = all;
      props.keep(props.kind, all);
    } }, 'Update'),
    h('button', { 'data-ui': 'cancel-section', type: 'button', onClick: () => {
      props.log.pressed.push('Cancel');
      setEditing(false);
    } }, 'Cancel'))));
  const summary = (entry: Record<string, unknown>, at: number) => h('li', { key: at, className: 'wk-saved' },
    h('div', { 'data-ui': 'group' },
      ...SUMMARY_FIELDS[props.kind].filter((id) => String(entry[id] ?? '') !== '').map((id) => h('dl', { key: id },
        h('dt', null, fields.find((each) => each.id === id)!.title),
        h('dd', { 'data-ui': id }, h('span', null, String(entry[id]))))),
      h('dl', { 'data-ui': 'date-range' }, h('dt', null, 'Period '),
        h('dd', { 'data-ui': 'period' }, h('span', null, periodOf(entry)))),
      h('div', null, h('a', { 'data-ui': 'edit-section', title: 'Edit', role: 'button', tabIndex: 0,
        onClick: () => props.log.pressed.push('Edit') }, 'Edit'),
      h('a', { 'data-ui': 'remove-section', title: 'Delete', role: 'button', tabIndex: 0,
        onClick: () => props.log.pressed.push('Delete') }, 'Delete'))));
  return h('div', { 'data-ui': props.kind, className: 'wk-repeat' },
    h('div', null, h('p', { id: `${props.kind}_label` }, `${props.title}\u00a0`, h('small', null, '(Optional)')),
      h('button', { 'data-ui': 'add-section', 'aria-label': `Add ${props.title}`, type: 'button', disabled: editing,
        'aria-disabled': editing ? 'true' : undefined, onClick: () => {
          props.log.adds += 1;
          draft.current = {};
          setCurrent(false);
          setEditing(true);
        } }, '+ Add')),
    saved.length === 0 && !editing ? null : h('ul', null, editing ? editor() : null,
      ...saved.map((entry, at) => summary(entry, at)).reverse()));
}

/** A section: its heading and Clear (none for the consent's), then its fields. */
function section(index: number, heading: string | null, log: WorkableLog, ...children: ReactNode[]): ReactElement {
  return h('section', { 'data-ui': 'section', key: index, className: 'wk-section' },
    heading === null ? null : h('div', { className: 'wk-section-head' }, h('h2', { id: `section-${index}_section_name` }, heading),
      h('a', { tabIndex: 0, role: 'button', 'data-ui': `clear-section-${index}`, 'aria-label': `Clear ${heading}`,
        onClick: () => log.pressed.push('Clear') }, 'Clear')),
    h('div', { 'data-ui': 'section-fields' }, ...children));
}

/** What mounting the page takes. */
export interface MountOptions {
  log: WorkableLog;
  /** How long after mounting the view is drawn, in ms. */
  drawAfterMs?: number;
  /** Which view: the application form, the posting's overview, or (jr8) the job site's posting whose "Apply now" opens
   *  the application in a dialog (JobsPage). */
  view?: 'application' | 'overview' | 'jobs';
  /** The job site's dialog: how long after it opens its form is drawn (300 ms by default), and whether it is open when
   *  the page is drawn. */
  formAfterMs?: number;
  jobsOpen?: boolean;
  /** The posting's description paragraphs (the overview). */
  description?: readonly string[];
  /** How a file put into an upload is sent (see the header); by default it gets there 60 ms later. */
  upload?: Uploader;
  /** The entries the page's draft restored, as saved summaries (the live page keeps its draft an hour). */
  restored?: { education?: ReadonlyArray<Record<string, unknown>>; experience?: ReadonlyArray<Record<string, unknown>> };
}

/** The application form (see the header). */
function ApplicationForm({ log, upload, crash, restored }: { log: WorkableLog; upload: Uploader; crash: () => void;
  restored: NonNullable<MountOptions['restored']> }): ReactElement {
  const [edited, setEdited] = useState(false);
  const [gdpr, setGdpr] = useState(false);
  const [done, setDone] = useState(false);
  const values = useRef<Record<string, unknown>>({});
  const keep: Keep = (id, value) => {
    values.current[id] = value;
    log.values[id] = value;
    setEdited(true);
  };
  if (done) {
    return h('div', { 'data-ui': 'successful-submit', className: 'wk-success' }, h('h2', null, 'Thank you for applying!'),
      h('p', null, 'Your application has been received.'));
  }
  const required = ['firstname', 'lastname', 'email', 'phone', 'resume', IDS.authorized];
  return h('form', { 'data-ui': 'application-form', noValidate: true,
    onSubmit: (event: { preventDefault: () => void }) => {
      event.preventDefault();
      const missing = required.filter((id) => {
        const value = values.current[id];
        return value === undefined || value === '' || value === null;
      });
      if (!gdpr) missing.push('gdpr');
      if (missing.length > 0) {
        log.refused.push(missing);
        return;
      }
      log.submitted += 1;
      document.body.dataset.submitted = String(log.submitted);
      setDone(true);
    } },
  h('div', { className: 'wk-autofill' }, h('div', null, h('strong', null, 'Autofill application'),
    h('p', null, 'Save time by importing your resume in one of the following formats: .pdf, .doc, .docx, .odt, or .rtf.')),
  h('div', { 'data-ui': 'autofill-button' }, h('button', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false',
    'aria-controls': 'imp0001_dropdown', onClick: () => log.pressed.push('Import resume from') }, 'Import resume from'))),
  h('span', { className: 'wk-required-note' }, h('span', null, '*'), ' Required fields'),
  section(0, 'Personal information', log,
    h(TextField, { id: 'firstname', title: 'First name', required: true, keep }),
    h(TextField, { id: 'lastname', title: 'Last name', required: true, keep }),
    h(TextField, { id: 'email', title: 'Email', required: true, type: 'email', keep }),
    h(TextField, { id: 'headline', title: 'Headline', required: false, keep }),
    h(PhoneField, { required: true, keep, log }),
    h(TextField, { id: 'address', title: 'Address', required: true, keep, initial: 'Seattle, United States of America',
      helper: 'Include your city, region, and country, so that employers can easily manage your application.' }),
    ...['city', 'postcode', 'country'].map((part) => h('div', { key: part, className: 'wk-field',
      style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden' } },
    h('label', null, h('input', { id: part, 'aria-hidden': 'true', tabIndex: -1, name: part, type: 'text',
      defaultValue: '' })))),
    h(Upload, { ui: 'avatar', id: 'pho0000000000001', title: 'Photo', required: false, accept: '.jpg,.jpeg,.gif,.png', log,
      keep, upload, crash })),
  section(1, 'Profile', log,
    h(Repeatable, { kind: 'education', title: 'Education', log, keep, restored: restored.education ?? [] }),
    h(Repeatable, { kind: 'experience', title: 'Experience', log, keep, restored: restored.experience ?? [] }),
    h(TextField, { id: 'summary', title: 'Summary', required: false, textarea: true, keep }),
    h(Upload, { ui: 'resume', id: 'res0000000000001', title: 'Resume', required: true,
      accept: '.pdf,.doc,.docx,.odt,.rtf,application/pdf', log, keep, upload, crash })),
  section(2, 'Details', log,
    h(TextField, { id: 'cover_letter', title: 'Cover letter', required: false, textarea: true, keep }),
    h(DateField, { id: IDS.start, title: 'Earliest Start Date', required: false, keep, log }),
    h(NumberField, { id: IDS.salary, title: 'Desired salary', required: false, keep }),
    h(YesNo, { id: IDS.authorized, title: 'Are you legally authorized to work in the United States?', required: true, keep }),
    h(YesNo, { id: IDS.sponsorship, title: 'Will you now or in the future require sponsorship for employment visa status?',
      required: true, keep }),
    h(RadioQuestion, { id: IDS.degree, title: 'What is the highest level of education you have completed?', required: true,
      options: ['High school', "Bachelor's degree", "Master's degree", 'Doctorate'], keep }),
    h(CheckboxQuestion, { id: IDS.skills, title: 'Which of these skills have you used?', required: false,
      options: ['TypeScript', 'Kubernetes', 'PostgreSQL', 'COBOL'], keep }),
    h(Dropdown, { id: IDS.heard, title: 'How did you hear about us?', required: true,
      options: ['LinkedIn', 'Indeed', 'A friend', 'Other'], keep, log }),
    h(Dropdown, { id: IDS.years, title: 'How many years of software engineering experience do you have?', required: false,
      options: ['0-2', '3-5', '6-9', '10+'], keep, log })),
  section(3, null, log, h(Consent, { keep, onChange: setGdpr })),
  h('button', { 'data-ui': 'apply-button', type: 'submit', disabled: !edited, 'aria-disabled': String(!edited),
    className: 'wk-submit' }, 'Submit application'));
}

/** The posting's overview (see the header). */
function Overview({ description }: { description: readonly string[] }): ReactElement {
  return h('main', { role: 'main' },
    h('div', null,
      h('section', { 'aria-labelledby': 'job-description-title', 'data-ui': 'job-description' },
        h('h2', { id: 'job-description-title' }, 'Description'), ...description.map((text) => h('p', { key: text }, text))),
      h('section', { 'aria-labelledby': 'job-requirements-title', 'data-ui': 'job-requirements' },
        h('h2', { id: 'job-requirements-title' }, 'Requirements'), h('p', null, 'Five years of building web services.')),
      h('section', { 'aria-labelledby': 'job-benefits-title', 'data-ui': 'job-benefits' },
        h('h2', { id: 'job-benefits-title' }, 'Benefits'), h('p', null, 'Health cover and a learning budget.'))),
    h('div', null, h('a', { tabIndex: 0, role: 'button', 'data-ui': 'apply-button', href: 'apply/' }, 'Apply for this job')));
}

/** jr8: Workable's job site (jobs.workable.com/view/<id>/<slug>), as the owner's captures of 2026-11-13 (snapshot12)
 *  draw it: the posting with no form and no dialog, its "Apply now" (button[data-ui=overview-apply-now] beside "Share
 *  job", and the sticky bar's sticky-apply-now, not shown at the page's top: each a button with no type and no href);
 *  a click() on either opens the application in a dialog at the same address (div[data-role=modal-wrapper] >
 *  dialog[role=dialog][aria-modal=true][open], as jobs-salvo-apply.html shows it): its title, its own Cancel (which
 *  closes it) and Submit, and the form drawn `formAfterMs` later, as the live dialog loads it. Each Apply now press is
 *  counted (log.applyNow), and the dialog leaves the posting's buttons where they are (an open attribute, no modal), so
 *  a press of them while it is open would land. */
function JobsPage(props: { log: WorkableLog; upload: Uploader; crash: () => void; description: readonly string[];
  formAfterMs: number; open: boolean }): ReactElement {
  const [open, setOpen] = useState(props.open);
  const [formShown, setFormShown] = useState(false);
  useEffect(() => {
    if (!open) {
      setFormShown(false);
      return undefined;
    }
    const timer = setTimeout(() => setFormShown(true), props.formAfterMs);
    return () => clearTimeout(timer);
  }, [open, props.formAfterMs]);
  const apply = () => {
    props.log.applyNow += 1;
    setOpen(true);
  };
  return h(Fragment, null,
    h('main', { role: 'main' },
      h('h1', { 'data-ui': 'overview-title' }, 'Site Reliability Engineer'),
      h('div', { className: 'wk-jobs-actions' },
        h('button', { 'data-ui': 'share-now', onClick: () => props.log.pressed.push('Share job') }, 'Share job'),
        h('button', { 'data-ui': 'overview-apply-now', onClick: apply }, 'Apply now')),
      h('section', null, h('h3', null, 'Description'), h('div', { 'data-ui': 'job-breakdown-description-parsed-html' },
        ...props.description.map((text) => h('p', { key: text }, text)))),
      h('section', null, h('h3', null, 'Requirements'), h('div', { 'data-ui': 'job-breakdown-requirements-parsed-html' },
        h('p', null, 'Five years of building web services.'))),
      h('div', { className: 'wk-sticky', style: { display: 'none' } },
        h('button', { 'data-ui': 'sticky-apply-now', onClick: apply }, 'Apply now'))),
    open ? h('div', { 'data-role': 'modal-wrapper' }, h('dialog', { role: 'dialog', 'aria-modal': 'true', open: true,
      'aria-labelledby': 'wk-apply-title', className: 'wk-jobs-dialog' },
    h('div', { id: 'wk-apply-title' }, h('h2', { 'data-ui': 'application-form-title' }, 'Apply for Site Reliability Engineer')),
    h('div', { 'data-ui': 'application-form-actions' },
      h('button', { 'data-ui': 'application-form-cancel', type: 'button', onClick: () => {
        props.log.pressed.push('Cancel');
        setOpen(false);
      } }, 'Cancel'),
      h('button', { 'data-ui': 'application-form-submit', type: 'button',
        onClick: () => props.log.pressed.push('Submit application') }, 'Submit application')),
    formShown ? h(ApplicationForm, { log: props.log, upload: props.upload, crash: props.crash, restored: {} })
      : h('p', { className: 'wk-loading' }, 'Loading…'))) : null);
}

/** The view after `drawAfterMs` (see the header). */
function Page(props: Required<Pick<MountOptions, 'log' | 'drawAfterMs' | 'view' | 'description' | 'upload'
  | 'restored' | 'formAfterMs' | 'jobsOpen'>>): ReactElement {
  const [drawn, setDrawn] = useState(props.drawAfterMs <= 0);
  const [crashed, setCrashed] = useState(false);
  useEffect(() => {
    if (drawn) {
      props.log.drawnAt ??= performance.now();
      return undefined;
    }
    const timer = setTimeout(() => setDrawn(true), props.drawAfterMs);
    return () => clearTimeout(timer);
  }, [drawn, props.drawAfterMs, props.log]);
  if (!drawn) return h(Fragment, null, h('p', { className: 'wk-loading' }, 'Loading…'));
  if (crashed) {
    return h('main', { className: 'wk-crash' }, h('h1', null, 'Sorry, an unknown error occurred.'),
      h('p', null, 'The page you are looking for might have been removed, had its name changed or is temporarily unavailable.'));
  }
  const crash = () => {
    props.log.crashed = true;
    setCrashed(true);
  };
  if (props.view === 'jobs') {
    return h(JobsPage, { log: props.log, upload: props.upload, crash, description: props.description,
      formAfterMs: props.formAfterMs, open: props.jobsOpen });
  }
  return props.view === 'overview' ? h(Overview, { description: props.description })
    : h(ApplicationForm, { log: props.log, upload: props.upload, crash, restored: props.restored });
}

/** Mounts the page into `container` (see the header). */
export function mountWorkablePage(container: Element, options: MountOptions): { unmount: () => void } {
  const root = createRoot(container);
  root.render(h(Page, { log: options.log, drawAfterMs: options.drawAfterMs ?? 0, view: options.view ?? 'application',
    description: options.description ?? DESCRIPTION, upload: options.upload ?? UPLOADED,
    restored: options.restored ?? {}, formAfterMs: options.formAfterMs ?? 300, jobsOpen: options.jobsOpen === true }));
  return { unmount: () => root.unmount() };
}

/** The cookie banner's buttons, which record a press (the page's own markup, outside the form). */
export function watchCookies(doc: Document, log: WorkableLog): void {
  for (const button of Array.from(doc.querySelectorAll('[data-ui^="cookie-consent"] button'))) {
    button.addEventListener('click', () => log.pressed.push(button.textContent ?? ''));
  }
}
