// Fails any build that drifts from the narrowest manifest the plan allows (docs/PRIVACY.md justifies each key).
// Checks .output/chrome-mv3, .output/edge-mv3 and .output-e2e/chrome-mv3; pass --all to require all three.
// Every build's bundles hold no other build's TailorIT origin, and every build ships TailorIT's mark as its icons, each
// a PNG of the size its key names (scripts/icons.mjs renders them). There are exactly two content scripts: ours, in the
// isolated world, and the page-world bridge (world MAIN, docs/SPEC-AMENDMENTS.md §12), on the same hosts, with no CSS,
// each within its own size budget. The bridge's bundle is read too: one anonymous function called at once, naming no
// chrome., browser. or postMessage, and run in a bare context it must add no global and listen for its command only,
// and only at a posting or its application form (the v3 Phase 6/7b review, S3). No content script's bundle holds WXT's
// content-script context, whose start-up announces the extension to the page (round 2, E1).
// v3 Phase 8 (docs/SPEC-AMENDMENTS.md §12 Decision 13): `scripting` joins the permissions; the optional host permissions
// are exactly https://*/* and no required host permission is broad; the static content scripts are still the two on
// the ATS hosts; the sentinel (sentinel.js, an unlisted script the worker registers at run time) is in every build,
// listed nowhere in the manifest, within its 17 KiB budget, holding no React, no zod and no DOM write; and
// registrationsFor (src/shared/hosts.ts), read here as the worker reads it, registers that sentinel in the top frame
// only, on every https page but the ATS hosts and every LinkedIn host (LinkedIn is deferred to v5: nothing of the
// extension may run there, even with https://*/* granted), inside the optional host permissions.
// v5 p1-rules (PLAN decisions 9 and 10, the owner's "Implement like jobright. I approved all", 2026-11-08): the required
// host permissions are exactly every https and http page plus TailorIT's origin (never <all_urls>), and there are no
// optional ones; the sentinel's registration also excludes the CAPTCHA and anti-bot vendors' own pages
// (CAPTCHA_VENDOR_MATCHES) and reaches none of them, and no static content script matches one either.
// v5 p1-shell (PLAN decision 1, the sidebar on the page): the sidebar's bundle (sidebar-app.js, an unlisted script the
// worker runs in a tab's top frame on sidebar/load) is in every build, listed nowhere in the manifest, within its own
// budget, holding no WXT content-script context; React lives there, never in the content script.
// v5 p2-detect (PLAN decision 14, adopted for "applied" detection): a third content script, the page-world submit
// watcher (world MAIN, content-scripts/submit-watch.js), on Workday's, ClearCompany's, Oracle's and SuccessFactors'
// candidate hosts alone (SUBMIT_WATCH_MATCHES, each one of ATS_MATCHES), every frame, from document_start, within its
// own budget; its bundle is one anonymous function, names no extension API, no header and no body reader beyond the
// copies its yes-or-no facts need (SUBMIT_WATCH_NEVER_NAMES), and, run in a bare context, adds no global and no
// listener, wraps fetch and XMLHttpRequest exactly where it installs (a posting or form, and, the P2 review's M3,
// anywhere under a single-page candidate app's own path: SUBMIT_WATCH_INSTALLS_AT), SuccessFactors' applyJob exactly
// at its career site's form, and nowhere else, and, driven, reads no body it has no use for and dispatches a sign
// alone. The watcher is told from the bridge by its file.
// v1.5 X (PLAN decision 2, the in-page preview dialog): exactly one web-accessible resource, the preview page
// (WEB_ACCESSIBLE_PAGE), at its dynamic address alone, on every https and http page, and in the build.
// v1.5 (the owner's "all ip address should be changable on .env", 2026-11-10): the production builds' TailorIT is
// TAILORIT_ORIGIN, read as wxt.config.ts reads it (scripts/tailorit-origin.mjs: the environment, else the extension's
// .env, else http://localhost:3100), and their manifests name exactly that origin.
// Usage: node scripts/check-build.mjs [--all]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { setImmediate as nextTurn } from 'node:timers';
import vm from 'node:vm';
import { paint } from './proc.mjs';
import { E2E_TAILORIT_ORIGIN, tailoritOrigin } from './tailorit-origin.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const requireAll = process.argv.includes('--all');
/** The production builds' TailorIT, as wxt.config.ts reads it; a value that is no origin fails the check at once. */
let PRODUCTION_ORIGIN;
try {
  PRODUCTION_ORIGIN = tailoritOrigin({ root: ROOT });
} catch (error) {
  console.error(paint('red', `✗ ${error instanceof Error ? error.message : String(error)}`));
  process.exit(1);
}
const { ALL_SITES_HOST_PERMISSIONS, ATS_MATCHES, CAPTCHA_VENDOR_MATCHES, CONTENT_SCRIPT_FILE, registrationsFor, SENTINEL_FILE,
  SITES_MATCH, SITES_REGISTRATION_ID, SUBMIT_WATCH_MATCHES, WEB_ACCESSIBLE_PAGE,
} = await import(new URL('../src/shared/hosts.ts', import.meta.url).href);
const { SIDEBAR_APP_FILE } = await import(new URL('../src/shared/sidebar.ts', import.meta.url).href);
const MANIFEST_KEY = readFileSync(join(ROOT, 'keys', 'manifest-key.txt'), 'utf8').trim();
/** The content script must stay under this: every file the manifest's content script lists, together. The snapshot
 *  build's integration (2026-11-06) found it at 1,047,869 bytes in production and 1,050,663 in the e2e variant, past the
 *  budget; the in-page UI then read only its own words (src/shared/copy.ts PAGE_COPY, not the options page's and the
 *  side panel's), which made them 1,017,951 and 1,020,745. v5 p1-rules (2026-11-08) raised it to 1 MiB and 4 KiB for
 *  the CAPTCHA switch (PLAN decision 9, about 2.9 KB), while React's in-page card was still in it. v5 p1-shell
 *  (2026-11-08): React and every view it draws left for the sidebar's own bundle (SIDEBAR_APP_BUDGET; test/
 *  content-no-react.test.ts), so with P1-panel and P1-rules merged (ee0e382) the content script is 817,527 bytes in
 *  production and 820,321 in the e2e variant, and the budget is 1 MiB again: about 222 KiB to spare. */
const CONTENT_SCRIPT_BUDGET = 1024 * 1024;
/** v5 p1-shell: the sidebar's bundle (src/entrypoints/sidebar-app.ts: React and react-dom, the side panel's views with
 *  P1-panel's sheet and modals, the in-page card's views, their stylesheets and words, and the zod schemas the views
 *  parse with) must stay under this. The worker runs it in a tab's top frame only when the sidebar or a card opens, never
 *  in every frame at load, so it weighs on no page that does not show one; 749,866 bytes in production and 749,968 in
 *  the e2e variant with P1-panel and P1-rules merged (ee0e382). 800 KiB keeps about 68 KiB for the views still to come,
 *  and stops an accidental second copy of React or of the schemas. */
const SIDEBAR_APP_BUDGET = 800 * 1024;
/** The page-world bridge (src/page/bridge.ts and its protocol, and the address parsers it installs by: the v3 Phase
 *  6/7b review, S3) must stay under this. The new ATSs (DESIGN-NEW-ATS §5) raised it from 20 KiB to 30 KiB for their
 *  fifteen address parsers (src/adapters/address.ts URL_PARSERS): builder C's eight alone were about 4.8 KiB of the
 *  bundle (16,670 bytes without them, 21,520 with, on Phase 0); with builders A's, B's and C's merged the bundle is
 *  28,897 bytes in both builds (the integration of 2026-11-06). The snapshot build's core pass Z1 (items 26 and 39)
 *  slimmed it: the bridge's decision (src/adapters/bridge-address.ts) reads only the parsers of the platforms with a
 *  host outside the public job hosts (sixteen), so it is 20,921 bytes, under a budget of 24 KiB. v5 p2-detect: 26 KiB,
 *  for the address variants and the pages after submitting its parsers now read (UltiPro's parser joined them for UKG's
 *  other recruiting hosts; Oracle's reads its Candidate Experience on a company's own domain, which platformOfUrl names
 *  with the HR and LinkedIn hosts it keeps off): 20,939 bytes on main 019f489, 26,507 with them (983c81e). */
const BRIDGE_BUDGET = 26 * 1024;
// ── v5 p2-detect: the page-world submit watcher (src/entrypoints/submit-watch.content.ts) ──
/** The submit watcher's file, as WXT writes it (the page-world bridge is the manifest's other world MAIN script). */
const SUBMIT_WATCH_FILE = 'content-scripts/submit-watch.js';
/** The submit watcher must stay under this. Its wrappers and its protocol (src/page/submit-watch.ts,
 *  src/dom/submit-net-protocol.ts) are about 3 KiB; the rest is the page-world bridge's own address decision
 *  (src/adapters/bridge-address.ts and its parsers), which it shares so it installs exactly where the bridge would:
 *  22,024 bytes when it was added (v5 p2-detect, addfa31), under the bridge's 24 KiB. The owner's word of 2026-11-08
 *  ("Jobright is sample ... you can use it") added Oracle's and SuccessFactors' signs and the body facts of Workday and
 *  Oracle, and Oracle's own-domain reading (28,571 bytes at 983c81e), so 28 KiB. The P2 review's M3 added its own
 *  install decision, anywhere under the single-page candidate apps' paths (src/adapters/bridge-address.ts
 *  submitWatchInstallsAt: 29,146 bytes at be29014), so 30 KiB. */
const SUBMIT_WATCH_BUDGET = 30 * 1024;
/** What the watcher's bundle may never name: the extension's APIs, headers, storage, and the body readers it has no
 *  use for. The owner's word of 2026-11-08 ("Jobright is sample ... you can use it") relaxed the rest of this rule for
 *  the three platforms whose sign is one yes-or-no fact of a body, as Jobright reads it (src/dom/submit-net-protocol.ts:
 *  Workday's application id, Oracle's action and flags, SuccessFactors' callback result): Request.clone, Response.clone,
 *  .text(), an XMLHttpRequest's responseText and the body the page sends are allowed now, and what leaves is held by
 *  the behaviour below instead (SUBMIT_WATCH_DRIVES: ClearCompany's bodies are never touched, and every event the
 *  watcher dispatches carries a sign alone). */
const SUBMIT_WATCH_NEVER_NAMES = ['chrome.', 'browser.', 'postMessage', '.json(', '.arrayBuffer(', '.blob(', '.formData(',
  'getReader', 'responseXML', 'getResponseHeader', 'getAllResponseHeaders', '.headers', 'localStorage',
  'sessionStorage', 'indexedDB', 'document.cookie'];
/** Where the watcher wraps fetch and XMLHttpRequest (a Workday, ClearCompany or Oracle posting or form, as the bridge
 *  decides; and, the P2 review's M3, anywhere under those single-page candidate apps' own paths, their job lists
 *  included: src/adapters/bridge-address.ts submitWatchInstallsAt; the last address is an employer's own domain's,
 *  where no manifest entry runs it and the worker injects it once the Oracle adapter detected the app's form), where it
 *  wraps SuccessFactors' applyJob proxy instead (a career site's posting or form), and where it does nothing (a shared
 *  host's page outside a candidate app, another platform's page, an address with none). */
const SUBMIT_WATCH_INSTALLS_AT = [
  'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Engineer_JR-1/apply/applyManually',
  'https://acme.wd5.myworkdayjobs.com/en-US/External', 'https://wd5.myworkdaysite.com/recruiting/acme/External/job/Remote/Engineer_JR-1',
  'https://acme.wd5.myworkdayjobs-impl.com/en-US/External/job/Remote/Engineer_JR-1',
  'https://vafb.clearcompany.com/careers/jobs/9485c936-3d5f-0a3b-27a4-708fe87203d8/apply',
  'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946/apply/section/1',
  // The P2 review (M3): the candidate apps' job lists, where a person enters before the app takes them to a form.
  'https://wd5.myworkdaysite.com/recruiting/acme/External', 'https://vafb.clearcompany.com/careers/jobs',
  'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions',
  'https://careers.example.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions'];
const SUBMIT_WATCH_PROXY_AT = [
  'https://career2.successfactors.eu/career?company=danfossas&career_job_req_id=48659&career_ns=job_application'];
const SUBMIT_WATCH_SILENT_AT = ['https://wd5.myworkdaysite.com/recruiting/acme',
  'https://wd5.myworkdaysite.com/wday/authgwy/acme/login',
  'https://job-boards.greenhouse.io/acme/jobs/4012345', 'https://vafb.clearcompany.com/hr/home',
  'https://careers.example.com/careers/CandidateExperience/en/sites/CX_1/requisitions',
  'https://elhr.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome', 'https://performancemanager4.successfactors.com/sf/home',
  ''];
/** The watcher driven at an address where it wraps fetch: the page's request, the answer the page's own fetch gives,
 *  and what the watcher may do (`touches`: whether it may read that answer's body; `tells`: the only details it may
 *  dispatch, each a sign alone, never a field of a body). The answers hold fields beside the fact read. */
const SUBMIT_WATCH_DRIVES = [
  { at: SUBMIT_WATCH_INSTALLS_AT[0], request: ['/wday/cxs/acme/jobapplication/JA-1/finalize', { method: 'POST', body: '{}' }],
    answer: { status: 200, text: '{"id":"JA-1","applicant":{"name":"A Person","email":"a@example.com"}}' },
    touches: true, tells: ['{"v":1,"sign":"workday-finalize"}'] },
  { at: SUBMIT_WATCH_INSTALLS_AT[4], request: ['/api/v1/careers/apply/form/11111111-2222-3333-4444-555555555555/'
    + '9485c936-3d5f-0a3b-27a4-708fe87203d8/responses/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    + '?isInternalEdit=false&advanceToEnd=false', { method: 'POST', body: '{"answers":["A Person"]}' }],
    answer: { status: 200, text: '{"ResponseType":"WorkflowEnded","Name":"A Person"}' },
    touches: false, tells: ['{"v":1,"sign":"clearcompany-responses"}'] },
  { at: SUBMIT_WATCH_INSTALLS_AT[5], request: ['/hcmRestApi/resources/latest/recruitingCEJobApplications', { method: 'POST',
    body: '{"action":"CREATE","requisitionNumber":12946,"candidateNumber":77,"firstName":"A","lastName":"Person"}' }],
    answer: { status: 201, text: '{"submissionId":5,"email":"a@example.com"}' },
    touches: true, tells: ['{"v":1,"sign":"oracle-created"}'] },
];
// ── end v5 p2-detect ──
// ── v5 p2-fill: the page patches (src/entrypoints/page-patches.ts, PLAN decision 14) ──
/** The page patches' bundle, an unlisted script the worker runs in one frame's page world (world MAIN) as a run begins
 *  there (src/background/page-patches.ts PAGE_PATCHES_FILE): never a content script, never a web-accessible resource. */
const PAGE_PATCHES_FILE = 'page-patches.js';
/** The page patches must stay under this: the page's alert and confirm held through one write (src/page/dialogs.ts),
 *  its own file picker armed for one press (src/page/picker.ts), their listener and protocol (src/page/patches.ts,
 *  src/dom/patch-protocol.ts) and WXT's unlisted-script wrapper: 4,825 bytes when they were added (v5 p2-fill). They
 *  hold no address reading: the worker decides where they run (a frame of ours with a form, as its run begins). */
const PAGE_PATCHES_BUDGET = 8 * 1024;
/** What the patches' bundle may never name: the extension's APIs and window messaging, and any network or storage API
 *  (they observe nothing and keep nothing: docs/PRIVACY.md). */
const PAGE_PATCHES_NEVER_NAMES = ['chrome.', 'browser.', 'postMessage', 'fetch', 'XMLHttpRequest', 'localStorage',
  'sessionStorage', 'indexedDB', 'sendBeacon'];
// ── end v5 p2-fill ──
/** What the bridge's bundle may never name: the extension's APIs (it runs in the page's world, which has none of
 *  them, and must not look for any) and window messaging. */
const BRIDGE_NEVER_NAMES = ['chrome.', 'browser.', 'postMessage'];
/** v3 Phase 8: the sentinel's budget (src/entrypoints/sentinel.ts and what it imports). DESIGN-NEW-ATS Phase 0: 16 KiB
 *  became 17 KiB for the sixteen new ATS match patterns, which the sentinel holds to rule their pages out (shared/hosts.ts
 *  onAtsMatch, isCompanySiteUrl): about 0.7 KiB of host and path text. v5 p1-rules (PLAN decision 9): 18 KiB, for the
 *  CAPTCHA and anti-bot vendors' pages isCompanySiteUrl refuses too (isCaptchaVendorUrl): 17,194 bytes on main 9ac709e,
 *  17,529 with them. v5 p2-detect: 19 KiB, for the address variants' patterns it rules out and Oracle's Candidate
 *  Experience on a company's own domain it recognises by its address (shared/hosts.ts oracleOwnDomain): 18,657 bytes
 *  (983c81e). */
const SENTINEL_BUDGET = 19 * 1024;
/** What the sentinel's bundle may never name: React and zod (it renders and parses nothing), any DOM write, and window
 *  messaging. It reads the page and sends the worker one message. */
const SENTINEL_NEVER_NAMES = ['react.', '__REACT', 'ZodError', '$ZodType', 'zod', 'createElement', 'appendChild', 'insertBefore',
  'replaceChild', 'replaceChildren', 'innerHTML', 'outerHTML', 'insertAdjacent', 'setAttribute', 'removeAttribute',
  'toggleAttribute', 'attachShadow', 'dispatchEvent', 'postMessage', 'execCommand', 'document.write', 'textContent=',
  'chrome.storage', 'browser.storage'];
/** v5 p1-rules (PLAN decision 10): a host permission that reaches more than web pages (every scheme, file pages, ftp or
 *  websockets): never one, required or optional. Every https and http page is required, exactly. */
const BEYOND_WEB_PAGES = /^(?:<all_urls>|(?:wss?|ftp|file|urn|data|chrome-extension):)/;
/** What no content script's bundle may hold: WXT's content-script context, whose start-up dispatches
 *  `<extension id>:<entry>:wxt:content-script-started` on the page's document (and posts it to the window), an event
 *  any page script can listen for to learn the extension is installed (the v3 Phase 6/7b review's round 2, E1). Our
 *  content script is an unlisted script the manifest hook lists (wxt.config.ts), whose wrapper only calls main(). */
const WXT_CONTEXT_NAMES = ['stopOldScripts', 'SCRIPT_STARTED_MESSAGE_TYPE', 'listenForNewerScripts',
  'noScriptStartedPostMessage'];
/** Keys a content script never has: CSS, and every way to reach more frames or other addresses than its matches. */
const NEVER_IN_A_CONTENT_SCRIPT = ['css', 'match_about_blank', 'match_origin_as_fallback', 'include_globs',
  'exclude_globs', 'exclude_matches'];

const BUILDS = [
  { dir: '.output/chrome-mv3', origin: PRODUCTION_ORIGIN, production: true },
  { dir: '.output/edge-mv3', origin: PRODUCTION_ORIGIN, production: true },
  { dir: '.output-e2e/chrome-mv3', origin: E2E_TAILORIT_ORIGIN, production: false },
];
/** Each build's TailorIT, as its bundles name it: none may hold another build's. */
const ORIGIN_HOSTS = [...new Set(BUILDS.map((build) => new URL(build.origin).host))];
/** Whether a bundle names `host` (a TailorIT's host and port) whole: localhost:3100 is not in localhost:31000. */
const namesHost = (text, host) =>
  new RegExp(`(?<![\\w.-])${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.:-])`).test(text);
/**
 * Strings that exist only in the e2e build; a production bundle containing one fails. The e2e fallback's sender check
 * (src/background/senders.ts) is a regular expression, which a bundle holds as written, its dots escaped: hence both
 * spellings of 127.0.0.1. A production TailorIT at 127.0.0.1 (TAILORIT_ORIGIN) names the plain spelling itself, so its
 * bundles are held to the escaped one alone.
 */
const E2E_ONLY = ['e2e:events', 'e2e/probe', 'storage-local-probe', 'localhost:3190', '127.0.0.1', String.raw`127\.0\.0\.1`,
  'tailorit-e2e-test-adapter'].filter((needle) => !PRODUCTION_ORIGIN.includes(needle));
/**
 * Strings only a development build holds: the snapshot hotkeys' marker, which both command names begin with
 * (src/background/capture.ts), the capture page's pageCapture call, and the worker's address for that page. The chrome,
 * edge and e2e builds are all production mode, so a bundle in any of them containing one fails.
 */
const DEV_ONLY = ['tailorit-dev-capture', 'saveAsMHTML', 'capture.html'];
/** Pages only a development build has: the capture page (wxt.config.ts skips it in every other mode). */
const DEV_ONLY_PAGES = ['capture.html'];

/** The manifest's icon sizes; the toolbar's action uses the two smallest. */
const ICON_SIZES = ['16', '32', '48', '128'];
const ACTION_ICON_SIZES = ['16', '32'];
/** A PNG file's first eight bytes. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const failures = [];
const fail = (build, message) => failures.push(`${build.dir}: ${message}`);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/** The manifest's content scripts: ours, with no world key (the isolated world), and the page-world bridge, the one
 *  whose world is MAIN; v5 p2-detect: and the page-world submit watcher, also MAIN, the one script of that world whose
 *  one file is SUBMIT_WATCH_FILE (the bridge is the other). A script in any other world, or a second one of any, is
 *  none of them. */
function contentScripts(manifest) {
  const scripts = manifest.content_scripts ?? [];
  const isolated = scripts.filter((script) => !('world' in script));
  const isWatcher = (script) => Array.isArray(script.js) && script.js.length === 1 && script.js[0] === SUBMIT_WATCH_FILE;
  const main = scripts.filter((script) => script.world === 'MAIN');
  const [bridge, watcher] = [main.filter((script) => !isWatcher(script)), main.filter(isWatcher)];
  return { ours: isolated.length === 1 ? isolated[0] : undefined, bridge: bridge.length === 1 ? bridge[0] : undefined,
    watcher: watcher.length === 1 ? watcher[0] : undefined };
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function checkManifest(build, manifest) {
  const fallback = !build.production && process.env.TAILORIT_FIXTURE_ORIGIN === '1';
  if (manifest.manifest_version !== 3) fail(build, 'manifest_version is not 3');
  if (!sameSet(manifest.permissions ?? [], ['storage', 'sidePanel', 'activeTab', 'alarms', 'scripting'])) {
    fail(build, `permissions are ${JSON.stringify(manifest.permissions)}`);
  }
  // v5 p1-rules (PLAN decision 10, like Jobright): every https and http page at install, and TailorIT; never <all_urls>.
  if (!sameSet(manifest.host_permissions ?? [], [...ALL_SITES_HOST_PERMISSIONS, `${build.origin}/*`])
    || !sameSet([...ALL_SITES_HOST_PERMISSIONS], ['https://*/*', 'http://*/*'])) {
    fail(build, `host_permissions are ${JSON.stringify(manifest.host_permissions)}, not every https and http page plus TailorIT`
      + ` (${build.origin}${build.production ? ', TAILORIT_ORIGIN: build again after changing it' : ''})`);
  }
  for (const host of manifest.host_permissions ?? []) {
    if (BEYOND_WEB_PAGES.test(host)) fail(build, `the host permission ${host} reaches more than web pages`);
  }
  for (const key of ['optional_host_permissions', 'optional_permissions', 'content_security_policy', 'commands', 'update_url']) {
    if (key in manifest) fail(build, `${key} must be absent`);
  }
  checkWebAccessible(build, manifest);
  if (manifest.key !== MANIFEST_KEY) fail(build, 'key is missing or is not the committed public key');
  if (manifest.minimum_chrome_version !== '144') fail(build, 'minimum_chrome_version is not 144');
  if (!manifest.action) fail(build, 'action is missing');
  const scripts = manifest.content_scripts ?? [];
  const { ours, bridge, watcher } = contentScripts(manifest);
  // v5 p2-detect: three, the submit watcher (world MAIN) beside the page-world bridge.
  if (scripts.length !== 3 || ours === undefined || bridge === undefined || watcher === undefined) {
    fail(build, 'expected three content scripts, ours, the page-world bridge and the submit watcher (both world MAIN), '
      + `found ${scripts.length}: ${JSON.stringify(scripts.map((script) => script.world ?? 'isolated'))}`);
  }
  const expected = fallback ? [...ATS_MATCHES, 'http://127.0.0.1/*'] : [...ATS_MATCHES];
  // v5 p1-rules (PLAN decision 9): no static content script ever runs in a CAPTCHA or anti-bot vendor's own frame.
  for (const [script, name] of [[ours, 'the content script'], [bridge, 'the page-world bridge'],
    [watcher, 'the submit watcher']]) {
    for (const address of VENDOR_ADDRESSES) {
      if ((script?.matches ?? []).some((pattern) => patternMatches(pattern, address))) {
        fail(build, `${name} runs in a CAPTCHA vendor's frame at ${address}`);
      }
    }
    // The P2 review (security 2, the S5 principle): nor on an employee HR system's page (HR_ADDRESSES), the job boards
    // of an employer's own UKG Pro for its staff among them. (CareerPlug's employers' host, app.careerplug.com, is under
    // the *.careerplug.com/jobs/* match, which Chrome's patterns cannot narrow: the platform rule refuses it, as before.)
    for (const address of HR_ADDRESSES.filter((each) => !each.startsWith('https://app.careerplug.com/'))) {
      if ((script?.matches ?? []).some((pattern) => patternMatches(pattern, address))) {
        fail(build, `${name} runs on an HR system at ${address}`);
      }
    }
  }
  if (ours) {
    if (!sameSet(ours.matches ?? [], expected)) fail(build, 'content script matches differ from the ATS list');
    if (ours.all_frames !== true) fail(build, 'content script is not all_frames');
    if (ours.run_at !== 'document_idle') fail(build, 'content script does not run at document_idle');
    for (const key of ['world', ...NEVER_IN_A_CONTENT_SCRIPT]) if (key in ours) fail(build, `content script has ${key}`);
  }
  if (bridge) {
    if (!sameSet(bridge.matches ?? [], expected)) fail(build, "the page-world bridge's matches differ from the ATS list");
    if (bridge.all_frames !== true) fail(build, 'the page-world bridge is not all_frames');
    if (bridge.run_at !== 'document_start') fail(build, 'the page-world bridge does not run at document_start');
    if (!Array.isArray(bridge.js) || bridge.js.length !== 1) fail(build, 'the page-world bridge is not one script file');
    for (const key of NEVER_IN_A_CONTENT_SCRIPT) if (key in bridge) fail(build, `the page-world bridge has ${key}`);
  }
  // ── v5 p2-detect: the submit watcher, on the network platforms' candidate hosts alone (each an ATS match) ──
  if (watcher) {
    const watched = fallback ? [...SUBMIT_WATCH_MATCHES, 'http://127.0.0.1/*'] : [...SUBMIT_WATCH_MATCHES];
    if (!sameSet(watcher.matches ?? [], watched)) fail(build, "the submit watcher's matches differ from SUBMIT_WATCH_MATCHES");
    for (const pattern of SUBMIT_WATCH_MATCHES) {
      if (!ATS_MATCHES.includes(pattern)) fail(build, `the submit watcher matches ${pattern}, which is no ATS match`);
    }
    if (watcher.all_frames !== true) fail(build, 'the submit watcher is not all_frames');
    if (watcher.run_at !== 'document_start') fail(build, 'the submit watcher does not run at document_start');
    for (const key of NEVER_IN_A_CONTENT_SCRIPT) if (key in watcher) fail(build, `the submit watcher has ${key}`);
  }
  // The whole object: `ids` would let other extensions connect, `accepts_tls_channel_id` adds a channel.
  if (!isDeepStrictEqual(manifest.externally_connectable, { matches: [`${build.origin}/*`] })) {
    fail(build, `externally_connectable is not exactly TailorIT (${build.origin}`
      + `${build.production ? ', TAILORIT_ORIGIN: build again after changing it' : ''})`);
  }
  if (manifest.options_ui?.open_in_tab !== true) fail(build, 'the options page does not open in a tab');
  for (const page of [manifest.options_ui?.page, manifest.side_panel?.default_path, WEB_ACCESSIBLE_PAGE]) {
    if (!page || !existsSync(join(ROOT, build.dir, page))) fail(build, `page ${page} is missing`);
  }
}

// ── v1.5 X ──
/**
 * The web-accessible resources (PLAN decision 2): exactly one entry, the preview page the dialog over a tab's page
 * embeds (WEB_ACCESSIBLE_PAGE). Why: that dialog shows the résumé on the page the person is on, inside a frame of the
 * extension's own (so the bytes stay in its process and the page's scripts cannot read them), and a page may frame an
 * extension page only when it is web-accessible. `use_dynamic_url: true`, so it loads only at an address that changes
 * each browser session (a page cannot probe for the extension at its fixed id); its matches every https and http page,
 * where the sidebar runs (the host permissions); and nothing else, ever: its scripts, styles and fonts load from the
 * extension's own origin (the page that loads them is ours), and a script, the sidebar's bundle, the content script or
 * a font listed here would be any page's to load. No other key (extension_ids would let other extensions in). The page
 * is in the build.
 */
function checkWebAccessible(build, manifest) {
  const entries = manifest.web_accessible_resources;
  const [entry] = Array.isArray(entries) ? entries : [];
  const exact = Array.isArray(entries) && entries.length === 1 && entry !== null && typeof entry === 'object'
    && sameSet(Object.keys(entry), ['resources', 'matches', 'use_dynamic_url'])
    && isDeepStrictEqual(entry.resources, [WEB_ACCESSIBLE_PAGE]) && entry.use_dynamic_url === true
    && Array.isArray(entry.matches) && sameSet(entry.matches, [...ALL_SITES_HOST_PERMISSIONS]);
  if (!exact) {
    fail(build, `web_accessible_resources must be exactly ${WEB_ACCESSIBLE_PAGE} at its dynamic address on every https and `
      + `http page, found ${JSON.stringify(entries ?? null)}`);
  }
}
// ── end v1.5 X ──

/** The icons: exactly the four sizes, each a PNG in the build whose header (IHDR, bytes 16-23) gives its key's width
 *  and height; the action's icons are the 16 and 32 px ones. */
function checkIcons(build, dir, manifest) {
  const icons = manifest.icons ?? {};
  if (!sameSet(Object.keys(icons), ICON_SIZES)) {
    fail(build, `icons are ${JSON.stringify(Object.keys(icons))}, not 16, 32, 48 and 128`);
  }
  for (const size of ICON_SIZES) {
    const path = icons[size];
    const file = typeof path === 'string' ? join(dir, path) : null;
    if (file === null || !existsSync(file) || !statSync(file).isFile()) {
      fail(build, `the ${size} px icon ${String(path)} is missing`);
      continue;
    }
    const bytes = readFileSync(file);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('latin1', 12, 16) !== 'IHDR') {
      fail(build, `the ${size} px icon ${path} is not a PNG`);
      continue;
    }
    const [width, height] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    if (width !== Number(size) || height !== Number(size)) fail(build, `the ${size} px icon ${path} is ${width}×${height}`);
  }
  const action = manifest.action?.default_icon;
  const expected = Object.fromEntries(ACTION_ICON_SIZES.map((size) => [size, icons[size]]));
  if (!isDeepStrictEqual(action, expected)) fail(build, "the action's icons are not the 16 and 32 px icons");
}

/** A budget over every file a content script lists, wherever the build put them; a listed file that is not there
 *  fails, and so does a script that lists none. `name` is how the failures name it. */
function checkScriptSize(build, dir, script, name, budget) {
  const listed = script?.js;
  if (!Array.isArray(listed) || listed.length === 0) {
    fail(build, `${name} lists no file`);
    return;
  }
  let total = 0;
  for (const path of listed) {
    const file = typeof path === 'string' ? join(dir, path) : null;
    if (file === null || !existsSync(file) || !statSync(file).isFile()) {
      fail(build, `${name} ${String(path)} is missing`);
      continue;
    }
    total += statSync(file).size;
  }
  if (total > budget) fail(build, `${name} is ${total} bytes (${listed.join(', ')}), over the ${budget}-byte budget`);
}

/** Addresses the bridge's bundle is run at (src/adapters/address.ts bridgeInstallsAt): where it installs, a posting or
 *  its form, and any page of a host that serves only public job postings (a board: round 2, E9); where it must not,
 *  every other page of the domains that also hold an employer's own pages (an internal portal, performancemanager, a
 *  search, an Oracle tenant's Fusion page, myworkdaysite.com's own pages) and an address with none (S3). */
const BRIDGE_INSTALLS_AT = ['https://job-boards.greenhouse.io/acme/jobs/4012345',
  'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Engineer_JR-1/apply/applyManually',
  'https://job-boards.greenhouse.io/acme', 'https://jobs.lever.co/acme', 'https://acme.wd5.myworkdayjobs.com/en-US/External',
  'https://wd5.myworkdaysite.com/recruiting/acme/External/job/Remote/Engineer_JR-1'];
const BRIDGE_SILENT_AT = ['https://internal-acme.icims.com/jobs/1/engineer/job',
  'https://performancemanager4.successfactors.com/sf/home', 'https://acme.taleo.net/careersection/2/jobsearch.ftl',
  'https://acme.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome', 'https://wd5.myworkdaysite.com/recruiting/acme/External',
  'https://careers-acme.icims.com/jobs/search?ss=1', '',
  // ── snapshot build 2026-11-06 (oracle-sf-sr): a government cloud tenant's own Fusion page ──
  'https://iaaxmg.fa.ocs.oraclegovcloud.com/fscmUI/faces/FuseWelcome'];

/**
 * The page-world bridge's bundle (src/entrypoints/page-bridge.content.ts): WXT's anonymous wrapper, `(function(){...})();`,
 * naming none of BRIDGE_NEVER_NAMES; and, run in a bare context whose document only records its listeners and has an
 * address, it adds no global and throws nothing; at a posting or its form it listens for exactly one event on the
 * document, its command (src/dom/bridge-protocol.ts), in the capture phase, and anywhere else for none. The page's world
 * is the page's: a global there would be the page's to read and to change.
 */
function checkBridgeBundle(build, dir, bridge) {
  const [path] = Array.isArray(bridge?.js) ? bridge.js : [];
  const file = typeof path === 'string' ? join(dir, path) : null;
  if (file === null || !existsSync(file)) return;
  const text = readFileSync(file, 'utf8').trim();
  if (!text.startsWith('(function(){') || !text.endsWith('})();')) {
    fail(build, 'the page-world bridge is not one anonymous function called at once');
  }
  for (const name of BRIDGE_NEVER_NAMES) if (text.includes(name)) fail(build, `the page-world bridge names "${name}"`);
  for (const href of [...BRIDGE_INSTALLS_AT, ...BRIDGE_SILENT_AT]) {
    const listeners = [];
    const document = { addEventListener: (type, _listener, capture) => listeners.push([type, capture === true]),
      removeEventListener: () => undefined, location: { href } };
    document.defaultView = { document };
    const sandbox = { document, URL };
    const before = new Set(Object.getOwnPropertyNames(sandbox));
    try {
      vm.runInContext(text, vm.createContext(sandbox), { timeout: 1_000 });
    } catch (error) {
      fail(build, `the page-world bridge throws on its own at ${href || 'no address'}: ${String(error).slice(0, 120)}`);
      return;
    }
    const added = Object.getOwnPropertyNames(sandbox).filter((name) => !before.has(name));
    if (added.length > 0) fail(build, `the page-world bridge adds globals: ${added.join(', ')}`);
    const wanted = BRIDGE_INSTALLS_AT.includes(href) ? [['tailorit:bridge', true]] : [];
    if (!isDeepStrictEqual(listeners, wanted)) {
      fail(build, `the page-world bridge listens for ${JSON.stringify(listeners)} at ${href || 'no address'}, not `
        + `${JSON.stringify(wanted)}`);
    }
  }
}

/**
 * v5 p2-detect: the submit watcher's bundle (src/entrypoints/submit-watch.content.ts): WXT's anonymous wrapper, naming
 * none of SUBMIT_WATCH_NEVER_NAMES; and, run in a bare context whose window holds stand-ins for fetch,
 * XMLHttpRequest and SuccessFactors' applyJob proxy and whose document and window record their listeners and events, it
 * adds no global, throws nothing and adds no listener; replaces fetch, open and send exactly at
 * SUBMIT_WATCH_INSTALLS_AT, the proxy's applyJob exactly at SUBMIT_WATCH_PROXY_AT, and nothing anywhere else; and,
 * driven as SUBMIT_WATCH_DRIVES says, reads no body it has no use for and dispatches nothing but a sign.
 */
async function checkSubmitWatchBundle(build, dir, watcher) {
  const [path] = Array.isArray(watcher?.js) ? watcher.js : [];
  const file = typeof path === 'string' ? join(dir, path) : null;
  if (file === null || !existsSync(file)) return;
  const text = readFileSync(file, 'utf8').trim();
  // The same bundle in another build is read once (each address runs it in a context of its own).
  if (!watchProblems.has(text)) watchProblems.set(text, await submitWatchProblems(text));
  for (const problem of watchProblems.get(text)) fail(build, problem);
}

/** What checkSubmitWatchBundle found wrong with a bundle's text, by its text. */
const watchProblems = new Map();

/** A bare window for the watcher's bundle at `href` (checkSubmitWatchBundle): stand-ins for fetch (answering
 *  `answer`, its body's readings counted), XMLHttpRequest and SuccessFactors' applyJob proxy; its document and window
 *  record their listeners, and its document the details of the events dispatched on it. */
function watchSandbox(href, answer) {
  const listeners = [];
  const told = [];
  const touched = { body: 0 };
  const listen = (type) => listeners.push(type);
  const response = { status: answer?.status ?? 200, redirected: false,
    clone() {
      touched.body += 1;
      return { text: async () => answer?.text ?? '' };
    },
    text: async () => {
      touched.body += 1;
      return answer?.text ?? '';
    } };
  const fetch = function fetch(..._request) { return Promise.resolve(response); };
  function XMLHttpRequest() { /* a stand-in */ }
  const open = function open() { return undefined; };
  const send = function send() { return undefined; };
  XMLHttpRequest.prototype.open = open;
  XMLHttpRequest.prototype.send = send;
  const applyJob = function applyJob() { return undefined; };
  const proxy = { applyJob };
  const document = { addEventListener: listen, removeEventListener: () => undefined, location: { href },
    dispatchEvent: (event) => told.push(event?.detail), querySelector: () => null };
  const window = { document, location: { href }, fetch, XMLHttpRequest, addEventListener: listen,
    removeEventListener: () => undefined, Request: function Request() { /* a stand-in */ },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; },
    HTMLInputElement: function HTMLInputElement() { /* a stand-in */ }, rcmHybridJobApplicationControllerASProxy: proxy };
  window.parent = window;
  window.top = window;
  document.defaultView = window;
  return { sandbox: { window, document, URL }, window, listeners, told, touched, fetch, open, send, XMLHttpRequest,
    proxy, applyJob };
}

/** The submit watcher's bundle's problems (checkSubmitWatchBundle), each as check-build says it. */
async function submitWatchProblems(text) {
  const problems = [];
  if (!text.startsWith('(function(){') || !text.endsWith('})();')) {
    problems.push('the submit watcher is not one anonymous function called at once');
  }
  for (const name of SUBMIT_WATCH_NEVER_NAMES) if (text.includes(name)) problems.push(`the submit watcher names "${name}"`);
  const run = (href, answer) => {
    const bare = watchSandbox(href, answer);
    const before = new Set(Object.getOwnPropertyNames(bare.sandbox));
    try {
      vm.runInContext(text, vm.createContext(bare.sandbox), { timeout: 1_000 });
    } catch (error) {
      problems.push(`the submit watcher throws on its own at ${href || 'no address'}: ${String(error).slice(0, 120)}`);
      return null;
    }
    const added = Object.getOwnPropertyNames(bare.sandbox).filter((name) => !before.has(name));
    if (added.length > 0) problems.push(`the submit watcher adds globals: ${added.join(', ')}`);
    return bare;
  };
  for (const href of [...SUBMIT_WATCH_INSTALLS_AT, ...SUBMIT_WATCH_PROXY_AT, ...SUBMIT_WATCH_SILENT_AT]) {
    const bare = run(href);
    if (bare === null) return problems;
    if (bare.listeners.length > 0) {
      problems.push(`the submit watcher listens for ${JSON.stringify(bare.listeners)} at ${href || 'no address'}`);
    }
    const wrapped = [bare.window.fetch !== bare.fetch, bare.XMLHttpRequest.prototype.open !== bare.open,
      bare.XMLHttpRequest.prototype.send !== bare.send];
    const wanted = SUBMIT_WATCH_INSTALLS_AT.includes(href);
    if (!wrapped.every((each) => each === wanted)) {
      problems.push(`the submit watcher ${wanted ? 'does not wrap' : 'wraps'} fetch and XMLHttpRequest at `
        + `${href || 'no address'} (${JSON.stringify(wrapped)})`);
    }
    const proxied = bare.proxy.applyJob !== bare.applyJob;
    if (proxied !== SUBMIT_WATCH_PROXY_AT.includes(href)) {
      problems.push(`the submit watcher ${proxied ? 'wraps' : 'does not wrap'} applyJob at ${href || 'no address'}`);
    }
  }
  for (const drive of SUBMIT_WATCH_DRIVES) {
    const bare = run(drive.at, drive.answer);
    if (bare === null) return problems;
    try {
      await bare.window.fetch(drive.request[0], drive.request[1]);
    } catch {
      // The page's own answer is the page's.
    }
    for (let turn = 0; turn < 5; turn += 1) await new Promise((done) => nextTurn(done));
    if (!drive.touches && bare.touched.body > 0) problems.push(`the submit watcher reads a body at ${drive.at}`);
    if (!isDeepStrictEqual(bare.told, drive.tells.filter((detail) => bare.told.includes(detail)))) {
      problems.push(`the submit watcher dispatches ${JSON.stringify(bare.told)} at ${drive.at}, more than a sign`);
    }
  }
  return problems;
}

/** v3 Phase 8: the sentinel's bundle: in the build, at its root, listed nowhere in the manifest, within its budget,
 *  naming none of SENTINEL_NEVER_NAMES nor WXT's content-script context; and the content script the worker injects is
 *  there too. */
function checkSentinel(build, dir, manifest) {
  const file = join(dir, SENTINEL_FILE);
  if (!existsSync(file)) {
    fail(build, `the sentinel ${SENTINEL_FILE} is missing`);
    return;
  }
  if (!existsSync(join(dir, CONTENT_SCRIPT_FILE))) fail(build, `the injected content script ${CONTENT_SCRIPT_FILE} is missing`);
  const listed = JSON.stringify([manifest.content_scripts ?? [], manifest.web_accessible_resources ?? [], manifest.background ?? {}]);
  if (listed.includes(SENTINEL_FILE)) fail(build, 'the sentinel is listed in the manifest: the worker registers it at run time');
  const size = statSync(file).size;
  if (size > SENTINEL_BUDGET) fail(build, `the sentinel is ${size} bytes, over the ${SENTINEL_BUDGET}-byte budget`);
  const text = readFileSync(file, 'utf8');
  for (const name of [...SENTINEL_NEVER_NAMES, ...WXT_CONTEXT_NAMES]) if (text.includes(name)) fail(build, `the sentinel names "${name}"`);
}

/** v5 p1-shell: the sidebar's bundle: in the build, at its root, listed nowhere in the manifest (the worker runs it on
 *  sidebar/load; never a content script, never a web-accessible resource), within its budget, naming none of WXT's
 *  content-script context (its start-up would announce the extension to the page). */
function checkSidebarApp(build, dir, manifest) {
  const file = join(dir, SIDEBAR_APP_FILE);
  if (!existsSync(file)) {
    fail(build, `the sidebar's bundle ${SIDEBAR_APP_FILE} is missing`);
    return;
  }
  const listed = JSON.stringify([manifest.content_scripts ?? [], manifest.web_accessible_resources ?? [], manifest.background ?? {}]);
  if (listed.includes(SIDEBAR_APP_FILE)) fail(build, "the sidebar's bundle is listed in the manifest: the worker runs it on sidebar/load");
  const size = statSync(file).size;
  if (size > SIDEBAR_APP_BUDGET) fail(build, `the sidebar's bundle is ${size} bytes, over the ${SIDEBAR_APP_BUDGET}-byte budget`);
  const text = readFileSync(file, 'utf8');
  for (const name of WXT_CONTEXT_NAMES) if (text.includes(name)) fail(build, `the sidebar's bundle names "${name}"`);
}

// ── v5 p2-fill ──
/**
 * The page patches' bundle (PAGE_PATCHES_FILE): in the build, at its root, listed nowhere in the manifest (the worker
 * runs it on page/patches, in one document's page world), within PAGE_PATCHES_BUDGET, one anonymous function called at
 * once, naming none of PAGE_PATCHES_NEVER_NAMES nor WXT's content-script context; and, run in a bare context whose
 * document records its listeners (its root answering nothing, as in a page where none is installed yet) and whose window
 * holds the page's own alert, confirm, showOpenFilePicker and file-input click, it adds no global, throws nothing,
 * listens for exactly its command (src/dom/patch-protocol.ts PATCH_COMMAND) on the document in the capture phase, and
 * leaves every one of those as the page has it: its patches are made on a command alone, during one write.
 */
function checkPagePatches(build, dir, manifest) {
  const file = join(dir, PAGE_PATCHES_FILE);
  if (!existsSync(file)) {
    fail(build, `the page patches ${PAGE_PATCHES_FILE} are missing`);
    return;
  }
  const listed = JSON.stringify([manifest.content_scripts ?? [], manifest.web_accessible_resources ?? [], manifest.background ?? {}]);
  if (listed.includes(PAGE_PATCHES_FILE)) fail(build, 'the page patches are listed in the manifest: the worker runs them on page/patches');
  const size = statSync(file).size;
  if (size > PAGE_PATCHES_BUDGET) fail(build, `the page patches are ${size} bytes, over the ${PAGE_PATCHES_BUDGET}-byte budget`);
  const text = readFileSync(file, 'utf8').trim();
  if (!text.startsWith('(function(){') || !text.endsWith('})();')) {
    fail(build, 'the page patches are not one anonymous function called at once');
  }
  for (const name of [...PAGE_PATCHES_NEVER_NAMES, ...WXT_CONTEXT_NAMES]) {
    if (text.includes(name)) fail(build, `the page patches name "${name}"`);
  }
  const listeners = [];
  const own = { alert() {}, confirm() {}, showOpenFilePicker() {}, click() {} };
  const input = { prototype: { click: own.click } };
  function CustomEvent(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
  const document = { addEventListener: (type, _listener, capture) => listeners.push([type, capture === true]),
    removeEventListener: () => undefined, documentElement: { dispatchEvent: () => true }, location: { href: '' } };
  const window = { document, alert: own.alert, confirm: own.confirm, showOpenFilePicker: own.showOpenFilePicker,
    HTMLInputElement: input, CustomEvent };
  document.defaultView = window;
  const sandbox = { document, window, URL };
  const before = new Set(Object.getOwnPropertyNames(sandbox));
  try {
    vm.runInContext(text, vm.createContext(sandbox), { timeout: 1_000 });
  } catch (error) {
    fail(build, `the page patches throw on their own: ${String(error).slice(0, 120)}`);
    return;
  }
  const added = Object.getOwnPropertyNames(sandbox).filter((name) => !before.has(name));
  if (added.length > 0) fail(build, `the page patches add globals: ${added.join(', ')}`);
  if (!isDeepStrictEqual(listeners, [['tailorit:patch', true]])) {
    fail(build, `the page patches listen for ${JSON.stringify(listeners)}, not [["tailorit:patch",true]]`);
  }
  const untouched = window.alert === own.alert && window.confirm === own.confirm
    && window.showOpenFilePicker === own.showOpenFilePicker && input.prototype.click === own.click
    && Object.keys(input.prototype).length === 1;
  if (!untouched) fail(build, 'the page patches patch the page at install');
}
// ── end v5 p2-fill ──

/** LinkedIn's hosts as patterns (v3 Phase 8: deferred to v5), each of which the career sites' registration must
 *  exclude, and addresses on them it must never reach. */
const LINKEDIN_EXCLUDED = ['https://*.linkedin.com/*', 'https://*.linkedin.cn/*', 'https://*.lnkd.in/*', 'https://*.licdn.com/*'];
const LINKEDIN_ADDRESSES = ['https://www.linkedin.com/jobs/view/4012345678/', 'https://linkedin.com/jobs/view/4012345678/',
  'https://uk.linkedin.com/jobs/search/?currentJobId=4012345678', 'https://lnkd.in/abc', 'https://media.licdn.com/x.js'];
/** The employee HR systems' hosts (the Phase 8 review, B4), which the registration must exclude too, and addresses on
 *  them it must never reach: a system where a person works for their employer never gets the sentinel. */
const HR_EXCLUDED = ['https://*.oraclecloud.com/*', 'https://*.myworkday.com/*', 'https://*.sapsf.com/*', 'https://*.sapsf.eu/*',
  // ── snapshot build 2026-11-06 (oracle-sf-sr): Oracle's government cloud ──
  'https://*.oraclegovcloud.com/*',
  // ── New ATSs (DESIGN-NEW-ATS §4, Phase 0): their employee hosts beside the candidate paths ──
  'https://workforcenow.adp.com/*', 'https://*.bamboohr.com/*', 'https://www.paycomonline.net/*', 'https://*.clearcompany.com/*',
  // ── The security fix of 2026-11-06 (S5): the new ATS vendors' employee systems, CareerPlug's employers' host ──
  'https://*.dayforcehcm.com/*', 'https://*.ultipro.com/*', 'https://*.ukg.net/*', 'https://*.paylocity.com/*',
  'https://*.paycor.com/*', 'https://*.rippling.com/*', 'https://*.hibob.com/*', 'https://*.adp.com/*',
  'https://app.careerplug.com/*',
  // The P2 review (security 2): UKG Pro Canada's employee hosts.
  'https://*.ultipro.ca/*'];
const HR_ADDRESSES = ['https://acme.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome', 'https://objectstorage.us-ashburn-1.oraclecloud.com/n/x',
  'https://wd5.myworkday.com/acme/d/home.htmld', 'https://performancemanager4.sapsf.com/sf/home', 'https://hcm.sapsf.eu/sf/home',
  // ── snapshot build 2026-11-06 (oracle-sf-sr) ──
  'https://iaaxmg.fa.ocs.oraclegovcloud.com/fscmUI/faces/FuseWelcome',
  // ── New ATSs (DESIGN-NEW-ATS §4, Phase 0) ──
  'https://workforcenow.adp.com/theme/index.html', 'https://acme.bamboohr.com/home', 'https://www.paycomonline.net/v4/ee/web.php/app/login',
  'https://acme.clearcompany.com/app/home',
  // ── The security fix of 2026-11-06 (S5) ──
  'https://www.dayforcehcm.com/mydayforce/login.aspx', 'https://n12.ultipro.com/default.aspx', 'https://acme.ukg.net/',
  'https://access.paylocity.com/', 'https://secure.paycor.com/Accounts/Signin', 'https://app.rippling.com/dashboard',
  'https://app.hibob.com/home', 'https://my.adp.com/', 'https://app.careerplug.com/jobs/1',
  // The P2 review (security 2): an employer's own UKG Pro hosts' job boards, for its staff (internal postings).
  'https://n12.ultipro.com/ACME1000/JobBoard/0d3f6a2e-1111-2222-3333-444455556666/OpportunityDetail?opportunityId=1',
  'https://n12.ultipro.ca/ACME1000/JobBoard/0d3f6a2e-1111-2222-3333-444455556666/'];

/** v5 p1-rules (PLAN decision 9): addresses of the CAPTCHA and anti-bot vendors' own frames (reCAPTCHA's anchor,
 *  challenge and enterprise frames on google.com and recaptcha.net, hCaptcha's, Turnstile's, Arkose's, DataDome's,
 *  PerimeterX's, GeeTest's): CAPTCHA_VENDOR_MATCHES must cover each, the registration must reach none, and no static
 *  content script may match one. */
const VENDOR_ADDRESSES = ['https://www.google.com/recaptcha/api2/anchor?ar=1&k=x&size=normal',
  'https://www.google.com/recaptcha/api2/bframe?hl=en&k=x', 'https://www.google.com/recaptcha/enterprise/anchor?k=x',
  'https://recaptcha.google.com/recaptcha/api2/anchor?k=x', 'https://www.recaptcha.net/recaptcha/api2/anchor?k=x',
  'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox',
  'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv0/0/x/light/normal',
  'https://client-api.arkoselabs.com/fc/gc/?token=x', 'https://geo.captcha-delivery.com/captcha/?initialCid=x',
  'https://li.protechts.net/index.html', 'https://static.geetest.com/static/js/gt.0.4.9.js'];

/** Whether a Chrome match pattern (https://, http:// or *:// for both; <host>/<path>, `*.` a host's first labels)
 *  matches an address. The P2 review (security 2): a `*` anywhere in the path matches any run of characters, as
 *  Chrome reads it (its path is matched against the address's path and query), so a pattern with a `*` between two
 *  segments (UKG's old employee-board one, before /JobBoard/) is read whole. */
function patternMatches(pattern, address) {
  const [, scheme, host, path] = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern) ?? [];
  if (scheme === undefined || host === undefined || path === undefined) return false;
  const url = new URL(address);
  if (scheme === '*' ? !/^https?:$/.test(url.protocol) : url.protocol !== `${scheme}:`) return false;
  const name = url.hostname;
  const hostFits = host === '*' || (host.startsWith('*.') ? name === host.slice(2) || name.endsWith(host.slice(1)) : name === host);
  const escaped = path.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, (char) => `\\${char}`));
  const glob = new RegExp(`^${escaped.join('.*')}$`);
  return hostFits && glob.test(`${url.pathname}${url.search}`);
}

/** v3 Phase 8: registrationsFor, pure, as the worker reconciles Chrome's registration to it: nothing while the career
 *  sites are off; while on, one, loading the sentinel alone, in the top frame only, once the page is loaded, kept across
 *  sessions, in the isolated world, on every https page but the ATS hosts, every LinkedIn host, the employee HR systems
 *  and (v5 p1-rules) the CAPTCHA and anti-bot vendors' own pages, inside the host permissions, none on an http page. */
function checkRegistrations() {
  const where = 'registrationsFor';
  const failHere = (message) => failures.push(`${where}: ${message}`);
  if (registrationsFor({ sites: false }).length !== 0) failHere('registers something while off');
  const on = registrationsFor({ sites: true });
  if (on.length !== 1 || on[0].id !== SITES_REGISTRATION_ID) failHere(`registers ${JSON.stringify(on.map((each) => each.id))}`);
  for (const each of on) {
    if (!isDeepStrictEqual(each.js, [SENTINEL_FILE])) failHere(`${each.id} loads ${JSON.stringify(each.js)}, not the sentinel`);
    if (each.allFrames !== false) failHere(`${each.id} is not the top frame only`);
    if (each.runAt !== 'document_idle') failHere(`${each.id} does not run at document_idle`);
    if (each.persistAcrossSessions !== true) failHere(`${each.id} is not kept across sessions`);
    if (each.world !== 'ISOLATED') failHere(`${each.id} is not in the isolated world`);
    for (const key of ['css', 'matchOriginAsFallback', 'match_about_blank']) if (key in each) failHere(`${each.id} has ${key}`);
    if (!isDeepStrictEqual(each.matches, [SITES_MATCH])) failHere(`${each.id} matches ${JSON.stringify(each.matches)}`);
    for (const match of each.matches) {
      if (!match.startsWith('https://')) failHere(`${each.id} matches ${match}`);
      if (!ALL_SITES_HOST_PERMISSIONS.includes(match)) failHere(`${each.id} matches ${match}, outside the host permissions`);
    }
    const excluded = new Set(each.excludeMatches ?? []);
    for (const pattern of [...ATS_MATCHES, ...LINKEDIN_EXCLUDED, ...HR_EXCLUDED, ...CAPTCHA_VENDOR_MATCHES]) {
      if (!excluded.has(pattern)) failHere(`${each.id} does not exclude ${pattern}`);
    }
    // LinkedIn is deferred to v5, and the HR systems are never reached: no address of theirs may be one it reaches.
    const reaches = (address) => each.matches.some((pattern) => patternMatches(pattern, address))
      && !(each.excludeMatches ?? []).some((pattern) => patternMatches(pattern, address));
    for (const address of LINKEDIN_ADDRESSES) if (reaches(address)) failHere(`${each.id} reaches LinkedIn at ${address}`);
    for (const address of HR_ADDRESSES) if (reaches(address)) failHere(`${each.id} reaches an HR system at ${address}`);
    for (const address of VENDOR_ADDRESSES) if (reaches(address)) failHere(`${each.id} reaches a CAPTCHA vendor at ${address}`);
  }
  // v5 p1-rules (PLAN decision 9): the vendors' list covers each of their frames.
  for (const address of VENDOR_ADDRESSES) {
    if (!CAPTCHA_VENDOR_MATCHES.some((pattern) => patternMatches(pattern, address))) {
      failHere(`CAPTCHA_VENDOR_MATCHES misses ${address}`);
    }
  }
}

/** Each content script's bundle names none of WXT_CONTEXT_NAMES: nothing of the extension announces itself to a page. */
function checkNoWxtContext(build, dir, manifest) {
  for (const script of manifest.content_scripts ?? []) {
    for (const path of Array.isArray(script.js) ? script.js : []) {
      const file = join(dir, String(path));
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const name of WXT_CONTEXT_NAMES) {
        if (text.includes(name)) fail(build, `content script ${String(path)} holds WXT's content-script context (${name})`);
      }
    }
  }
}

/** Each content script's budget: ours (no React since v5 p1-shell: the sidebar's bundle holds it), the page-world
 *  bridge's and (v5 p2-detect) the submit watcher's. */
async function checkContentScriptSize(build, dir, manifest) {
  const { ours, bridge, watcher } = contentScripts(manifest);
  if (ours) checkScriptSize(build, dir, ours, 'the content script', CONTENT_SCRIPT_BUDGET);
  if (bridge) {
    checkScriptSize(build, dir, bridge, 'the page-world bridge', BRIDGE_BUDGET);
    checkBridgeBundle(build, dir, bridge);
  }
  // ── v5 p2-detect ──
  if (watcher) {
    checkScriptSize(build, dir, watcher, 'the submit watcher', SUBMIT_WATCH_BUDGET);
    await checkSubmitWatchBundle(build, dir, watcher);
  }
}

const checked = [];
for (const build of BUILDS) {
  const dir = join(ROOT, build.dir);
  if (!existsSync(join(dir, 'manifest.json'))) {
    if (requireAll || build.dir === '.output/chrome-mv3') failures.push(`${build.dir}: not built`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  checkManifest(build, manifest);
  build.manifest = manifest;
  const all = files(dir).filter((file) => file.endsWith('.js'));
  if (build.production) {
    for (const file of all) {
      const text = readFileSync(file, 'utf8');
      for (const needle of E2E_ONLY) if (text.includes(needle)) fail(build, `${relative(dir, file)} contains "${needle}"`);
    }
  }
  for (const file of all) {
    const text = readFileSync(file, 'utf8');
    for (const needle of DEV_ONLY) if (text.includes(needle)) fail(build, `${relative(dir, file)} contains the development-only "${needle}"`);
    const own = new URL(build.origin).host;
    for (const host of ORIGIN_HOSTS.filter((other) => other !== own && !(build.production && E2E_ONLY.includes(other)))) {
      if (namesHost(text, host)) fail(build, `${relative(dir, file)} holds another build's TailorIT, "${host}"`);
    }
  }
  for (const page of DEV_ONLY_PAGES) if (existsSync(join(dir, page))) fail(build, `${page} is a development-only page`);
  await checkContentScriptSize(build, dir, manifest);
  checkNoWxtContext(build, dir, manifest);
  checkSentinel(build, dir, manifest);
  checkSidebarApp(build, dir, manifest);
  // v5 p2-fill
  checkPagePatches(build, dir, manifest);
  checkIcons(build, dir, manifest);
  checked.push({ build, sizes: all.map((file) => [relative(dir, file), statSync(file).size]) });
}

checkRegistrations();

// The e2e manifest may differ from production only by TailorIT's origin (and the fallback match, when on).
const production = BUILDS[0]?.manifest;
const e2e = BUILDS[2]?.manifest;
if (production && e2e) {
  // The fallback match is dropped from both, so a production TailorIT at http://127.0.0.1 compares the same.
  const strip = (text) => text.replaceAll(',"http://127.0.0.1/*"', '');
  const normalise = (m) => strip(JSON.stringify(m).replaceAll(E2E_TAILORIT_ORIGIN, PRODUCTION_ORIGIN));
  if (normalise(e2e) !== strip(JSON.stringify(production))) failures.push('the e2e manifest differs from production by more than the origin');
}

for (const { build, sizes } of checked) {
  console.log(paint('cyan', build.dir));
  for (const [file, size] of sizes) console.log(`  ${String(size).padStart(9)}  ${file}`);
}
if (failures.length) {
  for (const failure of failures) console.error(paint('red', `✗ ${failure}`));
  process.exit(1);
}
console.log(paint('green', `✓ ${checked.length} build(s) match the manifest the plan allows`));
