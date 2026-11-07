/*
 * Settings version 6 (version 4: v3 Phase 3, the owner's modes; version 5: "Résumé already on the page", the behaviour
 * review of 2026-11-06; version 6: v4's "decide, don't flag", no "Ask me each time" and no draft confirmation): the
 * defaults, and each older version migrated with every choice kept: auto-advance becomes the Next mode, the `all`
 * answers the AI answers mode, "Ask me each time" Profile only, the rest takes its default (the consents' All among
 * them, the owner's decision; Résumé already on the page, Keep it).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODES, DEFAULT_SETTINGS, migrateSettings, migrateSettingsV2, migrateSettingsV3, migrateSettingsV4,
  migrateSettingsV5, type SettingsV1, type SettingsV2, type SettingsV3, type SettingsV4, type SettingsV5,
} from './settings';

const { modes: _modes, view: _view, version: _version, llm, ...shared } = DEFAULT_SETTINGS;
/** Version 5's AI switches at their defaults (the draft confirmation off). */
const llmV5 = { ...llm, confirmDrafts: false };
const V3: SettingsV3 = { ...shared, version: 3, autoAdvance: false, llm: { ...llmV5, answerAll: true } };

describe('settings version 6', () => {
  it('defaults every mode as the owner chose: Manual Next, Submit and sign-in; a new step filled; every consent; all AI answers; a résumé on the page kept', () => {
    expect(DEFAULT_SETTINGS.version).toBe(6);
    // v4 (D6): nothing asks the person: no draft confirmation, and a posting that forbids AI is filled from the profile.
    expect('confirmDrafts' in DEFAULT_SETTINGS.llm).toBe(false);
    expect(DEFAULT_SETTINGS.llm.whenForbidden).toBe('profile-only');
    expect(DEFAULT_SETTINGS.modes).toEqual({ signIn: 'manual', next: 'manual', afterPageTurn: 'auto', submit: 'manual',
      recordOwn: 'on', consents: 'all', ai: 'all', resumeOnPage: 'keep',
      agentSkip: { requiredEmpty: true, noAi: true, legalGuess: false } });
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
    expect(migrated).toEqual({ version: 6, panel: 'in-page', view: 'expanded',
      modes: { ...DEFAULT_MODES, next: 'auto', ai: 'profile' }, preapprovedConsent: ['privacy', 'sms'],
      llm: { ...llm, drafts: false, whenForbidden: 'profile-only' }, offerToSaveAnswers: false, telemetry: { optIn: true },
      interpretations: { ...V3.interpretations, twoOrMoreRaces: false } });
    expect('answerAll' in migrated.llm).toBe(false);
    expect('autoAdvance' in migrated).toBe(false);
    // Its defaults stand otherwise: Manual Next, All AI answers.
    expect(migrateSettingsV3(V3).modes).toEqual(DEFAULT_MODES);
    // Nothing of the old object is shared.
    expect(migrated.preapprovedConsent).not.toBe(chosen.preapprovedConsent);
  });

  it('migrates version 4: every choice kept, "Résumé already on the page" Keep it (the behaviour review of 2026-11-06)', () => {
    const { resumeOnPage: _added, ...v4modes } = DEFAULT_MODES;
    const v4: SettingsV4 = { ...DEFAULT_SETTINGS, version: 4, panel: 'in-page', view: 'minimized',
      modes: { ...v4modes, next: 'auto', submit: 'auto', recordOwn: 'off', consents: 'required', ai: 'profile',
        agentSkip: { requiredEmpty: false, noAi: true, legalGuess: true } },
      preapprovedConsent: ['privacy'], llm: { ...llmV5, drafts: false }, telemetry: { optIn: true },
      offerToSaveAnswers: false, interpretations: { ...DEFAULT_SETTINGS.interpretations, twoOrMoreRaces: false } };
    const migrated = migrateSettingsV4(v4);
    expect(migrated).toEqual({ ...v4, version: 6, modes: { ...v4.modes, resumeOnPage: 'keep' },
      llm: { ...llm, drafts: false } });
    // Nothing of the old object is shared.
    expect(migrated.modes.agentSkip).not.toBe(v4.modes.agentSkip);
    expect(migrated.preapprovedConsent).not.toBe(v4.preapprovedConsent);
    expect(migrated.llm).not.toBe(v4.llm);
  });

  it('migrates version 5 (v4, D6): "Ask me each time" becomes Profile only, the draft confirmation goes, every other choice kept', () => {
    const v5: SettingsV5 = { ...DEFAULT_SETTINGS, version: 5, panel: 'in-page',
      modes: { ...DEFAULT_MODES, next: 'auto', agentSkip: { ...DEFAULT_MODES.agentSkip } },
      llm: { ...llmV5, confirmDrafts: true, whenForbidden: 'ask', answers: false } };
    const migrated = migrateSettingsV5(v5);
    expect(migrated).toEqual({ ...v5, version: 6, llm: { ...llm, answers: false, whenForbidden: 'profile-only' } });
    expect('confirmDrafts' in migrated.llm).toBe(false);
    // "Use AI anyway" and Profile only are kept as they were.
    for (const whenForbidden of ['use-ai', 'profile-only'] as const) {
      expect(migrateSettingsV5({ ...v5, llm: { ...v5.llm, whenForbidden } }).llm.whenForbidden).toBe(whenForbidden);
    }
    expect(migrated.modes.agentSkip).not.toBe(v5.modes.agentSkip);
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
