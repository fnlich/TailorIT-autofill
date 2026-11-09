/*
 * scripts/check-build.mjs's assertions: no build it checks (chrome, edge and e2e, all production mode) may hold the
 * capture page, the capture hotkeys' code or a `commands` key; a production bundle may hold none of the e2e build's
 * hooks; no bundle names another build's TailorIT; `externally_connectable` is exactly TailorIT's origin; every file
 * the content script lists exists and stays within the size budget; there are exactly two content scripts, ours and
 * the page-world bridge (world MAIN, the same matches, from document_start, one file and no CSS, within its own
 * budget: docs/SPEC-AMENDMENTS.md §12), whose bundle is one anonymous function that names no extension API and no
 * window messaging, adds no global and listens for its command alone, and no web-accessible resource; and every
 * build ships its four icons as PNGs of their sizes. v5 p1-rules (PLAN decisions 9 and 10): the host permissions are
 * exactly every https and http page plus TailorIT, with no optional ones, and neither the sentinel's registration nor
 * a static content script reaches a CAPTCHA or anti-bot vendor's frame. v5 p1-shell: the sidebar's bundle is in every
 * build, listed nowhere in the manifest, within its budget, and holds no WXT content-script context. v5 p2-detect: a
 * third content script, the page-world submit watcher (world MAIN, Workday's and ClearCompany's hosts alone, every
 * frame, from document_start, within its budget), whose bundle is one anonymous function naming no extension API and
 * no way to read a body or a header, adding no global and no listener, and wrapping fetch and XMLHttpRequest exactly
 * at a Workday or ClearCompany posting or form.
 * The script runs as it is, copied with what it reads (proc.mjs, the host list, the public key) into a
 * temporary folder that holds three fixture builds, and each case breaks the builds in one way.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CAPTURE_MARKER } from '../src/background/capture';
import { ATS_MATCHES, SUBMIT_WATCH_MATCHES } from '../src/shared/hosts';

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

/** v3 Phase 8: a sentinel bundle as the real one reads: it reads the page and sends one message. */
const SENTINEL_BUNDLE = '(function(){var t=globalThis.chrome;var r=document.querySelectorAll("input");'
  + 't.runtime.sendMessage({v:1,type:"page/recognised",reason:"application-form"})})();';

/** The page-world bridge's entry in a manifest, as WXT writes it (src/entrypoints/page-bridge.content.ts). */
const BRIDGE_SCRIPT = { all_frames: true, run_at: 'document_start', js: ['content-scripts/page-bridge.js'], world: 'MAIN' };
/** v5 p2-detect: the page-world submit watcher's entry, as WXT writes it (src/entrypoints/submit-watch.content.ts). */
const WATCH_SCRIPT = { all_frames: true, run_at: 'document_start', js: ['content-scripts/submit-watch.js'], world: 'MAIN' };
/** v5 p2-detect: a watcher bundle as the real one behaves: it wraps fetch and XMLHttpRequest's open and send at a
 *  Workday, ClearCompany or Oracle posting or form (check-build's own addresses), SuccessFactors' applyJob proxy at a
 *  career site's form, and nothing elsewhere; it reads no body and tells nothing. */
const WATCH_AT = 'var h=String(document.location&&document.location.href||"");'
  + 'if(/myworkdayjobs(?:-impl)?\\.com\\/|\\/job\\/Remote\\/Engineer_JR-1|\\/careers\\/jobs\\/[0-9a-f-]+\\/apply'
  + '|\\/CandidateExperience\\/.*\\/apply\\//.test(h))';
const WATCH_WRAP = '{var f=window.fetch;window.fetch=function(){return f.apply(this,arguments)};'
  + 'var p=window.XMLHttpRequest.prototype,o=p.open,s=p.send;p.open=function(){return o.apply(this,arguments)};'
  + 'p.send=function(){return s.apply(this,arguments)}}';
const WATCH_PROXY = 'if(/successfactors\\.eu\\/career\\?/.test(h)){var x=window.rcmHybridJobApplicationControllerASProxy,'
  + 'a=x.applyJob;x.applyJob=function(){return a.apply(this,arguments)}}';
const WATCH_BUNDLE = `(function(){${WATCH_AT}${WATCH_WRAP}${WATCH_PROXY}})();`;

const folders: string[] = [];

/** A copy of the script and what it reads, with three clean builds; `change` then breaks what a case needs. */
function project(change: (write: (path: string, text: string | Uint8Array) => void) => void = () => undefined): string {
  const root = mkdtempSync(join(tmpdir(), 'tailorit-check-build-'));
  folders.push(root);
  const write = (path: string, text: string | Uint8Array) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const path of ['scripts/check-build.mjs', 'scripts/proc.mjs', 'src/shared/hosts.ts', 'src/shared/sidebar.ts',
    'keys/manifest-key.txt']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(ROOT, path), join(root, path));
  }
  for (const [name, dir] of Object.entries(BUILDS)) {
    write(`${dir}/manifest.json`, JSON.stringify(manifest(name === 'e2e' ? 'http://localhost:3190' : 'http://localhost:3100')));
    write(`${dir}/background.js`, 'var background=(function(){return {}})();');
    write(`${dir}/content-scripts/content.js`, 'var content=(function(){return {}})();');
    write(`${dir}/content-scripts/page-bridge.js`, BRIDGE_BUNDLE);
    write(`${dir}/content-scripts/submit-watch.js`, WATCH_BUNDLE);
    // v3 Phase 8: the sentinel the worker registers, and the content script it injects, at the build's root.
    write(`${dir}/sentinel.js`, SENTINEL_BUNDLE);
    write(`${dir}/content-script.js`, 'var contentScript=(function(){return {}})();');
    // v5 p1-shell: the sidebar's bundle the worker runs on sidebar/load, at the build's root.
    write(`${dir}/sidebar-app.js`, 'var sidebarApp=(function(){return {}})();');
    write(`${dir}/chunks/options-abc.js`, 'export const options = 1;');
    write(`${dir}/options.html`, '<!doctype html><title>Settings</title>');
    write(`${dir}/sidepanel.html`, '<!doctype html><title>Review</title>');
    for (const [size, path] of Object.entries(ICONS)) write(`${dir}/${path}`, png(Number(size)));
  }
  change(write);
  return root;
}

function checkBuild(root: string): { status: number | null; output: string } {
  const run = spawnSync(process.execPath, [join(root, 'scripts', 'check-build.mjs'), '--all'], { cwd: root, encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' } });
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
  });

  it('fail a submit watcher over its 28 KiB budget, or one that reads a body, adds a global or a listener, or wraps elsewise (v5 p2-detect)', () => {
    const big = checkBuild(project((write) => {
      for (const dir of Object.values(BUILDS)) write(`${dir}/content-scripts/submit-watch.js`, `var big="${'a'.repeat(28 * 1024)}";`);
    }));
    expect(big.output).toContain('.output/chrome-mv3: the submit watcher is');
    expect(big.output).toContain('over the 28672-byte budget');
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
  });

  // (The snapshot build of 2026-11-06, core pass Z1 items 26 and 39: the bridge reads only the shared domains' address
  // parsers, under a budget of 24 KiB; v5 p2-detect: 26 KiB, for the address variants its parsers read.)
  it("fail a page-world bridge over its 26 KiB budget, or one whose file is missing", () => {
    const big = checkBuild(project((write) => {
      for (const dir of Object.values(BUILDS)) write(`${dir}/content-scripts/page-bridge.js`, `var big="${'a'.repeat(26 * 1024)}";`);
    }));
    expect(big.output).toContain('.output/chrome-mv3: the page-world bridge is');
    expect(big.output).toContain('over the 26624-byte budget');
    expect(big.status).toBe(1);

    const missing = checkBuild(project((write) => everyManifest(write, (changed) => {
      bridgeScript(changed).js = ['content-scripts/elsewhere.js'];
    })));
    expect(missing.output).toContain('.output/chrome-mv3: the page-world bridge content-scripts/elsewhere.js is missing');
    expect(missing.status).toBe(1);
  });

  it('fail a build with web-accessible resources, which a page-world script never needs', () => {
    const { status, output } = checkBuild(project((write) => everyManifest(write, (changed) => {
      changed.web_accessible_resources = [{ resources: ['content-scripts/page-bridge.js'], matches: [...ATS_MATCHES] }];
    })));
    expect(output).toContain('.output/chrome-mv3: web_accessible_resources must be absent');
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
  });

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

  it('fail a sentinel that is missing, listed in the manifest, over its budget, or that names React, zod or a DOM write', () => {
    const cases: Array<[string, string]> = [
      // v5 p2-detect: 19 KiB (Oracle's Candidate Experience on a company's own domain, recognised by its address).
      [`var big="${'a'.repeat(19 * 1024)}";`, 'the sentinel is 19467 bytes, over the 19456-byte budget'],
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
  });

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
  });
});
