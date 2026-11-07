/*
 * Phase 6's additions to the report: the step's progress line, the row action Confirm draft (in the in-page panel's
 * drawer; v4 ui, D6: Save my answer is never offered), actions limited to one frame (the in-page panel's), and the
 * stored-copy line under the policy notice, as the page's own card says it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { COPY } from '../../shared/copy';
import { button, click, frameReport, mount, row, unfoldRows, unmountAll } from '../ui.testkit';
import { Report, RunStatusLine } from './Report';

const rowOf = (root: ParentNode, key: string) => root.querySelector<HTMLElement>(`li[data-field-key="${key}"]`)!;
const action = (root: ParentNode, key: string, name: string) => rowOf(root, key).querySelector(`button[data-action="${name}"]`);

/** An AI draft that waits for the person, and one they confirmed. */
const waitingDraft = row('why', { kind: 'textarea', category: 'freeText.whyCompany', status: 'flagged', provenance: 'llm-draft',
  reason: 'llm-draft-needs-confirmation', needsUserAction: true, confidence: 0.75 });
const confirmedDraft = row('cover', { kind: 'textarea', category: 'freeText.coverLetter', status: 'filled',
  provenance: 'llm-draft', reason: 'ok', needsUserAction: false });

/** A flagged question the person then answered themselves, and others the review never offers to save. */
const fixed = row('notice', { category: 'screening.other', status: 'flagged', provenance: null, reason: 'unknown-field',
  needsUserAction: true, wrote: false, detail: { userEdited: true } });
const untouched = row('relocate', { category: 'screening.other', status: 'flagged', provenance: null, reason: 'unknown-field',
  needsUserAction: true, wrote: false });
const eeo = row('gender', { kind: 'select', category: 'eeo.gender', status: 'flagged', provenance: null,
  reason: 'eeo-not-in-profile', needsUserAction: true, wrote: false, detail: { userEdited: true } });
const consent = row('privacy', { kind: 'checkbox', category: 'consent.privacy', status: 'flagged', provenance: null,
  reason: 'consent-requires-user', needsUserAction: true, wrote: false, detail: { userEdited: true } });
const upload = row('portfolio', { kind: 'file', category: 'file.other', status: 'flagged', provenance: null,
  reason: 'upload-control-not-recognized', needsUserAction: true, wrote: false, detail: { userEdited: true } });
const verifiedEdited = row('email', { detail: { userEdited: true } });

describe('the report (Phase 6)', () => {
  afterEach(() => unmountAll());

  it('shows the adapter’s progress line for the step where the report has one, else the step’s number', async () => {
    const reports = [
      frameReport(0, { status: 'review', step: { index: 1, progress: 'Step 2 of 4' } }),
      frameReport(5, { status: 'fill-step', step: { index: 2 } }),
    ];
    const root = await mount(<><RunStatusLine reports={reports} /><Report reports={reports} /></>);
    const statuses = [...root.querySelectorAll<HTMLElement>('.tia-frame__status')].map((each) => each.textContent);
    expect(statuses).toEqual([`${COPY.runStatuses.review} · Step 2 of 4`, `${COPY.runStatuses['fill-step']} · Step 3`]);
    // The line above the report is the most urgent run's: the one still filling.
    expect(root.querySelector('p.tia-status')?.textContent).toBe(`${COPY.runStatuses['fill-step']} · Step 3`);
    expect(root.querySelector('p.tia-status')?.getAttribute('data-run-status')).toBe('fill-step');
  });

  it('offers Confirm draft in the drawer on an AI draft that waits for the person, unmarked, with its frame and key', async () => {
    const confirmed: Array<[number, string]> = [];
    const root = await mount(<Report reports={[frameReport(2, { fields: [waitingDraft, confirmedDraft, row('plain')] })]}
      onConfirmDraft={(frameId, key) => confirmed.push([frameId, key])} />);
    // Folded at first (v3 Phase 3 review): its actions are in its drawer.
    expect(action(root, 'why', 'confirm-draft')).toBeNull();
    await unfoldRows(root);
    expect(rowOf(root, 'why').dataset.draft).toBe('true');
    // v4 ui (D6): no "AI draft" mark.
    expect(rowOf(root, 'why').textContent).not.toContain(COPY.report.draftMark);
    expect(rowOf(root, 'plain').dataset.draft).toBe('false');
    expect(action(root, 'cover', 'confirm-draft')).toBeNull();
    expect(action(root, 'plain', 'confirm-draft')).toBeNull();
    await click(action(root, 'why', 'confirm-draft'));
    expect(confirmed).toEqual([[2, 'why']]);
    expect(action(root, 'why', 'confirm-draft')?.textContent).toBe(COPY.report.confirmDraft);
  });

  it('never offers Save my answer, even with its callback and a field the person fixed (v4 ui, D6)', async () => {
    const root = await mount(<Report reports={[frameReport(0, { fields: [fixed, untouched, eeo, consent, upload, verifiedEdited] })]}
      onSaveAnswer={() => undefined} onConfirmDraft={() => undefined} />);
    await unfoldRows(root);
    for (const key of ['notice', 'relocate', 'gender', 'privacy', 'portfolio', 'email']) {
      expect(action(root, key, 'save-answer'), key).toBeNull();
    }
    expect(button(root, COPY.report.saveAnswer)).toBeNull();
  });

  it('draws neither action without its callback, and holds them while a request is on its way', async () => {
    const plain = await mount(<Report reports={[frameReport(0, { fields: [waitingDraft, fixed] })]} />);
    await unfoldRows(plain);
    // Only the rows' folds and the progress line's (v3 Phase 3): no action.
    expect(plain.querySelectorAll('button[data-action]:not([data-action="toggle-fields"]), button.tia-row__go'))
      .toHaveLength(0);
    // v4 ui: and no drawer: the rows are plain lines.
    expect(plain.querySelector('button.tia-row__toggle')).toBeNull();
    const busy = await mount(<Report reports={[frameReport(0, { fields: [waitingDraft, fixed] })]} busy
      onConfirmDraft={() => undefined} />);
    await unfoldRows(busy);
    expect(action(busy, 'why', 'confirm-draft')?.hasAttribute('disabled')).toBe(true);
  });

  it('acts on one frame’s rows only when told to (the in-page panel’s own frame)', async () => {
    const shown: Array<[number, string]> = [];
    const reports = [frameReport(0, { fields: [row('top-email'), waitingDraft] }),
      frameReport(4, { platform: 'greenhouse', adapter: 'greenhouse', fields: [row('embed-email')] })];
    const root = await mount(<Report reports={reports} actionsFrameId={4} onShowField={(frameId, key) => shown.push([frameId, key])}
      onConfirmDraft={() => undefined} />);
    // Another frame's row has no action and no drawer.
    expect(rowOf(root, 'top-email').querySelector('button')).toBeNull();
    expect(action(root, 'why', 'confirm-draft')).toBeNull();
    await click(rowOf(root, 'embed-email').querySelector<HTMLButtonElement>('button.tia-row__toggle'));
    await click(action(root, 'embed-email', 'show-field'));
    await click(rowOf(root, 'embed-email').querySelector<HTMLButtonElement>('button.tia-row__go'));
    expect(shown).toEqual([[4, 'embed-email'], [4, 'embed-email']]);
  });

  it('says under the policy notice when only TailorIT’s saved copy of the posting said it, as the page’s card does', async () => {
    const decisions: string[] = [];
    const waiting = await mount(<Report reports={[frameReport(0, { status: 'policy-notice',
      notices: [{ code: 'policy' }, { code: 'policy-stored-copy' }] })]} onPolicyDecision={(_frame, decision) => decisions.push(decision)} />);
    const card = waiting.querySelector('[data-notice="policy"]')!;
    expect([...card.querySelectorAll('p')].map((p) => p.textContent)).toEqual([COPY.notices.policy, COPY.policyFromStoredCopy]);
    // The stored-copy line is part of the policy notice, never a notice of its own.
    expect(waiting.querySelector('[data-notice="policy-stored-copy"]')).toBeNull();
    await click(button(waiting, COPY.policyFillAnyway));
    expect(decisions).toEqual(['fill']);

    const past = await mount(<Report reports={[frameReport(0, { notices: [{ code: 'policy' }, { code: 'policy-stored-copy' }] })]} />);
    expect(past.querySelector('[data-notice="policy"] [data-notice-source="stored-copy"]')?.textContent).toBe(COPY.policyFromStoredCopy);
    const onPage = await mount(<Report reports={[frameReport(0, { status: 'policy-notice', notices: [{ code: 'policy' }] })]} />);
    expect(onPage.querySelector('[data-notice-source]')).toBeNull();
    // In profile-only mode (the default) the notice says where the statement was found too, and only when it was there.
    const profileOnly = await mount(<Report reports={[frameReport(0, { notices: [{ code: 'policy-profile-only' },
      { code: 'policy-stored-copy' }] })]} />);
    const notice = profileOnly.querySelector('[data-notice="policy-profile-only"]')!;
    expect([...notice.querySelectorAll('p')].map((p) => p.textContent)).toEqual([COPY.notices['policy-profile-only'],
      COPY.policyFromStoredCopy]);
    expect(profileOnly.querySelector('[data-notice="policy-stored-copy"]')).toBeNull();
    const fromPage = await mount(<Report reports={[frameReport(0, { notices: [{ code: 'policy-profile-only' }] })]} />);
    expect(fromPage.querySelector('[data-notice="policy-profile-only"]')?.textContent).toBe(COPY.notices['policy-profile-only']);
    expect(fromPage.querySelector('[data-notice-source]')).toBeNull();
  });
});
