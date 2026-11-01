/*
 * The "I did not use AI" attestation (the owner's amendments; the Phase E review, M5): a field whose rules read it as an
 * AI attestation and whose own words state that no AI was used. A frame holding one is a profile-only frame (planFrame)
 * unless the person's setting is to use the AI anyway; the side panel's Write it now reads the same (the Phase G review,
 * MINOR 5: the content script answers it with job/postingText, so it lives apart from the planner).
 */
import { statesNoAiUse } from '../resolver/classifyRules';
import { classifyField, type FieldClassification } from '../resolver/resolve';
import type { FieldSpec } from '../types/field';

/** Whether a field is an "I did not use AI" attestation: the rules read it as an AI attestation (their category, what
 *  they hand to the person, or one of the consent kinds its label names) and its own words state that no AI was used
 *  (statesNoAiUse). An employer's notice that it may use AI ("AI tools may be used to review my application") is an AI
 *  attestation to the consent policy, never ticked, but switches nothing (the Phase E review, M5). */
function attestsNoAi(spec: FieldSpec, classification: FieldClassification): boolean {
  const rules = classification.by === 'rules' || classification.by === 'tripwire' ? classification.rules : null;
  const named = classification.by === 'attention' ? classification.consent === 'consent.aiAttestation'
    : rules !== null && (rules.category === 'consent.aiAttestation' || rules.asks === 'consent.aiAttestation'
      || (rules.consentKinds ?? []).includes('consent.aiAttestation'));
  return named && statesNoAiUse(spec);
}

/** Whether a frame's fields hold an "I did not use AI" attestation (attestsNoAi). */
export function holdsNoAiAttestation(specs: readonly FieldSpec[]): boolean {
  return specs.some((spec) => attestsNoAi(spec, classifyField(spec)));
}
