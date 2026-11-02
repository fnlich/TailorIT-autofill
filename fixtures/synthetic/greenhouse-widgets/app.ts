/*
 * Greenhouse's application form, drawn with the real react-select v5 (react-select 5.10.2, emotion 11.14) inside a
 * wrapper that does what the Greenhouse capture of 2026-11-01 recorded (docs/FIXTURES.md, "The Greenhouse widget
 * capture"; its handlers log and props log):
 * - the wrapper holds whether each menu is open (menuIsOpen) and passes react-select a Control component wrapped in a
 *   div whose onMouseUp toggles it (`() => T(!q)`), whose onKeyUp opens it on any key but Enter and closes it on
 *   Escape and Tab, and whose onTouchEnd toggles it; react-select's onBlur closes it, and so does a choice (onChange).
 *   react-select's own opening (on a mousedown, a focus or typing, through onMenuOpen) changes nothing;
 * - Greenhouse's props: classNamePrefix "select", className "select-shell", inputId and instanceId the question's id,
 *   aria-labelledby its label, required, isClearable, placeholder "Select...", maxMenuHeight 300, closeMenuOnSelect,
 *   blurInputOnSelect false, menuShouldScrollIntoView, and its own Control, Input (enterKeyHint "done"),
 *   DropdownIndicator (a "Toggle flyout" button with no handler of its own), ClearIndicator ("Clear selections"),
 *   MultiValueRemove (a role=button div holding a "Remove selection" button) and no IndicatorSeparator. emotion's key is
 *   "remix-css", so its classes are the capture's (remix-css-13cymwt-control ...);
 * - the lists that load: Degree loads its ten options when it opens; School loads its first page of 100 schools when
 *   it opens, the next page when its list is scrolled to the end, and a search (debounced 300 ms) when something is
 *   typed into it while it is open (typing while it is closed sends nothing); Location (City) asks a geocoder
 *   (debounced 300 ms) whenever something is typed, open or not, and shows the results only while it is open, and of
 *   them only those whose label holds the typed text (react-select's own filter, as on the live BeyondTrust form of
 *   2026-11-01: the geocoder answers "Austin, TX" with Austin in Texas, which the list never shows, since its label
 *   reads "Austin, Texas, United States"). While a list loads, react-select shows "Loading..."
 *   (.select__menu-notice--loading) and its loading dots;
 * - the phone's country lists "Canada +1" with each country's flag, and shows the flag and "+1" once chosen;
 * - a checkbox question is a fieldset of native boxes that React holds: a click() ticks a box as React sees it, and
 *   setting .checked does not;
 * - choosing No for "Are you Hispanic/Latino?" reveals the Race question;
 * - the buttons the extension must never press ("Autofill my application", "Locate me", Dropbox, Google Drive, "Enter
 *   manually", "Clear selections", a chip's remove button) record every press.
 * How it starts (MountOptions.start): 'now' renders at once; 'late' shows the form's markup first, with nothing
 * listening, and React attaches to it (hydrateRoot) `attachMs` later, as Greenhouse's React attaches 1.8 to 3.1 s after
 * its form shows; 'rebuild' shows the markup first and `attachMs` later throws the whole form away, the form element
 * (the adapter's form root) and its Submit included, and draws it again with new nodes, as Twitch's page is drawn again
 * once its first render fails: a run holding the old form root holds a detached one.
 * The page script never dispatches an event, focuses, clicks or submits: every event on a control is the extension's.
 * What React holds, and what the page saw, is written to the log object the caller gives (window.__gh on the page).
 */
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import {
  createElement as h, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactElement,
} from 'react';
import { flushSync } from 'react-dom';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import Select, {
  components, type ClearIndicatorProps, type ControlProps, type InputProps, type MultiValue, type MultiValueRemoveProps,
  type SelectComponentsConfig, type GroupBase, type SingleValue, type OptionProps, type SingleValueProps,
} from 'react-select';

/** One option of a select. */
export interface Choice {
  value: string;
  label: string;
  /** A phone country's flag (intl-tel-input's iti__<code> class). */
  flag?: string;
}

/** What the page logs: React's values, by question id, and what each control saw. */
export interface GreenhouseLog {
  /** React's value of each question: an option's value, an array of them, a text, or null. */
  values: Record<string, unknown>;
  /** The wrapper mouseups React handled, by select id (each toggled its menu). */
  mouseups: Record<string, number>;
  /** Every school request: its term ('' for the first page) and page. */
  schoolRequests: Array<{ term: string; page: number }>;
  /** Every geocoder request. */
  locationRequests: string[];
  /** The never-pressed buttons a press reached, by their words. */
  pressed: string[];
  /** When React attached (performance.now()), or null before. */
  attachedAt: number | null;
  /** How many times the form was drawn from scratch by React (1, or 2 after a rebuild). */
  draws: number;
}

/** How the form starts, and how long its lists take. */
export interface MountOptions {
  start?: 'now' | 'late' | 'rebuild';
  /** For 'late' and 'rebuild': when React attaches, after the markup shows. */
  attachMs?: number;
  /** Where emotion puts its styles: the document's head by default. */
  styles?: HTMLElement;
  /** Each list's delay, in ms. */
  degreeMs?: number;
  schoolPageMs?: number;
  searchMs?: number;
  log?: GreenhouseLog;
}

const DEBOUNCE_MS = 300;

/** A new log. */
export function newLog(): GreenhouseLog {
  return { values: {}, mouseups: {}, schoolRequests: [], locationRequests: [], pressed: [], attachedAt: null, draws: 0 };
}

// ── The lists ─────────────────────────────────────────────────────────────────────────────────────────────────────

const YES_NO: Choice[] = [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }];

/** The capture's degree list (twitch, /education/degrees). */
const DEGREES: Choice[] = ["Associate's Degree", "Bachelor's Degree", 'Doctor of Medicine (M.D.)',
  'Doctor of Philosophy (Ph.D.)', "Engineer's Degree", 'High School', 'Juris Doctor (J.D.)',
  'Master of Business Administration (M.B.A.)', "Master's Degree", 'Other'].map((label, at) => ({ value: `d${at}`, label }));

/** 197 countries, by their ISO codes, named in English: the shape of the capture's citizenship list. */
const COUNTRY_CODES = ('AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF '
  + 'TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY '
  + 'HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU '
  + 'MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST '
  + 'SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE '
  + 'VN YE ZM ZW PS TW XK').split(' ');

function countries(): Choice[] {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  return COUNTRY_CODES.map((code) => ({ value: code, label: names.of(code) ?? code }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The phone's countries: the United States first, then by name, each with its dial code and flag (the capture's
 *  #country list holds 244 of them). */
const PHONE: Array<[string, string]> = [['us', '1'], ['af', '93'], ['al', '355'], ['dz', '213'], ['ar', '54'],
  ['au', '61'], ['at', '43'], ['bd', '880'], ['be', '32'], ['br', '55'], ['ca', '1'], ['cl', '56'], ['cn', '86'],
  ['co', '57'], ['dk', '45'], ['eg', '20'], ['fi', '358'], ['fr', '33'], ['de', '49'], ['gr', '30'], ['in', '91'],
  ['ie', '353'], ['il', '972'], ['it', '39'], ['jp', '81'], ['mx', '52'], ['nl', '31'], ['nz', '64'], ['ng', '234'],
  ['no', '47'], ['pk', '92'], ['pe', '51'], ['ph', '63'], ['pl', '48'], ['pt', '351'], ['ro', '40'], ['sg', '65'],
  ['za', '27'], ['es', '34'], ['se', '46'], ['ch', '41'], ['tr', '90'], ['ua', '380'], ['ae', '971'], ['gb', '44']];

function phoneCountries(): Choice[] {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const all = PHONE.map(([code, dial]) => ({ value: code, flag: code, label: `${names.of(code.toUpperCase()) ?? code} +${dial}` }));
  return [all[0]!, ...all.slice(1).sort((a, b) => a.label.localeCompare(b.label))];
}

/** Schools: the decoys around the one the golden profile names, and enough others for three pages. */
const SCHOOL_NAMES = ['University of Texas at Austin', 'University of Texas at Dallas', 'University of Texas at Arlington',
  'Austin College', 'Austin Community College', 'Stanford University', 'Texas A&M University', 'Rice University',
  'Massachusetts Institute of Technology', 'University of California, Berkeley'];
const SCHOOL_WORDS = ['Aalto', 'Abbott', 'Abilene', 'Adams', 'Albany', 'Alder', 'Allegheny', 'Alma', 'Amherst', 'Andrews',
  'Arcadia', 'Ashland', 'Auburn', 'Augusta', 'Avila', 'Baker', 'Baldwin', 'Bard', 'Bates', 'Baylor', 'Belmont', 'Benedict',
  'Berea', 'Bethel', 'Biola', 'Bowdoin', 'Bradley', 'Brandeis', 'Brenau', 'Bryant'];

function schools(): Choice[] {
  const generated = SCHOOL_WORDS.flatMap((word) => [`${word} University`, `${word} College`, `${word} State University`,
    `${word} Institute`, `${word} Polytechnic`, `${word} School of Design`, `${word} Seminary`, `${word} Academy`]);
  return [...SCHOOL_NAMES, ...generated].sort((a, b) => a.localeCompare(b)).map((label, at) => ({ value: `s${at}`, label }));
}

/** The geocoder's places (the capture's results for "Austin", and a few more). */
const PLACES = ['Austin, Texas, United States', 'Austintown, Ohio, United States', 'Austin, Minnesota, United States',
  'Austin, Indiana, United States', 'Taman Mount Austin, Johor, Malaysia', 'Austin, Arkansas, United States',
  'Austins Ferry, Tasmania, Australia', 'Port Austin, Michigan, United States',
  'Borough of Austin, Pennsylvania, United States', 'Austin, Pennsylvania, United States',
  'Dallas, Texas, United States', 'Denver, Colorado, United States', 'San Francisco, California, United States'];

/** The geocoder's answer: up to ten places whose words hold the query's first part (its city), those that also name
 *  any later part (a state) first. */
function geocode(query: string): Choice[] {
  const parts = query.toLowerCase().split(',').map((part) => part.trim()).filter((part) => part !== '');
  if (parts.length === 0) return [];
  const regions: Record<string, string> = { tx: 'texas', mn: 'minnesota', oh: 'ohio', in: 'indiana', ar: 'arkansas',
    pa: 'pennsylvania', mi: 'michigan', co: 'colorado', ca: 'california', us: 'united states', usa: 'united states' };
  const city = parts[0]!;
  const rest = parts.slice(1).map((part) => regions[part] ?? part);
  const found = PLACES.filter((place) => place.toLowerCase().includes(city));
  const named = (place: string) => rest.filter((part) => place.toLowerCase().includes(part)).length;
  return [...found].sort((a, b) => named(b) - named(a)).slice(0, 10).map((label) => ({ value: label, label }));
}

// ── The questions ─────────────────────────────────────────────────────────────────────────────────────────────────

/** react-select's own parts, for this page's options. */
const Base = {
  Control: components.Control<Choice, boolean, GroupBase<Choice>>,
  Input: components.Input<Choice, boolean, GroupBase<Choice>>,
  Option: components.Option<Choice, boolean, GroupBase<Choice>>,
  SingleValue: components.SingleValue<Choice, boolean, GroupBase<Choice>>,
};

type Loader = 'degree' | 'school' | 'location';

interface SelectSpec {
  id: string;
  label: string;
  required: boolean;
  multi?: boolean;
  options?: Choice[];
  load?: Loader;
  /** Location has no "Toggle flyout" button. */
  toggle?: boolean;
  /** "Select..." unless given (the phone's country and Location show none). */
  placeholder?: string;
}

interface Env {
  log: GreenhouseLog;
  timings: { degreeMs: number; schoolPageMs: number; searchMs: number };
  setValue(id: string, value: unknown): void;
}

const svg = () => h('svg', { className: 'svg-icon', fill: 'none', height: '20', width: '20', viewBox: '0 0 24 24',
  xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true' }, h('path', { d: 'M6 9l6 6 6-6' }));

const required = (on: boolean) => (on ? h('span', { 'aria-hidden': 'true' }, '*') : null);

/** A Greenhouse select: react-select inside the wrapper that holds menuIsOpen (see the header). */
function GhSelect({ spec, env }: { spec: SelectSpec; env: Env }): ReactElement {
  const { id } = spec;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<SingleValue<Choice> | MultiValue<Choice>>(spec.multi ? [] : null);
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<Choice[]>(spec.options ?? []);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const toggle = useRef<(next?: boolean) => void>(() => undefined);
  toggle.current = (next) => setOpen((was) => next ?? !was);
  const wanted = useRef('');

  // Degree: its options when it first opens.
  useEffect(() => {
    if (spec.load !== 'degree' || !open || options.length > 0) return undefined;
    setLoading(true);
    const timer = window.setTimeout(() => {
      setOptions(DEGREES);
      setLoading(false);
    }, env.timings.degreeMs);
    return () => window.clearTimeout(timer);
  }, [open, spec.load, options.length, env.timings.degreeMs]);

  // School: the first page (or the typed search) when it is open, debounced while something is typed.
  useEffect(() => {
    if (spec.load !== 'school' || !open) return undefined;
    const term = input.trim();
    setLoading(true);
    setOptions([]);
    const timer = window.setTimeout(() => {
      env.log.schoolRequests.push({ term, page: 1 });
      wanted.current = term;
      window.setTimeout(() => {
        if (wanted.current !== term) return;
        const all = schools().filter((school) => school.label.toLowerCase().includes(term.toLowerCase()));
        setOptions(all.slice(0, 100));
        setPage(1);
        setLoading(false);
      }, term === '' ? env.timings.schoolPageMs : env.timings.searchMs);
    }, term === '' ? 0 : DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, input, spec.load, env]);

  // Location: the geocoder, whenever something is typed; its results show only while the list is open.
  useEffect(() => {
    if (spec.load !== 'location') return undefined;
    const term = input.trim();
    if (term === '') {
      setOptions([]);
      return undefined;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      env.log.locationRequests.push(term);
      wanted.current = term;
      window.setTimeout(() => {
        if (wanted.current !== term) return;
        setOptions(geocode(term));
        setLoading(false);
      }, env.timings.searchMs);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input, spec.load, env]);

  const parts = useMemo((): SelectComponentsConfig<Choice, boolean, GroupBase<Choice>> => ({
    Control: (props: ControlProps<Choice, boolean>) => h('div', {
      onMouseUp: () => {
        env.log.mouseups[id] = (env.log.mouseups[id] ?? 0) + 1;
        toggle.current();
      },
      onKeyUp: (event: KeyboardEvent) => {
        if (event.code === 'Escape' || event.code === 'Tab') toggle.current(false);
        else if (event.code !== 'Enter') toggle.current(true);
      },
      onTouchEnd: () => toggle.current(),
    }, h(Base.Control, props)),
    Input: (props: InputProps<Choice, boolean>) => h(Base.Input, { ...props, enterKeyHint: 'done' } as InputProps<Choice, boolean>),
    DropdownIndicator: spec.toggle === false ? null : () => h('button', { type: 'button', className: 'icon-button icon-button--sm',
      'aria-label': 'Toggle flyout', tabIndex: -1 }, svg()),
    IndicatorSeparator: null,
    ClearIndicator: (props: ClearIndicatorProps<Choice, boolean>) => h('div', { 'aria-hidden': 'false' },
      h('button', { type: 'button', className: 'icon-button icon-button--sm', 'aria-label': 'Clear selections',
        'data-testid': 'clear-selection', onClick: () => {
          env.log.pressed.push('Clear selections');
          props.clearValue();
        } }, svg())),
    MultiValueRemove: (props: MultiValueRemoveProps<Choice, boolean>) => h('div', { ...props.innerProps, role: 'button',
      className: 'select__multi-value__remove', onClick: (event: unknown) => {
        env.log.pressed.push('Remove selection');
        (props.innerProps.onClick as ((event: unknown) => void) | undefined)?.(event);
      } }, h('button', { type: 'button', className: 'icon-button icon-button--xs icon-button--hover-gray',
      'aria-label': 'Remove selection' }, svg())),
    // The phone's country: each option and the answer carry the country's flag; the answer shows its dial code alone.
    Option: (props: OptionProps<Choice, boolean>) => h(Base.Option, props,
      props.data.flag ? h('div', { className: `iti__flag iti__${props.data.flag}` }) : null, props.children),
    SingleValue: (props: SingleValueProps<Choice, boolean>) => h(Base.SingleValue, props,
      props.data.flag ? [h('div', { key: 'flag', className: `iti__flag iti__${props.data.flag}` }),
        h('span', { key: 'dial' }, props.data.label.replace(/^.* (\+\d+)$/, '$1'))] : props.children),
  }), [id, env, spec.toggle]);

  const choose = (next: SingleValue<Choice> | MultiValue<Choice>) => {
    setValue(next);
    toggle.current(false);
    env.setValue(id, Array.isArray(next) ? (next as readonly Choice[]).map((option) => option.value)
      : (next as Choice | null)?.value ?? null);
  };
  return h('div', { className: 'select' }, h('div', { className: 'select__container' },
    h('label', { id: `${id}-label`, htmlFor: id, className: 'label select__label' }, spec.label, required(spec.required)),
    h(Select<Choice, boolean>, {
      instanceId: id, inputId: id, required: spec.required, 'aria-labelledby': `${id}-label`,
      'aria-errormessage': `${id}-error`, 'aria-invalid': false, isMulti: spec.multi === true, className: 'select-shell',
      classNamePrefix: 'select', isClearable: true, isDisabled: false, options, placeholder: spec.placeholder ?? 'Select...',
      components: parts, isLoading: loading, menuIsOpen: open, value, inputValue: input,
      onInputChange: (next: string) => setInput(next), onChange: choose, onBlur: () => toggle.current(false),
      onMenuOpen: () => undefined, onMenuClose: () => undefined,
      onMenuScrollToBottom: () => {
        if (spec.load !== 'school' || loading || options.length < page * 100) return;
        const term = input.trim();
        env.log.schoolRequests.push({ term, page: page + 1 });
        setLoading(true);
        window.setTimeout(() => {
          const all = schools().filter((school) => school.label.toLowerCase().includes(term.toLowerCase()));
          setOptions(all.slice(0, (page + 1) * 100));
          setPage(page + 1);
          setLoading(false);
        }, env.timings.schoolPageMs);
      },
      // School shows its server's results as they come; every other list (Location's geocoder results included) only
      // the options whose label holds the typed text, react-select's own filter.
      filterOption: spec.load === 'school' ? null : undefined,
      noOptionsMessage: () => (spec.load === 'location' ? null : 'No options'),
      loadingMessage: () => 'Loading...', maxMenuHeight: 300, minMenuHeight: 140, menuPlacement: 'bottom',
      menuPosition: 'absolute', menuShouldScrollIntoView: true, menuShouldBlockScroll: false, captureMenuScroll: true,
      closeMenuOnSelect: true, blurInputOnSelect: false, backspaceRemovesValue: true, escapeClearsValue: false,
      openMenuOnClick: true, openMenuOnFocus: false, isSearchable: true,
    })));
}

/** A text box, drawn as Greenhouse draws one. */
function GhText({ id, label, required: needed, type, autoComplete, env }: { id: string; label: string; required: boolean;
  type: string; autoComplete?: string; env: Env }): ReactElement {
  const [text, setText] = useState('');
  return h('div', { className: 'field-wrapper' }, h('div', { className: 'text-input-wrapper' },
    h('div', { className: 'input-wrapper' },
      h('label', { id: `${id}-label`, htmlFor: id, className: 'label label' }, label, required(needed)),
      h('input', { id, className: 'input input__single-line', 'aria-label': label, 'aria-required': needed, type,
        maxLength: 255, autoComplete, value: text, onChange: (event: ChangeEvent<HTMLInputElement>) => {
          setText(event.target.value);
          env.setValue(id, event.target.value);
        } }))));
}

/** A checkbox question: a fieldset of native boxes React holds. */
function GhCheckboxes({ id, label, options, env }: { id: string; label: string; options: Choice[]; env: Env }): ReactElement {
  const [ticked, setTicked] = useState<string[]>([]);
  const name = `${id}[]`;
  return h('div', { className: 'field-wrapper' }, h('fieldset', { className: 'checkbox', id: name },
    h('legend', { className: 'label checkbox__label' }, label, required(true)),
    ...options.map((option) => h('div', { key: option.value, className: 'checkbox__wrapper' },
      h('div', { className: 'checkbox__input' }, h('input', { type: 'checkbox', id: `${name}_${option.value}`, name,
        value: option.value, required: ticked.length === 0, checked: ticked.includes(option.value),
        onChange: () => {
          const next = ticked.includes(option.value) ? ticked.filter((held) => held !== option.value)
            : [...ticked, option.value];
          setTicked(next);
          env.setValue(name, next);
        } })),
      h('label', { htmlFor: `${name}_${option.value}` }, option.label)))));
}

/** A button the extension must never press: it records the press. */
function never(words: string, env: Env, props: Record<string, unknown> = {}): ReactElement {
  return h('button', { type: 'button', ...props, onClick: () => env.log.pressed.push(words) }, words);
}

/** The resume's upload group, as Greenhouse draws it. */
function GhUpload({ env }: { env: Env }): ReactElement {
  return h('div', { className: 'field-wrapper' }, h('div', { role: 'group', 'aria-labelledby': 'upload-label-resume',
    'aria-required': 'true', className: 'file-upload' },
  h('div', { id: 'upload-label-resume', className: 'label upload-label' }, 'Resume/CV', h('span', { className: 'required' }, '*')),
  h('div', { className: 'file-upload__wrapper' }, h('div', { className: 'button-container' },
    h('div', { className: 'secondary-button' }, h('div', null,
      h('button', { type: 'button', className: 'btn btn--rounded' }, 'Attach'),
      h('label', { className: 'visually-hidden', htmlFor: 'resume' }, 'Attach'),
      h('input', { id: 'resume', className: 'visually-hidden', type: 'file', accept: '.pdf,.doc,.docx,.txt,.rtf',
        onChange: (event: ChangeEvent<HTMLInputElement>) => env.setValue('resume', event.target.files?.[0]?.name ?? null) }))),
    h('div', { className: 'secondary-button' }, never('Dropbox', env, { className: 'btn btn--rounded', 'data-testid': 'resume-dropbox' })),
    h('div', { className: 'secondary-button' }, never('Google Drive', env, { className: 'btn btn--rounded' })),
    h('div', { className: 'secondary-button' }, h('div', null,
      never('Enter manually', env, { className: 'btn btn--rounded', 'data-testid': 'resume-text' }),
      h('label', { className: 'visually-hidden', htmlFor: 'resume_text' }, 'Enter manually')))))));
}

/** The phone's fieldset: its country select, intl-tel-input's hidden country search, and the number. */
function GhPhone({ env }: { env: Env }): ReactElement {
  const [text, setText] = useState('');
  return h('div', null, h('fieldset', { className: 'phone-input' },
    h('legend', { className: 'visually-hidden' }, 'Phone'),
    h('div', { className: 'phone-input__country' }, h(GhSelect, { env, spec: { id: 'country', label: 'Country', required: true,
      options: phoneCountries(), placeholder: '' } })),
    h('div', { className: 'phone-input__phone' }, h('div', { className: 'text-input-wrapper' }, h('div', { className: 'input-wrapper' },
      h('label', { id: 'phone-label', htmlFor: 'phone', className: 'label label' }, 'Phone', required(true)),
      h('div', { className: 'iti' }, h('div', { className: 'iti__country-container' },
        h('div', { id: 'iti-0__dropdown-content', className: 'iti__dropdown-content iti__hide', role: 'dialog' },
          h('input', { id: 'iti-0__search-input', type: 'search', className: 'iti__search-input', placeholder: 'Search',
            role: 'combobox', 'aria-expanded': 'true', 'aria-label': 'Search', 'aria-controls': 'iti-0__country-listbox',
            'aria-autocomplete': 'list', autoComplete: 'off', readOnly: true }),
          h('ul', { id: 'iti-0__country-listbox', role: 'listbox', 'aria-label': 'List of countries' },
            h('li', { role: 'option', 'aria-selected': 'false' }, 'United States +1')))),
      h('input', { id: 'phone', className: 'input input__single-line', 'aria-required': 'true', type: 'tel', autoComplete: 'tel',
        value: text, onChange: (event: ChangeEvent<HTMLInputElement>) => {
          setText(event.target.value);
          env.setValue('phone', event.target.value);
        } })))))));
}

/** The whole form's questions. */
function GhForm({ env }: { env: Env }): ReactElement {
  const [hispanic, setHispanic] = useState<string | null>(null);
  const field = (spec: SelectSpec) => h('div', { key: spec.id, className: 'field-wrapper' }, h(GhSelect, { spec, env }));
  // One object for the form's life: a select whose env changes draws its control again with new nodes, which
  // Greenhouse's never does (its components are the module's own).
  const eeo = useMemo(() => ({ ...env, setValue: (id: string, value: unknown) => {
    env.setValue(id, value);
    if (id === 'hispanic_ethnicity') setHispanic(value as string | null);
  } }), [env]);
  return h('div', null,
    h('div', { className: 'application--questions' },
      h(GhText, { id: 'first_name', label: 'First Name', required: true, type: 'text', autoComplete: 'given-name', env }),
      h(GhText, { id: 'last_name', label: 'Last Name', required: true, type: 'text', autoComplete: 'family-name', env }),
      h(GhText, { id: 'email', label: 'Email', required: true, type: 'text', autoComplete: 'email', env }),
      h(GhPhone, { env }),
      h('div', { className: 'field-wrapper' },
        h(GhSelect, { env, spec: { id: 'candidate-location', label: 'Location (City)', required: true, load: 'location', toggle: false,
          placeholder: '' } }),
        never('Locate me', env, { className: 'btn--tertiary' })),
      h(GhUpload, { env })),
    h('div', { className: 'education--container' }, h('div', { className: 'education--form' }, h('hr'),
      h('div', { className: 'education--header' }, h('p', { className: 'body body--medium' }, 'Education')),
      h(GhSelect, { env, spec: { id: 'school--0', label: 'School', required: false, load: 'school' } }),
      h(GhSelect, { env, spec: { id: 'degree--0', label: 'Degree', required: false, load: 'degree' } }))),
    h('div', { className: 'application--questions' },
      field({ id: 'question_9001', label: 'Are you legally authorized to work in the United States?', required: true, options: YES_NO }),
      field({ id: 'question_9002', label: 'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?',
        required: true, options: YES_NO }),
      h(GhCheckboxes, { env, id: 'question_9003', label: 'How did you hear about this opportunity? (select all that apply)',
        options: ['LinkedIn', 'Indeed', 'Glassdoor', 'Company Website', 'Other'].map((label, at) => ({ value: `90030${at}`, label })) }),
      field({ id: 'question_9004[]', label: 'Which of these skills have you used?', required: true, multi: true,
        options: ['TypeScript', 'Ruby', 'PostgreSQL', 'Kubernetes', 'Scala', 'Go'].map((label, at) => ({ value: `90040${at}`, label })) }),
      field({ id: 'question_9005', label: 'What is your current country of residence?', required: true, options: countries() })),
    h('div', { className: 'eeoc__container body' },
      h('h2', { className: 'section-header font-primary' }, 'Voluntary Self-Identification'),
      h('p', null, 'Completing this section is voluntary.'),
      h('div', { className: 'field-wrapper' }, h(GhSelect, { env, spec: { id: 'gender', label: 'Gender', required: false,
        options: ['Male', 'Female', 'Decline To Self Identify'].map((label, at) => ({ value: `${at + 1}`, label })) } })),
      h('div', { className: 'field-wrapper' }, h(GhSelect, { env: eeo, spec: { id: 'hispanic_ethnicity', label: 'Are you Hispanic/Latino?',
        required: false, options: [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' },
          { value: 'Decline', label: 'Decline To Self Identify' }] } })),
      hispanic === 'No' ? h('div', { className: 'field-wrapper' }, h(GhSelect, { env, spec: { id: 'race', label: 'Please identify your race',
        required: false, options: ['American Indian or Alaskan Native', 'Asian', 'Black or African American',
          'Native Hawaiian or Other Pacific Islander', 'White', 'Two or More Races', 'Decline To Self Identify']
          .map((label, at) => ({ value: `${at + 1}`, label })) } })) : null,
      h('div', { className: 'field-wrapper' }, h(GhSelect, { env, spec: { id: 'veteran_status', label: 'Veteran Status', required: false,
        options: ['I am not a protected veteran', 'I identify as one or more of the classifications of a protected veteran',
          "I don't wish to answer"].map((label, at) => ({ value: `${at + 1}`, label })) } })),
      h('div', { className: 'field-wrapper' }, h(GhSelect, { env, spec: { id: 'disability_status', label: 'Disability Status', required: false,
        options: ['Yes, I have a disability, or have had one in the past',
          'No, I do not have a disability and have not had one in the past', 'I do not want to answer']
          .map((label, at) => ({ value: `${at + 1}`, label })) } }))));
}

/** The header's "Autofill my application" button, above the form: it records any press. */
export function mountHeaderButton(host: Element, log: GreenhouseLog): void {
  const button = host.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--rounded';
  button.textContent = 'Autofill my application';
  button.addEventListener('click', () => log.pressed.push('Autofill my application'));
  host.append(button);
}

/** Draws the form's questions into `container` (inside the page's form), as `options.start` says (see the header). */
export function mountGreenhouseForm(container: HTMLElement, options: MountOptions = {}): { log: GreenhouseLog; unmount(): void } {
  const log = options.log ?? newLog();
  const doc = container.ownerDocument;
  const view = doc.defaultView!;
  const cache = createCache({ key: 'remix-css', container: options.styles ?? doc.head });
  const env: Env = {
    log,
    timings: { degreeMs: options.degreeMs ?? 500, schoolPageMs: options.schoolPageMs ?? 800, searchMs: options.searchMs ?? 600 },
    setValue: (id, value) => {
      log.values[id] = value;
    },
  };
  const app = () => h(CacheProvider, { value: cache }, h(GhForm, { env }));
  let root: Root | null = null;
  const attach = () => {
    log.attachedAt = view.performance.now();
  };
  const start = options.start ?? 'now';
  if (start === 'now') {
    root = createRoot(container);
    log.draws += 1;
    flushSync(() => root!.render(app()));
    attach();
    return { log, unmount: () => root?.unmount() };
  }
  // The markup alone first: drawn once off the page (emotion keeps its styles), then shown with nothing listening.
  const stage = doc.createElement('div');
  stage.hidden = true;
  doc.body.append(stage);
  const staging = createRoot(stage);
  flushSync(() => staging.render(app()));
  const markup = stage.innerHTML;
  staging.unmount();
  stage.remove();
  container.innerHTML = markup;
  const timer = view.setTimeout(() => {
    if (start === 'late') {
      root = hydrateRoot(container, app());
    } else {
      // The whole form again, with new nodes: a copy of the page's form (its Submit too) takes its place, and the
      // questions are drawn into the copy's container.
      const form = container.closest('form');
      const copy = form === null ? null : form.cloneNode(true) as HTMLElement;
      const inner = copy === null || container.id === '' ? null
        : copy.querySelector<HTMLElement>(`[id="${container.id}"]`);
      if (inner !== null) form!.replaceWith(copy!);
      const target = inner ?? container;
      target.replaceChildren();
      root = createRoot(target);
      log.draws += 1;
      flushSync(() => root!.render(app()));
    }
    attach();
  }, options.attachMs ?? 2500);
  return { log, unmount: () => {
    view.clearTimeout(timer);
    root?.unmount();
  } };
}
