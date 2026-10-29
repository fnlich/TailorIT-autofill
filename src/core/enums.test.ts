import { describe, expect, it } from 'vitest';
import { DEGREE_LEVELS, FILL_STATUSES, PROVENANCES } from './enums';

describe("the spec's closed lists", () => {
  it('has exactly the five provenances, the five statuses and the seven degree levels', () => {
    expect(PROVENANCES).toEqual(['profile', 'saved', 'rule', 'llm-pick', 'llm-draft']);
    expect([...FILL_STATUSES].sort()).toEqual(['blocked', 'filled', 'flagged', 'skipped', 'verified']);
    expect(DEGREE_LEVELS).toEqual(['highSchool', 'associate', 'bachelor', 'master', 'doctorate', 'professional', 'other']);
  });
});
