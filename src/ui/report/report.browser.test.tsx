import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '../../shared/copy';
import { button, click, frameReport, mount, PROFILE_SENTINELS, row, unmountAll } from '../ui.testkit';
import { Report, type SuggestionLabel } from './Report';
import { adoptStyles, REPORT_CSS } from './styles';

const rowsOf = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('li[data-field-key]')];

/** Whether a stylesheet holding the report's rules is adopted by `root`. */
const adopts = (root: Document | ShadowRoot) =>
  root.adoptedStyleSheets.some((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.startsWith('.tia-report')));

describe('the report', () => {
  afterEach(() => {
    unmountAll();
    vi.unstubAllGlobals();
  });

  it('names each form of the tab, then lists Required and Optional, each row a plain line: its icon and label (v4 ui)', async () => {
    const reports = [
      frameReport(4, { platform: 'greenhouse', adapter: 'greenhouse', fields: [
        row('gh|main|email|none|0', { label: 'Email', section: 'Apply for this job', required: true }),
      ] }),
      frameReport(0, { fields: [
        row('lever|main|first|none|0', { label: 'First name', section: 'Contact' }),
        row('lever|main|school|abc|0', { label: 'School', section: 'Education', status: 'flagged', provenance: 'llm-pick',
          matcherStage: 'llm', confidence: 0.75, reason: 'llm-pick-needs-review', wrote: true }),
        row('lever|main|phone|none|0', { label: 'Phone', section: 'Contact', status: 'skipped', provenance: null,
          confidence: 0, reason: 'no-profile-value', wrote: false, verification: 'not-applicable' }),
      ] }),
    ];
    const root = await mount(<Report reports={reports} />);

    // Two forms: each says which it is and where its run stands.
    const frames = [...root.querySelectorAll<HTMLElement>('[data-frame-id]')];
    expect(frames.map((frame) => frame.dataset.frameId)).toEqual(['0', '4']);
    expect(frames.map((frame) => frame.querySelector('.tia-frame__name')!.textContent))
      .toEqual(['Lever form', 'Greenhouse form, embedded in this page']);
    expect([...root.querySelectorAll('h3')].map((heading) => heading.textContent))
      .toEqual([COPY.report.requiredGroup, COPY.report.optionalGroup]);
    const groupOf = (name: string) => [...root.querySelectorAll<HTMLElement>(`[data-group="${name}"] li[data-field-key]`)]
      .map((each) => [each.dataset.fieldKey, each.dataset.status, each.dataset.provenance, each.dataset.progress]);
    expect(groupOf('required')).toEqual([['gh|main|email|none|0', 'verified', 'profile', 'filled']]);
    expect(groupOf('optional')).toEqual([
      ['lever|main|first|none|0', 'verified', 'profile', 'filled'],
      ['lever|main|school|abc|0', 'flagged', 'llm-pick', 'filled'],
      ['lever|main|phone|none|0', 'skipped', 'none', 'none'],
    ]);
    // v4 ui (D1): a row is its icon and its label, nothing more: no fold, no status, reason, source, stage or confidence.
    const school = root.querySelector<HTMLElement>('li[data-field-key="lever|main|school|abc|0"]')!;
    expect(school.querySelector('button.tia-row__toggle')).toBeNull();
    expect(school.textContent).toBe(`${COPY.report.rowStates.filled}School`);
    const phone = root.querySelector<HTMLElement>('li[data-field-key="lever|main|phone|none|0"]')!;
    expect(phone.textContent).toBe(`${COPY.report.rowStates.none}Phone`);
    // (A status chip's words that are also a row state's, said to a screen reader, are the row state's: v4 run renamed
    // flagged "Not filled".)
    const rowStates: readonly string[] = Object.values(COPY.report.rowStates);
    for (const text of [COPY.statuses.flagged, COPY.provenances['llm-pick'], COPY.stages.llm, '75%',
      COPY.reasons['llm-pick-needs-review'], COPY.report.noSource].filter((each) => !rowStates.includes(each))) {
      expect(root.textContent).not.toContain(text);
    }
    // The progress: one required field, filled.
    expect(root.querySelector('[data-progress]')?.getAttribute('data-progress')).toBe('rest');
    expect(root.querySelector('.tia-progress-line__title')?.textContent).toBe(COPY.report.progressFilled(1, 1, true));
    expect(root.querySelector('.tia-progress-line__percent')?.textContent).toBe('100%');
  });

  it('leaves a blocked row out of the lists and the counts (v4 ui, D8): a honeypot is none of the person\'s business', async () => {
    const root = await mount(<Report reports={[frameReport(0, { fields: [
      row('name', { label: 'Name', required: true }),
      row('trap', { label: 'Leave this empty', required: true, status: 'blocked', provenance: null, wrote: false,
        reason: 'honeypot', needsUserAction: true }),
    ] })]} />);
    expect(rowsOf(root).map((each) => each.dataset.fieldKey)).toEqual(['name']);
    expect(root.querySelector('.tia-progress-line__title')?.textContent).toBe(COPY.report.progressFilled(1, 1, true));
    expect(root.querySelector('.tia-progress-line__percent')?.textContent).toBe('100%');
    expect(root.textContent).not.toContain('Leave this empty');
  });

  it('draws no value, whatever else a row object carries', async () => {
    const [email, phone, street, company] = PROFILE_SENTINELS;
    const carrying = { ...row('lever|main|email|none|0', { label: 'Email' }), value: email, current: { kind: 'text', text: phone },
      writtenText: street, cleanLabel: company } as unknown as ReturnType<typeof row>;
    const root = await mount(<Report reports={[frameReport(0, { fields: [carrying] })]} />);
    expect(rowsOf(root)).toHaveLength(1);
    for (const sentinel of PROFILE_SENTINELS) expect(root.outerHTML).not.toContain(sentinel);
  });

  it('puts the notices on top, once each, and the policy card with its buttons while a run waits for it', async () => {
    const decisions: Array<[number, string]> = [];
    const reports = [
      frameReport(0, { notices: [{ code: 'validation' }, { code: 'tripwire', count: 2 }] }),
      frameReport(2, { status: 'policy-notice', notices: [{ code: 'tripwire' }, { code: 'policy' }, { code: 'policy-unreadable' }] }),
    ];
    const root = await mount(<Report reports={reports}
      onPolicyDecision={(frameId, decision) => decisions.push([frameId, decision])} />);
    const notices = [...root.querySelectorAll<HTMLElement>('[data-notice]')];
    expect(notices.map((notice) => notice.dataset.notice)).toEqual(['policy', 'tripwire', 'policy-unreadable', 'validation']);
    expect(notices.map((notice) => notice.querySelector('p')?.textContent ?? notice.textContent)).toEqual([COPY.notices.policy,
      COPY.notices.tripwire, COPY.notices['policy-unreadable'], COPY.notices.validation]);
    // The notices come before every frame.
    const firstFrame = root.querySelector('[data-frame-id]')!;
    expect(notices.every((notice) => notice.compareDocumentPosition(firstFrame) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    // The card's buttons decide for the frame that waits at it (frame 2), never for frame 0.
    await click(button(root, COPY.policyFillAnyway));
    await click(button(root, COPY.policyCancel));
    expect(decisions).toEqual([[2, 'fill'], [2, 'cancel']]);
  });

  it('shows the policy notice without buttons where no one can decide, and no card once nothing waits', async () => {
    const waiting = await mount(<Report reports={[frameReport(0, { status: 'policy-notice' })]} />);
    expect(waiting.querySelector('[data-notice="policy"]')?.textContent).toBe(COPY.notices.policy);
    expect(waiting.querySelectorAll('button')).toHaveLength(0);
    const after = await mount(<Report reports={[frameReport(0, { notices: [{ code: 'policy' }] })]} onPolicyDecision={() => undefined} />);
    expect(after.querySelector('[data-notice="policy"]')?.textContent).toBe(COPY.notices.policy);
    expect(button(after, COPY.policyFillAnyway)).toBeNull();
  });

  it('asks for "Show on page" with the row\'s frame and key', async () => {
    const shown: Array<[number, string]> = [];
    const root = await mount(<Report reports={[frameReport(3, { fields: [row('k1', { label: 'Email' })] })]}
      onShowField={(frameId, key) => shown.push([frameId, key])} />);
    // v3 Phase 3: the row's label is the button, as Jobright's; v4 ui: the side panel's rows have no drawer.
    const label = root.querySelector<HTMLButtonElement>('li[data-field-key="k1"] button.tia-row__go')!;
    expect(label.title).toBe(COPY.report.goTo('Email'));
    await click(label);
    expect(root.querySelector('li[data-field-key="k1"] button.tia-row__toggle')).toBeNull();
    expect(shown).toEqual([[3, 'k1']]);
    unmountAll();
    // The in-page panel's rows (it passes describeField) keep a drawer holding Show on page.
    const drawn = await mount(<Report reports={[frameReport(3, { fields: [row('k1', { label: 'Email' })] })]}
      onShowField={(frameId, key) => shown.push([frameId, key])} describeField={async () => []} />);
    await click(drawn.querySelector<HTMLButtonElement>('li[data-field-key="k1"] button.tia-row__toggle'));
    await click(button(drawn, COPY.report.showOnPage));
    expect(shown).toEqual([[3, 'k1'], [3, 'k1']]);
  });

  it('asks for a row\'s suggested options when it opens, shows them only while it is open, and forgets them', async () => {
    const asked: Array<[number, string]> = [];
    const labels: SuggestionLabel[] = [{ index: 7, label: 'The University of Texas at Austin' }, { index: 2, label: 'UT Health' }];
    const describe = vi.fn(async (frameId: number, key: string) => {
      asked.push([frameId, key]);
      return labels;
    });
    const flagged = row('school', { status: 'flagged', provenance: null, matcherStage: 'none', reason: 'ambiguous-options',
      detail: { suggestions: [{ index: 7, score: 0.91 }, { index: 2, score: 0.62 }] } });
    const root = await mount(<Report reports={[frameReport(0, { fields: [flagged, row('plain')] })]} describeField={describe} />);
    // Only a row with suggestions offers them.
    await click(rowsOf(root)[1]!.querySelector<HTMLButtonElement>('button.tia-row__toggle'));
    expect(rowsOf(root)[1]!.querySelector('[data-action]')).toBeNull();

    await click(rowsOf(root)[0]!.querySelector<HTMLButtonElement>('button.tia-row__toggle'));
    await click(button(root, COPY.report.showSuggestions(2)));
    expect(asked).toEqual([[0, 'school']]);
    const items = [...root.querySelectorAll('[data-option-index]')].map((item) => item.textContent);
    expect(items).toEqual(['The University of Texas at Austin (91%)', 'UT Health (62%)']);

    await click(button(root, COPY.report.hideSuggestions));
    expect(root.textContent).not.toContain('Texas');
    await click(button(root, COPY.report.showSuggestions(2)));
    expect(asked).toHaveLength(2);

    describe.mockResolvedValueOnce(null as never);
    await click(button(root, COPY.report.hideSuggestions));
    await click(button(root, COPY.report.showSuggestions(2)));
    expect(root.textContent).toContain(COPY.report.suggestionsFailed);
  });

  it('says what a frame is doing: its step and a dry run; never a pause\'s instruction or the hidden fields (v4 ui)', async () => {
    const root = await mount(<Report reports={[
      frameReport(0, { status: 'handoff', pauseReason: 'captcha', step: { index: 1, of: 4 }, mode: 'dry-run',
        counters: { passes: 2, hiddenControlsIgnored: 6, deferredFields: 0 } }),
    ]} />);
    const text = root.textContent ?? '';
    expect(text).toContain(`${COPY.runStatuses.handoff} · Step 2 of 4`);
    expect(text).toContain(COPY.report.dryRun);
    // D10: what a pause waits for is said on the page; D8: hidden fields are not the person's business.
    expect(text).not.toContain(COPY.pauseReasons.captcha);
    expect(text).not.toContain('hidden fields');
    expect(root.querySelector('[data-progress-details]')).toBeNull();
  });

  it('offers Preview and Show on the résumé and cover-letter rows: the preview under its row, Show the field (v4 ui)', async () => {
    const shown: Array<[number, string]> = [];
    const opened: string[] = [];
    const reports = [frameReport(2, { fields: [
      row('cv', { kind: 'file', category: 'file.resume', label: 'Resume/CV', required: true }),
      row('letter', { kind: 'file', category: 'file.coverLetter', label: 'Cover letter' }),
      row('letter-box', { kind: 'textarea', category: 'freeText.coverLetter', label: 'Cover letter (text)' }),
      row('email', { label: 'Email' }),
    ] })];
    const root = await mount(<Report reports={reports} onShowField={(frameId, key) => shown.push([frameId, key])}
      previewOf={(each) => (each.category === 'file.resume' ? 'resume' : each.key === 'letter' ? 'coverLetter' : null)}
      renderPreview={(kind, label, close) => {
        opened.push(`${kind}:${label}`);
        return <button type="button" data-fake-preview={kind} onClick={close}>{label}</button>;
      }} />);
    const rowOf = (key: string) => root.querySelector<HTMLElement>(`li[data-field-key="${key}"]`)!;
    expect(['cv', 'letter', 'letter-box', 'email'].map((key) => rowOf(key).dataset.file ?? null))
      .toEqual(['resume', 'coverLetter', null, null]);
    // A row with a file to preview: Preview (an eye) and Show; a cover letter with none: Show alone; any other row: neither.
    const preview = rowOf('cv').querySelector<HTMLButtonElement>('button[data-action="preview"]')!;
    expect([preview.textContent, preview.getAttribute('aria-label'), preview.getAttribute('aria-expanded'),
      preview.querySelector('svg')?.getAttribute('aria-hidden')])
      .toEqual([COPY.report.preview, COPY.report.previewLabel('Resume/CV'), 'false', 'true']);
    expect(rowOf('letter-box').querySelector('button[data-action="preview"]')).toBeNull();
    expect(rowOf('letter-box').querySelector('button[data-action="show-file"]')?.textContent).toBe(COPY.report.show);
    expect(rowOf('email').querySelector('button[data-action="preview"], button[data-action="show-file"]')).toBeNull();
    await click(preview);
    expect([preview.getAttribute('aria-expanded'), opened]).toEqual(['true', ['resume:Resume/CV']]);
    expect(rowOf('cv').querySelector('[data-row-preview="resume"] [data-fake-preview="resume"]')).not.toBeNull();
    // The container's close folds it.
    await click(rowOf('cv').querySelector('[data-fake-preview]'));
    expect(rowOf('cv').querySelector('[data-row-preview]')).toBeNull();
    await click(rowOf('letter').querySelector('button[data-action="preview"]'));
    expect(opened.at(-1)).toBe('coverLetter:Cover letter');
    await click(rowOf('letter').querySelector('button[data-action="show-file"]'));
    expect(shown).toEqual([[2, 'letter']]);
    // Without the container's preview, no Preview at all (the in-page panel).
    const bare = await mount(<Report reports={reports} previewOf={() => 'resume'} />);
    expect(bare.querySelector('button[data-action="preview"]')).toBeNull();
  });

  it('says there is nothing to review without a report', async () => {
    const root = await mount(<Report reports={[]} />);
    expect(root.textContent).toBe(COPY.panelEmpty);
  });

  it('adopts its stylesheet into the root it is mounted in: the document, or a closed shadow root', async () => {
    await mount(<Report reports={[]} />);
    expect(adopts(document)).toBe(true);

    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    const container = document.createElement('div');
    shadow.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<Report reports={[frameReport(0, { fields: [row('k')] })]} />));
    expect(adopts(shadow)).toBe(true);
    expect(shadow.querySelector('li[data-field-key="k"]')).not.toBeNull();
    // Mounted again in the same root, the sheet is not added twice.
    const count = shadow.adoptedStyleSheets.length;
    adoptStyles(shadow, REPORT_CSS);
    expect(shadow.adoptedStyleSheets).toHaveLength(count);
    act(() => root.unmount());
    host.remove();
  });

  it('falls back to a <style> element where the browser cannot construct a stylesheet', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    vi.stubGlobal('CSSStyleSheet', class {
      constructor() {
        throw new Error('not supported');
      }
    });
    adoptStyles(shadow, REPORT_CSS);
    expect(shadow.adoptedStyleSheets).toHaveLength(0);
    expect(shadow.querySelector('style')?.textContent).toBe(REPORT_CSS);
    host.remove();
  });
});
