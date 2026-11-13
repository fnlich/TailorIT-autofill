/*
 * jr8 ICIMS (the owner's snapshot11 of 2026-11-13): careers-healthedge's Candidate Profile asks the email again in a
 * required text box labelled "Email Verification" (rcf2020), which no rule read, so the AI guessed it. The email typed
 * again is the email (label.email-again); a code sent to the email is never the email. Labels are the pages' own words
 * (the converted captures': fixtures/icims/jr8-healthedge-profile.frame-1 and the account pages of other platforms).
 */
import { describe, expect, it } from 'vitest';
import type { FieldKind } from '../enums';
import { specOf, vocab } from '../plan/plan.testkit';
import { classifyField } from './resolve';

function read(label: string, kind: FieldKind = 'text') {
  const classified = classifyField(specOf(label, kind, {}), vocab);
  return classified.by === 'rules' ? { category: classified.rules?.category ?? null, rule: classified.rules?.rule ?? null }
    : { category: null, rule: null };
}

describe('jr8 ICIMS: the email typed again is the email', () => {
  it.each([
    'Email Verification', // careers-healthedge's rcf2020
    'Confirm your email', // SmartRecruiters' one-click
    'Retype Email Address', // SuccessFactors' account
    'Re-enter Email', // ClearCompany's account
    'Confirm Email Address', // Dayforce's candidate information
    'Verify Email', 'E-mail confirmation', 'Email address again', 'Please confirm your e-mail address',
  ])('%s: contact.email by label.email-again', (label) => {
    expect(read(label)).toEqual({ category: 'contact.email', rule: 'label.email-again' });
  });

  it('keeps the email itself on label.email', () => {
    expect(read('Email')).toEqual({ category: 'contact.email', rule: 'label.email' });
    expect(read('Email Address')).toEqual({ category: 'contact.email', rule: 'label.email' });
  });

  it.each(['Email verification code', 'Verify your email by entering the code we sent', 'Email Verification Code',
    'Confirm your phone', 'I confirm my email address is correct'])('%s: never the email by this rule', (label) => {
    expect(read(label).rule).not.toBe('label.email-again');
  });

  it('never ticks a box for it', () => {
    expect(read('Email Verification', 'checkbox').category).not.toBe('contact.email');
  });
});
