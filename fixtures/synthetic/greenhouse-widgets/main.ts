/*
 * The page's entry (index.html says where it is served): the job's id in the address picks how the form starts, and
 * window.__gh is the form's log (app.ts).
 */
import { mountGreenhouseForm, mountHeaderButton, newLog, type MountOptions } from './app';

const STARTS: Record<string, NonNullable<MountOptions['start']>> = { 9100: 'now', 9101: 'late', 9102: 'rebuild' };

const log = newLog();
(window as unknown as { __gh: unknown }).__gh = log;
mountHeaderButton(document.getElementById('autofill-host')!, log);
const job = /\/jobs\/(\d+)/.exec(location.pathname)?.[1] ?? '9100';
mountGreenhouseForm(document.getElementById('gh-root')!, { start: STARTS[job] ?? 'now', log });
