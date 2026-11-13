import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The owner's specification, as received on 2026-10-29. Changing docs/SPEC.md below its first line fails this test. */
const SPEC_SHA256 = '216576731d9e4e5c81c6e22f9fdbcd9e0f40e97f004b00afbf2606b29ac29ae4';

describe('docs/SPEC.md', () => {
  it("is the owner's specification, byte for byte", () => {
    const text = readFileSync(new URL('../docs/SPEC.md', import.meta.url), 'utf8');
    const body = text.slice(text.indexOf('\n') + 1);
    expect(createHash('sha256').update(body).digest('hex')).toBe(SPEC_SHA256);
  });
});

// The jr7 review fixes (C-1, A-6, C-3, C-4, D-7): the docs say what the code does. Each stale sentence the review found
// stays gone, and each corrected one is there.
describe('the jr7 docs, as the review fixes corrected them', () => {
  const doc = (name: string) => readFileSync(new URL(`../docs/${name}`, import.meta.url), 'utf8');
  const docs = ['ARCHITECTURE.md', 'PRIVACY.md', 'SPEC-AMENDMENTS.md', 'OWNER-QUESTIONS.md', 'CONTRACT.md'];

  it('never says Run auto-apply refuses every site with a check or a code, nor that Workday is filtered to guest tenants', () => {
    for (const name of docs) {
      const text = doc(name);
      expect(text, name).not.toMatch(/never a site that shows a (?:human )?check/);
      expect(text, name).not.toMatch(/Workday's guest tenants|workday \(its guest tenants\)|Workday \(its guest tenants/);
    }
    for (const name of ['ARCHITECTURE.md', 'PRIVACY.md', 'SPEC-AMENDMENTS.md']) {
      expect(doc(name), name).toContain('a site it already took staying');
    }
  });

  it('says Paycom\'s Continue To Application is pressed on Sign-in Auto alone, its portal covered, never "still needs" it', () => {
    for (const name of docs) expect(doc(name), name).not.toMatch(/still needs? Sign-in Auto/);
    const privacy = doc('PRIVACY.md');
    expect(privacy).toContain('there the contact dialog\'s "Continue To Application", which makes the candidate\'s account on Paycom, is pressed with Sign-in on Auto (or for one Autofill with Sign Up & Autofill) alone');
    expect(privacy).toContain('and since the jr7 review fixes Paycom\'s candidate portal pages, whose contact dialog gets the email alone, never the password');
    expect(privacy).not.toMatch(/nor on UKG Ready's, Paycom's, JobDiva's or Eightfold's pages/);
  });

  it('records Lever and Workable kept by decision, and asks for their pages after Submit among the live checks', () => {
    const owner = doc('OWNER-QUESTIONS.md');
    const owed = owner.slice(owner.indexOf('### Live checks jr7 still owes'), owner.indexOf('### Still lacking, per platform'));
    expect(owed).toMatch(/^- \*\*Lever:\*\* the page after Submit/m);
    expect(owed).toMatch(/^- \*\*Workable:\*\* the success panel after Submit/m);
    expect(owner).toContain('Lever and Workable: the page after Submit');
    for (const name of ['ARCHITECTURE.md', 'SPEC-AMENDMENTS.md']) {
      expect(doc(name), name).toMatch(/by the coordinator's decision after the jr7 review \(D-7\)/);
    }
  });
});
