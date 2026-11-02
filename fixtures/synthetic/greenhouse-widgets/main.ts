/*
 * The page's entry (index.html says where it is served): the job's id in the address picks how the form starts and
 * which questions it asks, and window.__gh is the form's log (app.ts).
 */
import { mountGreenhouseForm, mountHeaderButton, newLog, type MountOptions } from './app';

const JOBS: Record<string, Pick<MountOptions, 'start' | 'form'>> = { 9100: { start: 'now' }, 9101: { start: 'late' },
  9102: { start: 'rebuild' }, 9103: { start: 'now', form: 'beyondtrust' } };

const log = newLog();
(window as unknown as { __gh: unknown }).__gh = log;
mountHeaderButton(document.getElementById('autofill-host')!, log);
const job = /\/jobs\/(\d+)/.exec(location.pathname)?.[1] ?? '9100';
mountGreenhouseForm(document.getElementById('gh-root')!, { ...(JOBS[job] ?? { start: 'now' }), log });
