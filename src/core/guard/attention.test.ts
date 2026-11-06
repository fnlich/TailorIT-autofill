import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATTENTION_PATTERNS, attentionHits, BOT_CHECK_ATTENTION, botCheckOf, namesBotCheck, namesConsentTopic,
  PERSON_ONLY_ATTENTION, type AttentionPatternId, type BotCheckId,
} from './attention';

describe('the attention-check patterns (§7.9)', () => {
  it('are exactly the design’s, in its order, then the Phase 7a review’s', () => {
    const design = readFileSync(new URL('../../../docs/design/core.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const block = /^```ts\n([\s\S]*?)^```$/m.exec(design.slice(design.indexOf('### 7.9')));
    expect(block).not.toBeNull();
    const source = readFileSync(new URL('./attention.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const lines = block![1]!.split('\n').filter((line) => line.includes('{ id:'));
    expect(lines).toHaveLength(9);
    for (const line of lines) expect(source, line).toContain(line.trim());
    expect(ATTENTION_PATTERNS.map((pattern) => pattern.id)).toEqual(['select-to-prove', 'type-to-prove',
      'prove-reading', 'attention-check', 'if-reading', 'select-labelled', 'answer-literal', 'human-check',
      'arithmetic', 'posting-phrase']);
    // The audit of 2026-11-06 (S-2): the human check and the sum are bot checks, the person's alone.
    expect([...PERSON_ONLY_ATTENTION]).toEqual(['human-check', 'arithmetic', 'posting-phrase']);
    expect([...BOT_CHECK_ATTENTION]).toEqual(['human-check', 'arithmetic']);
  });

  it.each([
    'Did you start your cover letter with the phrase we asked for in the job description?',
    'Did you include the code word requested in the posting?',
    'Did you use the requested keyword in your answer?',
    'Did you begin your application with the words we asked you to use?',
  ])('reads %j as a check only the person can answer', (label) => {
    expect(attentionHits(label, '')).toContain('posting-phrase');
  });

  it("leaves a question about the applicant's work alone", () => {
    for (const label of ['Did you use Python in your last role?', 'Did you start a company?',
      'Did you include references?']) {
      expect(attentionHits(label, ''), label).toEqual([]);
    }
  });

  it.each<[string, AttentionPatternId]>([
    // Trap fixture 6's three questions.
    ["To confirm you are a human, type the word 'human' below.", 'prove-reading'],
    ['Attention check: select PURPLE.', 'attention-check'],
    ["To prove you read this, choose 'Strongly disagree'.", 'prove-reading'],
    // And the other wordings the patterns name.
    ['Please select Blue to show you are paying attention', 'select-to-prove'],
    ["Type 'banana' to confirm you read the posting", 'type-to-prove'],
    ['If you have read the description, pick C', 'if-reading'],
    ['Select the option labelled "Seven"', 'select-labelled'],
    ['Answer "yes" to this question', 'answer-literal'],
    ['Are you a robot?', 'human-check'],
    ['What is 4 + 3?', 'arithmetic'],
    ['Wh\u{0430}t is 4 plus 3?', 'arithmetic'],
  ])('flags %j as %s', (label, id) => {
    expect(attentionHits(label, '')).toContain(id);
  });

  it('reads the description too', () => {
    expect(attentionHits('Favourite colour', 'To show you read this, choose Purple.')).toEqual(['prove-reading']);
  });

  it('leaves ordinary questions alone', () => {
    for (const label of ["Type 'N/A' if not applicable", 'Select your country', 'What is your gender?',
      'How did you hear about us?', 'Which of these skills do you use? (select all that apply)', 'Email',
      'Choose up to 2', '']) {
      expect(attentionHits(label, ''), label).toEqual([]);
    }
  });

  it('tells a consent topic apart, so such a field is consent instead', () => {
    expect(namesConsentTopic('Check this box to confirm you read the privacy policy', '')).toBe(true);
    expect(namesConsentTopic('Attention check: select PURPLE.', '')).toBe(false);
  });

  // CORE-10 (Phase 2 review): ordinary questions read as attention checks, so the person lost their answer (and a
  // pre-approved consent its tick). "Select all that apply" is never an attack (§7.7), and a proof's purpose must be
  // about the reader: that it read this, is human or is paying attention.
  it.each([
    'Please select all that apply to indicate your racial/ethnic background',
    'Select all that apply to show your areas of expertise',
    'Select one option to indicate your veteran status',
    'Check this box to confirm that you agree to our privacy policy',
    'Check this box to confirm you have read the privacy notice',
    'Tick to confirm you have read and agree to the terms',
    'Type your full name to confirm that you have read and agree',
    'Type your full name to confirm that you have read and understood the above',
    'Check this box if you have read the privacy policy',
    'Are you a human resources professional?',
    'Are you a Human Resources Business Partner?',
  ])('leaves %j alone', (label) => {
    expect(attentionHits(label, ''), label).toEqual([]);
  });

  it.each<[string, AttentionPatternId]>([
    // The opposites, which stay attention checks.
    ['Select C to prove you read this', 'select-to-prove'],
    ['Check this box to confirm you are human', 'select-to-prove'],
    ['Select all of these if you are reading this', 'select-to-prove'],
    ['Tick this box to show you are a real person', 'select-to-prove'],
    ['To prove you have read the job description, choose Yellow', 'prove-reading'],
    ['Are you a human?', 'human-check'],
    ['Are you a human being or a bot?', 'human-check'],
  ])('still flags %j as %s', (label, id) => {
    expect(attentionHits(label, '')).toContain(id);
  });
});

// The audit of 2026-11-06 (S-2, S-3): bot checks and CAPTCHA asked as questions, and a site's own "I'm not a robot"
// box, are the person's alone (reason bot-check), read before any consent policy.
describe('bot checks (botCheckOf)', () => {
  it.each<[string, string, Parameters<typeof botCheckOf>[2], BotCheckId]>([
    ['Are you a robot?', '', 'radio', 'human-check'],
    ['Are you human?', '', 'select', 'human-check'],
    ['What is 4 + 3?', '', 'text', 'arithmetic'],
    ['Spam check: what is 7 plus 2?', '', 'text', 'arithmetic'],
    ['CAPTCHA', '', 'text', 'captcha'],
    ['reCAPTCHA', '', 'text', 'captcha'],
    ['Enter the characters you see in the image above', '', 'text', 'captcha'],
    ['Type the text shown in the picture', '', 'text', 'captcha'],
    ['Verification', 'Please enter the letters you see', 'text', 'captcha'],
    ['Security code', 'Enter the security code shown in the image.', 'text', 'captcha'],
    ['Security question: what colour is the sky?', '', 'text', 'captcha'],
    ['Anti-spam question', '', 'text', 'captcha'],
    ["I'm not a robot", '', 'checkbox', 'robot-statement'],
    ['I’m not a robot', '', 'checkbox', 'robot-statement'],
    ['I am a human', '', 'checkbox', 'robot-statement'],
    ['I confirm I am not a bot', '', 'checkbox', 'robot-statement'],
    ['Please confirm you are human', '', 'checkbox', 'robot-statement'],
    ['Check this box to confirm you are human', '', 'checkbox', 'robot-statement'],
    ['Verification', 'Tick to confirm you’re not a robot.', 'checkbox', 'robot-statement'],
    ['I am not a robot', '', 'radio', 'robot-statement'],
  ])('reads %j (%j, %s) as %s', (label, description, kind, id) => {
    expect(botCheckOf(label, description, kind)).toBe(id);
  });

  it.each<[string, string, Parameters<typeof botCheckOf>[2]]>([
    // Trap fixture 6's typed proof stays an attention check, which the `all` scope asks the AI (SPEC-AMENDMENTS §11).
    ["To confirm you are a human, type the word 'human' below.", '', 'text'],
    ['Attention check: select PURPLE.', '', 'radio'],
    ['Are you a human resources professional?', '', 'radio'],
    ['I am a human resources professional', '', 'checkbox'],
    ['I am a person with a disability', '', 'checkbox'],
    ['Please confirm you are a person with the right to work in the UK', '', 'checkbox'],
    ['Security code', '', 'text'],
    ['Email', 'This site is protected by reCAPTCHA and the Google Privacy Policy applies.', 'text'],
    ['Enter the code shown on your invitation letter', '', 'text'],
    ['Write a short text about this picture', '', 'textarea'],
    ['Do you have experience with robotics?', '', 'radio'],
    ['Phone number', '', 'text'],
  ])('leaves %j (%j, %s) alone', (label, description, kind) => {
    expect(botCheckOf(label, description, kind)).toBeNull();
  });

  it('names a bot check in any text an AI answer could be asked about', () => {
    for (const text of ['Enter the characters you see in the image', "I'm not a robot", 'CAPTCHA', 'Spam check']) {
      expect(namesBotCheck(text), text).toBe(true);
    }
    for (const text of ["To confirm you are a human, type the word 'human' below.", 'Why do you want to work here?',
      'Upload a picture of yourself']) {
      expect(namesBotCheck(text), text).toBe(false);
    }
  });
});
