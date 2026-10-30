import { afterEach, describe, expect, it } from 'vitest';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { genericAdapter } from './index';

describe('the generic adapter', () => {
  afterEach(() => removeFixtures(document));

  it('takes the form with the most visible fields as the form root', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body>
      <form id="search"><input aria-label="Search jobs"></form>
      <form id="application"><label for="a">Name</label><input id="a"><label for="b">Email</label><input id="b">
        <input type="hidden" name="token" value="x"></form>
      <form id="honeypots" style="display:none"><input><input><input></form></body>`);
    expect(genericAdapter.detect(fixture.doc)?.formRoot.id).toBe('application');
  });

  it('falls back to the body when the fields sit outside any form, and finds nothing on a page without fields',
    async () => {
      const loose = await loadFixture(document, '<!doctype html><body><label for="a">Name</label><input id="a"></body>');
      expect(genericAdapter.detect(loose.doc)?.formRoot).toBe(loose.doc.body);
      const posting = await loadFixture(document, '<!doctype html><body><h1>Engineer</h1><p>Apply on the next page.</p></body>');
      expect(genericAdapter.detect(posting.doc)).toBeNull();
    });

  it('reports aria-invalid errors, has no step logic, and never calls a step final', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <input id="bad" aria-invalid="true"><input id="ok" aria-invalid="false">
      <input id="hidden-bad" aria-invalid="TRUE" style="display:none"></form></body>`);
    const root = fixture.doc.querySelector('form')!;
    expect(genericAdapter.errors!(root).map((error) => error.el.id)).toEqual(['bad']);
    expect(genericAdapter.isFinalStep!(fixture.doc)).toBe('unknown');
    expect(genericAdapter.nextButton).toBeUndefined();
    expect(genericAdapter.submitButton).toBeUndefined();
    expect(genericAdapter.sections).toBeUndefined();
  });

  it('keys an application by its origin and path', () => {
    expect(genericAdapter.canonicalApplicationUrl(new URL('https://jobs.lever.co/acme/123/apply?source=x#y')))
      .toBe('https://jobs.lever.co/acme/123/apply');
    expect(genericAdapter.matchesUrl(new URL('https://jobs.lever.co/acme/123/apply'))).toBe(true);
  });
});
