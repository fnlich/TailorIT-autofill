/*
 * The core's tests read the committed vocabulary data through this Node-side helper: it loads
 * src/core/vocab/data/*.json with node:fs and builds the Vocab once per test process. It is a testkit, so the pure
 * program and its lint leave it out, and no non-test code may import it; the worker gets the JSON from its bundle.
 */
import { readFileSync } from 'node:fs';
import { createVocab } from './createVocab';
import { VOCAB_FILES, type RawVocab, type Vocab, type VocabFile } from './types';

const DATA_DIR = new URL('./data/', import.meta.url);

/** The exact text of one generated file. */
export function readVocabFile(file: VocabFile): string {
  return readFileSync(new URL(VOCAB_FILES[file], DATA_DIR), 'utf8');
}

/** Every generated file, parsed: createVocab's input. */
export function loadRawVocab(): RawVocab {
  const raw: Partial<Record<VocabFile, unknown>> = {};
  for (const file of Object.keys(VOCAB_FILES) as VocabFile[]) raw[file] = JSON.parse(readVocabFile(file));
  return raw as RawVocab;
}

let bundled: Vocab | undefined;

/** The Vocab over the committed data, built on first use and shared by every test in the process. */
export function bundledVocab(): Vocab {
  bundled ??= createVocab(loadRawVocab());
  return bundled;
}
