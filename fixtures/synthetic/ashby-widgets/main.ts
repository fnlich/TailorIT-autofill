/*
 * The page's entry (index.html says where it is served): the posting's id in the address says when the form is drawn,
 * and whether its uploads fail; an address without /application draws the Overview tab instead. The page's saves,
 * uploads and searches go to Ashby's API address (the e2e routes answer it), and window.__ashby is the form's log
 * (app.ts).
 */
import { DESCRIPTION, mountAshbyForm, newLog, watchTabs, type AshbyServer } from './app';
import type { School } from './data';

/** When each posting draws its panel, in ms after the page loads. */
const POSTINGS: Record<string, number> = { '00000000-0000-4000-8000-00000000a5b1': 1500, '00000000-0000-4000-8000-00000000a5b2': 0,
  '00000000-0000-4000-8000-00000000a5b3': 0, '00000000-0000-4000-8000-00000000a5b4': 1500 };

/** The posting whose every upload fails. */
const UPLOAD_FAILS = '00000000-0000-4000-8000-00000000a5b3';

/** The posting whose overview asks applicants not to use AI. */
const NO_AI = '00000000-0000-4000-8000-00000000a5b4';

const API = '/api/non-user-graphql';

/** One of the page's requests to Ashby's API: a POST, as Ashby's GraphQL operations are. */
async function post(op: string, body: unknown): Promise<unknown> {
  const answer = await fetch(`${API}?op=${op}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
  return answer.json();
}

const server: AshbyServer = {
  save(op, path, value) {
    void post(op, { path, value }).catch(() => undefined);
  },
  async places(text) {
    return ((await post('ApiAutocompleteGeoLocation', { text })) as { places: string[] }).places;
  },
  async schools(text) {
    return ((await post('ApiSearchSchoolByCanonicalName', { text })) as { schools: School[] }).schools;
  },
  async upload(name) {
    if (posting === UPLOAD_FAILS) return false;
    return ((await post('ApiCreateFileUploadHandle', { name })) as { ok?: boolean }).ok === true;
  },
};

const log = newLog();
(window as unknown as { __ashby: unknown }).__ashby = log;
watchTabs(document, log);
const posting = /\/([0-9a-f-]{36})(?:\/|$)/.exec(location.pathname)?.[1] ?? '';
const view = /\/application\/?$/.test(location.pathname) ? 'application' : 'overview';
mountAshbyForm(document.getElementById('ashby-panel')!, { log, server, drawAfterMs: POSTINGS[posting] ?? 0, view,
  description: posting === NO_AI ? [...DESCRIPTION, 'Please do not use AI tools to apply.'] : DESCRIPTION });
