/*
 * The vocabularies the matcher and canonicalizeProfile read: the committed data JSON (about 2 MB), bundled into the
 * worker as text and parsed into one Vocab on first use, then kept for the worker's life. It never reaches a content
 * script: frames receive planned writes, not the vocabulary.
 */
import { createVocab } from '../core/vocab/createVocab';
import type { RawVocab, Vocab } from '../core/vocab/types';
import answers from '../core/vocab/data/answers.json?raw';
import countries from '../core/vocab/data/countries.json?raw';
import degrees from '../core/vocab/data/degrees.json?raw';
import fields from '../core/vocab/data/fields.json?raw';
import institutionsGlobal from '../core/vocab/data/institutions-global.json?raw';
import institutionsUs from '../core/vocab/data/institutions-us.json?raw';
import languages from '../core/vocab/data/languages.json?raw';
import lexicon from '../core/vocab/data/lexicon.json?raw';
import manifest from '../core/vocab/data/manifest.json?raw';
import regions from '../core/vocab/data/regions.json?raw';

let built: Vocab | null = null;

/** The bundled Vocab, built once per worker life. */
export function bundledVocab(): Vocab {
  if (built === null) {
    const raw = {
      manifest: JSON.parse(manifest),
      institutionsUs: JSON.parse(institutionsUs),
      institutionsGlobal: JSON.parse(institutionsGlobal),
      fields: JSON.parse(fields),
      degrees: JSON.parse(degrees),
      countries: JSON.parse(countries),
      regions: JSON.parse(regions),
      languages: JSON.parse(languages),
      answers: JSON.parse(answers),
      lexicon: JSON.parse(lexicon),
    } as RawVocab;
    built = createVocab(raw);
  }
  return built;
}
