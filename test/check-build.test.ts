/*
 * scripts/check-build.mjs's assertions: no build it checks (chrome, edge and e2e, all production mode) may hold the
 * capture page, the capture hotkeys' code or a `commands` key; a production bundle may hold none of the e2e build's
 * hooks; no bundle names another build's TailorIT; `externally_connectable` is exactly TailorIT's origin; every file
 * the content script lists exists and stays within the size budget; there are exactly two content scripts, ours and
 * the page-world bridge (world MAIN, the same matches, from document_start, one file and no CSS, within its own
 * budget: docs/SPEC-AMENDMENTS.md §12), whose bundle is one anonymous function that names no extension API and no
 * window messaging, adds no global and listens for its command alone, and no web-accessible resource; and every
 * build ships its four icons as PNGs of their sizes. The script runs as it is, copied with what it reads (proc.mjs, the host list, the public key) into a
 * temporary folder that holds three fixture builds, and each case breaks the builds in one way.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CAPTURE_MARKER } from '../src/background/capture';
import { ATS_MATCHES } from '../src/shared/hosts';

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
    permissions: ['storage', 'sidePanel', 'activeTab'],
    host_permissions: [...ATS_MATCHES, `${origin}/*`],
    externally_connectable: { matches: [`${origin}/*`] },
    icons: { ...ICONS },
    action: { default_title: 'TailorIT Autofill', default_icon: { 16: ICONS[16], 32: ICONS[32] } },
    background: { service_worker: 'background.js' },
    options_ui: { open_in_tab: true, page: 'options.html' },
    side_panel: { default_path: 'sidepanel.html' },
    content_scripts: [{ matches: [...ATS_MATCHES], all_frames: true, run_at: 'document_idle', js: ['content-scripts/content.js'] },
      { ...BRIDGE_SCRIPT, matches: [...ATS_MATCHES] }],
  };
}

/** The page-world bridge's entry in a manifest, as WXT writes it (src/entrypoints/page-bridge.content.ts). */
const BRIDGE_SCRIPT = { all_frames: true, run_at: 'document_start', js: ['content-scripts/page-bridge.js'], world: 'MAIN' };

const folders: string[] = [];

/** A copy of the script and what it reads, with three clean builds; `change` then breaks what a case needs. */
function project(change: (write: (path: string, text: string | Uint8Array) => void) => void = () => undefined): string {
  const root = mkdtempSync(join(tmpdir(), 'tailorit-check-build-'));
  folders.push(root);
  const write = (path: string, text: string | Uint8Array) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const path of ['scripts/check-build.mjs', 'scripts/proc.mjs', 'src/shared/hosts.ts', 'keys/manifest-key.txt']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(ROOT, path), join(root, path));
  }
  for (const [name, dir] of Object.entries(BUILDS)) {
    write(`${dir}/manifest.json`, JSON.stringify(manifest(name === 'e2e' ? 'http://localhost:3190' : 'http://localhost:3100')));
    write(`${dir}/background.js`, 'var background=(function(){return {}})();');
    write(`${dir}/content-scripts/content.js`, 'var content=(function(){return {}})();');
    write(`${dir}/content-scripts/page-bridge.js`, '(function(){document.addEventListener("tailorit:bridge",()=>{},!0)})();');
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
    const development = { ...manifest('http://localhost:3100'), permissions: ['storage', 'sidePanel', 'activeTab', 'pageCapture'],
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

/** A script just past the content script's budget (scripts/check-build.mjs's CONTENT_SCRIPT_BUDGET, 1 MiB). */
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

describe("check-build's two content scripts: ours and the page-world bridge", () => {
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  it('pass ours and the bridge in either order', () => {
    const { status, output } = checkBuild(project((write) => everyManifest(write, (changed) => {
      (changed.content_scripts as unknown[]).reverse();
    })));
    expect(output).toContain('3 build(s) match the manifest the plan allows');
    expect(status).toBe(0);
  });

  it('fail a build with our content script alone, a third script, or two in the isolated world', () => {
    const alone = checkBuild(project((write) => everyManifest(write, (changed) => {
      changed.content_scripts = [contentScript(changed)];
    })));
    expect(alone.output).toContain('.output/chrome-mv3: expected two content scripts, ours and the page-world bridge '
      + '(world MAIN), found 1: ["isolated"]');
    expect(alone.status).toBe(1);

    const third = checkBuild(project((write) => everyManifest(write, (changed) => {
      (changed.content_scripts as unknown[]).push({ ...BRIDGE_SCRIPT, matches: [...ATS_MATCHES], js: ['content-scripts/more.js'] });
    })));
    expect(third.output).toContain('found 3: ["isolated","MAIN","MAIN"]');
    expect(third.status).toBe(1);

    const isolated = checkBuild(project((write) => everyManifest(write, (changed) => {
      delete bridgeScript(changed).world;
    })));
    expect(isolated.output).toContain('found 2: ["isolated","isolated"]');
    expect(isolated.status).toBe(1);
  });

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

  it("fail a page-world bridge over its 12 KiB budget, or one whose file is missing", () => {
    const big = checkBuild(project((write) => {
      for (const dir of Object.values(BUILDS)) write(`${dir}/content-scripts/page-bridge.js`, `var big="${'a'.repeat(12 * 1024)}";`);
    }));
    expect(big.output).toContain('.output/chrome-mv3: the page-world bridge is');
    expect(big.output).toContain('over the 12288-byte budget');
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

  it("fail a page-world bridge bundle that adds a global, names an extension API or window messaging, or listens elsewise", () => {
    const listen = 'document.addEventListener("tailorit:bridge",()=>{},!0)';
    const cases: Array<[string, string]> = [
      [`var pageBridge=(function(){${listen}})();`, 'the page-world bridge is not one anonymous function called at once'],
      [`var pageBridge=(function(){${listen}})();`, 'the page-world bridge adds globals: pageBridge'],
      [`(function(){globalThis.__tailorit=1;${listen}})();`, 'the page-world bridge adds globals: __tailorit'],
      [`(function(){chrome.runtime;${listen}})();`, 'the page-world bridge names "chrome."'],
      [`(function(){browser.runtime;${listen}})();`, 'the page-world bridge names "browser."'],
      [`(function(){document.defaultView.postMessage;${listen}})();`, 'the page-world bridge names "postMessage"'],
      ['(function(){})();', 'the page-world bridge listens for [], not its command alone'],
      [`(function(){${listen};document.addEventListener("message",()=>{},!0)})();`,
        'the page-world bridge listens for [["tailorit:bridge",true],["message",true]], not its command alone'],
      ['(function(){document.addEventListener("tailorit:bridge",()=>{})})();',
        'the page-world bridge listens for [["tailorit:bridge",false]], not its command alone'],
      ['(function(){window.x=1})();', 'the page-world bridge throws on its own: ReferenceError: window is not defined'],
    ];
    for (const [bundle, message] of cases) {
      const { status, output } = checkBuild(project((write) => {
        for (const dir of Object.values(BUILDS)) write(`${dir}/content-scripts/page-bridge.js`, bundle);
      }));
      expect(output, bundle).toContain(`.output/chrome-mv3: ${message}`);
      expect(status, bundle).toBe(1);
    }
  });
});
