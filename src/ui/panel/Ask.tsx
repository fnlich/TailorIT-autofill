/*
 * "Ask a custom question" (v2): a fold under the main buttons where the person types any question about the job and
 * gets an answer written by TailorIT's AI from the tab's active resume (the one the job card attaches, or the one chosen
 * with Change). Short, Medium or Long caps it at 600, 1500 or 3000 characters. The answer card says which resume it was
 * written from, with Copy and Regenerate.
 *
 * It is disabled, saying why, when the extension is not connected, AI-written answers are turned off in Options (the
 * drafts setting: the question is written by the AI too), or the person has no resume. On a posting that says
 * AI-assisted applications are not allowed, that is said above the box (from the tab's reports, or the answer itself,
 * which the worker marks so from the form's visible text even before any run): the person may still ask, since they
 * asked. The question and the answer live in this component's state only: never stored, never logged, gone when the
 * panel closes or follows another tab.
 *
 * v4 ui (the owner, 2026-11-07): an outline button, "Ask custom question", under the main Autofill button, unfolds the
 * box (and folds it again); what was asked stays while the panel shows the same page.
 */
import { useId, useState } from 'react';
import type { Answer } from '../../messaging/envelope';
import { type AskLength, type PanelAskAnswer } from '../../messaging/schemas';
import { ASK_LENGTHS, MAX_CUSTOM_QUESTION } from '../../messaging/page-schemas';
import { COPY } from '../../shared/copy';
import { Icon } from '../brand/Icon';

type State =
  | { state: 'idle' }
  | { state: 'working' }
  | { state: 'answered'; text: string; label: string; policy: boolean; copied: 'copied' | 'failed' | null }
  | { state: 'refused'; text: string };

export interface AskProps {
  /** Asks the worker (panel/ask). */
  ask(question: string, length: AskLength): Promise<Answer<PanelAskAnswer>>;
  /** Puts text on the clipboard; false when the browser would not. */
  copy(text: string): Promise<boolean>;
  connected: boolean;
  /** AI-written answers are turned off in Options. */
  aiOff?: boolean;
  /** The tab's card says there is no resume to attach. */
  noResume: boolean;
  /** The posting says AI-assisted applications are not allowed. */
  policy: boolean;
}

export function AskQuestion({ ask, copy, connected, aiOff = false, noResume, policy }: AskProps) {
  const questionId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [length, setLength] = useState<AskLength>('medium');
  const [result, setResult] = useState<State>({ state: 'idle' });
  const disabledWhy = !connected ? COPY.ask.notConnected : aiOff ? COPY.ask.outcomes['ai-off']
    : noResume ? COPY.ask.outcomes['no-resume'] : null;
  const working = result.state === 'working';
  const canAsk = disabledWhy === null && !working && question.trim() !== '';
  const forbidsAi = policy || (result.state === 'answered' && result.policy);

  const submit = async () => {
    if (!canAsk) return;
    setResult({ state: 'working' });
    const answer = await ask(question.trim(), length);
    if (!answer.ok) {
      setResult({ state: 'refused', text: answer.error === 'not_connected' ? COPY.ask.outcomes['not-connected']
        : COPY.ask.outcomes.unavailable });
      return;
    }
    const data = answer.data;
    setResult(data.outcome === 'answered'
      ? { state: 'answered', text: data.text, label: data.resumeLabel, policy: data.policy, copied: null }
      // v2.0 fix wave (REQ-1): TailorIT's own words for its AI's refusal, as they are.
      : { state: 'refused', text: data.message ?? COPY.ask.outcomes[data.outcome] });
  };

  const copyAnswer = async (text: string) => {
    const copied = await copy(text).catch(() => false);
    setResult((now) => (now.state === 'answered' && now.text === text ? { ...now, copied: copied ? 'copied' : 'failed' } : now));
  };

  return (
    <section className="tia-ask" data-ask={open ? 'open' : 'closed'}>
      <button type="button" className="tia-outline" aria-expanded={open} aria-controls={bodyId} data-ask-action="open"
        onClick={() => setOpen((was) => !was)}>
        <Icon name="sparkle" size={16} className="tia-icon tia-ask__icon" />
        {COPY.mainView.ask}
      </button>
      <div className="tia-ask__body" id={bodyId} hidden={!open} role="region" aria-label={COPY.ask.heading}>
        {forbidsAi && <p className="tia-ask__policy" data-ask-policy="">{COPY.ask.policy}</p>}
        {disabledWhy !== null && <p className="tia-ask__why" data-ask-disabled="">{disabledWhy}</p>}
        <label className="tia-ask__label" htmlFor={questionId}>{COPY.ask.label}</label>
        <textarea id={questionId} className="tia-ask__input" rows={3} maxLength={MAX_CUSTOM_QUESTION}
          placeholder={COPY.ask.placeholder} value={question} disabled={disabledWhy !== null}
          onChange={(event) => setQuestion(event.currentTarget.value)} />
        <fieldset className="tia-ask__lengths" disabled={disabledWhy !== null}>
          <legend className="tia-ask__legend">{COPY.ask.length}</legend>
          {ASK_LENGTHS.map((each) => (
            <label key={each} className="tia-ask__length">
              <input type="radio" name={`${questionId}-length`} value={each} checked={length === each}
                onChange={() => setLength(each)} />
              <span>{COPY.ask.lengths[each]}</span>
            </label>
          ))}
        </fieldset>
        <button type="button" className="tia-button tia-button--primary tia-ask__submit" disabled={!canAsk}
          data-ask-action="submit" onClick={() => void submit()}>
          {working && <Icon name="spinner" size={16} className="tia-icon tia-spin" />}
          {working ? COPY.ask.working : COPY.ask.submit}
        </button>
        {result.state === 'refused' && <p className="tia-ask__refused" role="status" data-ask-refused="">{result.text}</p>}
        {result.state === 'answered' && (
          <div className="tia-ask__answer" data-ask-answer="">
            <p className="tia-ask__from">{COPY.ask.writtenFrom(result.label)}</p>
            <p className="tia-ask__text">{result.text}</p>
            <div className="tia-ask__actions">
              <button type="button" className="tia-button" data-ask-action="copy" onClick={() => void copyAnswer(result.text)}>
                {COPY.ask.copy}
              </button>
              <button type="button" className="tia-button" data-ask-action="regenerate" disabled={!canAsk}
                onClick={() => void submit()}>{COPY.ask.regenerate}</button>
            </div>
            {result.copied !== null && (
              <p className="tia-ask__copied" role="status">{result.copied === 'copied' ? COPY.ask.copied : COPY.ask.copyFailed}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
