/*
 * "Autofill for another job" (v3 Phase 3b; Jobright's "Autofill for Another Job"), under the side panel's job card: a
 * search over the person's tracked jobs in TailorIT (panel/jobSearch: GET /api/autofill/jobs/search, the words they
 * type, nothing of the page), and a choice that makes the job the card, the match, the resume and the fill use for this
 * page (panel/chooseJob). The worker answers each job by its place in the search, never TailorIT's id. A job chosen so
 * says so on the card, with "Use this page's own job" to undo it. Presentational: the requests come in as callbacks.
 */
import { useId, useState, type FormEvent } from 'react';
import type { PanelJobSearchAnswer } from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { Icon } from '../brand/Icon';

type Found = Extract<PanelJobSearchAnswer, { outcome: 'found' }>['items'];

const WORDS = COPY.job.another;

export interface AnotherJobProps {
  /** The search (null: the worker did not answer). */
  search(query: string): Promise<PanelJobSearchAnswer | null>;
  /** The person chose a job of the last search (null: the page's own job again). */
  choose(ref: string | null): void;
  /** The card's job is one the person chose for this page. */
  chosen: boolean;
}

export function AnotherJob({ search, choose, chosen }: AnotherJobProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<{ state: 'idle' } | { state: 'searching' } | { state: 'found'; items: Found }
    | { state: 'refused'; text: string }>({ state: 'idle' });
  const regionId = useId();
  const inputId = useId();

  const run = async (words: string) => {
    setState({ state: 'searching' });
    const answer = await search(words);
    if (answer === null) setState({ state: 'refused', text: COPY.panel.failed });
    else if (answer.outcome === 'found') setState({ state: 'found', items: answer.items });
    else setState({ state: 'refused', text: WORDS.outcomes[answer.outcome] });
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state.state === 'idle') void run('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(query.trim());
  };

  return (
    <div className="tia-another" data-another-job={open ? 'open' : 'closed'}>
      {chosen && (
        <p className="tia-another__chosen" data-job-chosen="">
          <Icon name="check" size={14} className="tia-icon" />
          <span>{WORDS.chosen}</span>
          <button type="button" className="tia-button tia-button--quiet" data-job-action="page-job"
            onClick={() => choose(null)}>{WORDS.pageJob}</button>
        </p>
      )}
      <button type="button" className="tia-linkbutton" aria-expanded={open} aria-controls={regionId}
        data-job-action="another" onClick={toggle}>{WORDS.open}</button>
      {open && (
        <section className="tia-another__box" id={regionId} aria-label={WORDS.heading}>
          <p className="tia-help">{WORDS.help}</p>
          <form className="tia-another__form" role="search" onSubmit={submit}>
            <label className="tia-visually-hidden" htmlFor={inputId}>{WORDS.label}</label>
            <input id={inputId} className="tia-input" type="search" value={query} maxLength={200}
              placeholder={WORDS.placeholder} onChange={(event) => setQuery(event.target.value)} />
            <button type="submit" className="tia-button" disabled={state.state === 'searching'}>{WORDS.label}</button>
          </form>
          {state.state === 'searching' && <p className="tia-help" role="status">{WORDS.searching}</p>}
          {state.state === 'refused' && <p className="tia-help" role="status" data-search-refused="">{state.text}</p>}
          {state.state === 'found' && state.items.length === 0 && <p className="tia-help" role="status">{WORDS.none}</p>}
          {state.state === 'found' && state.items.length > 0 && (
            <ul className="tia-another__list">
              {state.items.map((item) => (
                <li key={item.ref} className="tia-another__item">
                  <span className="tia-another__what">
                    <strong className="tia-another__title">{item.title}</strong>
                    <span className="tia-another__where">{[item.company, item.location].filter((part) => part !== '')
                      .join(' · ')}</span>
                  </span>
                  <button type="button" className="tia-button tia-button--quiet" data-job-choice={item.ref}
                    aria-label={`${WORDS.use}: ${item.title}`} onClick={() => {
                      setOpen(false);
                      choose(item.ref);
                    }}>{WORDS.use}</button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="tia-button tia-button--quiet" onClick={() => setOpen(false)}>{WORDS.close}</button>
        </section>
      )}
    </div>
  );
}
