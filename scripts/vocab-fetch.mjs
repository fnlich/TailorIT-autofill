// Downloads the vocabulary sources listed in vocab/sources.json into vocab/.sources/<id>/ (git-ignored), unpacks
// archives with the system's tar, and checks every file against its recorded sha256. A source whose hashes are still
// null is recorded (the first fetch); after that a mismatch fails. The build (scripts/vocab-build.ts) never touches
// the network: it reads only files this script has checked. Usage: node scripts/vocab-fetch.mjs [--record]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { paint } from './proc.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST = join(ROOT, 'vocab', 'sources.json');
const SOURCES = join(ROOT, 'vocab', '.sources');
const record = process.argv.includes('--record');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
let failed = false;

for (const source of manifest.sources) {
  const dir = join(SOURCES, source.id);
  // Each source gets its own new, empty folder: downloads are data, never run.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  console.log(paint('cyan', `▶ ${source.id}: ${source.url}`));
  const response = await fetch(source.url, { redirect: 'follow', headers: { 'user-agent': 'TailorIT-Autofill vocab-fetch (one-time download)' } });
  if (!response.ok) {
    console.error(paint('red', `✗ ${source.id}: HTTP ${response.status}`));
    failed = true;
    continue;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  // A source without an archive is a single file, saved under its own name.
  const [singleFile = 'download'] = Object.keys(source.files);
  const downloaded = join(dir, source.archive ? `download.${source.archive}` : singleFile);
  writeFileSync(downloaded, bytes);
  if (source.archive) {
    const archiveHash = sha256(downloaded);
    if (source.archiveSha256 === null || record) source.archiveSha256 = archiveHash;
    else if (source.archiveSha256 !== archiveHash) {
      console.error(paint('red', `✗ ${source.id}: the archive's sha256 is ${archiveHash}, expected ${source.archiveSha256}`));
      failed = true;
      continue;
    }
    // Windows' own bsdtar unpacks zip files; relative paths keep a drive letter from reading as a remote host.
    const archiveName = `download.${source.archive}`;
    const tarBin = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'unzip';
    const tarArgs = process.platform === 'win32' ? ['-xf', archiveName] : ['-o', archiveName];
    const tar = spawnSync(tarBin, tarArgs, { cwd: dir, stdio: 'inherit' });
    if (tar.status !== 0) {
      console.error(paint('red', `✗ ${source.id}: could not unpack the archive`));
      failed = true;
      continue;
    }
    rmSync(downloaded);
  }
  for (const [file, expected] of Object.entries(source.files)) {
    const path = join(dir, file);
    if (!existsSync(path)) {
      console.error(paint('red', `✗ ${source.id}: ${file} is not in the download`));
      failed = true;
      continue;
    }
    const actual = sha256(path);
    if (expected === null || record) source.files[file] = actual;
    else if (expected !== actual) {
      console.error(paint('red', `✗ ${source.id}: ${file} has sha256 ${actual}, expected ${expected}`));
      failed = true;
      continue;
    }
    console.log(paint('green', `✓ ${source.id}/${file} ${actual.slice(0, 16)}…`));
  }
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
process.exit(failed ? 1 : 0);
