/*
 * The page's entry (index.html says where it is served): the posting's shortcode in the address says when the view is
 * drawn, and an address without /apply/ draws the overview instead. window.__workable is the page's log (app.ts), and
 * the tabs link the posting's two pages, as Workable's do. A file put in is POSTed to Workable's S3 bucket's address
 * (UPLOAD_ADDRESS, the posting named in its query), which the e2e routes answer: 204, or 403 for .../0000000A05/.
 * .../0000000A06/'s draft restored one Experience entry (RESTORED), as the live page puts back its hour-old draft.
 * jr8: on Workable's job site (jobs.workable.com/view/<id>/<slug>) it draws the posting whose "Apply now" opens the
 * application in a dialog (app.ts JobsPage), its uploads named by the view's id.
 */
import { DESCRIPTION, mountWorkablePage, newLog, watchCookies, type Uploader } from './app';

/** When each posting draws its view, in ms after the page loads. */
const POSTINGS: Record<string, number> = { '0000000A01': 1500, '0000000A02': 0, '0000000A03': 0, '0000000A04': 1500,
  '0000000A05': 0, '0000000A06': 0 };
/** Where the live page sends a file (the live check of 2026-11-02 saw its POST). */
const UPLOAD_ADDRESS = 'https://workable-application-form.s3.us-east-1.amazonaws.com/';

/** The posting whose overview asks applicants not to use AI. */
const NO_AI = '0000000A04';
/** The posting whose draft restored a saved Experience entry: the golden profile's earlier job, typed as the person
 *  would. */
const RESTORED = { '0000000A06': { experience: [{ title: 'Software Engineer', company: 'Marrowgate Systems',
  start_date: '07/2019', end_date: '05/2021' }] } } as const satisfies Record<string, object>;

const log = newLog();
(window as unknown as { __workable: unknown }).__workable = log;
watchCookies(document, log);
const match = /^\/([^/]+)\/j\/([0-9A-F]{10})\/(apply\/?)?$/.exec(location.pathname);
const jobsSite = location.hostname === 'jobs.workable.com';
const code = jobsSite ? /^\/view\/([A-Za-z0-9]+)/.exec(location.pathname)?.[1] ?? '' : match?.[2] ?? '';
const base = match === null ? location.pathname : `/${match[1]}/j/${code}/`;
document.querySelector('a[data-ui="role-overview-tab"]')?.setAttribute('href', base);
document.querySelector('a[data-ui="application-form-tab"]')?.setAttribute('href', `${base}apply/`);
const view = jobsSite ? 'jobs' : match?.[3] === undefined ? 'overview' : 'application';
const upload: Uploader = async (field, file) => {
  const body = new FormData();
  body.append('key', field);
  body.append('file', file);
  return (await fetch(`${UPLOAD_ADDRESS}?posting=${code}`, { method: 'POST', body })).ok;
};
const restored = (RESTORED as Record<string, (typeof RESTORED)['0000000A06']>)[code];
mountWorkablePage(document.getElementById('wk-app')!, { log, drawAfterMs: POSTINGS[code] ?? 0, view, upload,
  description: code === NO_AI ? [...DESCRIPTION, 'Please do not use AI tools to apply.'] : DESCRIPTION,
  ...(restored === undefined ? {} : { restored }) });
