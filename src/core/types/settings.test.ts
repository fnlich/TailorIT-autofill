/*
 * Settings version 8 (v5 p1-shell: "Where the panel shows", On the page or Chrome's side panel, version 7's in-page card
 * read as the page; Default view's new meaning). Version 7 (version 4: v3 Phase 3, the owner's modes; version 5: "Résumé already on the page", the behaviour
 * review of 2026-11-06; version 6: v4's "decide, don't flag", no "Ask me each time" and no draft confirmation; version
 * 7: snapshot round 2's "When a list has no match" and the notifications' time): the defaults, and each older version
 * migrated with every choice kept: auto-advance becomes the Next mode, the `all` answers the AI answers mode, "Ask me
 * each time" Profile only, the rest takes its default (the consents' All among them, the owner's decision; Résumé
 * already on the page, Keep it; a list with no match, Other; notifications, until closed).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODES, DEFAULT_SETTINGS, migrateSettings, migrateSettingsV2, migrateSettingsV3, migrateSettingsV4,
  migrateSettingsV5, migrateSettingsV6, migrateSettingsV7, MODE_CHOICES, NO_MATCH_MODES, NOTIFICATION_TIMES,
  PANEL_PLACES, SETTINGS_VERSION, type ModesV6, type SettingsV1, type SettingsV2, type SettingsV3, type SettingsV4,
  type SettingsV5, type SettingsV6, type SettingsV7,
} from './settings';

const { modes: _modes, view: _view, version: _version, panel: _panel, llm, ...rest } = DEFAULT_SETTINGS;
/** Versions 1 to 7's default place: Chrome's side panel, which version 8 keeps (v5 p1-shell). */
const shared = { ...rest, panel: 'side' as const };
/** What versions 1 to 7's defaults read as in version 8: every default, the side panel kept. */
const DEFAULTS_FROM_OLD = { ...DEFAULT_SETTINGS, panel: 'side' as const };
/** Version 5's AI switches at their defaults (the draft confirmation off). */
const llmV5 = { ...llm, confirmDrafts: false };
const V3: SettingsV3 = { ...shared, version: 3, autoAdvance: false, llm: { ...llmV5, answerAll: true } };
/** Version 6's modes at their defaults (before "When a list has no match" and the notifications' time). */
const { noMatch: _noMatch, notifications: _notifications, ...MODES_V6 } = DEFAULT_MODES;
const modesV6 = (change: Partial<ModesV6> = {}): ModesV6 => ({ ...MODES_V6, agentSkip: { ...MODES_V6.agentSkip },
  ...change });
/** Version 7's modes from version 6's: the two new ones at their defaults. */
const withV7 = <T extends object>(modes: T) => ({ ...modes, noMatch: 'other', notifications: 'until-closed' });

describe('settings version 8', () => {
  it('shows the panel on the page by default, in version 8 (v5 p1-shell)', () => {
    expect(SETTINGS_VERSION).toBe(8);
    expect(DEFAULT_SETTINGS.version).toBe(8);
    expect(DEFAULT_SETTINGS.panel).toBe('page');
    expect(PANEL_PLACES).toEqual(['page', 'side']);
  });

  it('migrates version 7: the small in-page card becomes the sidebar on the page, the side panel stays, every other choice kept', () => {
    const v7: SettingsV7 = { ...DEFAULT_SETTINGS, version: 7, panel: 'in-page', view: 'minimized',
      modes: { ...DEFAULT_MODES, next: 'auto', agentSkip: { requiredEmpty: false, noAi: true, legalGuess: true } },
      llm: { ...llm, drafts: false }, telemetry: { optIn: true } };
    const migrated = migrateSettingsV7(v7);
    expect(migrated).toEqual({ ...v7, version: 8, panel: 'page' });
    expect(migrateSettingsV7({ ...v7, panel: 'side' }).panel).toBe('side');
    // Nothing of the old object is shared.
    expect(migrated.modes).not.toBe(v7.modes);
    expect(migrated.modes.agentSkip).not.toBe(v7.modes.agentSkip);
    expect(migrated.llm).not.toBe(v7.llm);
  });
});

describe('settings version 7', () => {
  it('defaults every mode as the owner chose: Manual Next, Submit and sign-in; a new step filled; every consent; all AI answers; a résumé on the page kept; Other for a list with no match; notifications until closed', () => {
    // v4 (D6): nothing asks the person: no draft confirmation, and a posting that forbids AI is filled from the profile.
    expect('confirmDrafts' in DEFAULT_SETTINGS.llm).toBe(false);
    expect(DEFAULT_SETTINGS.llm.whenForbidden).toBe('profile-only');
    expect(DEFAULT_SETTINGS.modes).toEqual({ signIn: 'manual', next: 'manual', afterPageTurn: 'auto', submit: 'manual',
      recordOwn: 'on', consents: 'all', ai: 'all', resumeOnPage: 'keep',
      agentSkip: { requiredEmpty: true, noAi: true, legalGuess: false }, noMatch: 'other', notifications: 'until-closed' });
    // s2 profile: each new mode's choices are its whole list, its default first.
    expect([...MODE_CHOICES.noMatch].sort()).toEqual([...NO_MATCH_MODES].sort());
    expect([...MODE_CHOICES.notifications].sort()).toEqual([...NOTIFICATION_TIMES].sort());
    expect([MODE_CHOICES.noMatch[0], MODE_CHOICES.notifications[0]]).toEqual(['other', 'until-closed']);
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
    expect(migrated).toEqual({ version: 8, panel: 'page', view: 'expanded',
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
    const { resumeOnPage: _added, ...v4modes } = MODES_V6;
    const v4: SettingsV4 = { ...DEFAULT_SETTINGS, version: 4, panel: 'in-page', view: 'minimized',
      modes: { ...v4modes, next: 'auto', submit: 'auto', recordOwn: 'off', consents: 'required', ai: 'profile',
        agentSkip: { requiredEmpty: false, noAi: true, legalGuess: true } },
      preapprovedConsent: ['privacy'], llm: { ...llmV5, drafts: false }, telemetry: { optIn: true },
      offerToSaveAnswers: false, interpretations: { ...DEFAULT_SETTINGS.interpretations, twoOrMoreRaces: false } };
    const migrated = migrateSettingsV4(v4);
    expect(migrated).toEqual({ ...v4, version: 8, panel: 'page', modes: withV7({ ...v4.modes, resumeOnPage: 'keep' }),
      llm: { ...llm, drafts: false } });
    // Nothing of the old object is shared.
    expect(migrated.modes.agentSkip).not.toBe(v4.modes.agentSkip);
    expect(migrated.preapprovedConsent).not.toBe(v4.preapprovedConsent);
    expect(migrated.llm).not.toBe(v4.llm);
  });

  it('migrates version 5 (v4, D6): "Ask me each time" becomes Profile only, the draft confirmation goes, every other choice kept', () => {
    const v5: SettingsV5 = { ...DEFAULT_SETTINGS, version: 5, panel: 'in-page', modes: modesV6({ next: 'auto' }),
      llm: { ...llmV5, confirmDrafts: true, whenForbidden: 'ask', answers: false } };
    const migrated = migrateSettingsV5(v5);
    expect(migrated).toEqual({ ...v5, version: 8, panel: 'page', modes: withV7(v5.modes),
      llm: { ...llm, answers: false, whenForbidden: 'profile-only' } });
    expect('confirmDrafts' in migrated.llm).toBe(false);
    // "Use AI anyway" and Profile only are kept as they were.
    for (const whenForbidden of ['use-ai', 'profile-only'] as const) {
      expect(migrateSettingsV5({ ...v5, llm: { ...v5.llm, whenForbidden } }).llm.whenForbidden).toBe(whenForbidden);
    }
    expect(migrated.modes.agentSkip).not.toBe(v5.modes.agentSkip);
  });

  // s2 profile (snapshot round 2): the two new modes take what version 6 did.
  it('migrates version 6: every choice kept, a list with no match takes its Other, notifications stay until closed', () => {
    const v6: SettingsV6 = { ...DEFAULT_SETTINGS, version: 6, panel: 'in-page', view: 'minimized',
      modes: modesV6({ next: 'auto', consents: 'required', resumeOnPage: 'upload',
        agentSkip: { requiredEmpty: false, noAi: false, legalGuess: true } }),
      llm: { ...llm, drafts: false }, telemetry: { optIn: true } };
    const migrated = migrateSettingsV6(v6);
    expect(migrated).toEqual({ ...v6, version: 8, panel: 'page', modes: withV7(v6.modes) });
    // Nothing of the old object is shared.
    expect(migrated.modes.agentSkip).not.toBe(v6.modes.agentSkip);
    expect(migrated.llm).not.toBe(v6.llm);
    expect(migrated.preapprovedConsent).not.toBe(v6.preapprovedConsent);
  });

  it('migrates version 2 through version 3 (the `all` answers on) and version 1 through both', () => {
    const { answerAll: _answerAll, ...v2llm } = V3.llm;
    const v2: SettingsV2 = { ...V3, version: 2, autoAdvance: true, llm: v2llm };
    expect(migrateSettingsV2(v2)).toEqual({ ...DEFAULTS_FROM_OLD, modes: { ...DEFAULT_MODES, next: 'auto', ai: 'all' } });
    const v1: SettingsV1 = { version: 1, panel: 'side', autoAdvance: false, preapprovedConsent: [],
      llm: { tiebreak: true, classify: true, drafts: false }, telemetry: { optIn: false }, offerToSaveAnswers: true,
      interpretations: { postingCountryForLegal: false, twoOrMoreRaces: false } };
    expect(migrateSettings(v1)).toEqual(DEFAULTS_FROM_OLD);
  });
});
