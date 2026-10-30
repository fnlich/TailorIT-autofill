/*
 * scripts/check-build.mjs's development-only assertions: no build it checks (chrome, edge and e2e, all production
 * mode) may hold the capture page, the capture hotkeys' code or a `commands` key. The script runs as it is, copied
 * with what it reads (proc.mjs, the host list, the public key) into a temporary folder that holds three fixture
 * builds, and each case breaks one build in one way.
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

/** A production manifest as wxt.config.ts makes it, for TailorIT at `origin`. */
function manifest(origin: string): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: 'TailorIT Autofill',
    version: '0.1.0',
    key: KEY,
    minimum_chrome_version: '144',
    permissions: ['storage', 'sidePanel'],
    host_permissions: [...ATS_MATCHES, `${origin}/*`],
    externally_connectable: { matches: [`${origin}/*`] },
    action: { default_title: 'TailorIT Autofill' },
    background: { service_worker: 'background.js' },
    options_ui: { open_in_tab: true, page: 'options.html' },
    side_panel: { default_path: 'sidepanel.html' },
    content_scripts: [{ matches: [...ATS_MATCHES], all_frames: true, run_at: 'document_idle', js: ['content-scripts/content.js'] }],
  };
}

const folders: string[] = [];

/** A copy of the script and what it reads, with three clean builds; `change` then breaks what a case needs. */
function project(change: (write: (path: string, text: string) => void) => void = () => undefined): string {
  const root = mkdtempSync(join(tmpdir(), 'tailorit-check-build-'));
  folders.push(root);
  const write = (path: string, text: string) => {
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
    write(`${dir}/chunks/options-abc.js`, 'export const options = 1;');
    write(`${dir}/options.html`, '<!doctype html><title>Settings</title>');
    write(`${dir}/sidepanel.html`, '<!doctype html><title>Review</title>');
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
    const development = { ...manifest('http://localhost:3100'), permissions: ['storage', 'sidePanel', 'pageCapture'],
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
