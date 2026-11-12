/*
 * The configured platforms' configs (DESIGN-NEW-ATS §3, Phase 0), by platform: read by content/submitted.ts for each
 * one's success sign, and by the configured layer's tests (every config sound: configProblems), nothing else. Each
 * platform's own folder exports its config (src/adapters/<platform>/config.ts); its builder adds one line here, in the
 * marked block, beside its PLATFORM_ADAPTERS entry (src/adapters/index.ts) and its URL_PARSERS entry
 * (src/adapters/address.ts). Phase 0 itself registers none.
 */
import type { Platform } from '../../core/enums';
// ── New ATSs, builder B (DESIGN-NEW-ATS §5) ──
import { CLEARCOMPANY_CONFIG } from '../clearcompany/config';
import { DICE_CONFIG } from '../dice/config';
import { JOBVITE_CONFIG } from '../jobvite/config';
import { PAYLOCITY_CONFIG } from '../paylocity/config';
// ── end New ATSs, builder B ──
// ── New ATSs, builder C (DESIGN-NEW-ATS §5) ──
import { JAZZHR_CONFIG } from '../jazzhr/config';
import { BAMBOOHR_CONFIG } from '../bamboohr/config';
import { RIPPLING_CONFIG } from '../rippling/config';
import { BREEZY_CONFIG } from '../breezy/config';
import { CAREERPLUG_CONFIG } from '../careerplug/config';
import { PINPOINT_CONFIG } from '../pinpoint/config';
import { PAYCOR_CONFIG } from '../paycor/config';
import { HIBOB_CONFIG } from '../hibob/config';
// ── end New ATSs, builder C ──
import type { AtsConfig } from './types';
// ── New ATSs, builder A (DESIGN-NEW-ATS §5) ──
import { ADP_CONFIG } from '../adp';
import { DAYFORCE_CONFIG } from '../dayforce/config';
import { ULTIPRO_CONFIG } from '../ultipro';
// ── end New ATSs, builder A ──
// ── jr7 JDEF-7 ──
import { EIGHTFOLD_CONFIG } from '../eightfold/config';
import { JOBDIVA_CONFIG } from '../jobdiva/config';
// ── end jr7 JDEF-7 ──

/** Every configured platform's config. */
export const ATS_CONFIGS: Partial<Record<Platform, AtsConfig>> = {
  // ── New ATSs: one line per platform, its builder's (DESIGN-NEW-ATS §5) ──
  // Builder A: ADP's and UltiPro's full adapters compose their configs' hooks; none declares a success sign yet.
  adp: ADP_CONFIG, dayforce: DAYFORCE_CONFIG, ultipro: ULTIPRO_CONFIG,
  // ── New ATSs, builder B ──
  jobvite: JOBVITE_CONFIG,
  dice: DICE_CONFIG,
  clearcompany: CLEARCOMPANY_CONFIG,
  paylocity: PAYLOCITY_CONFIG,
  // ── end New ATSs, builder B ──
  // ── builder C ──
  jazzhr: JAZZHR_CONFIG,
  bamboohr: BAMBOOHR_CONFIG,
  rippling: RIPPLING_CONFIG,
  breezy: BREEZY_CONFIG,
  careerplug: CAREERPLUG_CONFIG,
  pinpoint: PINPOINT_CONFIG,
  paycor: PAYCOR_CONFIG,
  hibob: HIBOB_CONFIG,
  // ── end builder C ──
  // ── end New ATSs ──
  // ── jr7 JDEF-7 ──
  jobdiva: JOBDIVA_CONFIG,
  eightfold: EIGHTFOLD_CONFIG,
  // ── end jr7 JDEF-7 ──
};
