/*
 * v5 p2-detect (the owner, 2026-11-08: "Jobright is sample, and it works perfectly. you can use it"): the pages after
 * submitting no snapshot shows, read by the rules written from Jobright 1.25.2's per-site submission rules
 * (adapters/success.ts), each on a synthetic page built from its rule (fixtures/synthetic/success/): Workday's task
 * dialog and sign-in content, SuccessFactors' #jobAppPageTitle, BambooHR's "Thank You" block and JazzHR's heading. A
 * sign is read only where a person sees it, with its words, and beside its companion; the decoys (the same words in
 * another place, the place with other words) never.
 */
import { afterEach, describe, expect, it } from 'vitest';
import bamboohrHtml from '../../fixtures/synthetic/success/bamboohr.html?raw';
import jazzhrHtml from '../../fixtures/synthetic/success/jazzhr.html?raw';
import successfactorsHtml from '../../fixtures/synthetic/success/successfactors.html?raw';
import workdayHtml from '../../fixtures/synthetic/success/workday.html?raw';
import { successSignsOf, wordsOf } from '../adapters/success';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { signsOf } from './submitted';

afterEach(() => removeFixtures(document));

const ids = (signs: Element[]) => signs.map((sign) => sign.id || `${sign.parentElement?.id ?? '?'} ${sign.localName}`);

describe("the pages after submitting, by Jobright's rules (v5 p2-detect)", () => {
  it("Workday: the task dialog titled Application Submitted, or saying so, and the sign-in content's Congratulations", async () => {
    const { doc } = await loadFixture(document, workdayHtml);
    expect(ids(signsOf(doc, 'workday'))).toEqual(['task h2', 'task']);
    doc.getElementById('welcome')!.hidden = false;
    expect(ids(signsOf(doc, 'workday'))).toEqual(['task h2', 'task', 'welcome div']);
    // The dialog gone: only the sign-in content's.
    doc.getElementById('task')!.remove();
    expect(ids(signsOf(doc, 'workday'))).toEqual(['welcome div']);
    // Its companion gone: none.
    doc.querySelector('#welcome h1')!.textContent = 'Welcome back';
    expect(signsOf(doc, 'workday')).toEqual([]);
  });

  it("SuccessFactors: #jobAppPageTitle's message beside the Jobs applied button, once shown", async () => {
    const { doc } = await loadFixture(document, successfactorsHtml);
    expect(signsOf(doc, 'successfactors')).toEqual([]);
    doc.getElementById('jobAppPageTitle')!.hidden = false;
    expect(ids(signsOf(doc, 'successfactors'))).toEqual(['success_message']);
    doc.getElementById('fbja_jobsApplied')!.remove();
    expect(signsOf(doc, 'successfactors')).toEqual([]);
  });

  it('BambooHR: the paragraph beside its Thank You heading, never the words alone or the heading beside other words', async () => {
    const { doc } = await loadFixture(document, bamboohrHtml);
    expect(ids(signsOf(doc, 'bamboohr'))).toEqual(['done p']);
    doc.getElementById('done')!.style.display = 'none';
    expect(signsOf(doc, 'bamboohr')).toEqual([]);
  });

  it('JazzHR: the centred heading saying the application was received, nothing else', async () => {
    const { doc } = await loadFixture(document, jazzhrHtml);
    expect(ids(signsOf(doc, 'jazzhr'))).toEqual(['done']);
  });

  it('reads an element by its words as a person reads them, and keeps a rule off a page that shows its exclude', async () => {
    const { doc } = await loadFixture(document, '<!doctype html><body><div id="a">  Thank\n  <b>you</b><script>x</script>'
      + '<style>p{}</style> </div><div id="gate">Create an account</div></body>');
    expect(wordsOf(doc.getElementById('a')!)).toBe('Thank you');
    const rule = { css: '#a', text: /^Thank you$/, from: 'test' };
    expect(successSignsOf(doc, [rule]).map((el) => el.id)).toEqual(['a']);
    expect(successSignsOf(doc, [{ ...rule, exclude: '#gate' }])).toEqual([]);
    doc.getElementById('gate')!.hidden = true;
    expect(successSignsOf(doc, [{ ...rule, exclude: '#gate' }]).map((el) => el.id)).toEqual(['a']);
    // A rule whose selector the browser cannot read is no sign.
    expect(successSignsOf(doc, [{ css: 'div:::nope', from: 'test' }])).toEqual([]);
  });
});
