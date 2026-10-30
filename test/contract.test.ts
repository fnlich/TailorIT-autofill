import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ATS_KINDS,
  AUTOFILL_API_VERSION,
  AUTOFILL_CONTRACT_SCHEMAS,
  AUTOFILL_FIELD_KINDS,
  AUTOFILL_ROUTES,
  DEGREE_LEVELS as CONTRACT_DEGREE_LEVELS,
  GENDER_IDENTITIES,
  LANGUAGE_PROFICIENCIES,
  RACE_CATEGORIES,
  WORK_STATUSES as CONTRACT_WORK_STATUSES,
} from '../src/contract/tailorit';
import { DEGREE_LEVELS, FIELD_KINDS, GENDERS, PLATFORMS, PROFICIENCIES, RACES, WORK_STATUSES } from '../src/core/enums';

// TailorIT's contract as `npm run contract:pull` copies it into src/contract/tailorit/: the schemas, their record
// (v1/contract.json) and the examples beside it, never edited by hand. TailorIT's own test
// (apps/api/test/autofill-contract.test.ts) checks its side against the same record, so a failure here means the copy
// was edited or pulled half-way: pull it again rather than fix it.

const CONTRACT = fileURLToPath(new URL('../src/contract/tailorit', import.meta.url));

interface ContractRecord {
  apiVersion: number;
  zod: string;
  files: Record<string, string>;
  fixtures: Record<string, string>;
  schemas: Record<string, unknown>;
  routes: unknown;
}
const record = JSON.parse(readFileSync(join(CONTRACT, 'v1', 'contract.json'), 'utf8')) as ContractRecord;
const source = JSON.parse(readFileSync(join(CONTRACT, 'SOURCE.json'), 'utf8')) as {
  commit: string;
  apiVersion: number;
  zod: string;
};

/** TailorIT's hash: SHA-256 over the text with LF line ends. */
const sha256 = (file: string) =>
  createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n?/g, '\n'), 'utf8').digest('hex');

/** Every file under `dir`, relative to it with forward slashes, sorted. */
function filesUnder(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? filesUnder(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
    )
    .sort();
}

const SCHEMA_NAMES = Object.keys(AUTOFILL_CONTRACT_SCHEMAS) as (keyof typeof AUTOFILL_CONTRACT_SCHEMAS)[];
const EXAMPLES = Object.keys(record.fixtures);
const readExample = (file: string): unknown =>
  JSON.parse(readFileSync(join(CONTRACT, 'v1', 'fixtures', ...file.split('/')), 'utf8'));
const examplesOf = (schema: string, kind: 'valid' | 'invalid') =>
  EXAMPLES.filter((file) => file.startsWith(`${schema}/${kind}/`));
const issuesOf = (error: z.ZodError) =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
/** A value as JSON holds it: what contract.json's parts were written from. */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** Every object key in a JSON value, as a path ("profile.education.0.id"). */
function keyPaths(value: unknown, at = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => keyPaths(item, `${at}${index}.`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => [`${at}${key}`, ...keyPaths(item, `${at}${key}.`)]);
}

describe("the copy of TailorIT's contract (src/contract/tailorit)", () => {
  it('holds exactly what contract.json records, unedited (to change it, pull it again: npm run contract:pull)', () => {
    const expected = [
      ...Object.keys(record.files),
      'SOURCE.json',
      'v1/contract.json',
      ...EXAMPLES.map((file) => `v1/fixtures/${file}`),
    ].sort();
    expect(filesUnder(CONTRACT)).toEqual(expected);
    for (const [file, hash] of Object.entries(record.files)) expect(sha256(join(CONTRACT, file)), file).toBe(hash);
    for (const [file, hash] of Object.entries(record.fixtures)) {
      expect(sha256(join(CONTRACT, 'v1', 'fixtures', ...file.split('/'))), file).toBe(hash);
    }
  });

  it('names API version 1 and the zod this extension pins, as SOURCE.json does', () => {
    const zod = (createRequire(import.meta.url)('zod/package.json') as { version: string }).version;
    expect(record.apiVersion).toBe(1);
    expect(AUTOFILL_API_VERSION).toBe(record.apiVersion);
    expect(zod).toBe('4.6.7');
    expect(record.zod).toBe(zod);
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect([source.apiVersion, source.zod]).toEqual([record.apiVersion, record.zod]);
  });

  it("gives the JSON Schemas and the route table its record holds, through this extension's zod", () => {
    expect(Object.keys(record.schemas)).toEqual(SCHEMA_NAMES);
    for (const name of SCHEMA_NAMES) {
      expect(asJson(z.toJSONSchema(AUTOFILL_CONTRACT_SCHEMAS[name])), name).toEqual(record.schemas[name]);
    }
    expect(asJson(AUTOFILL_ROUTES)).toEqual(record.routes);
  });
});

describe('the examples (v1/fixtures)', () => {
  it('give each schema its valid/golden.json (the mock answers with it) and an invalid case', () => {
    for (const name of SCHEMA_NAMES) {
      expect(examplesOf(name, 'valid'), name).toContain(`${name}/valid/golden.json`);
      expect(examplesOf(name, 'invalid').length, name).toBeGreaterThan(0);
    }
  });

  describe.each(SCHEMA_NAMES)('%s', (name) => {
    const schema: z.ZodType = AUTOFILL_CONTRACT_SCHEMAS[name];

    it('parses every valid example, and knows every key in it', () => {
      for (const file of examplesOf(name, 'valid')) {
        const example = readExample(file);
        const result = schema.safeParse(example);
        expect(result.error ? issuesOf(result.error) : [], file).toEqual([]);
        const kept = new Set(keyPaths(result.data));
        expect(keyPaths(example).filter((path) => !kept.has(path)), `${file}: keys the schema drops`).toEqual([]);
      }
    });

    it('refuses every invalid example, each for exactly one reason', () => {
      for (const file of examplesOf(name, 'invalid')) {
        const result = schema.safeParse(readExample(file));
        expect(result.success, `${file} parses`).toBe(false);
        expect(issuesOf(result.error!), `${file} should break exactly one rule`).toHaveLength(1);
      }
    });
  });
});

describe('the value lists the two sides share', () => {
  // TailorIT's test holds the same lists (as this extension's src/core/enums.ts writes them): change both sides at once.
  it("are this extension's, value for value and in its order", () => {
    expect(AUTOFILL_FIELD_KINDS).toEqual(FIELD_KINDS);
    expect(ATS_KINDS).toEqual(PLATFORMS);
    expect(CONTRACT_DEGREE_LEVELS).toEqual(DEGREE_LEVELS);
    expect(LANGUAGE_PROFICIENCIES).toEqual(PROFICIENCIES);
    expect(RACE_CATEGORIES).toEqual(RACES);
    expect(GENDER_IDENTITIES).toEqual(GENDERS);
    expect(CONTRACT_WORK_STATUSES).toEqual(WORK_STATUSES);
  });
});
