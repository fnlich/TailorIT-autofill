/*
 * Settings version 4 (v3 Phase 3, the owner's modes): the defaults, and each older version migrated with every choice
 * kept: auto-advance becomes the Next mode, the `all` answers the AI answers mode, the rest takes its default (the
 * consents' All among them, the owner's decision).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODES, DEFAULT_SETTINGS, migrateSettings, migrateSettingsV2, migrateSettingsV3, type SettingsV1, type SettingsV2,
  type SettingsV3,
} from './settings';

const { modes: _modes, view: _view, version: _version, llm, ...shared } = DEFAULT_SETTINGS;
const V3: SettingsV3 = { ...shared, version: 3, autoAdvance: false, llm: { ...llm, answerAll: true } };

describe('settings version 4', () => {
  it('defaults every mode as the owner chose: Manual Next, Submit and sign-in; a new step filled; every consent; all AI answers', () => {
    expect(DEFAULT_SETTINGS.version).toBe(4);
    expect(DEFAULT_SETTINGS.modes).toEqual({ signIn: 'manual', next: 'manual', afterPageTurn: 'auto', submit: 'manual',
      consents: 'all', ai: 'all', agentSkip: { requiredEmpty: true, noAi: true, legalGuess: false } });
    expect(DEFAULT_SETTINGS.view).toBe('expanded');
    // The defaults are copies: changing one never changes the other.
    expect(DEFAULT_SETTINGS.modes).not.toBe(DEFAULT_MODES);
    expect(DEFAULT_SETTINGS.modes.agentSkip).not.toBe(DEFAULT_MODES.agentSkip);
  });

  it('migrates version 3: auto-advance is the Next mode, the `all` answers the AI answers mode, every other choice kept', () => {
    const chosen: SettingsV3 = { ...V3, panel: 'in-page', autoAdvance: true, preapprovedConsent: ['privacy', 'sms'],
      llm: { ...V3.llm, answerAll: false, drafts: false, whenForbidden: 'ask' }, offerToSaveAnswers: false,
      telemetry: { optIn: true }, interpretations: { ...V3.interpretations, twoOrMoreRaces: false } };
    const migrated = migrateSettingsV3(chosen);
    expect(migrated).toEqual({ version: 4, panel: 'in-page', view: 'expanded',
      modes: { ...DEFAULT_MODES, next: 'auto', ai: 'profile' }, preapprovedConsent: ['privacy', 'sms'],
      llm: { ...llm, drafts: false, whenForbidden: 'ask' }, offerToSaveAnswers: false, telemetry: { optIn: true },
      interpretations: { ...V3.interpretations, twoOrMoreRaces: false } });
    expect('answerAll' in migrated.llm).toBe(false);
    expect('autoAdvance' in migrated).toBe(false);
    // Its defaults stand otherwise: Manual Next, All AI answers.
    expect(migrateSettingsV3(V3).modes).toEqual(DEFAULT_MODES);
    // Nothing of the old object is shared.
    expect(migrated.preapprovedConsent).not.toBe(chosen.preapprovedConsent);
  });

  it('migrates version 2 through version 3 (the `all` answers on) and version 1 through both', () => {
    const { answerAll: _answerAll, ...v2llm } = V3.llm;
    const v2: SettingsV2 = { ...V3, version: 2, autoAdvance: true, llm: v2llm };
    expect(migrateSettingsV2(v2)).toEqual({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_MODES, next: 'auto', ai: 'all' } });
    const v1: SettingsV1 = { version: 1, panel: 'side', autoAdvance: false, preapprovedConsent: [],
      llm: { tiebreak: true, classify: true, drafts: false }, telemetry: { optIn: false }, offerToSaveAnswers: true,
      interpretations: { postingCountryForLegal: false, twoOrMoreRaces: false } };
    expect(migrateSettings(v1)).toEqual(DEFAULT_SETTINGS);
  });
});
