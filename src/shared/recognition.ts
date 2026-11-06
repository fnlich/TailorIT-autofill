/*
 * Why the sentinel recognised a page (v3 Phase 8; src/sentinel/recognise.ts reads them, the worker's page/recognised
 * takes them): a closed list, with no imports, so the sentinel's bundle and the message schemas share it. An embedded
 * applicant-tracking system (its frame, its loader, an embed's gh_jid) is no reason (the Phase 8 review, B3): its own
 * frame gets the static content script.
 */
export const RECOGNITION_REASONS = ['career-site', 'platform', 'job-posting', 'application-form'] as const;
export type RecognitionReason = (typeof RECOGNITION_REASONS)[number];
