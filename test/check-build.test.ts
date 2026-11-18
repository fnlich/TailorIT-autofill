/*
 * scripts/check-build.mjs's assertions: no build it checks (chrome, edge and e2e, all production mode) may hold the
 * capture page, the capture hotkeys' code or a `commands` key; a production bundle may hold none of the e2e build's
 * hooks; no bundle names another build's TailorIT; `externally_connectable` is exactly TailorIT's origin; every file
 * the content script lists exists and stays within the size budget; there are exactly two content scripts, ours and
 * the page-world bridge (world MAIN, the same matches, from document_start, one file and no CSS, within its own
 * budget: docs/SPEC-AMENDMENTS.md §12), whose bundle is one anonymous function that names no extension API and no
 * window messaging, adds no global and listens for its command alone, and (v1.5 X) no web-accessible resource but the
 * preview page at its dynamic address on every web page; and every
 * build ships its four icons as PNGs of their sizes. v5 p1-rules (PLAN decisions 9 and 10): the host permissions are
 * exactly every https and http page plus TailorIT, with no optional ones, and neither the sentinel's registration nor
 * a static content script reaches a CAPTCHA or anti-bot vendor's frame. v5 p1-shell: the sidebar's bundle is in every
 * build, listed nowhere in the manifest, within its budget, and holds no WXT content-script context. v5 p2-detect: a
 * third content script, the page-world submit watcher (world MAIN, Workday's, ClearCompany's, Oracle's and
 * SuccessFactors' hosts alone, every frame, from document_start, within its budget), whose bundle is one anonymous
 * function naming no extension API, no header and no body reader beyond the copies its yes-or-no facts need, adding no
 * global and no listener, wrapping fetch and XMLHttpRequest exactly at a posting or form and (the P2 review, M3) the
 * candidate apps' job lists, SuccessFactors' applyJob at its form, reading no body it has no use for and dispatching a
 * sign alone. The P2 review (security 2): no static content script runs on an employee HR system's page.
 * The script runs as it is, copied with what it reads (proc.mjs, the host list, the public key) into a
 * temporary folder that holds three fixture builds, and each case breaks the builds in one way.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MatchPattern } from 'wxt/utils/match-patterns';
import { CAPTURE_MARKER } from '../src/background/capture';
import { ATS_MATCHES, HR_HOST_MATCHES, isCompanySiteUrl, isHrHost, onAtsMatch, SUBMIT_WATCH_MATCHES } from '../src/shared/hosts';

const ROOT = resolve(import.meta.dirname, '..');
const KEY = readFileSync(join(ROOT, 'keys', 'manifest-key.txt'), 'utf8').trim();
const BUILDS = { chrome: '.output/chrome-mv3', edge: '.output/edge-mv3', e2e: '.output-e2e/chrome-mv3' } as const;

/** The manifest's icons, as wxt.config.ts names them. */
const ICONS = { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' } as const;

/** The smallest file check-build reads as a PNG of this size: the signature and an IHDR chunk naming its width and
 *  height (the bytes a real PNG's header holds; the image data does not matter to the check). */
function png(width: number, height = width): Uint8Array {
  const bytes = new Uint8Array(33);
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

/** A production manifest as wxt.config.ts makes it, for TailorIT at `origin`. */
function manifest(origin: string): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: 'TailorIT Autofill',
    version: '0.1.0',
    key: KEY,
    minimum_chrome_version: '144',
    permissions: ['storage', 'sidePanel', 'activeTab', 'alarms', 'scripting'],
    // v5 p1-rules (PLAN decision 10): every https and http page at install, beside TailorIT; no optional ones.
    host_permissions: ['https://*/*', 'http://*/*', `${origin}/*`],
    externally_connectable: { matches: [`${origin}/*`] },
    icons: { ...ICONS },
    action: { default_title: 'TailorIT Autofill', default_icon: { 16: ICONS[16], 32: ICONS[32] } },
    background: { service_worker: 'background.js' },
    options_ui: { open_in_tab: true, page: 'options.html' },
    side_panel: { default_path: 'sidepanel.html' },
    // v1.5 X (PLAN decision 2): the preview page, the one web-accessible resource, at its dynamic address alone.
    web_accessible_resources: [{ resources: ['preview.html'], matches: ['https://*/*', 'http://*/*'], use_dynamic_url: true }],
    content_scripts: [{ matches: [...ATS_MATCHES], all_frames: true, run_at: 'document_idle', js: ['content-scripts/content.js'] },
      { ...BRIDGE_SCRIPT, matches: [...ATS_MATCHES] },
      // v5 p2-detect: the page-world submit watcher.
      { ...WATCH_SCRIPT, matches: [...SUBMIT_WATCH_MATCHES] }],
  };
}

/** A bridge bundle as the real one behaves (v3 Phase 6/7b review, S3, and round 2, E9): it listens for its command on
 *  the public job hosts and at a posting (check-build's own addresses), and nowhere else. */
const BRIDGE_LISTEN = 'document.addEventListener("tailorit:bridge",()=>{},!0)';
const BRIDGE_AT = 'var h=String(document.location&&document.location.href||"");'
  + 'if(/^https:\\/\\/(job-boards\\.greenhouse\\.io|jobs\\.lever\\.co|acme\\.wd5\\.myworkdayjobs\\.com)\\//.test(h)'
  + '||h.indexOf("/job/Remote/Engineer_JR-1")>0)';
const BRIDGE_BUNDLE = `(function(){${BRIDGE_AT}${BRIDGE_LISTEN}})();`;
/** check-build's first address, a posting, where the bridge must listen. */
const POSTING_AT = 'https://job-boards.greenhouse.io/acme/jobs/4012345';

/** v5 p2-fill: a page-patches bundle as the real one behaves (src/page/patches.ts): it probes the document's root, then
 *  listens for its command on the document, and patches nothing at install. */
const PATCHES_LISTEN = 'document.addEventListener("tailorit:patch",()=>{},!0)';
const PATCHES_BUNDLE = `(function(){var v=document.defaultView;document.documentElement.dispatchEvent(new v.CustomEvent("tailorit:patch",{detail:"{}"}));${PATCHES_LISTEN}})();`;

/** v3 Phase 8: a sentinel bundle as the real one reads: it reads the page and sends one message. */
const SENTINEL_BUNDLE = '(function(){var t=globalThis.chrome;var r=document.querySelectorAll("input");'
  + 't.runtime.sendMessage({v:1,type:"page/recognised",reason:"application-form"})})();';

/** The page-world bridge's entry in a manifest, as WXT writes it (src/entrypoints/page-bridge.content.ts). */
const BRIDGE_SCRIPT = { all_frames: true, run_at: 'document_start', js: ['content-scripts/page-bridge.js'], world: 'MAIN' };
/** v5 p2-detect: the page-world submit watcher's entry, as WXT writes it (src/entrypoints/submit-watch.content.ts). */
const WATCH_SCRIPT = { all_frames: true, run_at: 'document_start', js: ['content-scripts/submit-watch.js'], world: 'MAIN' };
/** v5 p2-detect: a watcher bundle as the real one behaves: it wraps fetch and XMLHttpRequest's open and send at a
 *  Workday, ClearCompany or Oracle posting or form and (the P2 review, M3) their candidate apps' job lists
 *  (check-build's own addresses), SuccessFactors' applyJob proxy at a career site's form, and nothing elsewhere; it
 *  reads no body and tells nothing. */
const WATCH_AT = 'var h=String(document.location&&document.location.href||"");'
  + 'if(/myworkdayjobs(?:-impl)?\\.com\\/|\\/recruiting\\/acme\\/External|\\/careers\\/jobs'
  + '|\\/hcmUI\\/CandidateExperience\\//.test(h))';
/** The P2 review (M3): the watcher before it, installing at a posting or its form alone (the bridge's decision). */
const WATCH_AT_FORMS = 'var h=String(document.location&&document.location.href||"");'
  + 'if(/myworkdayjobs(?:-impl)?\\.com\\/|\\/job\\/Remote\\/Engineer_JR-1|\\/careers\\/jobs\\/[0-9a-f-]+\\/apply'
  + '|\\/CandidateExperience\\/.*\\/apply\\//.test(h))';
const WATCH_WRAP = '{var f=window.fetch;window.fetch=function(){return f.apply(this,arguments)};'
  + 'var p=window.XMLHttpRequest.prototype,o=p.open,s=p.send;p.open=function(){return o.apply(this,arguments)};'
  + 'p.send=function(){return s.apply(this,arguments)}}';
const WATCH_PROXY = 'if(/successfactors\\.eu\\/career\\?/.test(h)){var x=window.rcmHybridJobApplicationControllerASProxy,'
  + 'a=x.applyJob;x.applyJob=function(){return a.apply(this,arguments)}}';
const WATCH_BUNDLE = `(function(){${WATCH_AT}${WATCH_WRAP}${WATCH_PROXY}})();`;

const folders: string[] = [];

/** A copy of the script and what it reads, with three clean builds; `change` then breaks what a case needs. The
 *  production builds are made for TailorIT at `origin` (TAILORIT_ORIGIN), by default http://localhost:3100. */
function project(change: (write: (path: string, text: string | Uint8Array) => void) => void = () => undefined,
  origin = 'http://localhost:3100'): string {
  const root = mkdtempSync(join(tmpdir(), 'tailorit-check-build-'));
  folders.push(root);
  const write = (path: string, text: string | Uint8Array) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const path of ['scripts/check-build.mjs', 'scripts/proc.mjs', 'scripts/tailorit-origin.mjs', 'src/shared/hosts.ts',
    'src/shared/sidebar.ts', 'keys/manifest-key.txt', 'scripts/provenance-values.json']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(ROOT, path), join(root, path));
  }
  for (const [name, dir] of Object.entries(BUILDS)) {
    const own = name === 'e2e' ? 'http://localhost:3190' : origin;
    write(`${dir}/manifest.json`, JSON.stringify(manifest(own)));
    // The worker names its TailorIT (__TAILORIT_ORIGIN__), as the real bundle does.
    write(`${dir}/background.js`, `var background=(function(){return {o:${JSON.stringify(own)}}})();`);
    write(`${dir}/content-scripts/content.js`, 'var content=(function(){return {}})();');
    write(`${dir}/content-scripts/page-bridge.js`, BRIDGE_BUNDLE);
    write(`${dir}/content-scripts/submit-watch.js`, WATCH_BUNDLE);
    // v3 Phase 8: the sentinel the worker registers, and the content script it injects, at the build's root.
    write(`${dir}/sentinel.js`, SENTINEL_BUNDLE);
    write(`${dir}/content-script.js`, 'var contentScript=(function(){return {}})();');
    // v5 p1-shell: the sidebar's bundle the worker runs on sidebar/load, at the build's root.
    write(`${dir}/sidebar-app.js`, 'var sidebarApp=(function(){return {}})();');
    // v5 p2-fill: the page patches the worker runs on page/patches, at the build's root.
    write(`${dir}/page-patches.js`, PATCHES_BUNDLE);
    write(`${dir}/chunks/options-abc.js`, 'export const options = 1;');
    write(`${dir}/options.html`, '<!doctype html><title>Settings</title>');
    write(`${dir}/sidepanel.html`, '<!doctype html><title>Review</title>');
    // v1.5 X: the web-accessible preview page.
    write(`${dir}/preview.html`, '<!doctype html><title>TailorIT Preview</title>');
    for (const [size, path] of Object.entries(ICONS)) write(`${dir}/${path}`, png(Number(size)));
  }
  change(write);
  return root;
}

/** Runs the copy's check-build with TAILORIT_ORIGIN unset unless `env` sets it (a .env a case writes then decides). */
function checkBuild(root: string, env: Record<string, string> = {}): { status: number | null; output: string } {
  const run = spawnSync(process.execPath, [join(root, 'scripts', 'check-build.mjs'), '--all'], { cwd: root, encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', TAILORIT_ORIGIN: '', ...env } });
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

describe("check-build's development-only assertions", () => {
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  it('pass three clean production-mode builds', () => {
    const { status, output } = checkBuild(project());
    expect(output).toContain('3 build(s) match the manifest the plan allows');
    expect(status).toBe(0);
  });

  it('fail a build that holds the capture page', () => {
    const { status, output } = checkBuild(project((write) => write(`${BUILDS.chrome}/capture.html`, '<!doctype html>')));
    expect(output).toContain('.output/chrome-mv3: capture.html is a development-only page');
    expect(status).toBe(1);
  });

  // jr7 INT-7 (the content script's budget): the configured rules' provenance never ships (__PROVENANCE__ false).
  it("fail any build, the e2e one included, whose bundles hold a configured rule's provenance", () => {
    for (const [script, said] of [
      ['var c=[{css:"#ats-portal",from:"jr7-paycomonline1-signature"}];', '("jr7-paycomonline1-signature")'],
      ['var c=[{css:"section.submit_success",from:`jazzhr-3`}];', '(a "from" naming a capture)'],
      ['var c={snapshots:["jr7-saashr-confirmation"]};', '("jr7-saashr-confirmation")'],
    ] as const) {
      const { status, output } = checkBuild(project((write) => write(`${BUILDS.e2e}/content-script.js`, script)));
      expect(output, script).toContain(`.output-e2e/chrome-mv3: content-script.js holds rule provenance ${said}`);
      expect(status, script).toBe(1);
    }
    // Another `from` (a date range's, a message's) is no provenance.
    const clean = checkBuild(project((write) => write(`${BUILDS.chrome}/content-script.js`,
      'var r={from:"2020-01",to:"2021-02"},m={from:e.frameId,chain:{from:"0123456789abcdef"}};')));
    expect(clean.output).not.toContain('rule provenance');
  });

  // jr7 review A-4: the guard compares with the exact list of the sources' provenance (scripts/provenance-values.json,
  // test/provenance.test.ts), whatever a value's shape, and reads `snapshot` and `snapshots` keys as well as `from`.
  it("fail a bundle holding any value of the provenance list, whatever its shape, as a key's value or in the text", () => {
    // The values the cases name are the sources' own (none is made up for the test).
    const { values } = JSON.parse(readFileSync(join(ROOT, 'scripts', 'provenance-values.json'), 'utf8')) as {
      values: string[] };
    expect(values).toEqual(expect.arrayContaining(['vafb-account', 'jr7-paycomonline1-apply-2', 'jr7-bamboohr1-form-filled',
      'jr7-rippling1-apply-blank, jr7-rippling2-apply-blank', 'guest', 'code-dialog', 'personal', 'vafb-uploads',
      "Jobright 1.25.2 ats-submission-rules 'myworkday-submitted'"]));
    expect(values).not.toContain('fixtures/acme/new-case.html');
    for (const [script, said] of [
      // A bare `from` of a case name no capture shape matches (ClearCompany's), as the review's mutation wrote it.
      ['var c=[{css:"#account",from:"vafb-account"}];', '(from: "vafb-account")'],
      // A widget's snapshot, as Paycom's date wrote it before the gate.
      ['function d(e){return{parts:e,snapshot:"jr7-paycomonline1-apply-2"}}', '("jr7-paycomonline1-apply-2")'],
      ['function d(e){return{parts:e,snapshot:"jr7-paycomonline1-apply-2"}}', '(snapshot: "jr7-paycomonline1-apply-2")'],
      // A capture constant used through a name, as BambooHR's and Rippling's were: the value alone, anywhere.
      ['var R=`jr7-bamboohr1-form-filled`;function w(d){return{...d,snapshot:`${d.snapshot}; ${R}`}}',
        '("jr7-bamboohr1-form-filled")'],
      ['var J=`jr7-rippling1-apply-blank, jr7-rippling2-apply-blank`;',
        '("jr7-rippling1-apply-blank, jr7-rippling2-apply-blank")'],
      // A config's snapshot list of plain case names (ADP's), each a word the code may also use: as the key's list.
      ['var a={platform:`adp`,snapshots:[`guest`,\'code-dialog\',"personal"]};', '(snapshots: "guest")'],
      ['var a={platform:`adp`,snapshots:[`guest`,\'code-dialog\',"personal"]};', '(snapshots: "personal")'],
      // One part of a list written in one string.
      ['var r={css:"form",from:"vafb-uploads, vafb-page3"};', '(from: "vafb-uploads")'],
      // A note, with its escaped quotes read.
      [String.raw`var s=[{from:'Jobright 1.25.2 ats-submission-rules \'myworkday-submitted\''}];`,
        `("Jobright 1.25.2 ats-submission-rules 'myworkday-submitted'")`],
      // A fixture's path the list has not met yet: its shape.
      ['var w={snapshot:"fixtures/acme/new-case.html"};', '(a "snapshot" naming a capture)'],
    ] as const) {
      const { status, output } = checkBuild(project((write) => write(`${BUILDS.e2e}/content-script.js`, script)));
      expect(output, script).toContain(`.output-e2e/chrome-mv3: content-script.js holds rule provenance ${said}`);
      expect(status, script).toBe(1);
    }
    // The same plain words outside a provenance key are the code's own, and a date range's `from` is no provenance.
    const clean = checkBuild(project((write) => write(`${BUILDS.chrome}/content-script.js`,
      'var s={step:`guest`,kind:"personal",page:`code-dialog`},r={from:"2020-01",to:"2021-02"};')));
    expect(clean.output).not.toContain('rule provenance');
    expect(clean.status).toBe(0);
  }, 60_000); // Eleven runs of the script: as the file's other many-build cases (a loaded machine takes over 5 s).

  it('fail every check when the provenance list is missing', () => {
    const root = project();
    rmSync(join(root, 'scripts', 'provenance-values.json'));
    const { status, output } = checkBuild(root);
    expect(output).toContain(
      "scripts/provenance-values.json is missing or unreadable: no build's provenance can be checked");
    expect(status).toBe(1);
  });

  it("fail any build, the e2e one included, whose bundles hold the hotkeys' marker", () => {
    const { status, output } = checkBuild(project((write) => write(`${BUILDS.e2e}/background.js`,
      'var background=(function(){chrome.commands.onCommand.addListener(e=>{e==="tailorit-dev-capture-now"})})();')));
    expect(output).toContain(`.output-e2e/chrome-mv3: background.js contains the development-only "${CAPTURE_MARKER}"`);
    expect(status).toBe(1);
  });

  it("fail a build whose bundles hold the capture page's code", () => {
    const { status, output } = checkBuild(project((write) => write(`${BUILDS.edge}/chunks/capture-x1.js`,
      'await chrome.pageCapture.saveAsMHTML({tabId:5});chrome.tabs.create({url:"/capture.html?tabId=5"});')));
    expect(output).toContain('contains the development-only "saveAsMHTML"');
    expect(output).toContain('contains the development-only "capture.html"');
    expect(status).toBe(1);
  });

  it("fail a development manifest: its commands and pageCapture", () => {
    const development = { ...manifest('http://localhost:3100'), permissions: ['storage', 'sidePanel', 'activeTab', 'alarms', 'pageCapture'],
      commands: { 'tailorit-dev-capture-now': { suggested_key: { default: 'Alt+Shift+S' }, description: 'Save' } } };
    const { status, output } = checkBuild(project((write) => write(`${BUILDS.chrome}/manifest.json`, JSON.stringify(development))));
    expect(output).toContain('.output/chrome-mv3: commands must be absent');
    expect(output).toContain('.output/chrome-mv3: permissions are');
    expect(status).toBe(1);
  });

  it("look for the marker the capture hotkeys' code carries", () => {
    expect(readFileSync(join(ROOT, 'scripts', 'check-build.mjs'), 'utf8')).toContain(`'${CAPTURE_MARKER}'`);
  });
});

/** Writes every build's manifest, changed by `change` (the e2e one stays the production one but for its origin). */
function everyManifest(write: (path: string, text: string | Uint8Array) => void,
  change: (manifest: Record<string, unknown>) => void): void {
  for (const [name, dir] of Object.entries(BUILDS)) {
    const changed = manifest(name === 'e2e' ? 'http://localhost:3190' : 'http://localhost:3100');
    change(changed);
    write(`${dir}/manifest.json`, JSON.stringify(changed));
  }
}

/** The content script's entry in a manifest. */
const contentScript = (changed: Record<string, unknown>) => (changed.content_scripts as Array<Record<string, unknown>>)[0]!;
/** The page-world bridge's entry in a manifest. */
const bridgeScript = (changed: Record<string, unknown>) => (changed.content_scripts as Array<Record<string, unknown>>)[1]!;
/** v5 p2-detect: the page-world submit watcher's entry in a manifest. */
const watchScript = (changed: Record<string, unknown>) => (changed.content_scripts as Array<Record<string, unknown>>)[2]!;

/** A script just past the content script's budget (scripts/check-build.mjs's CONTENT_SCRIPT_BUDGET, 1 MiB again since
 *  v5 p1-shell). */
const OVER_BUDGET = `var big="${'a'.repeat(1024 * 1024)}";`;

describe("check-build's manifest and bundle assertions", () => {
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  // W3: the budget was measured only at content-scripts/content.js, and skipped without a word when that was absent.
  it('measure the content script wherever the manifest lists it', () => {
    const { status, output } = checkBuild(project((write) => {
      everyManifest(write, (changed) => {
        contentScript(changed).js = ['content-scripts/content.js', 'content-scripts/panel.js'];
      });
      for (const dir of Object.values(BUILDS)) write(`${dir}/content-scripts/panel.js`, OVER_BUDGET);
    }));
    expect(output).toContain('.output/chrome-mv3: the content script is');
    expect(output).toContain('over the 1048576-byte budget');
    expect(status).toBe(1);
  });

  it('measure a content script the manifest names other than content.js', () => {
    const { status, output } = checkBuild(project((write) => {
      everyManifest(write, (changed) => {
        contentScript(changed).js = ['content-scripts/app.js'];
      });
      write(`${BUILDS.edge}/content-scripts/app.js`, OVER_BUDGET);
      for (const dir of [BUILDS.chrome, BUILDS.e2e]) write(`${dir}/content-scripts/app.js`, 'var app=1;');
    }));
    expect(output).toContain('.output/edge-mv3: the content script is');
    expect(output).not.toContain('.output/chrome-mv3: the content script is');
    expect(status).toBe(1);
  });

  it('fail a build whose manifest lists a content script that is not there, or none', () => {
    const missing = checkBuild(project((write) => everyManifest(write, (changed) => {
      contentScript(changed).js = ['content-scripts/main.js'];
    })));
    expect(missing.output).toContain('.output/chrome-mv3: the content script content-scripts/main.js is missing');
    expect(missing.status).toBe(1);

    const none = checkBuild(project((write) => everyManifest(write, (changed) => {
      delete contentScript(changed).js;
    })));
    expect(none.output).toContain('.output/chrome-mv3: the content script lists no file');
    expect(none.status).toBe(1);
  });

  // W4: the e2e build's fallback sender is a regular expression, so a bundle holds the address with its dots escaped.
  it("fail a production bundle that holds the e2e fallback sender's address as the bundler writes it", () => {
    const literal = /\/\^http:[^\n]*127\\\.0\\\.0\\\.1[^\n]*?\/(?=\.test)/.exec(
      readFileSync(join(ROOT, 'src', 'background', 'senders.ts'), 'utf8'))?.[0];
    expect(literal).toBeDefined();
    const { status, output } = checkBuild(project((write) => write(`${BUILDS.chrome}/background.js`,
      `var background=(function(){function a(e){return ${literal}.test(e)}return {a}})();`)));
    expect(output).toContain(String.raw`.output/chrome-mv3: background.js contains "127\.0\.0\.1"`);
    expect(status).toBe(1);
  });

  it('pass the e2e build, which holds that sender', () => {
    const { status, output } = checkBuild(project((write) => write(`${BUILDS.e2e}/background.js`,
      String.raw`var background=(function(){function a(e){return /^http:\/\/127\.0\.0\.1:\d+\//.test(e)}return {a}})();`)));
    expect(output).toContain('3 build(s) match the manifest the plan allows');
    expect(status).toBe(0);
  });

  it("fail an e2e bundle that names production's TailorIT", () => {
    const { status, output } = checkBuild(project((write) => write(`${BUILDS.e2e}/background.js`,
      'var background=(function(){return {o:"http://localhost:3100"}})();')));
    expect(output).toContain(`${BUILDS.e2e}: background.js holds another build's TailorIT, "localhost:3100"`);
    expect(status).toBe(1);
  });

  // W5: only `matches` was compared, so other keys (any extension's id, the TLS channel id) passed.
  it('fail an externally_connectable that holds anything beside TailorIT\'s origin', () => {
    for (const extra of [{ ids: ['*'] }, { accepts_tls_channel_id: true }, { ids: [] }]) {
      const { status, output } = checkBuild(project((write) => everyManifest(write, (changed) => {
        changed.externally_connectable = { ...(changed.externally_connectable as object), ...extra };
      })));
      expect(output, JSON.stringify(extra)).toContain('.output/chrome-mv3: externally_connectable is not exactly TailorIT');
      expect(status).toBe(1);
    }
  });

  it('pass an externally_connectable whose one key is TailorIT\'s origin, whatever the key order of the manifest', () => {
    const { status } = checkBuild(project((write) => everyManifest(write, (changed) => {
      const connectable = changed.externally_connectable;
      delete changed.externally_connectable;
      changed.externally_connectable = connectable;
    })));
    expect(status).toBe(0);
  });

  it('fail a build whose icons are missing, not PNGs or the wrong size, or whose action names others', () => {
    const missing = checkBuild(project((write) => everyManifest(write, (changed) => {
      changed.icons = { ...ICONS, 48: 'icon/missing.png' };
    })));
    expect(missing.output).toContain('.output/chrome-mv3: the 48 px icon icon/missing.png is missing');
    expect(missing.status).toBe(1);

    const sizes = checkBuild(project((write) => {
      write(`${BUILDS.edge}/${ICONS[32]}`, png(32, 16));
      write(`${BUILDS.e2e}/${ICONS[128]}`, 'not a picture');
    }));
    expect(sizes.output).toContain('.output/edge-mv3: the 32 px icon icon/32.png is 32×16');
    expect(sizes.output).toContain('.output-e2e/chrome-mv3: the 128 px icon icon/128.png is not a PNG');
    expect(sizes.status).toBe(1);

    const keys = checkBuild(project((write) => everyManifest(write, (changed) => {
      changed.icons = { 16: ICONS[16], 32: ICONS[32], 48: ICONS[48] };
      changed.action = { default_title: 'TailorIT Autofill', default_icon: { 16: ICONS[16] } };
    })));
    expect(keys.output).toContain('.output/chrome-mv3: icons are ["16","32","48"], not 16, 32, 48 and 128');
    expect(keys.output).toContain(".output/chrome-mv3: the action's icons are not the 16 and 32 px icons");
    expect(keys.status).toBe(1);
  });
});

describe("check-build's three content scripts: ours, the page-world bridge and (v5 p2-detect) the submit watcher", () => {
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  it('pass ours, the bridge and the watcher in any order', () => {
    const { status, output } = checkBuild(project((write) => everyManifest(write, (changed) => {
      (changed.content_scripts as unknown[]).reverse();
    })));
    expect(output).toContain('3 build(s) match the manifest the plan allows');
    expect(status).toBe(0);
  });

  // v5 p2-detect: three content scripts, the submit watcher beside the bridge (the old two-script cases, each kept).
  it('fail a build with our content script alone, a fourth script, a page-world script missing, or two in the isolated world', () => {
    const alone = checkBuild(project((write) => everyManifest(write, (changed) => {
      changed.content_scripts = [contentScript(changed)];
    })));
    expect(alone.output).toContain('.output/chrome-mv3: expected three content scripts, ours, the page-world bridge and '
      + 'the submit watcher (both world MAIN), found 1: ["isolated"]');
    expect(alone.status).toBe(1);

    const fourth = checkBuild(project((write) => everyManifest(write, (changed) => {
      (changed.content_scripts as unknown[]).push({ ...BRIDGE_SCRIPT, matches: [...ATS_MATCHES], js: ['content-scripts/more.js'] });
    })));
    expect(fourth.output).toContain('found 4: ["isolated","MAIN","MAIN","MAIN"]');
    expect(fourth.status).toBe(1);

    const noWatcher = checkBuild(project((write) => everyManifest(write, (changed) => {
      (changed.content_scripts as unknown[]).pop();
    })));
    expect(noWatcher.output).toContain('found 2: ["isolated","MAIN"]');
    expect(noWatcher.status).toBe(1);

    const isolated = checkBuild(project((write) => everyManifest(write, (changed) => {
      delete bridgeScript(changed).world;
    })));
    expect(isolated.output).toContain('found 3: ["isolated","isolated","MAIN"]');
    expect(isolated.status).toBe(1);
  });

  it('fail a submit watcher with other matches, CSS, about:blank frames, the top frame alone or another start (v5 p2-detect)', () => {
    const cases: Array<[(watcher: Record<string, unknown>) => void, string]> = [
      [(watcher) => { watcher.matches = [...SUBMIT_WATCH_MATCHES, 'https://jobs.lever.co/*']; },
        "the submit watcher's matches differ from SUBMIT_WATCH_MATCHES"],
      [(watcher) => { watcher.matches = [...ATS_MATCHES]; }, "the submit watcher's matches differ from SUBMIT_WATCH_MATCHES"],
      [(watcher) => { watcher.css = ['content-scripts/submit-watch.css']; }, 'the submit watcher has css'],
      [(watcher) => { watcher.match_about_blank = true; }, 'the submit watcher has match_about_blank'],
      [(watcher) => { watcher.exclude_matches = ['https://*.myworkdaysite.com/*']; }, 'the submit watcher has exclude_matches'],
      [(watcher) => { watcher.all_frames = false; }, 'the submit watcher is not all_frames'],
      [(watcher) => { watcher.run_at = 'document_idle'; }, 'the submit watcher does not run at document_start'],
    ];
    for (const [change, message] of cases) {
      const { status, output } = checkBuild(project((write) => everyManifest(write, (changed) => change(watchScript(changed)))));
      expect(output, message).toContain(`.output/chrome-mv3: ${message}`);
      expect(status, message).toBe(1);
    }
  }, 30_000);

  it('fail a submit watcher over its 30 KiB budget, or one that reads a body, adds a global or a listener, or wraps elsewise (v5 p2-detect)', () => {
    const big = checkBuild(project((write) => {
      for (const dir of Object.values(BUILDS)) write(`${dir}/content-scripts/submit-watch.js`, `var big="${'a'.repeat(30 * 1024)}";`);
    }));
    expect(big.output).toContain('.output/chrome-mv3: the submit watcher is');
    expect(big.output).toContain('over the 30720-byte budget');
    expect(big.status).toBe(1);

    const installs = 'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Engineer_JR-1/apply/applyManually';
    const clearCompany = 'https://vafb.clearcompany.com/careers/jobs/9485c936-3d5f-0a3b-27a4-708fe87203d8/apply';
    const wrap = `${WATCH_AT}${WATCH_WRAP}${WATCH_PROXY}`;
    const xhr = 'var p=window.XMLHttpRequest.prototype,o=p.open,s=p.send;p.open=function(){return o.apply(this,arguments)};'
      + 'p.send=function(){return s.apply(this,arguments)}';
    // A watcher that reads every answer's body, or tells more than a sign (a field of the answer beside it).
    const reading = `${WATCH_AT}{var f=window.fetch;window.fetch=function(){var q=f.apply(this,arguments);`
      + `q.then(function(r){r.clone()});return q};${xhr}}${WATCH_PROXY}`;
    const detail = JSON.stringify({ v: 1, sign: 'workday-finalize', name: 'A Person' });
    const telling = `${WATCH_AT}{var f=window.fetch;window.fetch=function(){var q=f.apply(this,arguments);`
      + `q.then(function(){document.dispatchEvent(new window.CustomEvent("tailorit:submit-net",{detail:${JSON.stringify(detail)}}))});`
      + `return q};${xhr}}${WATCH_PROXY}`;
    const cases: Array<[string, string]> = [
      [`var watch=(function(){${wrap}})();`, 'the submit watcher is not one anonymous function called at once'],
      [`var watch=(function(){${wrap}})();`, 'the submit watcher adds globals: watch'],
      [`(function(){globalThis.__tailorit=1;${wrap}})();`, 'the submit watcher adds globals: __tailorit'],
      [`(function(){chrome.runtime;${wrap}})();`, 'the submit watcher names "chrome."'],
      [`(function(){var r;r&&r.json();${wrap}})();`, 'the submit watcher names ".json("'],
      [`(function(){var r;r&&r.getReader();${wrap}})();`, 'the submit watcher names "getReader"'],
      [`(function(){var r;r&&r.headers;${wrap}})();`, 'the submit watcher names ".headers"'],
      [`(function(){var r;r&&r.getAllResponseHeaders();${wrap}})();`, 'the submit watcher names "getAllResponseHeaders"'],
      // The owner's word of 2026-11-08: a body read where the sign needs it, never where it does not (ClearCompany's).
      [`(function(){${reading}})();`, `the submit watcher reads a body at ${clearCompany}`],
      [`(function(){${telling}})();`, `the submit watcher dispatches ${JSON.stringify([detail])} at ${installs}, more than a sign`],
      [`(function(){${WATCH_AT}${WATCH_WRAP}})();`,
        'the submit watcher does not wrap applyJob at https://career2.successfactors.eu/career?company=danfossas'],
      [`(function(){document.addEventListener("tailorit:submit-net",()=>{});${wrap}})();`,
        `the submit watcher listens for ["tailorit:submit-net"] at ${installs}`],
      ['(function(){})();', `the submit watcher does not wrap fetch and XMLHttpRequest at ${installs}`],
      [`(function(){${WATCH_WRAP}})();`,
        'the submit watcher wraps fetch and XMLHttpRequest at https://career2.successfactors.eu/career?company=danfossas'],
      ['(function(){window.fetch=function(){}})();', `the submit watcher does not wrap fetch and XMLHttpRequest at ${installs}`],
      // The P2 review (M3): a watcher that installs at a posting or its form alone misses the candidate apps' job lists.
      [`(function(){${WATCH_AT_FORMS}${WATCH_WRAP}${WATCH_PROXY}})();`,
        'the submit watcher does not wrap fetch and XMLHttpRequest at https://wd5.myworkdaysite.com/recruiting/acme/External'],
      [`(function(){${WATCH_AT_FORMS}${WATCH_WRAP}${WATCH_PROXY}})();`, 'the submit watcher does not wrap fetch and '
        + 'XMLHttpRequest at https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions'],
    ];
    for (const [bundle, message] of cases) {
      const { status, output } = checkBuild(project((write) => {
        for (const dir of Object.values(BUILDS)) write(`${dir}/content-scripts/submit-watch.js`, bundle);
      }));
      expect(output, bundle).toContain(`.output/chrome-mv3: ${message}`);
      expect(status, bundle).toBe(1);
    }
  }, 30_000);

  it('fail a page-world bridge with other matches, CSS, about:blank frames, another start or more files', () => {
    const cases: Array<[(bridge: Record<string, unknown>) => void, string]> = [
      [(bridge) => { bridge.matches = [...ATS_MATCHES, 'https://*/*']; }, "the page-world bridge's matches differ from the ATS list"],
      [(bridge) => { bridge.matches = ATS_MATCHES.slice(1); }, "the page-world bridge's matches differ from the ATS list"],
      [(bridge) => { bridge.css = ['content-scripts/page-bridge.css']; }, 'the page-world bridge has css'],
      [(bridge) => { bridge.match_about_blank = true; }, 'the page-world bridge has match_about_blank'],
      [(bridge) => { bridge.match_origin_as_fallback = true; }, 'the page-world bridge has match_origin_as_fallback'],
      [(bridge) => { bridge.exclude_matches = ['https://jobs.lever.co/*']; }, 'the page-world bridge has exclude_matches'],
      [(bridge) => { bridge.all_frames = false; }, 'the page-world bridge is not all_frames'],
      [(bridge) => { bridge.run_at = 'document_idle'; }, 'the page-world bridge does not run at document_start'],
      [(bridge) => { bridge.js = ['content-scripts/page-bridge.js', 'content-scripts/content.js']; },
        'the page-world bridge is not one script file'],
    ];
    for (const [change, message] of cases) {
      const { status, output } = checkBuild(project((write) => everyManifest(write, (changed) => change(bridgeScript(changed)))));
      expect(output, message).toContain(`.output/chrome-mv3: ${message}`);
      expect(status, message).toBe(1);
    }
  }, 30_000); // v3.2 EXT: as the file's other many-build cases (nine builds checked; a loaded machine takes over 5 s).

  // (The snapshot build of 2026-11-06, core pass Z1 items 26 and 39: the bridge reads only the shared domains' address
  // parsers, under a budget of 24 KiB; v5 p2-detect: 26 KiB, for the address variants its parsers read; jr7 ENGINE-7
  // E0: 28 KiB, for jr7's five new platforms' static matches, which the bridge's manifest must equal.)
  it("fail a page-world bridge over its 28 KiB budget, or one whose file is missing", () => {
    const big = checkBuild(project((write) => {
      for (const dir of Object.values(BUILDS)) write(`${dir}/content-scripts/page-bridge.js`, `var big="${'a'.repeat(28 * 1024)}";`);
    }));
    expect(big.output).toContain('.output/chrome-mv3: the page-world bridge is');
    expect(big.output).toContain('over the 28672-byte budget');
    expect(big.status).toBe(1);

    const missing = checkBuild(project((write) => everyManifest(write, (changed) => {
      bridgeScript(changed).js = ['content-scripts/elsewhere.js'];
    })));
    expect(missing.output).toContain('.output/chrome-mv3: the page-world bridge content-scripts/elsewhere.js is missing');
    expect(missing.status).toBe(1);
  });

  // v1.5 X (PLAN decision 2): exactly the preview page, at its dynamic address alone, on every https and http page.
  it('fail a build with any web-accessible resource but the preview page at its dynamic address on every web page (a page-world script never needs one)', () => {
    const PREVIEW = { resources: ['preview.html'], matches: ['https://*/*', 'http://*/*'], use_dynamic_url: true };
    // Each case one build of its own (every case spawns check-build: kept few).
    const cases: Array<[string, unknown]> = [
      ['the bridge beside it', [PREVIEW, { resources: ['content-scripts/page-bridge.js'], matches: [...ATS_MATCHES] }]],
      ['a second resource', [{ ...PREVIEW, resources: ['preview.html', 'chunks/options-abc.js'] }]],
      ['its fixed address', [{ ...PREVIEW, use_dynamic_url: false }]],
      ['every scheme', [{ ...PREVIEW, matches: ['<all_urls>'] }]],
      ['other extensions', [{ ...PREVIEW, extension_ids: ['*'] }]],
      ['none', undefined],
    ];
    for (const [name, resources] of cases) {
      const { status, output } = checkBuild(project((write) => everyManifest(write, (changed) => {
        if (resources === undefined) delete changed.web_accessible_resources;
        else changed.web_accessible_resources = resources;
      })));
      expect(output, name).toContain('.output/chrome-mv3: web_accessible_resources must be exactly preview.html at its '
        + 'dynamic address on every https and http page');
      expect(status, name).toBe(1);
    }
    // The matches' order does not matter.
    const reordered = checkBuild(project((write) => everyManifest(write, (changed) => {
      changed.web_accessible_resources = [{ ...PREVIEW, matches: ['http://*/*', 'https://*/*'] }];
    })));
    expect(reordered.output).not.toContain('web_accessible_resources');
    expect(reordered.status).toBe(0);
  }, 60_000);

  // v1.5 X: the preview page is in every build.
  it('fail a build without the web-accessible preview page', () => {
    const root = project();
    for (const dir of Object.values(BUILDS)) rmSync(join(root, dir, 'preview.html'));
    const { status, output } = checkBuild(root);
    expect(output).toContain('.output/chrome-mv3: page preview.html is missing');
    expect(status).toBe(1);
  });

  it("fail a content script whose bundle holds WXT's content-script context, which announces the extension (round 2, E1)", () => {
    for (const name of ['stopOldScripts', 'SCRIPT_STARTED_MESSAGE_TYPE']) {
      const { status, output } = checkBuild(project((write) => {
        for (const dir of Object.values(BUILDS)) {
          write(`${dir}/content-scripts/content.js`, `var content=(function(){var c={${name}:function(){}};return c})();`);
        }
      }));
      expect(output, name).toContain(`.output/chrome-mv3: content script content-scripts/content.js holds WXT's `
        + `content-script context (${name})`);
      expect(status, name).toBe(1);
    }
  });

  it("fail a page-world bridge bundle that adds a global, names an extension API or window messaging, or listens elsewise", () => {
    const listen = `${BRIDGE_AT}${BRIDGE_LISTEN}`;
    const command = '[["tailorit:bridge",true]]';
    const cases: Array<[string, string]> = [
      [`var pageBridge=(function(){${listen}})();`, 'the page-world bridge is not one anonymous function called at once'],
      [`var pageBridge=(function(){${listen}})();`, 'the page-world bridge adds globals: pageBridge'],
      [`(function(){globalThis.__tailorit=1;${listen}})();`, 'the page-world bridge adds globals: __tailorit'],
      [`(function(){chrome.runtime;${listen}})();`, 'the page-world bridge names "chrome."'],
      [`(function(){browser.runtime;${listen}})();`, 'the page-world bridge names "browser."'],
      [`(function(){document.defaultView.postMessage;${listen}})();`, 'the page-world bridge names "postMessage"'],
      ['(function(){})();', `the page-world bridge listens for [] at ${POSTING_AT}, not ${command}`],
      [`(function(){${listen};document.addEventListener("message",()=>{},!0)})();`,
        `the page-world bridge listens for [["tailorit:bridge",true],["message",true]] at ${POSTING_AT}, not ${command}`],
      ['(function(){document.addEventListener("tailorit:bridge",()=>{})})();',
        `the page-world bridge listens for [["tailorit:bridge",false]] at ${POSTING_AT}, not ${command}`],
      // The v3 Phase 6/7b review (S3): a bridge that installs on every page of the ATS domains.
      [`(function(){${BRIDGE_LISTEN}})();`,
        `the page-world bridge listens for ${command} at https://internal-acme.icims.com/jobs/1/engineer/job, not []`],
      ['(function(){window.x=1})();',
        `the page-world bridge throws on its own at ${POSTING_AT}: ReferenceError: window is not defined`],
    ];
    for (const [bundle, message] of cases) {
      const { status, output } = checkBuild(project((write) => {
        for (const dir of Object.values(BUILDS)) write(`${dir}/content-scripts/page-bridge.js`, bundle);
      }));
      expect(output, bundle).toContain(`.output/chrome-mv3: ${message}`);
      expect(status, bundle).toBe(1);
    }
    // v5 p2-detect: eleven runs of the script, each now also running the submit watcher's bundle at its addresses.
  }, 30_000);
});

describe("check-build's v3 Phase 8 and v5 assertions: the hosts, the sentinel and its registrations", () => {
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  it('fail a build without scripting, or with another permission', () => {
    for (const permissions of [['storage', 'sidePanel', 'activeTab', 'alarms'], ['storage', 'sidePanel', 'activeTab', 'alarms',
      'scripting', 'tabs']]) {
      const { status, output } = checkBuild(project((write) => everyManifest(write, (changed) => {
        changed.permissions = permissions;
      })));
      expect(output, permissions.join()).toContain(`.output/chrome-mv3: permissions are ${JSON.stringify(permissions)}`);
      expect(status).toBe(1);
    }
  });

  // v5 p1-rules (PLAN decision 10): every https and http page is required at install, so no host is optional any more.
  it('fail any optional host permission, the v3 Phase 8 one included', () => {
    for (const optional of [['https://*/*'], ['<all_urls>'], []]) {
      const { status, output } = checkBuild(project((write) => everyManifest(write, (changed) => {
        changed.optional_host_permissions = optional;
      })));
      expect(output, JSON.stringify(optional)).toContain('.output/chrome-mv3: optional_host_permissions must be absent');
      expect(status).toBe(1);
    }
  });

  it('fail host permissions other than every https and http page plus TailorIT, never <all_urls>, and optional permissions', () => {
    const cases: Array<[string[], string]> = [
      [['https://*/*', 'http://localhost:3100/*'], 'host_permissions are ["https://*/*","http://localhost:3100/*"]'],
      [[...ATS_MATCHES, 'http://localhost:3100/*'],
        `host_permissions are ${JSON.stringify([...ATS_MATCHES, 'http://localhost:3100/*'])}, not every https and http page`],
      [['<all_urls>', 'http://localhost:3100/*'], 'the host permission <all_urls> reaches more than web pages'],
      [['https://*/*', 'http://*/*', 'file:///*', 'http://localhost:3100/*'], 'the host permission file:///* reaches more than web pages'],
      [['https://*/*', 'http://*/*', 'ws://*/*', 'http://localhost:3100/*'], 'the host permission ws://*/* reaches more than web pages'],
      [['https://*/*', 'http://*/*'], 'host_permissions are ["https://*/*","http://*/*"]'],
    ];
    for (const [hosts, message] of cases) {
      const { status, output } = checkBuild(project((write) => everyManifest(write, (changed) => {
        changed.host_permissions = hosts;
      })));
      expect(output, message).toContain(`.output/chrome-mv3: ${message}`);
      expect(status, message).toBe(1);
    }
    const { status, output } = checkBuild(project((write) => everyManifest(write, (changed) => {
      changed.optional_permissions = ['tabs'];
    })));
    expect(output).toContain('.output/chrome-mv3: optional_permissions must be absent');
    expect(status).toBe(1);
  }, 30_000); // v1.5 X: as the file's other many-build cases (a loaded machine takes over 5 s).

  // v5 p1-rules (PLAN decision 9): no static content script runs in a CAPTCHA or anti-bot vendor's frame.
  it("fail a static content script that would run in a CAPTCHA vendor's frame", () => {
    for (const [pattern, address] of [['https://challenges.cloudflare.com/*',
      'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv0/0/x/light/normal'],
    ['https://*.hcaptcha.com/*', 'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox']]) {
      const { status, output } = checkBuild(project((write) => {
        const hosts = readFileSync(join(ROOT, 'src', 'shared', 'hosts.ts'), 'utf8');
        write('src/shared/hosts.ts', hosts.replace("export const ATS_MATCHES = [\n", `export const ATS_MATCHES = [\n  '${pattern}',\n`));
        everyManifest(write, (changed) => {
          contentScript(changed).matches = [pattern, ...ATS_MATCHES];
          bridgeScript(changed).matches = [pattern, ...ATS_MATCHES];
        });
      }));
      expect(output, pattern).toContain(`.output/chrome-mv3: the content script runs in a CAPTCHA vendor's frame at ${address}`);
      expect(output, pattern).toContain(`.output/chrome-mv3: the page-world bridge runs in a CAPTCHA vendor's frame at ${address}`);
      expect(status, pattern).toBe(1);
    }
  });

  // The P2 review (security 2): UKG's candidate hosts by name; an employer's own UKG Pro host (<n>.ultipro.com, .ca),
  // whose job boards are for its staff, gets no content script, no bridge and no sentinel.
  it("fail a static content script that would run on an employer's own UKG Pro job board", () => {
    for (const pattern of ['https://*.ultipro.com/*/JobBoard/*', 'https://*.ultipro.ca/*/JobBoard/*']) {
      const address = pattern.includes('.ca/')
        ? 'https://n12.ultipro.ca/ACME1000/JobBoard/0d3f6a2e-1111-2222-3333-444455556666/'
        : 'https://n12.ultipro.com/ACME1000/JobBoard/0d3f6a2e-1111-2222-3333-444455556666/OpportunityDetail?opportunityId=1';
      const { status, output } = checkBuild(project((write) => {
        const hosts = readFileSync(join(ROOT, 'src', 'shared', 'hosts.ts'), 'utf8');
        write('src/shared/hosts.ts', hosts.replace("export const ATS_MATCHES = [\n", `export const ATS_MATCHES = [\n  '${pattern}',\n`));
        everyManifest(write, (changed) => {
          contentScript(changed).matches = [pattern, ...ATS_MATCHES];
          bridgeScript(changed).matches = [pattern, ...ATS_MATCHES];
        });
      }));
      expect(output, pattern).toContain(`.output/chrome-mv3: the content script runs on an HR system at ${address}`);
      expect(output, pattern).toContain(`.output/chrome-mv3: the page-world bridge runs on an HR system at ${address}`);
      expect(status, pattern).toBe(1);
    }
    // The match list itself: no static match covers an employer's UKG Pro host, the sentinel excludes it.
    for (const address of ['https://n12.ultipro.com/ACME1000/JobBoard/x/', 'https://n12.ultipro.ca/ACME1000/JobBoard/x/']) {
      expect(onAtsMatch(address), address).toBe(false);
      expect(isCompanySiteUrl(address), address).toBe(false);
    }
    for (const address of ['https://recruiting2.ultipro.com/ACME1000/JobBoard/x/', 'https://recruiting.ultipro.ca/ACME1000/JobBoard/x/',
      'https://acme.rec.pro.ukg.net/ACME1000/JobBoard/x/']) expect(onAtsMatch(address), address).toBe(true);
  });

  it('fail a sentinel that is missing, listed in the manifest, over its budget, or that names React, zod or a DOM write', () => {
    const cases: Array<[string, string]> = [
      // v5 p2-detect: 19 KiB (Oracle's Candidate Experience on a company's own domain, recognised by its address).
      // jr7 ENGINE-7 E0: 20 KiB (jr7's new hosts and HR lists).
      [`var big="${'a'.repeat(20 * 1024)}";`, 'the sentinel is 20491 bytes, over the 20480-byte budget'],
      ['(function(){document.body.appendChild(document.createElement("div"))})();', 'the sentinel names "createElement"'],
      ['(function(){e.innerHTML="x"})();', 'the sentinel names "innerHTML"'],
      ['(function(){e.setAttribute("x","y")})();', 'the sentinel names "setAttribute"'],
      ['(function(){Symbol.for("react.element")})();', 'the sentinel names "react."'],
      ['(function(){class ZodError extends Error{}})();', 'the sentinel names "ZodError"'],
      ['(function(){window.postMessage("x","*")})();', 'the sentinel names "postMessage"'],
      ['(function(){var stopOldScripts=1})();', 'the sentinel names "stopOldScripts"'],
    ];
    for (const [bundle, message] of cases) {
      const { status, output } = checkBuild(project((write) => {
        for (const dir of Object.values(BUILDS)) write(`${dir}/sentinel.js`, bundle);
      }));
      expect(output, bundle).toContain(`.output/chrome-mv3: ${message}`);
      expect(status, bundle).toBe(1);
    }
    const listed = checkBuild(project((write) => everyManifest(write, (changed) => {
      contentScript(changed).js = ['content-scripts/content.js', 'sentinel.js'];
    })));
    expect(listed.output).toContain('.output/chrome-mv3: the sentinel is listed in the manifest');
    // project() keeps its folder last in `folders` before it calls the change.
    const gone = checkBuild(project(() => {
      for (const dir of Object.values(BUILDS)) rmSync(join(folders.at(-1)!, dir, 'sentinel.js'));
    }));
    expect(gone.output).toContain('.output/chrome-mv3: the sentinel sentinel.js is missing');
  }, 30_000); // v1.5 X: as the file's other many-build cases (a loaded machine takes over 5 s).

  it("fail a sidebar bundle that is missing, listed in the manifest, over its budget, or holds WXT's context", () => {
    const cases: Array<[string, string]> = [
      [`var big="${'a'.repeat(800 * 1024)}";`, "the sidebar's bundle is 819211 bytes, over the 819200-byte budget"],
      ['(function(){var stopOldScripts=1})();', `the sidebar's bundle names "stopOldScripts"`],
    ];
    for (const [bundle, message] of cases) {
      const { status, output } = checkBuild(project((write) => {
        for (const dir of Object.values(BUILDS)) write(`${dir}/sidebar-app.js`, bundle);
      }));
      expect(output, message).toContain(`.output/chrome-mv3: ${message}`);
      expect(status, message).toBe(1);
    }
    const listed = checkBuild(project((write) => everyManifest(write, (changed) => {
      changed.web_accessible_resources = [{ resources: ['sidebar-app.js'], matches: ['https://*/*'] }];
    })));
    expect(listed.output).toContain(".output/chrome-mv3: the sidebar's bundle is listed in the manifest");
    expect(listed.status).toBe(1);
    // project() keeps its folder last in `folders` before it calls the change.
    const gone = checkBuild(project(() => {
      for (const dir of Object.values(BUILDS)) rmSync(join(folders.at(-1)!, dir, 'sidebar-app.js'));
    }));
    expect(gone.output).toContain(".output/chrome-mv3: the sidebar's bundle sidebar-app.js is missing");
    expect(gone.status).toBe(1);
  });

  // The jr6 review (R16): Sign-up Information's password fields are drawn on the extension's own pages alone, never in
  // a bundle a job site's page loads (its page process hears what is typed there).
  it('fail a sidebar bundle or a content script that holds Sign-up Information’s fields (the jr6 review, R16)', () => {
    for (const mark of ['data-signup-password', 'Generate strong password']) {
      const sidebar = checkBuild(project((write) => {
        for (const dir of Object.values(BUILDS)) write(`${dir}/sidebar-app.js`, `(function(){var a=${JSON.stringify(mark)}})();`);
      }));
      expect(sidebar.output, mark).toContain(`.output/chrome-mv3: the sidebar's bundle holds Sign-up Information's fields ("${mark}")`);
      expect(sidebar.status, mark).toBe(1);
      const content = checkBuild(project((write) => {
        for (const dir of Object.values(BUILDS)) {
          write(`${dir}/content-scripts/content.js`, `var content=(function(){var a=${JSON.stringify(mark)};return {}})();`);
        }
      }));
      expect(content.output, mark).toContain(`.output/chrome-mv3: content script content-scripts/content.js holds `
        + `Sign-up Information's fields ("${mark}")`);
      expect(content.status, mark).toBe(1);
    }
  });

  // v5 p2-fill (PLAN decision 14): the page patches' bundle.
  it('fail page patches that are missing, listed, over their budget, name an API, add a global, listen elsewise or patch at install', () => {
    const cases: Array<[string, string]> = [
      [`var big="${'a'.repeat(8 * 1024)}";`, 'the page patches are 8203 bytes, over the 8192-byte budget'],
      [`var pagePatches=(function(){${PATCHES_LISTEN}})();`, 'the page patches are not one anonymous function called at once'],
      [`var pagePatches=(function(){${PATCHES_LISTEN}})();`, 'the page patches add globals: pagePatches'],
      [`(function(){chrome.runtime;${PATCHES_LISTEN}})();`, 'the page patches name "chrome."'],
      [`(function(){window.fetch;${PATCHES_LISTEN}})();`, 'the page patches name "fetch"'],
      [`(function(){var stopOldScripts=1;${PATCHES_LISTEN}})();`, 'the page patches name "stopOldScripts"'],
      ['(function(){})();', 'the page patches listen for [], not [["tailorit:patch",true]]'],
      [`(function(){${PATCHES_LISTEN};document.addEventListener("click",()=>{},!0)})();`,
        'the page patches listen for [["tailorit:patch",true],["click",true]], not [["tailorit:patch",true]]'],
      [`(function(){document.defaultView.alert=function(){};${PATCHES_LISTEN}})();`, 'the page patches patch the page at install'],
      [`(function(){document.defaultView.confirm=null;${PATCHES_LISTEN}})();`, 'the page patches patch the page at install'],
      [`(function(){document.defaultView.HTMLInputElement.prototype.click=function(){};${PATCHES_LISTEN}})();`,
        'the page patches patch the page at install'],
      [`(function(){document.defaultView.showOpenFilePicker=function(){};${PATCHES_LISTEN}})();`,
        'the page patches patch the page at install'],
      ['(function(){undefinedThing.x=1})();', 'the page patches throw on their own: ReferenceError: undefinedThing is not defined'],
    ];
    for (const [bundle, message] of cases) {
      const { status, output } = checkBuild(project((write) => {
        for (const dir of Object.values(BUILDS)) write(`${dir}/page-patches.js`, bundle);
      }));
      expect(output, message).toContain(`.output/chrome-mv3: ${message}`);
      expect(status, message).toBe(1);
    }
    const listed = checkBuild(project((write) => everyManifest(write, (changed) => {
      changed.web_accessible_resources = [{ resources: ['page-patches.js'], matches: ['https://*/*'] }];
    })));
    expect(listed.output).toContain('.output/chrome-mv3: the page patches are listed in the manifest');
    expect(listed.status).toBe(1);
    // project() keeps its folder last in `folders` before it calls the change.
    const gone = checkBuild(project(() => {
      for (const dir of Object.values(BUILDS)) rmSync(join(folders.at(-1)!, dir, 'page-patches.js'));
    }));
    expect(gone.output).toContain('.output/chrome-mv3: the page patches page-patches.js are missing');
    expect(gone.status).toBe(1);
  }, 30_000);

  it('hold registrationsFor to the sentinel, in the top frame only, on every https page but the ATS hosts, LinkedIn and the HR systems', () => {
    const changed = (body: string) => checkBuild(project((write) => {
      const hosts = readFileSync(join(ROOT, 'src', 'shared', 'hosts.ts'), 'utf8');
      write('src/shared/hosts.ts', hosts.replace(/export function registrationsFor[\s\S]*?\n}\n/, body));
    }));
    /** A registrationsFor that registers `fields` while on. */
    const registering = (fields: string) => 'export function registrationsFor(on: { sites: boolean }): SiteRegistration[] {\n'
      + `  return on.sites ? [{ id: SITES_REGISTRATION_ID, js: [SENTINEL_FILE], runAt: 'document_idle', persistAcrossSessions: true, world: 'ISOLATED', ${fields} } as never] : [];\n}\n`;
    const cases: Array<[string, string]> = [
      ['export function registrationsFor(on: { sites: boolean }): SiteRegistration[] {\n  void on;\n  return [];\n}\n',
        'registrationsFor: registers []'],
      [registering("allFrames: true, matches: [SITES_MATCH], excludeMatches: [...ATS_MATCHES, ...LINKEDIN_HOST_MATCHES, ...HR_HOST_MATCHES]"),
        'registrationsFor: tailorit-sites is not the top frame only'],
      [registering("allFrames: false, matches: [SITES_MATCH], excludeMatches: [...LINKEDIN_HOST_MATCHES]"),
        'registrationsFor: tailorit-sites does not exclude https://job-boards.greenhouse.io/*'],
      [registering("allFrames: false, matches: ['https://*/*', 'http://*/*'], excludeMatches: [...ATS_MATCHES, ...LINKEDIN_HOST_MATCHES, ...HR_HOST_MATCHES]"),
        'registrationsFor: tailorit-sites matches http://*/*'],
      // LinkedIn is deferred to v5: a registration that does not exclude every LinkedIn host fails, and says where it
      // would reach.
      [registering("allFrames: false, matches: [SITES_MATCH], excludeMatches: [...ATS_MATCHES, ...HR_HOST_MATCHES]"),
        'registrationsFor: tailorit-sites does not exclude https://*.linkedin.com/*'],
      [registering("allFrames: false, matches: [SITES_MATCH], excludeMatches: [...ATS_MATCHES, ...HR_HOST_MATCHES]"),
        'registrationsFor: tailorit-sites reaches LinkedIn at https://www.linkedin.com/jobs/view/4012345678/'],
      [registering("allFrames: false, matches: [SITES_MATCH], excludeMatches: [...ATS_MATCHES, ...HR_HOST_MATCHES, 'https://www.linkedin.com/*']"),
        'registrationsFor: tailorit-sites reaches LinkedIn at https://uk.linkedin.com/jobs/search/?currentJobId=4012345678'],
      // The Phase 8 review (B4): the employee HR systems are excluded too.
      [registering("allFrames: false, matches: [SITES_MATCH], excludeMatches: [...ATS_MATCHES, ...LINKEDIN_HOST_MATCHES]"),
        'registrationsFor: tailorit-sites does not exclude https://*.oraclecloud.com/*'],
      [registering("allFrames: false, matches: [SITES_MATCH], excludeMatches: [...ATS_MATCHES, ...LINKEDIN_HOST_MATCHES]"),
        'registrationsFor: tailorit-sites reaches an HR system at https://wd5.myworkday.com/acme/d/home.htmld'],
      // v5 p1-rules (PLAN decision 9): the CAPTCHA and anti-bot vendors' own pages are excluded too.
      [registering("allFrames: false, matches: [SITES_MATCH], excludeMatches: [...ATS_MATCHES, ...LINKEDIN_HOST_MATCHES, ...HR_HOST_MATCHES]"),
        'registrationsFor: tailorit-sites does not exclude *://*.google.com/recaptcha/*'],
      [registering("allFrames: false, matches: [SITES_MATCH], excludeMatches: [...ATS_MATCHES, ...LINKEDIN_HOST_MATCHES, ...HR_HOST_MATCHES]"),
        'registrationsFor: tailorit-sites reaches a CAPTCHA vendor at https://www.google.com/recaptcha/api2/anchor?ar=1&k=x&size=normal'],
      [registering("allFrames: false, matches: [SITES_MATCH], excludeMatches: [...ATS_MATCHES, ...LINKEDIN_HOST_MATCHES, ...HR_HOST_MATCHES, ...CAPTCHA_VENDOR_MATCHES.filter((each) => !each.includes('hcaptcha'))]"),
        'registrationsFor: tailorit-sites reaches a CAPTCHA vendor at https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox'],
      // The registration stays on https pages: http forms would send the answers unencrypted.
      [registering("allFrames: false, matches: ['https://*/*', 'http://*/*'], excludeMatches: [...ATS_MATCHES, ...LINKEDIN_HOST_MATCHES, ...HR_HOST_MATCHES, ...CAPTCHA_VENDOR_MATCHES]"),
        'registrationsFor: tailorit-sites matches http://*/*'],
    ];
    for (const [body, message] of cases) {
      const { status, output } = changed(body);
      expect(output, message).toContain(message);
      expect(status, message).toBe(1);
    }
  }, 30_000); // v1.5 X: as the file's other many-build cases (a loaded machine takes over 5 s).
});

// v1.5 (the owner's "all ip address should be changable on .env", 2026-11-10): the production builds' TailorIT is
// TAILORIT_ORIGIN (the environment, else the extension's .env, else http://localhost:3100), and check-build holds their
// manifests to exactly that origin.
describe("check-build's TailorIT origin (TAILORIT_ORIGIN)", () => {
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });
  const LAN = 'http://192.168.1.20:3100';

  it('pass production builds made for a configured origin, whose manifests name exactly it', () => {
    const root = project(undefined, LAN);
    const passed = checkBuild(root, { TAILORIT_ORIGIN: LAN });
    expect(passed.output).toContain('3 build(s) match the manifest the plan allows');
    expect(passed.status).toBe(0);
    const manifestOf = JSON.parse(readFileSync(join(root, BUILDS.chrome, 'manifest.json'), 'utf8'));
    expect(manifestOf.host_permissions).toEqual(['https://*/*', 'http://*/*', `${LAN}/*`]);
    expect(manifestOf.externally_connectable).toEqual({ matches: [`${LAN}/*`] });
    // A trailing slash or upper case in the setting is the same origin.
    expect(checkBuild(root, { TAILORIT_ORIGIN: 'HTTP://192.168.1.20:3100/' }).status).toBe(0);
  }, 30_000);

  it('fail builds made for another TailorIT than the configured one, saying which', () => {
    const { status, output } = checkBuild(project(), { TAILORIT_ORIGIN: LAN });
    expect(output).toContain('.output/chrome-mv3: host_permissions are ["https://*/*","http://*/*","http://localhost:3100/*"], '
      + `not every https and http page plus TailorIT (${LAN}, TAILORIT_ORIGIN: build again after changing it)`);
    expect(output).toContain(`.output/edge-mv3: externally_connectable is not exactly TailorIT (${LAN}, TAILORIT_ORIGIN`);
    expect(status).toBe(1);
    // And the other way round: builds for the LAN address, checked against the default.
    const back = checkBuild(project(undefined, LAN));
    expect(back.output).toContain('externally_connectable is not exactly TailorIT (http://localhost:3100, TAILORIT_ORIGIN');
    expect(back.status).toBe(1);
  }, 30_000);

  it('fail a manifest that names the configured origin and another beside it', () => {
    const { status, output } = checkBuild(project((write) => {
      for (const dir of [BUILDS.chrome, BUILDS.edge]) {
        write(`${dir}/manifest.json`, JSON.stringify({ ...manifest(LAN),
          host_permissions: ['https://*/*', 'http://*/*', `${LAN}/*`, 'http://localhost:3100/*'],
          externally_connectable: { matches: [`${LAN}/*`, 'http://localhost:3100/*'] } }));
      }
    }, LAN), { TAILORIT_ORIGIN: LAN });
    expect(output).toContain('.output/chrome-mv3: host_permissions are');
    expect(output).toContain(`.output/chrome-mv3: externally_connectable is not exactly TailorIT (${LAN}`);
    expect(status).toBe(1);
  }, 30_000);

  it('read TAILORIT_ORIGIN from the .env in the extension\'s root, the environment winning over it', () => {
    const root = project((write) => write('.env', '# TailorIT on the LAN\nTAILORIT_ORIGIN=http://tailorit.lan:3100\n'),
      'http://tailorit.lan:3100');
    expect(checkBuild(root).status).toBe(0);
    const overridden = checkBuild(root, { TAILORIT_ORIGIN: 'http://localhost:3100' });
    expect(overridden.output).toContain('externally_connectable is not exactly TailorIT (http://localhost:3100');
    expect(overridden.status).toBe(1);
  }, 30_000);

  it('stop at once on a TAILORIT_ORIGIN that is no origin, saying what to write', () => {
    for (const [value, why] of [['http://192.168.1.20:3100/app', 'must be an origin, with no path'],
      ['192.168.1.20:3100', 'is not an address'], ['ftp://192.168.1.20', 'must start with http:// or https://'],
      ['http://localhost:3190', "is the e2e mock's address"]] as const) {
      const { status, output } = checkBuild(project(), { TAILORIT_ORIGIN: value });
      expect(output, value).toContain(`TAILORIT_ORIGIN=${value} ${why}`);
      expect(output, value).not.toContain('match the manifest');
      expect(status, value).toBe(1);
    }
  }, 30_000);

  it("pass a TailorIT at 127.0.0.1, whose bundles name it, and still fail the e2e sender's escaped address there", () => {
    const local = 'http://127.0.0.1:3100';
    expect(checkBuild(project(undefined, local), { TAILORIT_ORIGIN: local }).status).toBe(0);
    const { status, output } = checkBuild(project((write) => write(`${BUILDS.chrome}/background.js`,
      String.raw`var background=(function(){function a(e){return /^http:\/\/127\.0\.0\.1:\d+\//.test(e)}return {o:"http://127.0.0.1:3100",a}})();`),
    local), { TAILORIT_ORIGIN: local });
    expect(output).toContain(String.raw`.output/chrome-mv3: background.js contains "127\.0\.0\.1"`);
    expect(status).toBe(1);
  }, 30_000);
});

// ── jr7 ENGINE-7 E0 (the coordinator's decision of 2026-11-11): check-build's own HR lists, a second lock ──
describe("check-build's own HR lists, a second lock on src/shared/hosts.ts (jr7 ENGINE-7 E0)", () => {
  /** The quoted https addresses and patterns of scripts/check-build.mjs's `const <name> = [...]`, comments aside. */
  const listOf = (name: string): string[] => {
    const source = readFileSync(join(ROOT, 'scripts', 'check-build.mjs'), 'utf8');
    const start = source.indexOf(`\nconst ${name} = [`);
    const body = start < 0 ? '' : source.slice(start, source.indexOf('];', start));
    return [...body.matchAll(/'(https:\/\/[^'\s]+)'/g)].map((match) => match[1]!);
  };

  it('names exactly the HR patterns hosts.ts names, each with an address it covers, on an HR host no career-site page is',
    () => {
      const excluded = listOf('HR_EXCLUDED');
      const addresses = listOf('HR_ADDRESSES');
      expect(excluded.length).toBeGreaterThan(20);
      // A host missing from either list fails here: the sentinel's registration (hosts.ts) and the build's own check
      // (check-build.mjs) keep the same employee systems off.
      expect([...excluded].sort()).toEqual([...HR_HOST_MATCHES].sort());
      for (const pattern of excluded) {
        expect(addresses.some((address) => new MatchPattern(pattern).includes(address)), pattern).toBe(true);
      }
      for (const address of addresses) {
        expect(isHrHost(new URL(address).hostname), address).toBe(true);
        expect(isCompanySiteUrl(address), address).toBe(false);
      }
    });
});
// ── end jr7 ENGINE-7 E0 ──
